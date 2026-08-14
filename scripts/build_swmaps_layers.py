from __future__ import annotations

import io
import math
import os
import sqlite3
import sys
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from PIL import Image

WEST, SOUTH, EAST, NORTH = -103.95, 44.555, -103.315, 44.768
MIN_ZOOM = 10
MAX_ZOOM = 16
BLOCK = 8
TILE_SIZE = 256
ORIGIN = 20037508.342789244
OUT = Path('swmaps_layers')
OUT.mkdir(exist_ok=True)

@dataclass(frozen=True)
class Layer:
    filename: str
    name: str
    url: str
    wms_layer: str
    image_format: str
    mbtiles_format: str
    attribution: str

LAYERS = [
    Layer(
        'BFID_NAIP_Aerial.mbtiles',
        'BFID NAIP Natural Color',
        'https://imagery.nationalmap.gov/arcgis/services/USGSNAIPImagery/ImageServer/WMSServer',
        'USGSNAIPImagery:NaturalColor',
        'image/jpeg',
        'jpg',
        'USGS / USDA National Agriculture Imagery Program',
    ),
    Layer(
        'BFID_3DEP_Hillshade.mbtiles',
        'BFID 3DEP Multidirectional Hillshade',
        'https://elevation.nationalmap.gov/arcgis/services/3DEPElevation/ImageServer/WMSServer',
        '3DEPElevation:Hillshade Multidirectional',
        'image/jpeg',
        'jpg',
        'USGS 3D Elevation Program (3DEP)',
    ),
    Layer(
        'BFID_3DEP_Slope.mbtiles',
        'BFID 3DEP Slope Map',
        'https://elevation.nationalmap.gov/arcgis/services/3DEPElevation/ImageServer/WMSServer',
        '3DEPElevation:Slope Map',
        'image/png',
        'png',
        'USGS 3D Elevation Program (3DEP)',
    ),
]


def lonlat_to_tile(lon: float, lat: float, z: int) -> tuple[float, float]:
    n = 2 ** z
    x = (lon + 180.0) / 360.0 * n
    r = math.radians(lat)
    y = (1.0 - math.asinh(math.tan(r)) / math.pi) / 2.0 * n
    return x, y


def tile_bounds(x: int, y: int, z: int) -> tuple[float, float, float, float]:
    span = 2 * ORIGIN / (2 ** z)
    xmin = -ORIGIN + x * span
    xmax = xmin + span
    ymax = ORIGIN - y * span
    ymin = ymax - span
    return xmin, ymin, xmax, ymax


def tile_range(z: int) -> tuple[int, int, int, int]:
    x0, y0 = lonlat_to_tile(WEST, NORTH, z)
    x1, y1 = lonlat_to_tile(EAST, SOUTH, z)
    return math.floor(x0), math.floor(x1 - 1e-9), math.floor(y0), math.floor(y1 - 1e-9)


def init_db(path: Path, layer: Layer) -> sqlite3.Connection:
    if path.exists():
        path.unlink()
    con = sqlite3.connect(path)
    con.execute('PRAGMA journal_mode=OFF')
    con.execute('PRAGMA synchronous=OFF')
    con.execute('CREATE TABLE metadata (name TEXT, value TEXT)')
    con.execute('CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB)')
    con.execute('CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row)')
    center_lon = (WEST + EAST) / 2
    center_lat = (SOUTH + NORTH) / 2
    metadata = {
        'name': layer.name,
        'type': 'baselayer',
        'version': '1.0',
        'description': f'{layer.name}; BFID field coverage',
        'format': layer.mbtiles_format,
        'bounds': f'{WEST},{SOUTH},{EAST},{NORTH}',
        'center': f'{center_lon},{center_lat},14',
        'minzoom': str(MIN_ZOOM),
        'maxzoom': str(MAX_ZOOM),
        'attribution': layer.attribution,
    }
    con.executemany('INSERT INTO metadata(name,value) VALUES (?,?)', metadata.items())
    con.commit()
    return con


def wms_bytes(layer: Layer, bbox: tuple[float, float, float, float], width: int, height: int) -> bytes:
    params = {
        'SERVICE': 'WMS',
        'VERSION': '1.3.0',
        'REQUEST': 'GetMap',
        'LAYERS': layer.wms_layer,
        'STYLES': '',
        'CRS': 'EPSG:3857',
        'BBOX': ','.join(f'{v:.6f}' for v in bbox),
        'WIDTH': str(width),
        'HEIGHT': str(height),
        'FORMAT': layer.image_format,
        'TRANSPARENT': 'FALSE',
    }
    url = layer.url + '?' + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={'User-Agent': 'BFID-SWMaps-Offline-Builder/1.0'})
    last: Exception | None = None
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=90) as response:
                data = response.read()
                ctype = response.headers.get_content_type()
                if not ctype.startswith('image/'):
                    raise RuntimeError(f'Unexpected WMS response {ctype}: {data[:180]!r}')
                return data
        except Exception as exc:
            last = exc
            time.sleep(2 ** attempt)
    raise RuntimeError(f'WMS request failed after retries: {last}')


