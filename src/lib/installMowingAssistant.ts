import './mowingAssistant.css';
import { getSetting, putSetting } from './db';
import { getSpraySessionState } from './spraySession';
import {
  acknowledgeMowingFollowUp,
  DEFAULT_MOWING_SETTINGS,
  getDueMowingReminders,
  getMowingSessionState,
  getRecentMowingSessions,
  getSegmentMowingStatus,
  loadMowingWorkItems,
  normalizeMowingSettings,
  setSegmentMowingStatus,
  startMowingSession,
  stopMowingSession,
  type MowingOutcome,
  type MowingSettings,
  type MowingWorkItem
} from './mowingSession';
import {
  createMowingUi,
  fillEquipmentEditor,
  fillMowingSettings,
  mowingMessage,
  NEW_MOWING_WORK_ITEM,
  readMowingSettings,
  renderEquipmentProfiles,
  renderMowingReminders,
  renderMowingSession,
  renderMowingWorkItems,
  renderRecentMowing,
  renderSelectedMowingWorkItem,
  type MowingUi
} from './mowingAssistantView';
import { exportWorkCsv, exportWorkPdf } from './workArchive';
import type { MowStatus, PositionFix } from './types';

const FLAG = '__bfidMowingAssistantInstalled';
const SETTINGS_KEY = 'mowingAssistantSettings';
const NEARBY_WORK_ITEM_METERS = 245;
let ui: MowingUi | null = null;
let settings: MowingSettings = normalizeMowingSettings(DEFAULT_MOWING_SETTINGS);
let selectedSegmentId: string | null = null;
let selectedSegmentName = '';
let workItems: MowingWorkItem[] = [];
let statusTimer: number | null = null;
let oldStatusText = '';
let oldStatusRecording = false;

