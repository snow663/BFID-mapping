import type {
  RecentSpraySession,
  SprayReminder,
  SpraySessionState,
  SprayWorkItem
} from './spraySession';
import {
  SPRAY_STATIONS,
  rateCurrentWeather,
  selectedRig,
  type SprayRigProfile,
  type SpraySettings,
  type SprayWindow,
  type WeatherSnapshot
} from './sprayWeather';

const TIME_ZONE = 'America/Denver';
export const NEW_WORK_ITEM_VALUE = '__new__';

export type SprayUi = {
  section: HTMLElement;
  station: HTMLSelectElement;
  product: HTMLInputElement;
  notes: HTMLTextAreaElement;
  rig: HTMLSelectElement;
  rigName: HTMLInputElement;
  rigVehicle: HTMLInputElement;
  rigTank: HTMLInputElement;
  rigDelivery: HTMLInputElement;
  rigPosition: HTMLInputElement;
  rigNew: HTMLButtonElement;
  rigSave: HTMLButtonElement;
  rigDelete: HTMLButtonElement;
  maxWind: HTMLInputElement;
  maxGust: HTMLInputElement;
  minRh: HTMLInputElement;
  minTemp: HTMLInputElement;
  maxTemp: HTMLInputElement;
  maxPop: HTMLInputElement;
  dryHours: HTMLInputElement;
  minWindow: HTMLInputElement;
  followUpDays: HTMLInputElement;
  current: HTMLElement;
  rating: HTMLElement;
  refresh: HTMLButtonElement;
  forecast: HTMLElement;
  windows: HTMLElement;
  workItem: HTMLSelectElement;
  workItemInfo: HTMLElement;
  session: HTMLElement;
  start: HTMLButtonElement;
  finishComplete: HTMLButtonElement;
  finishReturn: HTMLButtonElement;
  finishPartial: HTMLButtonElement;
  snapshot: HTMLButtonElement;
  recent: HTMLElement;
  reminders: HTMLElement;
  enableReminders: HTMLButtonElement;
  weekCsv: HTMLButtonElement;
  weekPdf: HTMLButtonElement;
  ytdCsv: HTMLButtonElement;
  ytdPdf: HTMLButtonElement;
  segment: HTMLElement;
  sprayStatus: HTMLSelectElement;
  message: HTMLElement;
};

function esc(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function num(value: number | null, digits = 0): string {
  return value === null ? '—' : value.toFixed(digits);
}

function cardinal(value: number | null): string {
  if (value === null) return '—';
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return directions[Math.round((((value % 360) + 360) % 360) / 22.5) % 16];
}

export function formatSprayTime(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  }).format(new Date(value));
}

function formatWindow(window: SprayWindow): string {
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE, weekday: 'short', month: 'short', day: 'numeric'
  }).format(new Date(window.startTime));
  const time = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, hour: 'numeric', minute: '2-digit' });
  return `${day}, ${time.format(new Date(window.startTime))}–${time.format(new Date(window.endTime))}`;
}

