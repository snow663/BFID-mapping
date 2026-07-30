import type {
  MowingEquipmentProfile,
  MowingReminder,
  MowingSessionState,
  MowingSettings,
  MowingWorkItem,
  RecentMowingSession
} from './mowingSession';
import { selectedMowingEquipment } from './mowingSession';

const TIME_ZONE = 'America/Denver';
export const NEW_MOWING_WORK_ITEM = '__new__';

export type MowingUi = {
  section: HTMLElement;
  workItem: HTMLSelectElement;
  workItemInfo: HTMLElement;
  notes: HTMLTextAreaElement;
  equipment: HTMLSelectElement;
  equipmentName: HTMLInputElement;
  machine: HTMLInputElement;
  cuttingWidth: HTMLInputElement;
  equipmentNotes: HTMLInputElement;
  equipmentNew: HTMLButtonElement;
  equipmentSave: HTMLButtonElement;
  equipmentDelete: HTMLButtonElement;
  followUpDays: HTMLInputElement;
  saveSettings: HTMLButtonElement;
  session: HTMLElement;
  start: HTMLButtonElement;
  finishActions: HTMLElement;
  finishComplete: HTMLButtonElement;
  finishReturn: HTMLButtonElement;
  finishPartial: HTMLButtonElement;
  recent: HTMLElement;
  reminders: HTMLElement;
  enableReminders: HTMLButtonElement;
  weekCsv: HTMLButtonElement;
  weekPdf: HTMLButtonElement;
  ytdCsv: HTMLButtonElement;
  ytdPdf: HTMLButtonElement;
  segment: HTMLElement;
  mowStatus: HTMLSelectElement;
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

export function formatMowingTime(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  }).format(new Date(value));
}

function html(): string {
  return `
<h2>Mowing field assistant</h2>
<div class="bfid-mowing-workflow">
  <div class="segment-card"><strong>Current location</strong><span class="mowing-segment">No project segment selected.</span></div>
  <label>Run / location archive<select class="mowing-work-item"><option value="${NEW_MOWING_WORK_ITEM}">New run at current location</option></select></label>
  <div class="bfid-mowing-work-item-info">A new location archive will be created from the first GPS fix.</div>
</div>
<details class="bfid-mowing-settings">
  <summary>Mower profiles and follow-up settings</summary>
  <div>
    <label>Run notes<textarea class="mowing-notes" placeholder="Skipped patches, obstructions, rough areas, access issues, field notes"></textarea></label>
    <div class="bfid-mowing-profile-editor">
      <label>Mower profile<select class="mowing-equipment"></select></label>
      <div class="bfid-mowing-grid">
        <label>Profile name<input class="mowing-equipment-name"></label>
        <label>Machine / vehicle<input class="mowing-machine"></label>
        <label>Cutting width feet<input class="mowing-cutting-width" type="number" min="0" step="0.5"></label>
      </div>
      <label>Profile notes<input class="mowing-equipment-notes" placeholder="Deck, attachment, usual setup"></label>
      <div class="bfid-mowing-actions three"><button class="mowing-equipment-new" type="button">New profile</button><button class="mowing-equipment-save" type="button">Save profile</button><button class="mowing-equipment-delete" type="button">Delete profile</button></div>
    </div>
    <label>Follow-up flag after days<input class="mowing-follow-up-days" type="number" min="1" max="365"></label>
    <button class="mowing-save-settings wide" type="button">Save mowing settings</button>
  </div>
</details>
<div class="bfid-mowing-session"><span>No mowing session active.</span></div>
<div class="bfid-mowing-start-row"><button class="bfid-mowing-start wide" type="button">Start mowing here</button></div>
<div class="bfid-mowing-finish-actions" hidden>
  <button class="bfid-mowing-complete" type="button">Finish · completed</button>
  <button class="bfid-mowing-needs-return" type="button">Finish · needs return</button>
  <button class="bfid-mowing-partial" type="button">Finish · partial</button>
</div>
<details class="bfid-mowing-archive" open>
  <summary>Reminders and work archive</summary>
  <div>
    <div class="bfid-mowing-reminders"></div>
    <button class="mowing-enable-reminders wide" type="button">Enable browser reminder notices</button>
    <strong>Recent mowing runs</strong>
    <div class="bfid-mowing-record-list"></div>
    <strong>Completed work exports</strong>
    <div class="bfid-mowing-actions two"><button class="mowing-week-csv" type="button">Weekly CSV</button><button class="mowing-week-pdf" type="button">Weekly PDF</button><button class="mowing-ytd-csv" type="button">YTD CSV</button><button class="mowing-ytd-pdf" type="button">YTD PDF</button></div>
  </div>
</details>
<label>Selected segment mowing state<select class="mowing-status" disabled><option value="unmowed">Unmowed</option><option value="partial">Partial</option><option value="mowed">Mowed</option><option value="needs-return">Needs return</option><option value="skipped">Skipped</option></select></label>
<div class="bfid-mowing-message"></div>`;
}