function distanceMeters(a: PositionFix, b: { longitude: number; latitude: number }): number {
  const radians = Math.PI / 180;
  const lat1 = a.latitude * radians;
  const lat2 = b.latitude * radians;
  const deltaLat = (b.latitude - a.latitude) * radians;
  const deltaLon = (b.longitude - a.longitude) * radians;
  const value = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

async function loadSettings(): Promise<void> {
  try {
    const raw = await getSetting(SETTINGS_KEY, '');
    settings = normalizeMowingSettings(raw ? JSON.parse(raw) : DEFAULT_MOWING_SETTINGS);
  } catch {
    settings = normalizeMowingSettings(DEFAULT_MOWING_SETTINGS);
  }
}

async function saveSettings(): Promise<void> {
  if (!ui) return;
  settings = normalizeMowingSettings(readMowingSettings(ui, settings));
  await putSetting(SETTINGS_KEY, JSON.stringify(settings));
}

function oneShotPosition(): Promise<PositionFix> {
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

function dueOrOpen(item: MowingWorkItem): boolean {
  return item.status !== 'completed' || Boolean(item.followUpAt && new Date(item.followUpAt).getTime() <= Date.now());
}

function autoSelectNearbyWorkItem(position: PositionFix): void {
  if (!ui || ui.workItem.value !== NEW_MOWING_WORK_ITEM) return;
  const nearest = workItems
    .filter(dueOrOpen)
    .map((item) => ({ item, distance: distanceMeters(position, item.anchor) }))
    .sort((a, b) => a.distance - b.distance)[0];
  if (nearest && nearest.distance <= NEARBY_WORK_ITEM_METERS) {
    ui.workItem.value = nearest.item.id;
    renderSelectedMowingWorkItem(ui, nearest.item);
    mowingMessage(ui, `Nearby archive selected: ${nearest.item.label}. A new mowing run will be appended.`);
  }
}

function appRecordingActive(): boolean {
  const status = document.querySelector<HTMLElement>('.status-pill.recording');
  return Boolean(status && !status.textContent?.startsWith('MOWING'));
}

function legacyMowingButton(): HTMLButtonElement | null {
  return [...document.querySelectorAll<HTMLButtonElement>('.sidebar button')]
    .find((button) => button.textContent?.trim() === 'Record mowing') ?? null;
}

function hideLegacyMowingControls(): void {
  const button = legacyMowingButton();
  if (button) {
    button.hidden = true;
    button.disabled = true;
  }
  const selectedSection = [...document.querySelectorAll<HTMLElement>('.sidebar section')]
    .find((item) => item.querySelector('h2')?.textContent?.trim() === 'Selected segment');
  const mowingLabel = [...(selectedSection?.querySelectorAll<HTMLLabelElement>('label') ?? [])]
    .find((label) => label.textContent?.includes('Mowing state'));
  if (mowingLabel) mowingLabel.hidden = true;
}

function otherButtons(): HTMLButtonElement[] {
  const fixed = [...document.querySelectorAll<HTMLButtonElement>('.sidebar button')]
    .filter((button) => ['Record travel', 'Start building road'].includes(button.textContent?.trim() ?? ''));
  const sprayStart = document.querySelector<HTMLButtonElement>('.bfid-spray-start');
  return sprayStart ? [...fixed, sprayStart] : fixed;
}

function lockOtherActivities(active: boolean): void {
  for (const button of otherButtons()) {
    if (active) {
      if (button.dataset.mowingOldDisabled === undefined) button.dataset.mowingOldDisabled = String(button.disabled);
      if (!button.disabled) button.disabled = true;
      button.title = 'Finish mowing first.';
    } else if (button.dataset.mowingOldDisabled !== undefined) {
      const restore = button.dataset.mowingOldDisabled === 'true';
      if (button.disabled !== restore) button.disabled = restore;
      delete button.dataset.mowingOldDisabled;
      button.removeAttribute('title');
    }
  }
}

function sessionChanged(): void {
  if (!ui) return;
  const state = getMowingSessionState();
  renderMowingSession(ui, state, oldStatusText, oldStatusRecording);
  lockOtherActivities(state.active);
}

async function renderRecent(): Promise<void> {
  if (ui) renderRecentMowing(ui, await getRecentMowingSessions());
}

async function refreshWorkItems(preferredId?: string): Promise<void> {
  if (!ui) return;
  const current = preferredId || ui.workItem.value || NEW_MOWING_WORK_ITEM;
  workItems = await loadMowingWorkItems();
  renderMowingWorkItems(ui, workItems, current);
}

async function refreshReminders(notify = false): Promise<void> {
  if (!ui) return;
  const reminders = await getDueMowingReminders();
  renderMowingReminders(ui, reminders);
  if (!notify || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  for (const reminder of reminders) {
    const key = `bfid-mowing-reminder-notified:${reminder.kind}:${reminder.workItem.id}:${reminder.dueAt}`;
    if (localStorage.getItem(key)) continue;
    new Notification(reminder.kind === 'return' ? 'Mowing return due' : 'Mowing follow-up due', {
      body: reminder.workItem.label
    });
    localStorage.setItem(key, new Date().toISOString());
  }
}

async function enableReminders(): Promise<void> {
  if (!ui) return;
  if (typeof Notification === 'undefined') {
    mowingMessage(ui, 'This browser does not support notification notices.', true);
    return;
  }
  const permission = await Notification.requestPermission();
  mowingMessage(ui, permission === 'granted'
    ? 'Browser notices enabled. Due mowing reminders appear when the app is open.'
    : 'Browser notification permission was not granted.', permission !== 'granted');
  if (permission === 'granted') await refreshReminders(true);
}

async function start(): Promise<void> {
  if (!ui) return;
  if (getSpraySessionState().active) {
    mowingMessage(ui, 'Finish spraying before starting a mowing run.', true);
    return;
  }
  if (appRecordingActive()) {
    mowingMessage(ui, 'Finish the active travel or mapping recording before starting mowing.', true);
    return;
  }
  await saveSettings();
  ui.start.disabled = true;
  mowingMessage(ui, 'Waiting for a high-accuracy GPS fix…');
  const status = document.querySelector<HTMLElement>('.status-pill');
  oldStatusText = status?.textContent ?? '';
  oldStatusRecording = status?.classList.contains('recording') ?? false;
  try {
    const position = await oneShotPosition();
    autoSelectNearbyWorkItem(position);
    const appendId = ui.workItem.value === NEW_MOWING_WORK_ITEM ? null : ui.workItem.value;
    const state = await startMowingSession(
      settings,
      selectedSegmentId,
      selectedSegmentName,
      appendId,
      sessionChanged
    );
    sessionChanged();
    await refreshWorkItems(state.workItem?.id);
    mowingMessage(ui, 'Mowing started. Start time, mower profile, location, and GPS trail are recording.');
    if (statusTimer === null) statusTimer = window.setInterval(sessionChanged, 1000);
  } catch (error) {
    mowingMessage(ui, error instanceof Error ? error.message : 'Unable to start mowing.', true);
    ui.start.disabled = getSpraySessionState().active;
  }
}

async function finish(outcome: MowingOutcome): Promise<void> {
  if (!ui) return;
  for (const button of [ui.finishComplete, ui.finishReturn, ui.finishPartial]) button.disabled = true;
  try {
    await stopMowingSession(outcome);
    if (statusTimer !== null) window.clearInterval(statusTimer);
    statusTimer = null;
    sessionChanged();
    await Promise.all([renderRecent(), refreshWorkItems(), refreshReminders(true), syncSegment(true)]);
    const message = outcome === 'completed'
      ? `Run saved as completed. This location will be flagged again in ${settings.followUpDays} days.`
      : outcome === 'needs-return'
        ? 'Run saved as needs return. A reminder is due tomorrow at 6:30 AM.'
        : 'Run saved as partial. Another mowing session can be appended later.';
    mowingMessage(ui, message);
  } finally {
    for (const button of [ui.finishComplete, ui.finishReturn, ui.finishPartial]) button.disabled = false;
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
    ui.segment.textContent = 'No project segment selected. GPS location will identify the mowing run.';
    ui.mowStatus.disabled = true;
    ui.mowStatus.value = 'unmowed';
    return;
  }
  ui.segment.textContent = next.name || next.id;
  ui.mowStatus.disabled = false;
  ui.mowStatus.value = await getSegmentMowingStatus(next.id);
  const sameSegment = workItems
    .filter((item) => item.segmentId === next.id && dueOrOpen(item))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (sameSegment && !getMowingSessionState().active) {
    ui.workItem.value = sameSegment.id;
    renderSelectedMowingWorkItem(ui, sameSegment);
  }
}

async function updateSegmentStatus(): Promise<void> {
  if (!ui || !selectedSegmentId) return;
  await setSegmentMowingStatus(selectedSegmentId, ui.mowStatus.value as MowStatus);
  mowingMessage(ui, `${selectedSegmentName || selectedSegmentId}: mowing state updated.`);
}

function saveEquipmentProfile(): void {
  if (!ui) return;
  settings = normalizeMowingSettings(readMowingSettings(ui, settings));
  void putSetting(SETTINGS_KEY, JSON.stringify(settings)).then(() => {
    renderEquipmentProfiles(ui!, settings);
    mowingMessage(ui!, 'Mower profile saved.');
  });
}

function newEquipmentProfile(): void {
  if (!ui) return;
  const id = crypto.randomUUID();
  settings = {
    ...settings,
    selectedEquipmentId: id,
    equipmentProfiles: [...settings.equipmentProfiles, {
      id,
      name: 'New mower',
      machine: '',
      cuttingWidthFeet: null,
      notes: ''
    }]
  };
  renderEquipmentProfiles(ui, settings);
  ui.equipment.value = id;
  fillEquipmentEditor(ui, settings.equipmentProfiles.at(-1)!);
  ui.equipmentName.focus();
}

function deleteEquipmentProfile(): void {
  if (!ui) return;
  if (settings.equipmentProfiles.length <= 1) {
    mowingMessage(ui, 'At least one mower profile is required.', true);
    return;
  }
  const id = ui.equipment.value;
  const equipmentProfiles = settings.equipmentProfiles.filter((profile) => profile.id !== id);
  settings = { ...settings, equipmentProfiles, selectedEquipmentId: equipmentProfiles[0].id };
  fillMowingSettings(ui, settings);
  void putSetting(SETTINGS_KEY, JSON.stringify(settings));
  mowingMessage(ui, 'Mower profile deleted.');
}

async function exportFile(kind: 'csv' | 'pdf', range: 'week' | 'ytd'): Promise<void> {
  if (!ui) return;
  try {
    if (kind === 'csv') await exportWorkCsv(range);
    else await exportWorkPdf(range);
    mowingMessage(ui, `${range === 'week' ? 'Weekly' : 'Year-to-date'} ${kind.toUpperCase()} created.`);
  } catch (error) {
    mowingMessage(ui, error instanceof Error ? error.message : 'Export failed.', true);
  }
}

async function handleReminderAction(target: Element): Promise<void> {
  if (!ui) return;
  const useId = target.closest<HTMLButtonElement>('[data-mowing-use]')?.dataset.mowingUse;
  if (useId) {
    ui.workItem.value = useId;
    renderSelectedMowingWorkItem(ui, workItems.find((item) => item.id === useId) ?? null);
    mowingMessage(ui, 'Reminder location selected. A new run will append when mowing starts.');
    return;
  }
  const reviewedId = target.closest<HTMLButtonElement>('[data-mowing-reviewed]')?.dataset.mowingReviewed;
  if (reviewedId) {
    await acknowledgeMowingFollowUp(reviewedId, settings.followUpDays);
    await Promise.all([refreshWorkItems(reviewedId), refreshReminders()]);
    mowingMessage(ui, `Follow-up acknowledged and flagged again in ${settings.followUpDays} days.`);
  }
}

async function mountAssistant(): Promise<void> {
  if (document.getElementById('bfid-mowing-assistant')) return;
  const sidebar = document.querySelector<HTMLElement>('.sidebar');
  if (!sidebar) {
    window.setTimeout(() => void mountAssistant(), 100);
    return;
  }
  ui = createMowingUi(sidebar);
  hideLegacyMowingControls();
  await loadSettings();
  fillMowingSettings(ui, settings);
  await refreshWorkItems();

  ui.start.onclick = () => void start();
  ui.finishComplete.onclick = () => void finish('completed');
  ui.finishReturn.onclick = () => void finish('needs-return');
  ui.finishPartial.onclick = () => void finish('partial');
  ui.saveSettings.onclick = () => void saveSettings().then(() => mowingMessage(ui!, 'Mowing settings saved.'));
  ui.workItem.onchange = () => renderSelectedMowingWorkItem(ui!, workItems.find((item) => item.id === ui!.workItem.value) ?? null);
  ui.equipment.onchange = () => {
    settings = { ...settings, selectedEquipmentId: ui!.equipment.value };
    const profile = settings.equipmentProfiles.find((item) => item.id === ui!.equipment.value);
    if (profile) fillEquipmentEditor(ui!, profile);
  };
  ui.equipmentSave.onclick = saveEquipmentProfile;
  ui.equipmentNew.onclick = newEquipmentProfile;
  ui.equipmentDelete.onclick = deleteEquipmentProfile;
  ui.mowStatus.onchange = () => void updateSegmentStatus();
  ui.enableReminders.onclick = () => void enableReminders();
  ui.weekCsv.onclick = () => void exportFile('csv', 'week');
  ui.weekPdf.onclick = () => void exportFile('pdf', 'week');
  ui.ytdCsv.onclick = () => void exportFile('csv', 'ytd');
  ui.ytdPdf.onclick = () => void exportFile('pdf', 'ytd');
  ui.reminders.addEventListener('click', (event) => {
    if (event.target instanceof Element) void handleReminderAction(event.target);
  });

  window.addEventListener('bfid:spray-track', (event) => {
    if (!ui || getMowingSessionState().active) return;
    const active = Boolean((event as CustomEvent<{ active?: boolean }>).detail?.active);
    ui.start.disabled = active;
    ui.start.title = active ? 'Finish spraying first.' : '';
  });

  document.addEventListener('click', (event) => {
    if (!getMowingSessionState().active || !ui) return;
    const button = event.target instanceof Element ? event.target.closest('button') : null;
    const text = button?.textContent?.trim();
    if (['Record travel', 'Start building road'].includes(text ?? '') || button?.classList.contains('bfid-spray-start')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      mowingMessage(ui, 'Finish mowing before starting another field activity.', true);
    }
  }, true);

  new MutationObserver(() => {
    hideLegacyMowingControls();
    void syncSegment();
    lockOtherActivities(getMowingSessionState().active);
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

export function installMowingAssistant(): void {
  const state = window as unknown as Record<string, unknown>;
  if (state[FLAG]) return;
  state[FLAG] = true;
  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', () => void mountAssistant(), { once: true })
    : void mountAssistant();
}