function html(): string {
  return `
<h2>Spraying field assistant</h2>
<div class="bfid-spray-workflow">
  <div class="segment-card"><strong>Current location</strong><span class="spray-segment">No project segment selected.</span></div>
  <label>Run / location archive<select class="spray-work-item"><option value="${NEW_WORK_ITEM_VALUE}">New run at current location</option></select></label>
  <div class="bfid-spray-work-item-info">A new location archive will be created from the first GPS fix.</div>
</div>
<label>Weather station<select class="spray-station"><option value="auto">Auto — nearest Nisland/Newell station</option>${SPRAY_STATIONS.map((station) => `<option value="${station.id}">${esc(station.name)}</option>`).join('')}</select></label>
<div class="bfid-spray-current"></div>
<div class="bfid-spray-rating unknown">Pull up to the location and request a spraying window.</div>
<button class="spray-refresh wide" type="button">Check spraying window here</button>
<div class="bfid-spray-forecast-status">No location-specific forecast loaded.</div>
<div class="bfid-spray-window-list"></div>
<details class="bfid-spray-limits">
  <summary>Product, spray rig, and decision limits</summary>
  <div>
    <label>Product / mix name<input class="spray-product" value="Glyphosate" placeholder="Glyphosate"></label>
    <label>Application notes<textarea class="spray-notes" placeholder="Target weeds, mix, additives, skipped patches, field notes"></textarea></label>
    <div class="bfid-spray-rig-editor">
      <label>Spray rig profile<select class="spray-rig"></select></label>
      <div class="bfid-spray-grid">
        <label>Profile name<input class="spray-rig-name"></label>
        <label>Vehicle<input class="spray-rig-vehicle"></label>
        <label>Tank gallons<input class="spray-rig-tank" type="number" min="0" step="1"></label>
        <label>Delivery method<input class="spray-rig-delivery"></label>
      </div>
      <label>Usual operating position<input class="spray-rig-position"></label>
      <div class="bfid-spray-actions three"><button class="spray-rig-new" type="button">New profile</button><button class="spray-rig-save" type="button">Save profile</button><button class="spray-rig-delete" type="button">Delete profile</button></div>
    </div>
    <div class="bfid-spray-grid">
      <label>Maximum wind mph<input class="spray-max-wind" type="number"></label>
      <label>Maximum gust mph<input class="spray-max-gust" type="number"></label>
      <label>Minimum humidity %<input class="spray-min-rh" type="number"></label>
      <label>Minimum temperature °F<input class="spray-min-temp" type="number"></label>
      <label>Maximum temperature °F<input class="spray-max-temp" type="number"></label>
      <label>Maximum precip chance %<input class="spray-max-pop" type="number"></label>
      <label>Required dry time hours<input class="spray-dry-hours" type="number"></label>
      <label>Minimum useful window hours<input class="spray-min-window" type="number"></label>
      <label>Follow-up flag after days<input class="spray-follow-up-days" type="number"></label>
    </div>
    <button class="spray-save wide" type="button">Save product, rig, and limits</button>
  </div>
</details>
<div class="bfid-spray-disclaimer">The result is a planning recommendation, not a label determination. The exact glyphosate formulation label, on-site wind and direction, gusts, inversion conditions, buffers, rainfast interval, and sensitive downwind areas control the decision.</div>
<div class="bfid-spray-session"><span>No spraying session active.</span></div>
<div class="bfid-spray-start-row"><button class="bfid-spray-start wide" type="button" disabled>Check conditions before starting</button></div>
<div class="bfid-spray-finish-actions" hidden>
  <button class="bfid-spray-complete" type="button">Finish · completed</button>
  <button class="bfid-spray-needs-return" type="button">Finish · needs return</button>
  <button class="bfid-spray-partial" type="button">Finish · partial</button>
  <button class="spray-snapshot" type="button">Record weather now</button>
</div>
<details class="bfid-spray-archive" open>
  <summary>Reminders and work archive</summary>
  <div>
    <div class="bfid-spray-reminders"></div>
    <button class="spray-enable-reminders wide" type="button">Enable browser reminder notices</button>
    <strong>Recent spraying runs</strong>
    <div class="bfid-spray-record-list"></div>
    <strong>Completed work exports</strong>
    <div class="bfid-spray-actions two"><button class="spray-week-csv" type="button">Weekly CSV</button><button class="spray-week-pdf" type="button">Weekly PDF</button><button class="spray-ytd-csv" type="button">YTD CSV</button><button class="spray-ytd-pdf" type="button">YTD PDF</button></div>
  </div>
</details>
<label>Selected segment spraying state<select class="spray-status" disabled><option value="unsprayed">Unsprayed</option><option value="partial">Partial</option><option value="sprayed">Sprayed</option><option value="needs-return">Needs return</option><option value="skipped">Skipped</option></select></label>
<div class="bfid-spray-message"></div>`;
}