export function createMowingUi(sidebar: HTMLElement): MowingUi {
  const section = document.createElement('section');
  section.id = 'bfid-mowing-assistant';
  section.innerHTML = html();
  const spray = document.getElementById('bfid-spray-assistant');
  const portable = [...sidebar.querySelectorAll<HTMLElement>('section')]
    .find((item) => item.querySelector('h2')?.textContent?.trim() === 'Portable data');
  if (spray?.parentElement === sidebar) sidebar.insertBefore(section, spray);
  else if (portable) sidebar.insertBefore(section, portable);
  else sidebar.append(section);
  const query = <T extends Element>(selector: string): T => section.querySelector<T>(selector)!;
  return {
    section,
    workItem: query('.mowing-work-item'),
    workItemInfo: query('.bfid-mowing-work-item-info'),
    notes: query('.mowing-notes'),
    equipment: query('.mowing-equipment'),
    equipmentName: query('.mowing-equipment-name'),
    machine: query('.mowing-machine'),
    cuttingWidth: query('.mowing-cutting-width'),
    equipmentNotes: query('.mowing-equipment-notes'),
    equipmentNew: query('.mowing-equipment-new'),
    equipmentSave: query('.mowing-equipment-save'),
    equipmentDelete: query('.mowing-equipment-delete'),
    followUpDays: query('.mowing-follow-up-days'),
    saveSettings: query('.mowing-save-settings'),
    session: query('.bfid-mowing-session'),
    start: query('.bfid-mowing-start'),
    finishActions: query('.bfid-mowing-finish-actions'),
    finishComplete: query('.bfid-mowing-complete'),
    finishReturn: query('.bfid-mowing-needs-return'),
    finishPartial: query('.bfid-mowing-partial'),
    recent: query('.bfid-mowing-record-list'),
    reminders: query('.bfid-mowing-reminders'),
    enableReminders: query('.mowing-enable-reminders'),
    weekCsv: query('.mowing-week-csv'),
    weekPdf: query('.mowing-week-pdf'),
    ytdCsv: query('.mowing-ytd-csv'),
    ytdPdf: query('.mowing-ytd-pdf'),
    segment: query('.mowing-segment'),
    mowStatus: query('.mowing-status'),
    message: query('.bfid-mowing-message')
  };
}

export function fillEquipmentEditor(ui: MowingUi, profile: MowingEquipmentProfile): void {
  ui.equipmentName.value = profile.name;
  ui.machine.value = profile.machine;
  ui.cuttingWidth.value = profile.cuttingWidthFeet === null ? '' : String(profile.cuttingWidthFeet);
  ui.equipmentNotes.value = profile.notes;
}

export function readEquipmentEditor(ui: MowingUi, id = ui.equipment.value || crypto.randomUUID()): MowingEquipmentProfile {
  const width = Number(ui.cuttingWidth.value);
  return {
    id,
    name: ui.equipmentName.value.trim() || 'Unnamed mower',
    machine: ui.machine.value.trim(),
    cuttingWidthFeet: Number.isFinite(width) && width > 0 ? width : null,
    notes: ui.equipmentNotes.value.trim()
  };
}

export function renderEquipmentProfiles(ui: MowingUi, settings: MowingSettings): void {
  ui.equipment.innerHTML = settings.equipmentProfiles
    .map((profile) => `<option value="${esc(profile.id)}">${esc(profile.name)}</option>`)
    .join('');
  ui.equipment.value = settings.selectedEquipmentId;
  fillEquipmentEditor(ui, selectedMowingEquipment(settings));
}

export function fillMowingSettings(ui: MowingUi, settings: MowingSettings): void {
  ui.notes.value = settings.sessionNotes;
  ui.followUpDays.value = String(settings.followUpDays);
  renderEquipmentProfiles(ui, settings);
}

export function readMowingSettings(ui: MowingUi, current: MowingSettings): MowingSettings {
  const profile = readEquipmentEditor(ui);
  const profiles = current.equipmentProfiles.some((item) => item.id === profile.id)
    ? current.equipmentProfiles.map((item) => item.id === profile.id ? profile : item)
    : [...current.equipmentProfiles, profile];
  const days = Number(ui.followUpDays.value);
  return {
    selectedEquipmentId: profile.id,
    equipmentProfiles: profiles,
    followUpDays: Number.isFinite(days) ? Math.min(365, Math.max(1, Math.round(days))) : 30,
    sessionNotes: ui.notes.value.trim()
  };
}

