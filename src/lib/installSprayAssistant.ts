import './sprayAssistant.css';
import { getSetting, putSetting } from './db';
import {
  createSprayUi,
  fillRigEditor,
  fillSpraySettings,
  NEW_WORK_ITEM_VALUE,
  readSpraySettings,
  renderRecentSpraying,
  renderReminders,
  renderRigProfiles,
  renderSelectedWorkItem,
  renderSpraySession,
  renderWeatherAssessment,
  renderWorkItems,
  sprayMessage,
  type SprayUi
} from './sprayAssistantView';
import {
  DEFAULT_SPRAY_SETTINGS,
  chooseSprayStation,
  distanceMeters,
  fetchHourlyForecast,
  fetchStationWeather,
  findSprayWindows,
  normalizeSpraySettings,
  type SprayPosition,
  type SpraySettings,
  type WeatherSnapshot
} from './sprayWeather';
import {
  acknowledgeSprayFollowUp,
  captureSprayWeather,
  getDueSprayReminders,
  getRecentSpraySessions,
  getSegmentSprayStatus,
  getSpraySessionState,
  loadSprayWorkItems,
  setSegmentSprayStatus,
  startSpraySession,
  stopSpraySession,
  type SprayOutcome,
  type SprayStatus,
  type SprayWorkItem
} from './spraySession';
import { exportWorkCsv, exportWorkPdf } from './workArchive';

const FLAG = '__bfidSprayAssistantInstalled';
const SETTINGS_KEY = 'sprayAssistantSettings';
const ASSESSMENT_MAX_AGE_MS = 30 * 60 * 1000;
const NEARBY_WORK_ITEM_METERS = 245;
let ui: SprayUi | null = null;
let settings: SpraySettings = { ...DEFAULT_SPRAY_SETTINGS };
let currentSnapshot: WeatherSnapshot | null = null;
let weatherCheckedAt = 0;
let selectedSegmentId: string | null = null;
let selectedSegmentName = '';
let workItems: SprayWorkItem[] = [];
let statusTimer: number | null = null;
let oldStatusText = '';
let oldStatusRecording = false;

async function loadSettings(): Promise<void> {
  try {
    const raw = await getSetting(SETTINGS_KEY, '');
    settings = normalizeSpraySettings(raw ? JSON.parse(raw) : {});
  } catch {
    settings = normalizeSpraySettings();
  }
}

async function saveSettings(): Promise<void> {
  if (!ui) return;
  settings = readSpraySettings(ui, settings);
  await putSetting(SETTINGS_KEY, JSON.stringify(settings));
}

function oneShotPosition(): Promise<SprayPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Location services unavailable.'));
    navigator.geolocation.getCurrentPosition(
      (result) => resolve({
        longitude: result.coords.longitude,
        latitude: result.coords.latitude,
        accuracy: result.coords.accuracy,
        altitude: result.coords.altitude,
        heading: result.coords.heading,
        speed: result.coords.speed,
        timestamp: result.timestamp,
        source: 'gps'
      }),
      reject,
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    );
  });
}

function assessmentCurrent(): boolean {
  return Boolean(currentSnapshot && Date.now() - weatherCheckedAt <= ASSESSMENT_MAX_AGE_MS);
}

function invalidateAssessment(message = 'Conditions changed. Check the spraying window again.'): void {
  if (!ui || getSpraySessionState().active) return;
  currentSnapshot = null;
  weatherCheckedAt = 0;
  ui.start.disabled = true;
  ui.start.textContent = 'Check conditions before starting';
  ui.forecast.textContent = message;
}

function dueOrOpen(item: SprayWorkItem): boolean {
  return item.status !== 'completed' || Boolean(item.followUpAt && new Date(item.followUpAt).getTime() <= Date.now());
}

function autoSelectNearbyWorkItem(position: SprayPosition): void {
  if (!ui || ui.workItem.value !== NEW_WORK_ITEM_VALUE) return;
  const nearest = workItems
    .filter(dueOrOpen)
    .map((item) => ({ item, distance: distanceMeters(position, item.anchor) }))
    .sort((a, b) => a.distance - b.distance)[0];
  if (nearest && nearest.distance <= NEARBY_WORK_ITEM_METERS) {
    ui.workItem.value = nearest.item.id;
    renderSelectedWorkItem(ui, nearest.item);
    sprayMessage(ui, `Nearby archive selected: ${nearest.item.label}. A new run will be appended.`);
  }
}

