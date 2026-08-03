import { db } from './db';
import { loadMowingWorkItems } from './mowingSession';
import { getSpraySessionState, loadSprayWorkItems, type SpraySessionRecord } from './spraySession';
import type { TrackSession } from './types';

const FLAG = '__bfidCanonicalRouteUiInstalled';
const SPRAY_SUMMARY_ID = 'bfid-spray-route-summary';
const MOWING_SUMMARY_ID = 'bfid-mowing-route-summary';

function number(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function ensureStyles(): void {
  if (document.getElementById('bfid-canonical-route-ui-style')) return;
  const style = document.createElement('style');
  style.id = 'bfid-canonical-route-ui-style';
  style.textContent = `
    .bfid-canonical-route-summary {
      margin: 8px 0 12px;
      padding: 9px 10px;
      border: 1px solid rgba(150, 180, 162, 0.35);
      border-radius: 8px;
      background: rgba(9, 22, 17, 0.45);
      font-size: 12px;
      line-height: 1.45;
    }
    .bfid-canonical-route-summary strong { display: block; margin-bottom: 2px; }
    .bfid-canonical-route-summary span { display: block; opacity: 0.84; }
    .bfid-spray-gallons-label {
      display: block;
      width: 100%;
      margin-bottom: 8px;
      font-size: 12px;
    }
    .bfid-spray-gallons-label input { width: 100%; margin-top: 4px; }
  `;
  document.head.append(style);
}

function summaryElement(id: string, after: Element | null): HTMLElement | null {
  if (!after) return null;
  let element = document.getElementById(id);
  if (!element) {
    element = document.createElement('div');
    element.id = id;
    element.className = 'bfid-canonical-route-summary';
    after.insertAdjacentElement('afterend', element);
  }
  return element;
}

function renderSummary(element: HTMLElement, signature: string, html: string): void {
  if (element.dataset.routeSignature === signature) return;
  element.dataset.routeSignature = signature;
  element.innerHTML = html;
}

function ensureGallonsInput(): HTMLInputElement | null {
  const actions = document.querySelector<HTMLElement>('.bfid-spray-finish-actions');
  if (!actions) return null;
  let input = actions.querySelector<HTMLInputElement>('.spray-gallons-used');
  if (input) return input;

  const label = document.createElement('label');
  label.className = 'bfid-spray-gallons-label';
  label.textContent = 'Gallons used this run';
  input = document.createElement('input');
  input.className = 'spray-gallons-used';
  input.type = 'number';
  input.min = '0';
  input.step = '0.1';
  input.inputMode = 'decimal';
  input.placeholder = 'Enter at finish for gal/mi';
  label.append(input);
  actions.prepend(label);
  return input;
}

async function latestSession(sessionIds: string[]): Promise<TrackSession | null> {
  if (!sessionIds.length) return null;
  const sessions = (await db.trackSessions.bulkGet(sessionIds)).filter((item): item is TrackSession => Boolean(item));
  return sessions.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0] ?? null;
}

async function updateMowingSummary(): Promise<void> {
  const select = document.querySelector<HTMLSelectElement>('.mowing-work-item');
  const after = document.querySelector('.bfid-mowing-work-item-info');
  const element = summaryElement(MOWING_SUMMARY_ID, after);
  if (!element || !select || select.value === '__new__') {
    if (element) renderSummary(element, 'new', '<strong>Canonical route not selected</strong><span>The first completed run at a new location records the permanent route.</span>');
    return;
  }

  const item = (await loadMowingWorkItems()).find((candidate) => candidate.id === select.value);
  if (!item) return;
  const latest = await latestSession(item.sessionIds);
  const route = number(item.routeLengthMiles);
  const latestDistance = number(latest?.completedDistanceMiles);
  const acresPerHour = number(latest?.acresPerHour);
  const latestText = latest
    ? `Latest: ${latest.durationMinutes ?? 0} min${latestDistance === null ? '' : ` · ${latestDistance.toFixed(2)} mi`}${acresPerHour === null ? '' : ` · ${acresPerHour.toFixed(2)} acres/hr`}`
    : 'No compact job records yet.';
  const signature = JSON.stringify([item.id, item.updatedAt, item.runCount, item.sessionIds, route, latest?.id, latest?.endedAt, acresPerHour]);
  const html = route === null
    ? `<strong>Route awaiting first completed run</strong><span>${item.runCount ?? item.sessionIds.length} attempted run(s) · ${latestText}</span>`
    : `<strong>Canonical route: ${route.toFixed(2)} mi</strong><span>${item.runCount ?? item.sessionIds.length} total run(s) · ${item.sessionIds.length} recent record(s) retained · ${latestText}</span>`;
  renderSummary(element, signature, html);
}