export function mowingMessage(ui: MowingUi, text: string, error = false): void {
  ui.message.textContent = text;
  ui.message.className = `bfid-mowing-message${error ? ' error' : ''}`;
}

export function renderMowingSession(ui: MowingUi, state: MowingSessionState, oldText: string, oldRecording: boolean): void {
  ui.start.hidden = state.active;
  ui.finishActions.hidden = !state.active;
  ui.workItem.disabled = state.active;
  ui.equipment.disabled = state.active;
  ui.notes.disabled = state.active;
  const status = document.querySelector<HTMLElement>('.status-pill');
  if (state.active && state.session) {
    const minutes = Math.max(0, Math.round((Date.now() - new Date(state.session.startedAt).getTime()) / 60000));
    ui.session.className = 'bfid-mowing-session active';
    ui.session.innerHTML = `<strong>MOWING ACTIVE</strong><span>${minutes} min · ${state.pointCount} GPS points</span><small>${esc(state.session.equipmentProfileName || state.session.equipment)} · run ${state.session.sequence}${state.session.segmentName ? ` · ${esc(state.session.segmentName)}` : ''}</small>`;
    if (status) {
      status.classList.add('recording');
      status.textContent = `MOWING · ${state.pointCount} points`;
    }
  } else {
    ui.session.className = 'bfid-mowing-session';
    ui.session.innerHTML = '<span>No mowing session active.</span>';
    if (status?.textContent?.startsWith('MOWING')) {
      status.textContent = oldText || 'Location inactive';
      status.classList.toggle('recording', oldRecording);
    }
  }
}

export function renderMowingWorkItems(ui: MowingUi, items: MowingWorkItem[], selectedId = NEW_MOWING_WORK_ITEM): void {
  const options = [`<option value="${NEW_MOWING_WORK_ITEM}">New run at current location</option>`];
  for (const item of [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
    const suffix = item.status === 'completed' ? 'completed' : item.status === 'needs-return' ? 'return due' : 'open';
    options.push(`<option value="${esc(item.id)}">${esc(item.label)} · ${suffix} · ${item.sessionIds.length} run${item.sessionIds.length === 1 ? '' : 's'}</option>`);
  }
  ui.workItem.innerHTML = options.join('');
  ui.workItem.value = items.some((item) => item.id === selectedId) ? selectedId : NEW_MOWING_WORK_ITEM;
  renderSelectedMowingWorkItem(ui, items.find((item) => item.id === ui.workItem.value) ?? null);
}

export function renderSelectedMowingWorkItem(ui: MowingUi, item: MowingWorkItem | null): void {
  if (!item) {
    ui.workItemInfo.textContent = 'A new location archive will be created from the first GPS fix.';
    return;
  }
  const due = item.nextReturnAt || item.followUpAt;
  ui.workItemInfo.innerHTML = `<strong>${esc(item.label)}</strong><span>${item.sessionIds.length} saved run${item.sessionIds.length === 1 ? '' : 's'} · ${esc(item.status)}${due ? ` · flagged ${esc(formatMowingTime(due))}` : ''}</span>`;
}

export function renderRecentMowing(ui: MowingUi, records: RecentMowingSession[]): void {
  ui.recent.innerHTML = records.length
    ? records.map((record) => `<article class="bfid-mowing-record"><strong>${esc(record.segmentName || record.equipmentProfileName || 'Mowing run')}</strong><span>${esc(formatMowingTime(record.startedAt))} · ${record.durationMinutes} min · ${record.pointCount} GPS points</span><small>${esc(record.outcome || (record.endedAt ? 'ended' : 'unfinished'))} · archive run ${record.sequence || 1}${record.equipmentProfileName ? ` · ${esc(record.equipmentProfileName)}` : ''}</small></article>`).join('')
    : '<div class="bfid-mowing-empty">No archived mowing runs yet.</div>';
}

export function renderMowingReminders(ui: MowingUi, reminders: MowingReminder[]): void {
  ui.reminders.innerHTML = reminders.length
    ? reminders.map((reminder) => `<article class="bfid-mowing-reminder ${reminder.kind}"><strong>${reminder.kind === 'return' ? 'Return due' : 'Follow-up visit due'}</strong><span>${esc(reminder.workItem.label)}</span><small>Due ${esc(formatMowingTime(reminder.dueAt))} · ${reminder.workItem.sessionIds.length} archived run${reminder.workItem.sessionIds.length === 1 ? '' : 's'}</small><div><button type="button" data-mowing-use="${esc(reminder.workItem.id)}">Use this location</button>${reminder.kind === 'follow-up' ? `<button type="button" data-mowing-reviewed="${esc(reminder.workItem.id)}">Reviewed</button>` : ''}</div></article>`).join('')
    : '<div class="bfid-mowing-empty">No mowing return or follow-up flags are due.</div>';
}
