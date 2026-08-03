import { db } from './db';
import type { TrackPoint, TrackSession } from './types';
import type { SpraySessionRecord } from './spraySession';
import type { WeatherSnapshot } from './sprayWeather';

export type WorkRange = 'week' | 'ytd';

type WorkRow = {
  date: string;
  activity: 'spraying' | 'mowing';
  outcome: string;
  location: string;
  startedAt: string;
  endedAt: string;
  durationMinutes: number;
  distanceMiles: number;
  completedPercent: number | null;
  gpsPoints: number;
  product: string;
  equipment: string;
  gallonsUsed: number | null;
  gallonsPerMile: number | null;
  mowingAcres: number | null;
  acresPerHour: number | null;
  routeSpeedMph: number | null;
  startWeather: string;
  endWeather: string;
};

function rangeStart(range: WorkRange): Date {
  const now = new Date();
  if (range === 'ytd') return new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
  const start = new Date(now);
  const day = start.getDay();
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  start.setDate(start.getDate() - daysSinceMonday);
  start.setHours(0, 0, 0, 0);
  return start;
}

function haversineMiles(a: TrackPoint, b: TrackPoint): number {
  const r = Math.PI / 180;
  const lat1 = a.latitude * r;
  const lat2 = b.latitude * r;
  const dLat = (b.latitude - a.latitude) * r;
  const dLon = (b.longitude - a.longitude) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return (6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))) / 1609.344;
}

function trackDistance(points: TrackPoint[]): number {
  let distance = 0;
  for (let index = 1; index < points.length; index += 1) distance += haversineMiles(points[index - 1], points[index]);
  return distance;
}

function weatherText(snapshot: WeatherSnapshot | undefined): string {
  if (!snapshot) return '';
  const value = (number: number | null, digits = 0): string => number === null ? '?' : number.toFixed(digits);
  const stale = snapshot.stale ? ' stale' : '';
  return `${snapshot.stationId}${stale}; ${value(snapshot.temperatureF)} F; RH ${value(snapshot.relativeHumidityPercent)}%; wind ${value(snapshot.windSpeedMph, 1)} mph; gust ${value(snapshot.windGustMph, 1)} mph`;
}

function localDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}

function localTime(value: string): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

function finite(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function rowsForRange(range: WorkRange): Promise<WorkRow[]> {
  const sessions = await db.trackSessions.where('startedAt').aboveOrEqual(rangeStart(range).toISOString()).toArray() as TrackSession[];
  const operational = sessions.filter((session) => session.activity === 'spraying' || session.activity === 'mowing');
  const rows: WorkRow[] = [];
  for (const raw of operational) {
    if (!raw.endedAt) continue;
    const needsLegacyPoints = raw.completedDistanceMiles === undefined || raw.gpsPointsCaptured === undefined;
    const points = needsLegacyPoints
      ? await db.trackPoints.where('sessionId').equals(raw.id).sortBy('timestamp') as TrackPoint[]
      : [];
    const start = new Date(raw.startedAt).getTime();
    const end = new Date(raw.endedAt).getTime();
    const durationMinutes = raw.durationMinutes ?? Math.max(0, Math.round((end - start) / 60000));
    const distanceMiles = raw.completedDistanceMiles ?? trackDistance(points);
    const gpsPoints = raw.gpsPointsCaptured ?? points.length;

    if (raw.activity === 'spraying') {
      const session = raw as unknown as SpraySessionRecord;
      rows.push({
        date: localDate(session.startedAt),
        activity: 'spraying',
        outcome: session.outcome ?? 'ended',
        location: session.segmentName || session.segmentId || session.workItemId || 'GPS spray site',
        startedAt: localTime(session.startedAt),
        endedAt: localTime(raw.endedAt),
        durationMinutes,
        distanceMiles,
        completedPercent: finite(session.completedPercent),
        gpsPoints,
        product: session.productName || '',
        equipment: session.rigProfileName || session.equipment || '',
        gallonsUsed: finite(session.gallonsUsed),
        gallonsPerMile: finite(session.gallonsPerMile),
        mowingAcres: null,
        acresPerHour: null,
        routeSpeedMph: finite(session.routeSpeedMph),
        startWeather: weatherText(session.startWeather),
        endWeather: weatherText(session.endWeather)
      });
    } else {
      rows.push({
        date: localDate(raw.startedAt),
        activity: 'mowing',
        outcome: raw.outcome ?? 'completed',
        location: raw.segmentName || raw.segmentId || raw.name || raw.workItemId || 'GPS mowing site',
        startedAt: localTime(raw.startedAt),
        endedAt: localTime(raw.endedAt),
        durationMinutes,
        distanceMiles,
        completedPercent: finite(raw.completedPercent),
        gpsPoints,
        product: '',
        equipment: raw.equipmentProfileName || raw.equipment || '',
        gallonsUsed: null,
        gallonsPerMile: null,
        mowingAcres: finite(raw.mowingAcres),
        acresPerHour: finite(raw.acresPerHour),
        routeSpeedMph: finite(raw.routeSpeedMph),
        startWeather: '',
        endWeather: ''
      });
    }
  }
  return rows.sort((a, b) => `${a.date} ${a.startedAt}`.localeCompare(`${b.date} ${b.startedAt}`));
}

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function download(content: BlobPart, type: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function fileStem(range: WorkRange): string {
  return `bfid-work-${range}-${new Date().toISOString().slice(0, 10)}`;
}

export async function exportWorkCsv(range: WorkRange): Promise<void> {
  const rows = await rowsForRange(range);
  const headers: Array<keyof WorkRow> = [
    'date', 'activity', 'outcome', 'location', 'startedAt', 'endedAt', 'durationMinutes', 'distanceMiles',
    'completedPercent', 'gpsPoints', 'product', 'equipment', 'gallonsUsed', 'gallonsPerMile',
    'mowingAcres', 'acresPerHour', 'routeSpeedMph', 'startWeather', 'endWeather'
  ];
  const decimals = new Set<keyof WorkRow>([
    'distanceMiles', 'completedPercent', 'gallonsUsed', 'gallonsPerMile', 'mowingAcres', 'acresPerHour', 'routeSpeedMph'
  ]);
  const csv = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => {
      const value = row[header];
      return csvCell(decimals.has(header) && typeof value === 'number' ? value.toFixed(2) : value);
    }).join(','))
  ].join('\n');
  download(csv, 'text/csv;charset=utf-8', `${fileStem(range)}.csv`);
}

