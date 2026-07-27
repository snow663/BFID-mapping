# BFID Mapping

A local-first mapping application for Belle Fourche Irrigation District field access, mowing status, structures, and GPS observations.

This repository deliberately separates the lightweight application from the large aerial, LiDAR, and project-data packages. The app works with no location service and no network connection; GPS is optional.

## Current starter capabilities

- Svelte 5 and TypeScript frontend
- MapLibre map with editable project-segment status
- Optional raster PMTiles basemap path
- IndexedDB persistence through Dexie
- Manual working-position placement
- Browser GPS position and field-track recording
- Separate travel and mowing classifications
- Portable JSON backup and restore
- Installable PWA configuration
- Tauri 2 desktop shell
- Demonstration linework around Newell, clearly marked as demo data

## Run the web/PWA version

Requirements: Node.js 22 or newer.

```bash
npm install
npm run dev
```

Open the URL printed by Vite. To test installation and offline application-shell behavior:

```bash
npm run build
npm run preview
```

Browser geolocation requires a secure context. `localhost` is accepted for development; a deployed version should use HTTPS.

## Run the Tauri version

Install the Tauri prerequisites for your operating system, including Rust, then run:

```bash
npm install
npm run tauri dev
```

The same frontend is used by both the PWA and Tauri builds.

## Offline raster PMTiles

Large imagery files are not committed to Git. Place a raster PMTiles archive in `public/maps/` for a bundled test build, for example:

```text
public/maps/aerial.pmtiles
```

Then enter this path in the app:

```text
/maps/aerial.pmtiles
```

The initial PMTiles hook expects a raster archive such as aerial imagery, hillshade, slope shading, or local relief. Vector PMTiles styling and portable `.bfmap` package mounting are planned next.

## Data model

A project segment stores its geometry and two independent operational states:

- **Travel state:** unknown, visually likely, verified, blocked, seasonal, or foot only
- **Mowing state:** unmowed, partial, mowed, needs return, or skipped

GPS tracks are stored as sessions and timestamped points. The original track remains available as evidence for later segment matching.

## Important: demonstration data

All linework and structures included in the first build are fictional demonstration geometry. They are not BFID records and must not be used for navigation or field decisions.

## Next implementation targets

1. Import authoritative BFID centerlines and structure points.
2. Add GeoJSON, GPX, and KML import.
3. Add side-specific canal and drain routes.
4. Build project-package import/export for raster PMTiles plus editable data.
5. Match recorded tracks to segments with distance, heading, and coverage checks.
6. Add access-point routing to the nearest unmowed segment.
7. Generate and package LiDAR-derived hillshade, slope, roughness, and local-relief layers.
8. Add native Android location integration in the Tauri mobile target.

## Repository policy for map data

Do not commit raw LAZ/LAS, GeoTIFF, MBTiles, or PMTiles datasets directly to ordinary Git history. Keep source GIS data in external storage or release assets and document its source, acquisition date, resolution, projection, and license.