async function refreshWeather(): Promise<void> {
  if (!ui) return;
  ui.refresh.disabled = true;
  ui.start.disabled = true;
  ui.forecast.textContent = 'Getting GPS, station conditions, and the hourly forecast…';
  try {
    await saveSettings();
    let position = getSpraySessionState().position;
    if (!position) position = await oneShotPosition();
    autoSelectNearbyWorkItem(position);
    const station = chooseSprayStation(settings.stationMode, position);
    const [snapshot, periods] = await Promise.all([
      fetchStationWeather(station, 'manual', position),
      fetchHourlyForecast(position)
    ]);
    currentSnapshot = snapshot;
    weatherCheckedAt = Date.now();
    renderWeatherAssessment(ui, snapshot, findSprayWindows(periods, settings), settings, position);
  } catch (error) {
    currentSnapshot = null;
    weatherCheckedAt = 0;
    renderWeatherAssessment(ui, null, [], settings, null);
    ui.forecast.textContent = error instanceof Error ? error.message : 'Weather update failed.';
    ui.start.disabled = true;
    ui.start.textContent = 'Weather assessment unavailable';
  } finally {
    ui.refresh.disabled = false;
  }
}

function appRecordingActive(): boolean {
  const status = document.querySelector<HTMLElement>('.status-pill.recording');
  return Boolean(status && !status.textContent?.startsWith('SPRAYING'));
}

function otherButtons(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('.sidebar button')]
    .filter((button) => ['Record travel', 'Record mowing', 'Start building road'].includes(button.textContent?.trim() ?? ''));
}

function lockOtherActivities(active: boolean): void {
  for (const button of otherButtons()) {
    if (active) {
      if (button.dataset.sprayOldDisabled === undefined) button.dataset.sprayOldDisabled = String(button.disabled);
      button.disabled = true;
      button.title = 'Finish spraying first.';
    } else if (button.dataset.sprayOldDisabled !== undefined) {
      button.disabled = button.dataset.sprayOldDisabled === 'true';
      delete button.dataset.sprayOldDisabled;
      button.removeAttribute('title');
    }
  }
}

function sessionChanged(): void {
  if (!ui) return;
  const state = getSpraySessionState();
  renderSpraySession(ui, state, oldStatusText, oldStatusRecording);
  lockOtherActivities(state.active);
}

async function renderRecent(): Promise<void> {
  if (ui) renderRecentSpraying(ui, await getRecentSpraySessions());
}

async function refreshWorkItems(preferredId?: string): Promise<void> {
  if (!ui) return;
  const current = preferredId || ui.workItem.value || NEW_WORK_ITEM_VALUE;
  workItems = await loadSprayWorkItems();
  renderWorkItems(ui, workItems, current);
}