function pdfSafe(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replaceAll('\\', '\\\\')
    .replaceAll('(', '\\(')
    .replaceAll(')', '\\)');
}

function wrapLine(value: string, width = 96): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > width && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function makePdf(lines: string[]): string {
  const pages: string[][] = [];
  for (let index = 0; index < lines.length; index += 46) pages.push(lines.slice(index, index + 46));
  if (!pages.length) pages.push(['No work records in this range.']);

  const objects: string[] = [];
  const pageIds = pages.map((_, index) => 4 + index * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

  pages.forEach((page, index) => {
    const pageId = 4 + index * 2;
    const contentId = pageId + 1;
    const commands = [
      'BT',
      '/F1 9 Tf',
      '40 760 Td',
      ...page.flatMap((line) => [`(${pdfSafe(line)}) Tj`, '0 -15 Td']),
      'ET'
    ].join('\n');
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${commands.length} >>\nstream\n${commands}\nendstream`;
  });

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = pdf.length;
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return pdf;
}

function outcomeCount(rows: WorkRow[], activity: WorkRow['activity'], outcome: string): number {
  return rows.filter((row) => row.activity === activity && row.outcome === outcome).length;
}

function metric(value: number | null, suffix: string): string {
  return value === null ? '' : ` | ${value.toFixed(2)} ${suffix}`;
}

export async function exportWorkPdf(range: WorkRange): Promise<void> {
  const rows = await rowsForRange(range);
  const totalMinutes = rows.reduce((sum, row) => sum + row.durationMinutes, 0);
  const totalMiles = rows.reduce((sum, row) => sum + row.distanceMiles, 0);
  const title = range === 'week' ? 'BFID Weekly Completed Work' : 'BFID Year-to-Date Completed Work';
  const lines = [
    title,
    `Generated: ${new Date().toLocaleString()}`,
    `Range starts: ${rangeStart(range).toLocaleDateString()}`,
    '',
    `Spray runs completed: ${outcomeCount(rows, 'spraying', 'completed')}`,
    `Spray runs needing return: ${outcomeCount(rows, 'spraying', 'needs-return')}`,
    `Spray runs partial: ${outcomeCount(rows, 'spraying', 'partial')}`,
    `Mowing runs completed: ${outcomeCount(rows, 'mowing', 'completed')}`,
    `Mowing runs needing return: ${outcomeCount(rows, 'mowing', 'needs-return')}`,
    `Mowing runs partial: ${outcomeCount(rows, 'mowing', 'partial')}`,
    `Recorded field time: ${(totalMinutes / 60).toFixed(1)} hours`,
    `Canonical route work: ${totalMiles.toFixed(1)} miles`,
    '',
    'Session detail'
  ];
  for (const row of rows) {
    lines.push(...wrapLine(`${row.date} | ${row.activity.toUpperCase()} | ${row.outcome} | ${row.location}`));
    const percent = row.completedPercent === null ? '' : ` | ${row.completedPercent.toFixed(0)}%`;
    lines.push(...wrapLine(`  ${row.startedAt}-${row.endedAt} | ${row.durationMinutes} min | ${row.distanceMiles.toFixed(2)} mi${percent} | ${row.gpsPoints} GPS fixes captured${row.product ? ` | ${row.product}` : ''}${row.equipment ? ` | ${row.equipment}` : ''}`));
    if (row.activity === 'spraying') {
      lines.push(...wrapLine(`  Application${metric(row.gallonsUsed, 'gal')}${metric(row.gallonsPerMile, 'gal/mi')}`));
    } else {
      lines.push(...wrapLine(`  Production${metric(row.mowingAcres, 'acres')}${metric(row.acresPerHour, 'acres/hr')}${metric(row.routeSpeedMph, 'route mph')}`));
    }
    if (row.startWeather) lines.push(...wrapLine(`  Start: ${row.startWeather}`));
    if (row.endWeather) lines.push(...wrapLine(`  End: ${row.endWeather}`));
  }
  download(makePdf(lines), 'application/pdf', `${fileStem(range)}.pdf`);
}