export function createSprayUi(sidebar: HTMLElement): SprayUi {
  const section = document.createElement('section');
  section.id = 'bfid-spray-assistant';
  section.innerHTML = html();
  const portable = [...sidebar.querySelectorAll<HTMLElement>('section')]
    .find((item) => item.querySelector('h2')?.textContent?.trim() === 'Portable data');
  portable ? sidebar.insertBefore(section, portable) : sidebar.append(section);
  const query = <T extends Element>(selector: string): T => section.querySelector<T>(selector)!;
  return {
    section,
    station: query('.spray-station'),
    product: query('.spray-product'),
    notes: query('.spray-notes'),
    rig: query('.spray-rig'),
    rigName: query('.spray-rig-name'),
    rigVehicle: query('.spray-rig-vehicle'),
    rigTank: query('.spray-rig-tank'),
    rigDelivery: query('.spray-rig-delivery'),
    rigPosition: query('.spray-rig-position'),
    rigNew: query('.spray-rig-new'),
    rigSave: query('.spray-rig-save'),
    rigDelete: query('.spray-rig-delete'),
    maxWind: query('.spray-max-wind'),
    maxGust: query('.spray-max-gust'),
    minRh: query('.spray-min-rh'),
    minTemp: query('.spray-min-temp'),
    maxTemp: query('.spray-max-temp'),
    maxPop: query('.spray-max-pop'),
    dryHours: query('.spray-dry-hours'),
    minWindow: query('.spray-min-window'),
    followUpDays: query('.spray-follow-up-days'),
    current: query('.bfid-spray-current'),
    rating: query('.bfid-spray-rating'),
    refresh: query('.spray-refresh'),
    forecast: query('.bfid-spray-forecast-status'),
    windows: query('.bfid-spray-window-list'),
    workItem: query('.spray-work-item'),
    workItemInfo: query('.bfid-spray-work-item-info'),
    session: query('.bfid-spray-session'),
    start: query('.bfid-spray-start'),
    finishComplete: query('.bfid-spray-complete'),
    finishReturn: query('.bfid-spray-needs-return'),
    finishPartial: query('.bfid-spray-partial'),
    snapshot: query('.spray-snapshot'),
    recent: query('.bfid-spray-record-list'),
    reminders: query('.bfid-spray-reminders'),
    enableReminders: query('.spray-enable-reminders'),
    weekCsv: query('.spray-week-csv'),
    weekPdf: query('.spray-week-pdf'),
    ytdCsv: query('.spray-ytd-csv'),
    ytdPdf: query('.spray-ytd-pdf'),
    segment: query('.spray-segment'),
    sprayStatus: query('.spray-status'),
    message: query('.bfid-spray-message')
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function numberInput(input: HTMLInputElement, fallback: number): number {
  const value = Number(input.value);
  return Number.isFinite(value) ? value : fallback;
}

export function renderRigProfiles(ui: SprayUi, settings: SpraySettings): void {
  ui.rig.innerHTML = settings.rigProfiles.map((profile) => `<option value="${esc(profile.id)}">${esc(profile.name)}</option>`).join('');
  ui.rig.value = settings.selectedRigId;
  fillRigEditor(ui, selectedRig(settings));
}

export function fillRigEditor(ui: SprayUi, profile: SprayRigProfile): void {
  ui.rigName.value = profile.name;
  ui.rigVehicle.value = profile.vehicle;
  ui.rigTank.value = profile.tankGallons === null ? '' : String(profile.tankGallons);
  ui.rigDelivery.value = profile.deliveryMethod;
  ui.rigPosition.value = profile.operatingPosition;
}

export function readRigEditor(ui: SprayUi, id = ui.rig.value || crypto.randomUUID()): SprayRigProfile {
  const gallons = Number(ui.rigTank.value);
  return {
    id,
    name: ui.rigName.value.trim() || 'Unnamed spray rig',
    vehicle: ui.rigVehicle.value.trim(),
    tankGallons: Number.isFinite(gallons) && gallons >= 0 ? gallons : null,
    deliveryMethod: ui.rigDelivery.value.trim(),
    operatingPosition: ui.rigPosition.value.trim()
  };
}

export function fillSpraySettings(ui: SprayUi, settings: SpraySettings): void {
  ui.station.value = settings.stationMode;
  ui.product.value = settings.productName;
  ui.notes.value = settings.applicationNotes;
  renderRigProfiles(ui, settings);
  ui.maxWind.value = String(settings.maxWindMph);
  ui.maxGust.value = String(settings.maxGustMph);
  ui.minRh.value = String(settings.minHumidityPercent);
  ui.minTemp.value = String(settings.minTemperatureF);
  ui.maxTemp.value = String(settings.maxTemperatureF);
  ui.maxPop.value = String(settings.maxPrecipProbabilityPercent);
  ui.dryHours.value = String(settings.requiredDryHours);
  ui.minWindow.value = String(settings.minimumWindowHours);
  ui.followUpDays.value = String(settings.followUpDays);
}

export function readSpraySettings(ui: SprayUi, current: SpraySettings): SpraySettings {
  const selectedRigId = ui.rig.value || current.selectedRigId;
  const edited = readRigEditor(ui, selectedRigId);
  const rigProfiles = current.rigProfiles.some((profile) => profile.id === selectedRigId)
    ? current.rigProfiles.map((profile) => profile.id === selectedRigId ? edited : profile)
    : [...current.rigProfiles, edited];
  return {
    stationMode: ui.station.value,
    productName: ui.product.value.trim() || 'Glyphosate',
    applicationNotes: ui.notes.value.trim(),
    rigProfiles,
    selectedRigId,
    maxWindMph: clamp(numberInput(ui.maxWind, 10), 0, 60),
    maxGustMph: clamp(numberInput(ui.maxGust, 15), 0, 80),
    minHumidityPercent: clamp(numberInput(ui.minRh, 30), 0, 100),
    minTemperatureF: clamp(numberInput(ui.minTemp, 40), -40, 130),
    maxTemperatureF: clamp(numberInput(ui.maxTemp, 90), -40, 140),
    maxPrecipProbabilityPercent: clamp(numberInput(ui.maxPop, 20), 0, 100),
    requiredDryHours: clamp(Math.round(numberInput(ui.dryHours, 6)), 0, 24),
    minimumWindowHours: clamp(Math.round(numberInput(ui.minWindow, 2)), 1, 12),
    followUpDays: clamp(Math.round(numberInput(ui.followUpDays, 30)), 1, 180)
  };
}

export function sprayMessage(ui: SprayUi, text: string, error = false): void {
  ui.message.textContent = text;
  ui.message.className = `bfid-spray-message${error ? ' error' : ''}`;
}

export function renderWeatherAssessment(
  ui: SprayUi,
  snapshot: WeatherSnapshot | null,
  windows: SprayWindow[],
  settings: SpraySettings,
  position: { longitude: number; latitude: number } | null
): void {
  if (!snapshot) {
    ui.current.innerHTML = '<div class="bfid-spray-empty">Current station conditions unavailable.</div>';
    ui.rating.className = 'bfid-spray-rating unknown';
    ui.rating.textContent = 'No current assessment';
    ui.windows.innerHTML = '<div class="bfid-spray-empty">No forecast assessment available.</div>';
    return;
  }
  const station = SPRAY_STATIONS.find((item) => item.id === snapshot.stationId);
  ui.current.innerHTML = `<div class="bfid-spray-reading"><small>Station</small><b>${esc(snapshot.stationName)}</b></div><div class="bfid-spray-reading"><small>Temperature</small><b>${num(snapshot.temperatureF)} °F</b></div><div class="bfid-spray-reading"><small>Humidity</small><b>${num(snapshot.relativeHumidityPercent)}%</b></div><div class="bfid-spray-reading"><small>Wind</small><b>${cardinal(snapshot.windDirectionDegrees)} ${num(snapshot.windSpeedMph)} mph</b></div><div class="bfid-spray-reading"><small>Gust</small><b>${num(snapshot.windGustMph)} mph</b></div><div class="bfid-spray-reading"><small>Rain today</small><b>${num(snapshot.rainTodayInches, 2)} in</b></div><div class="bfid-spray-observation-time">${esc(station?.detail ?? snapshot.stationId)} · observed ${esc(snapshot.observedAt ? formatSprayTime(snapshot.observedAt) : 'time unavailable')}${snapshot.stale ? ' · stale/cached' : ''}</div>`;
  const result = rateCurrentWeather(snapshot, settings);
  const best = windows[0];
  let title = 'Unknown';
  let advice = result.reasons.join(' · ');
  if (result.rating === 'good') {
    title = 'GOOD NOW';
    advice = `Current station conditions are inside your configured limits.${best ? ` Forecast remains usable beginning ${formatWindow(best)}.` : ''}`;
  } else if (result.rating === 'marginal') {
    title = 'MARGINAL NOW';
    advice = `${result.reasons.join(' · ')}.${best ? ` Best estimated window: ${formatWindow(best)}.` : ' No fully acceptable forecast window was found.'}`;
  } else if (result.rating === 'hold') {
    title = 'BAD NOW · HOLD';
    advice = `${result.reasons.join(' · ')}.${best ? ` Best estimated window: ${formatWindow(best)}.` : ' No forecast period meets every configured limit.'}`;
  }
  ui.rating.className = `bfid-spray-rating ${result.rating}`;
  ui.rating.innerHTML = `<strong>${esc(title)}</strong><span>${esc(advice)}</span>`;
  ui.windows.innerHTML = windows.length
    ? windows.map((window) => `<article class="bfid-spray-window"><strong>${esc(formatWindow(window))}</strong><span>${window.hours} forecast hours</span><small>wind ≤ ${num(window.maxWindMph)} mph · ${num(window.minTemperatureF)}–${num(window.maxTemperatureF)} °F · humidity ≥ ${num(window.minHumidityPercent)}% · precip ≤ ${num(window.maxPrecipitationPercent)}%</small></article>`).join('')
    : '<div class="bfid-spray-empty">No forecast period meets every configured limit.</div>';
  ui.forecast.textContent = position
    ? `Forecast evaluated at ${position.latitude.toFixed(4)}, ${position.longitude.toFixed(4)}.`
    : 'Forecast location unavailable.';
  ui.start.disabled = false;
  ui.start.textContent = result.rating === 'good' ? 'Start spraying' : 'Start spraying despite warning';
}

export function renderWorkItems(ui: SprayUi, items: SprayWorkItem[], selectedId: string): void {
  const options = [`<option value="${NEW_WORK_ITEM_VALUE}">New run at current location</option>`];
  for (const item of [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 40)) {
    const status = item.status === 'needs-return' ? 'NEEDS RETURN' : item.status === 'completed' ? 'completed' : 'open';
    options.push(`<option value="${esc(item.id)}">${esc(status)} · ${esc(item.label)} · ${item.sessionIds.length} run${item.sessionIds.length === 1 ? '' : 's'}</option>`);
  }
  ui.workItem.innerHTML = options.join('');
  ui.workItem.value = items.some((item) => item.id === selectedId) ? selectedId : NEW_WORK_ITEM_VALUE;
  renderSelectedWorkItem(ui, items.find((item) => item.id === ui.workItem.value) ?? null);
}

export function renderSelectedWorkItem(ui: SprayUi, item: SprayWorkItem | null): void {
  if (!item) {
    ui.workItemInfo.textContent = 'A new location archive will be created from the first GPS fix.';
    return;
  }
  const due = item.nextReturnAt
    ? ` · return ${formatSprayTime(item.nextReturnAt)}`
    : item.followUpAt
      ? ` · follow-up ${formatSprayTime(item.followUpAt)}`
      : '';
  ui.workItemInfo.textContent = `${item.status} · ${item.sessionIds.length} stored run${item.sessionIds.length === 1 ? '' : 's'}${due}`;
}

export function renderSpraySession(ui: SprayUi, state: SpraySessionState, oldText: string, oldRecording: boolean): void {
  const active = state.active;
  ui.start.closest<HTMLElement>('.bfid-spray-start-row')!.hidden = active;
  ui.section.querySelector<HTMLElement>('.bfid-spray-finish-actions')!.hidden = !active;
  for (const input of [ui.station, ui.product, ui.notes, ui.rig, ui.rigName, ui.rigVehicle, ui.rigTank, ui.rigDelivery, ui.rigPosition, ui.workItem]) input.disabled = active;
  for (const button of [ui.rigNew, ui.rigSave, ui.rigDelete]) button.disabled = active;
  const status = document.querySelector<HTMLElement>('.status-pill');
  if (active && state.session) {
    const minutes = Math.max(0, Math.round((Date.now() - new Date(state.session.startedAt).getTime()) / 60000));
    ui.session.className = 'bfid-spray-session active';
    ui.session.innerHTML = `<strong>SPRAYING ACTIVE · run ${state.session.sequence}</strong><span>${minutes} min · ${state.pointCount} GPS points · ${state.weatherCount} weather records</span><small>${esc(state.workItem?.label || 'GPS spray site')} · ${esc(state.session.productName || 'Product not entered')} · ${esc(state.session.rigProfileName || state.session.equipment)}</small>`;
    if (status) {
      status.classList.add('recording');
      status.textContent = `SPRAYING · ${state.pointCount} points · ${state.weatherCount} weather`;
    }
  } else {
    ui.session.className = 'bfid-spray-session';
    ui.session.innerHTML = '<span>No spraying session active.</span>';
    if (status?.textContent?.startsWith('SPRAYING')) {
      status.textContent = oldText || 'Location inactive';
      status.classList.toggle('recording', oldRecording);
    }
  }
}

function outcomeLabel(outcome: RecentSpraySession['outcome']): string {
  if (outcome === 'completed') return 'completed';
  if (outcome === 'needs-return') return 'needs return';
  if (outcome === 'partial') return 'partial';
  return 'unfinished';
}

export function renderRecentSpraying(ui: SprayUi, records: RecentSpraySession[]): void {
  ui.recent.innerHTML = records.length
    ? records.map((record) => `<article class="bfid-spray-record"><strong>${esc(record.segmentName || record.productName || 'Spraying run')} · ${esc(outcomeLabel(record.outcome))}</strong><span>${esc(formatSprayTime(record.startedAt))} · run ${record.sequence || 1} · ${record.durationMinutes} min</span><small>${record.pointCount} GPS points · ${record.weatherSnapshots?.length ?? 0} weather records · ${esc(record.rigProfileName || record.equipment)}${record.productName ? ` · ${esc(record.productName)}` : ''}</small></article>`).join('')
    : '<div class="bfid-spray-empty">No spraying sessions recorded yet.</div>';
}

export function renderReminders(ui: SprayUi, reminders: SprayReminder[]): void {
  ui.reminders.innerHTML = reminders.length
    ? `<strong>Due now</strong>${reminders.map((reminder) => `<article class="bfid-spray-reminder ${reminder.kind}"><strong>${reminder.kind === 'return' ? 'Return today' : 'Follow-up visit due'}</strong><span>${esc(reminder.workItem.label)}</span><small>Due ${esc(formatSprayTime(reminder.dueAt))} · ${reminder.workItem.sessionIds.length} archived run${reminder.workItem.sessionIds.length === 1 ? '' : 's'}</small><div><button type="button" data-spray-use="${esc(reminder.workItem.id)}">Use this location</button>${reminder.kind === 'follow-up' ? `<button type="button" data-spray-reviewed="${esc(reminder.workItem.id)}">Checked · flag again later</button>` : ''}</div></article>`).join('')}`
    : '<div class="bfid-spray-empty">No spraying reminders are due.</div>';
}