async function refreshReminders(notify = false): Promise<void> {
  if (!ui) return;
  const reminders = await getDueSprayReminders();
  renderReminders(ui, reminders);
  if (!notify || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  for (const reminder of reminders) {
    const key = `bfid-reminder-notified:${reminder.kind}:${reminder.workItem.id}:${reminder.dueAt}`;
    if (localStorage.getItem(key)) continue;
    new Notification(reminder.kind === 'return' ? 'Spraying return due' : 'Spraying follow-up due', {
      body: reminder.workItem.label
    });
    localStorage.setItem(key, new Date().toISOString());
  }
}

async function enableReminders(): Promise<void> {
  if (!ui) return;
  if (typeof Notification === 'undefined') {
    sprayMessage(ui, 'This browser does not support notification notices.', true);
    return;
  }
  const permission = await Notification.requestPermission();
  sprayMessage(ui, permission === 'granted'
    ? 'Browser notices enabled. Due reminders appear when the app is open.'
    : 'Browser notification permission was not granted.', permission !== 'granted');
  if (permission === 'granted') await refreshReminders(true);
}

async function start(): Promise<void> {
  if (!ui) return;
  if (appRecordingActive()) {
    sprayMessage(ui, 'Finish the active travel, mowing, or mapping recording before starting spraying.', true);
    return;
  }
  if (!assessmentCurrent()) {
    sprayMessage(ui, 'Check the spraying window at this location before starting.', true);
    return;
  }
  await saveSettings();
  ui.start.disabled = true;
  sprayMessage(ui, 'Waiting for a high-accuracy GPS fix…');
  const status = document.querySelector<HTMLElement>('.status-pill');
  oldStatusText = status?.textContent ?? '';
  oldStatusRecording = status?.classList.contains('recording') ?? false;
  try {
    const appendId = ui.workItem.value === NEW_WORK_ITEM_VALUE ? null : ui.workItem.value;
    const state = await startSpraySession(
      settings,
      selectedSegmentId,
      selectedSegmentName,
      appendId,
      sessionChanged
    );
    sessionChanged();
    await refreshWorkItems(state.workItem?.id);
    sprayMessage(ui, `Spraying started. Start time, weather, rig, product, and GPS trail are recording.`);
    if (statusTimer === null) statusTimer = window.setInterval(sessionChanged, 1000);
  } catch (error) {
    sprayMessage(ui, error instanceof Error ? error.message : 'Unable to start spraying.', true);
    ui.start.disabled = false;
  }
}

async function finish(outcome: SprayOutcome): Promise<void> {
  if (!ui) return;
  for (const button of [ui.finishComplete, ui.finishReturn, ui.finishPartial]) button.disabled = true;
  try {
    await stopSpraySession(outcome);
    if (statusTimer !== null) window.clearInterval(statusTimer);
    statusTimer = null;
    sessionChanged();
    await Promise.all([renderRecent(), refreshWorkItems(), refreshReminders(true), syncSegment(true)]);
    invalidateAssessment('Run closed. Check conditions again before the next spraying session.');
    const message = outcome === 'completed'
      ? `Run saved as completed. This location will be flagged again in ${settings.followUpDays} days.`
      : outcome === 'needs-return'
        ? 'Run saved as needs return. A reminder is due tomorrow at 6:30 AM.'
        : 'Run saved as partial. No completion was inferred; another session can be appended later.';
    sprayMessage(ui, message);
  } finally {
    for (const button of [ui.finishComplete, ui.finishReturn, ui.finishPartial]) button.disabled = false;
  }
}

async function snapshot(): Promise<void> {
  if (!ui) return;
  ui.snapshot.disabled = true;
  try {
    await captureSprayWeather('manual');
    sprayMessage(ui, 'Additional weather snapshot recorded in this run.');
  } catch (error) {
    sprayMessage(ui, error instanceof Error ? error.message : 'Weather snapshot failed.', true);
  } finally {
    ui.snapshot.disabled = false;
  }
}

function selectedSegment(): { id: string | null; name: string } {
  const section = [...document.querySelectorAll<HTMLElement>('.sidebar section')]
    .find((item) => item.querySelector('h2')?.textContent?.trim() === 'Selected segment');
  return {
    id: section?.querySelector('code')?.textContent?.trim() || null,
    name: section?.querySelector('.segment-card strong')?.textContent?.trim() || ''
  };
}

async function syncSegment(force = false): Promise<void> {
  if (!ui) return;
  const next = selectedSegment();
  if (!force && next.id === selectedSegmentId && next.name === selectedSegmentName) return;
  selectedSegmentId = next.id;
  selectedSegmentName = next.name;
  if (!next.id) {
    ui.segment.textContent = 'No project segment selected. GPS location will identify the run.';
    ui.sprayStatus.disabled = true;
    ui.sprayStatus.value = 'unsprayed';
    return;
  }
  ui.segment.textContent = next.name || next.id;
  ui.sprayStatus.disabled = false;
  ui.sprayStatus.value = await getSegmentSprayStatus(next.id);
  const sameSegment = workItems
    .filter((item) => item.segmentId === next.id && dueOrOpen(item))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (sameSegment && !getSpraySessionState().active) {
    ui.workItem.value = sameSegment.id;
    renderSelectedWorkItem(ui, sameSegment);
  }
}

async function updateSegmentStatus(): Promise<void> {
  if (!ui || !selectedSegmentId) return;
  await setSegmentSprayStatus(selectedSegmentId, ui.sprayStatus.value as SprayStatus);
  sprayMessage(ui, `${selectedSegmentName || selectedSegmentId}: spraying state updated.`);
}

function saveRigProfile(): void {
  if (!ui) return;
  settings = readSpraySettings(ui, settings);
  void putSetting(SETTINGS_KEY, JSON.stringify(settings)).then(() => {
    renderRigProfiles(ui!, settings);
    invalidateAssessment();
    sprayMessage(ui!, 'Spray rig profile saved.');
  });
}

function newRigProfile(): void {
  if (!ui) return;
  const id = crypto.randomUUID();
  settings = {
    ...settings,
    selectedRigId: id,
    rigProfiles: [...settings.rigProfiles, {
      id,
      name: 'New spray rig',
      vehicle: '',
      tankGallons: null,
      deliveryMethod: '',
      operatingPosition: ''
    }]
  };
  renderRigProfiles(ui, settings);
  ui.rig.value = id;
  fillRigEditor(ui, settings.rigProfiles.at(-1)!);
  ui.rigName.focus();
}

function deleteRigProfile(): void {
  if (!ui) return;
  if (settings.rigProfiles.length <= 1) {
    sprayMessage(ui, 'At least one spray rig profile is required.', true);
    return;
  }
  const id = ui.rig.value;
  const rigProfiles = settings.rigProfiles.filter((profile) => profile.id !== id);
  settings = { ...settings, rigProfiles, selectedRigId: rigProfiles[0].id };
  fillSpraySettings(ui, settings);
  void putSetting(SETTINGS_KEY, JSON.stringify(settings));
  invalidateAssessment();
  sprayMessage(ui, 'Spray rig profile deleted.');
}

async function exportFile(kind: 'csv' | 'pdf', range: 'week' | 'ytd'): Promise<void> {
  if (!ui) return;
  try {
    if (kind === 'csv') await exportWorkCsv(range);
    else await exportWorkPdf(range);
    sprayMessage(ui, `${range === 'week' ? 'Weekly' : 'Year-to-date'} ${kind.toUpperCase()} created.`);
  } catch (error) {
    sprayMessage(ui, error instanceof Error ? error.message : 'Export failed.', true);
  }
}

async function handleReminderAction(target: Element): Promise<void> {
  if (!ui) return;
  const useId = target.closest<HTMLButtonElement>('[data-spray-use]')?.dataset.sprayUse;
  if (useId) {
    ui.workItem.value = useId;
    renderSelectedWorkItem(ui, workItems.find((item) => item.id === useId) ?? null);
    sprayMessage(ui, 'Reminder location selected. Check the spraying window when you arrive.');
    return;
  }
  const reviewedId = target.closest<HTMLButtonElement>('[data-spray-reviewed]')?.dataset.sprayReviewed;
  if (reviewedId) {
    await acknowledgeSprayFollowUp(reviewedId, settings.followUpDays);
    await Promise.all([refreshWorkItems(reviewedId), refreshReminders()]);
    sprayMessage(ui, `Follow-up acknowledged and flagged again in ${settings.followUpDays} days.`);
  }
}

async function mountAssistant(): Promise<void> {
  if (document.getElementById('bfid-spray-assistant')) return;
  const sidebar = document.querySelector<HTMLElement>('.sidebar');
  if (!sidebar) {
    window.setTimeout(() => void mountAssistant(), 100);
    return;
  }
  ui = createSprayUi(sidebar);
  await loadSettings();
  fillSpraySettings(ui, settings);
  await refreshWorkItems();

  ui.refresh.onclick = () => void refreshWeather();
  ui.start.onclick = () => void start();
  ui.finishComplete.onclick = () => void finish('completed');
  ui.finishReturn.onclick = () => void finish('needs-return');
  ui.finishPartial.onclick = () => void finish('partial');
  ui.snapshot.onclick = () => void snapshot();
  ui.section.querySelector<HTMLButtonElement>('.spray-save')!.onclick = () => void saveSettings().then(() => {
    if (ui) {
      renderRigProfiles(ui, settings);
      invalidateAssessment();
      sprayMessage(ui, 'Product, rig, decision limits, and follow-up interval saved.');
    }
  });
  ui.station.onchange = () => invalidateAssessment('Weather station changed. Check the spraying window again.');
  ui.workItem.onchange = () => renderSelectedWorkItem(ui!, workItems.find((item) => item.id === ui!.workItem.value) ?? null);
  ui.rig.onchange = () => {
    settings = { ...settings, selectedRigId: ui!.rig.value };
    const profile = settings.rigProfiles.find((item) => item.id === ui!.rig.value);
    if (profile) fillRigEditor(ui!, profile);
    invalidateAssessment();
  };
  ui.rigSave.onclick = saveRigProfile;
  ui.rigNew.onclick = newRigProfile;
  ui.rigDelete.onclick = deleteRigProfile;
  ui.sprayStatus.onchange = () => void updateSegmentStatus();
  ui.enableReminders.onclick = () => void enableReminders();
  ui.weekCsv.onclick = () => void exportFile('csv', 'week');
  ui.weekPdf.onclick = () => void exportFile('pdf', 'week');
  ui.ytdCsv.onclick = () => void exportFile('csv', 'ytd');
  ui.ytdPdf.onclick = () => void exportFile('pdf', 'ytd');
  ui.reminders.addEventListener('click', (event) => {
    if (event.target instanceof Element) void handleReminderAction(event.target);
  });

  document.addEventListener('click', (event) => {
    if (!getSpraySessionState().active || !ui) return;
    const text = (event.target instanceof Element ? event.target.closest('button')?.textContent : '')?.trim();
    if (['Record travel', 'Record mowing', 'Start building road'].includes(text ?? '')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      sprayMessage(ui, 'Finish spraying before starting another field activity.', true);
    }
  }, true);

  new MutationObserver(() => {
    void syncSegment();
    lockOtherActivities(getSpraySessionState().active);
  }).observe(sidebar, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['disabled']
  });

  await syncSegment(true);
  await Promise.all([renderRecent(), refreshReminders(true)]);
  sessionChanged();
}

export function installSprayAssistant(): void {
  const state = window as unknown as Record<string, unknown>;
  if (state[FLAG]) return;
  state[FLAG] = true;
  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', () => void mountAssistant(), { once: true })
    : void mountAssistant();
}