def save_tile(con: sqlite3.Connection, layer: Layer, z: int, x: int, y: int, image: Image.Image) -> None:
    buf = io.BytesIO()
    if layer.mbtiles_format == 'jpg':
        image.convert('RGB').save(buf, format='JPEG', quality=84, optimize=False)
    else:
        image.convert('RGBA').save(buf, format='PNG', compress_level=6)
    tms_y = (2 ** z - 1) - y
    con.execute(
        'INSERT OR REPLACE INTO tiles(zoom_level,tile_column,tile_row,tile_data) VALUES (?,?,?,?)',
        (z, x, tms_y, sqlite3.Binary(buf.getvalue())),
    )


def fetch_block(con: sqlite3.Connection, layer: Layer, z: int, bx: int, by: int, nx: int, ny: int) -> None:
    xmin, _, _, ymax = tile_bounds(bx, by, z)
    _, ymin, xmax, _ = tile_bounds(bx + nx - 1, by + ny - 1, z)
    try:
        data = wms_bytes(layer, (xmin, ymin, xmax, ymax), nx * TILE_SIZE, ny * TILE_SIZE)
        with Image.open(io.BytesIO(data)) as src:
            img = src.convert('RGBA' if layer.mbtiles_format == 'png' else 'RGB')
            if img.size != (nx * TILE_SIZE, ny * TILE_SIZE):
                raise RuntimeError(f'Unexpected image size {img.size}')
            for j in range(ny):
                for i in range(nx):
                    tile = img.crop((i*TILE_SIZE, j*TILE_SIZE, (i+1)*TILE_SIZE, (j+1)*TILE_SIZE))
                    save_tile(con, layer, z, bx+i, by+j, tile)
        return
    except Exception as exc:
        if nx == 1 and ny == 1:
            raise
        print(f'Block {z}/{bx}/{by} {nx}x{ny} failed ({exc}); splitting', flush=True)
        sx = max(1, nx // 2)
        sy = max(1, ny // 2)
        parts = []
        for oy in (0, sy):
            if oy >= ny:
                continue
            for ox in (0, sx):
                if ox >= nx:
                    continue
                parts.append((bx+ox, by+oy, min(sx, nx-ox), min(sy, ny-oy)))
        for px, py, pnx, pny in parts:
            fetch_block(con, layer, z, px, py, pnx, pny)


def build(layer: Layer) -> tuple[Path, int]:
    path = OUT / layer.filename
    con = init_db(path, layer)
    total = 0
    try:
        for z in range(MIN_ZOOM, MAX_ZOOM + 1):
            xmin, xmax, ymin, ymax = tile_range(z)
            count = (xmax-xmin+1) * (ymax-ymin+1)
            print(f'{layer.name}: zoom {z}: {count} tiles', flush=True)
            for by in range(ymin, ymax+1, BLOCK):
                for bx in range(xmin, xmax+1, BLOCK):
                    nx = min(BLOCK, xmax-bx+1)
                    ny = min(BLOCK, ymax-by+1)
                    fetch_block(con, layer, z, bx, by, nx, ny)
            con.commit()
            total += count
    finally:
        con.commit()
        con.close()
    return path, total


def main() -> int:
    built = []
    for layer in LAYERS:
        path, count = build(layer)
        built.append((path, count))
        print(f'Built {path} ({path.stat().st_size/1024/1024:.1f} MiB, {count} tiles)', flush=True)

    readme = OUT / 'README_SWMaps.txt'
    lines = [
        'BFID SW Maps offline raster package',
        '',
        f'Coverage: west {WEST}, south {SOUTH}, east {EAST}, north {NORTH}',
        f'Zoom levels: {MIN_ZOOM}-{MAX_ZOOM}',
        '',
        'Files:',
    ]
    for path, count in built:
        lines.append(f'- {path.name}: {count} tiles; {path.stat().st_size/1024/1024:.1f} MiB')
    lines += [
        '',
        'SW Maps Android:',
        '1. Copy the .mbtiles files to SW_Maps/Maps/mbtiles on the device, or use the current Import Layer tool.',
        '2. Open your project -> Layers -> Add -> Tiles / MBTiles.',
        '3. Add NAIP as the aerial base. Add either 3DEP hillshade or slope above it and adjust transparency as desired.',
        '',
        'Sources:',
        '- NAIP natural-color aerial imagery: USGS/USDA National Agriculture Imagery Program service.',
        '- Terrain: USGS 3D Elevation Program (3DEP) dynamic elevation service.',
        '',
        'These files are for field navigation and work tracking, not cadastral or survey boundary determination.',
    ]
    readme.write_text('\n'.join(lines), encoding='utf-8')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
