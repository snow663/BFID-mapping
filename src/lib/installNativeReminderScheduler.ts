import { isTauri } from '@tauri-apps/api/core';
import { loadMowingWorkItems } from './mowingSession';
import { loadSprayWorkItems } from './spraySession';

const FLAG = '__bfidNativeReminderSchedulerInstalled';
const RESYNC_DELAY_MS = 1500;
const SECOND_RESYNC_DELAY_MS = 7000;
const PERIODIC_RESYNC_MS = 60 * 60 * 1000;

type NotificationModule = typeof import('@tauri-apps/plugin-notification');

type DesiredReminder = {
  id: number;
  title: string;
  body: string;
  dueAt: string;
};

let notificationModule: NotificationModule | null = null;
let syncing = false;

function notificationId(key: string): number {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 1) || 1;
}

function reminder(
  key: string,
  title: string,
  body: string,
  dueAt: string | undefined
): DesiredReminder | null {
  if (!dueAt) return null;
  const time = new Date(dueAt).getTime();
  if (!Number.isFinite(time) || time <= Date.now()) return null;
  return { id: notificationId(key), title, body, dueAt };
}

async function plugin(): Promise<NotificationModule | null> {
  if (!isTauri()) return null;
  if (notificationModule) return notificationModule;
  try {
    notificationModule = await import('@tauri-apps/plugin-notification');
    return notificationModule;
  } catch (error) {
    console.warn('Native notification plugin unavailable', error);
    return null;
  }
}

async function ensurePermission(request: boolean): Promise<boolean> {
  const api = await plugin();
  if (!api) return false;
  if (await api.isPermissionGranted()) return true;
  if (!request) return false;
  return (await api.requestPermission()) === 'granted';
}

async function desiredReminders(): Promise<{ desired: DesiredReminder[]; managedIds: number[] }> {
  const desired: DesiredReminder[] = [];
  const managedIds = new Set<number>();
  const [sprayItems, mowingItems] = await Promise.all([loadSprayWorkItems(), loadMowingWorkItems()]);

  for (const item of sprayItems) {
    const returnKey = `spraying:return:${item.id}`;
    const followUpKey = `spraying:follow-up:${item.id}`;
    managedIds.add(notificationId(returnKey));
    managedIds.add(notificationId(followUpKey));
    const next = item.status === 'needs-return'
      ? reminder(returnKey, 'Spraying return due', item.label, item.nextReturnAt)
      : item.status === 'completed'
        ? reminder(followUpKey, 'Spraying follow-up due', item.label, item.followUpAt)
        : null;
    if (next) desired.push(next);
  }

  for (const item of mowingItems) {
    const returnKey = `mowing:return:${item.id}`;
    const followUpKey = `mowing:follow-up:${item.id}`;
    managedIds.add(notificationId(returnKey));
    managedIds.add(notificationId(followUpKey));
    const next = item.status === 'needs-return'
      ? reminder(returnKey, 'Mowing return due', item.label, item.nextReturnAt)
      : item.status === 'completed'
        ? reminder(followUpKey, 'Mowing follow-up due', item.label, item.followUpAt)
        : null;
    if (next) desired.push(next);
  }

  return { desired, managedIds: [...managedIds] };
}

async function syncNativeReminders(requestPermission = false): Promise<boolean> {
  if (syncing || !isTauri()) return false;
  syncing = true;
  try {
    const api = await plugin();
    if (!api || !(await ensurePermission(requestPermission))) return false;
    const { desired, managedIds } = await desiredReminders();

    if (managedIds.length) {
      try { await api.cancel(managedIds); } catch { /* Nothing scheduled yet is normal. */ }
    }

    for (const item of desired) {
      api.sendNotification({
        id: item.id,
        title: item.title,
        body: item.body,
        schedule: api.Schedule.at(new Date(item.dueAt), false, true)
      });
    }
    return true;
  } catch (error) {
    console.warn('Could not synchronize native work reminders', error);
    return false;
  } finally {
    syncing = false;
  }
}

function messageFor(button: Element): HTMLElement | null {
  const section = button.closest<HTMLElement>('section');
  return section?.querySelector<HTMLElement>('.bfid-spray-message, .bfid-mowing-message') ?? null;
}

async function enableFromButton(button: Element): Promise<void> {
  const message = messageFor(button);
  if (message) message.textContent = 'Requesting device notification permission…';
  const enabled = await syncNativeReminders(true);
  if (message) {
    message.textContent = enabled
      ? 'Device reminders enabled. Return and follow-up notices are scheduled even when the app is closed.'
      : 'Device notification permission was not granted.';
    message.classList.toggle('error', !enabled);
  }
}

function updateButtonLabels(root: ParentNode = document): void {
  for (const button of root.querySelectorAll<HTMLButtonElement>('.spray-enable-reminders, .mowing-enable-reminders')) {
    button.textContent = 'Enable device reminder notices';
  }
}

function scheduleResync(): void {
  window.setTimeout(() => void syncNativeReminders(false), RESYNC_DELAY_MS);
  window.setTimeout(() => void syncNativeReminders(false), SECOND_RESYNC_DELAY_MS);
}

export function installNativeReminderScheduler(): void {
  const global = window as unknown as Record<string, unknown>;
  if (global[FLAG]) return;
  global[FLAG] = true;
  if (!isTauri()) return;

  const start = (): void => {
    updateButtonLabels();
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element) updateButtonLabels(node);
        }
      }
    }).observe(document.body, { childList: true, subtree: true });

    document.addEventListener('click', (event) => {
      if (!(event.target instanceof Element)) return;
      const enableButton = event.target.closest('.spray-enable-reminders, .mowing-enable-reminders');
      if (enableButton) {
        event.preventDefault();
        event.stopImmediatePropagation();
        void enableFromButton(enableButton);
        return;
      }

      if (event.target.closest([
        '.bfid-spray-start',
        '.bfid-spray-complete',
        '.bfid-spray-needs-return',
        '.bfid-spray-partial',
        '[data-spray-reviewed]',
        '.bfid-mowing-start',
        '.bfid-mowing-complete',
        '.bfid-mowing-needs-return',
        '.bfid-mowing-partial',
        '[data-mowing-reviewed]'
      ].join(','))) scheduleResync();
    }, true);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void syncNativeReminders(false);
    });
    window.setInterval(() => void syncNativeReminders(false), PERIODIC_RESYNC_MS);
    void syncNativeReminders(false);
  };

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', start, { once: true })
    : start();
}