async function updateSpraySummary(): Promise<void> {
  const select = document.querySelector<HTMLSelectElement>('.spray-work-item');
  const after = document.querySelector('.bfid-spray-work-item-info');
  const element = summaryElement(SPRAY_SUMMARY_ID, after);
  if (!element || !select || select.value === '__new__') {
    if (element) renderSummary(element, 'new', '<strong>Canonical route not selected</strong><span>The first completed run at a new location records the permanent route.</span>');
    return;
  }

  const item = (await loadSprayWorkItems()).find((candidate) => candidate.id === select.value);
  if (!item) return;
  const latest = await latestSession(item.sessionIds);
  const route = number(item.routeLengthMiles);
  const latestDistance = number(latest?.completedDistanceMiles);
  const gallonsPerMile = number(latest?.gallonsPerMile);
  const latestText = latest
    ? `Latest: ${latest.durationMinutes ?? 0} min${latestDistance === null ? '' : ` · ${latestDistance.toFixed(2)} mi`}${gallonsPerMile === null ? '' : ` · ${gallonsPerMile.toFixed(2)} gal/mi`}`
    : 'No compact job records yet.';
  const signature = JSON.stringify([item.id, item.updatedAt, item.runCount, item.sessionIds, route, latest?.id, latest?.endedAt, gallonsPerMile]);
  const html = route === null
    ? `<strong>Route awaiting first completed run</strong><span>${item.runCount ?? item.sessionIds.length} attempted run(s) · ${latestText}</span>`
    : `<strong>Canonical route: ${route.toFixed(2)} mi</strong><span>${item.runCount ?? item.sessionIds.length} total run(s) · ${item.sessionIds.length} recent record(s) retained · ${latestText}</span>`;
  renderSummary(element, signature, html);
}

async function updateAll(): Promise<void> {
  ensureGallonsInput();
  await Promise.all([updateMowingSummary(), updateSpraySummary()]);
}

async function applyGallons(sessionId: string, gallons: number): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const session = await db.trackSessions.get(sessionId) as unknown as SpraySessionRecord | undefined;
    if (session?.endedAt) {
      const distance = number(session.completedDistanceMiles) ?? 0;
      await db.trackSessions.update(sessionId, {
        gallonsUsed: gallons,
        gallonsPerMile: distance > 0 ? gallons / distance : undefined
      } as any);
      const input = document.querySelector<HTMLInputElement>('.spray-gallons-used');
      if (input) input.value = '';
      window.dispatchEvent(new CustomEvent('bfid:compact-record-updated'));
      await updateAll();
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 500));
  }
}

function install(): void {
  ensureStyles();
  document.addEventListener('change', (event) => {
    if (!(event.target instanceof Element)) return;
    if (event.target.matches('.mowing-work-item, .spray-work-item')) void updateAll();
  });

  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const sprayFinish = event.target.closest('.bfid-spray-complete, .bfid-spray-needs-return, .bfid-spray-partial');
    if (sprayFinish) {
      const sessionId = getSpraySessionState().session?.id;
      const gallons = number(document.querySelector<HTMLInputElement>('.spray-gallons-used')?.value);
      if (sessionId && gallons !== null && gallons >= 0) void applyGallons(sessionId, gallons);
      window.setTimeout(() => void updateAll(), 1200);
    }
    if (event.target.closest('.bfid-mowing-complete, .bfid-mowing-needs-return, .bfid-mowing-partial, .bfid-mowing-start, .bfid-spray-start')) {
      window.setTimeout(() => void updateAll(), 1200);
    }
  }, true);

  const mountTimer = window.setInterval(() => {
    ensureGallonsInput();
    if (document.querySelector('.mowing-work-item') && document.querySelector('.spray-work-item')) {
      window.clearInterval(mountTimer);
      void updateAll();
    }
  }, 250);
  window.setTimeout(() => window.clearInterval(mountTimer), 15_000);

  window.addEventListener('bfid:compact-record-updated', () => void updateAll());
  window.setInterval(() => void updateAll(), 15_000);
  void updateAll();
}

export function installCanonicalRouteUi(): void {
  const global = window as unknown as Record<string, unknown>;
  if (global[FLAG]) return;
  global[FLAG] = true;
  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', install, { once: true })
    : install();
}

installCanonicalRouteUi();
