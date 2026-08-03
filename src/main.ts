import { mount } from 'svelte';
import 'maplibre-gl/dist/maplibre-gl.css';
import './app.css';
import './map-overrides.css';

type Installer = {
  name: string;
  run: () => Promise<void>;
};

type BootBridge = {
  stage?: string;
  ready?: boolean;
};

const buildId = import.meta.env.VITE_BUILD_ID || 'dev-local';
const bootBridge = window as Window & { __BFID_BOOT__?: BootBridge };

function errorText(error: unknown): string {
  if (error instanceof Error) return error.stack || error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return 'Unknown startup error';
  }
}

function setBootStage(detailText: string, headingText = 'Starting BFID Mapping…'): void {
  bootBridge.__BFID_BOOT__ ??= {};
  bootBridge.__BFID_BOOT__.stage = detailText;

  const boot = document.getElementById('bfid-boot');
  if (!boot) return;
  const heading = boot.querySelector<HTMLElement>('[data-boot-heading]');
  const detail = boot.querySelector<HTMLElement>('[data-boot-detail]');
  if (heading) heading.textContent = headingText;
  if (detail) detail.textContent = detailText;
}

function reportFatalStartup(error: unknown): void {
  const message = errorText(error);
  console.error('BFID Mapping startup failed', error);

  bootBridge.__BFID_BOOT__ ??= {};
  bootBridge.__BFID_BOOT__.stage = message;

  const boot = document.getElementById('bfid-boot');
  if (!boot) return;
  boot.classList.add('failed');

  const heading = boot.querySelector<HTMLElement>('[data-boot-heading]');
  const detail = boot.querySelector<HTMLElement>('[data-boot-detail]');
  if (heading) heading.textContent = 'BFID Mapping could not start';
  if (detail) detail.textContent = message;
}

function clearBootPanel(): void {
  bootBridge.__BFID_BOOT__ ??= {};
  bootBridge.__BFID_BOOT__.ready = true;

  const boot = document.getElementById('bfid-boot');
  if (!boot) return;
  window.requestAnimationFrame(() => boot.remove());
}

function installCompatibilityPolyfills(): void {
  const arrayPrototype = Array.prototype as unknown as {
    at?: (this: unknown[], index: number) => unknown;
  };

  if (!arrayPrototype.at) {
    Object.defineProperty(Array.prototype, 'at', {
      configurable: true,
      writable: true,
      value(this: unknown[], index: number): unknown {
        const length = this.length >>> 0;
        const relativeIndex = Math.trunc(index) || 0;
        const resolvedIndex = relativeIndex < 0 ? length + relativeIndex : relativeIndex;
        return resolvedIndex < 0 || resolvedIndex >= length ? undefined : this[resolvedIndex];
      }
    });
  }

  const cryptoObject = globalThis.crypto as (Crypto & { randomUUID?: () => string }) | undefined;
  if (cryptoObject && !cryptoObject.randomUUID) {
    Object.defineProperty(cryptoObject, 'randomUUID', {
      configurable: true,
      value(): string {
        const bytes = new Uint8Array(16);
        cryptoObject.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      }
    });
  }
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number, label: string): Promise<T> {
  let timeoutId: number | undefined;
  const timeout = new Promise<T>((_resolve, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(label)), milliseconds);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
}

async function installStartupPatches(): Promise<void> {
  const installers: Installer[] = [
    {
      name: 'NHD service adapter',
      run: async () => (await import('./lib/installNhdServiceAdapter')).installNhdServiceAdapter()
    },
    {
      name: 'reference overlays',
      run: async () => (await import('./lib/installReferenceOverlays')).installReferenceOverlayPatch()
    },
    {
      name: 'GPS follow',
      run: async () => (await import('./lib/installGpsFollow')).installGpsFollowPatch()
    },
    {
      name: 'project import',
      run: async () => (await import('./lib/installProjectImport')).installProjectImportPatch()
    },
    {
      name: 'irrigation reconnaissance',
      run: async () => (await import('./lib/installIrrigationRecon')).installIrrigationReconPatch()
    },
    {
      name: 'explicit map panels',
      run: async () => (await import('./lib/installExplicitMapPanels')).installExplicitMapPanels()
    },
    {
      name: 'map polish',
      run: async () => (await import('./lib/installMapPolish')).installMapPolishPatch()
    },
    {
      name: 'road label ordering',
      run: async () => (await import('./lib/installRoadLabelOrdering')).installRoadLabelOrderingPatch()
    },
    {
      name: 'Mesonet stations',
      run: async () => (await import('./lib/installMesonetStations')).installMesonetStationsPatch()
    },
    {
      name: 'mowing track layer',
      run: async () => (await import('./lib/installMowingTrackLayer')).installMowingTrackLayer()
    },
    {
      name: 'spray track layer',
      run: async () => (await import('./lib/installSprayTrackLayer')).installSprayTrackLayer()
    },
    {
      name: 'mowing assistant',
      run: async () => (await import('./lib/installMowingAssistant')).installMowingAssistant()
    },
    {
      name: 'spray assistant',
      run: async () => (await import('./lib/installSprayAssistant')).installSprayAssistant()
    },
    {
      name: 'native reminder scheduler',
      run: async () => (await import('./lib/installNativeReminderScheduler')).installNativeReminderScheduler()
    }
  ];

  for (const installer of installers) {
    try {
      await withTimeout(installer.run(), 10_000, `${installer.name} startup timed out.`);
    } catch (error) {
      console.error(`Could not install ${installer.name}`, error);
    }
  }
}

async function clearHostedPreviewCaches(): Promise<boolean> {
  if (!location.hostname.endsWith('github.io')) return false;

  const hadController = 'serviceWorker' in navigator && Boolean(navigator.serviceWorker.controller);

  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
  } catch (error) {
    console.warn('Could not unregister legacy preview service worker', error);
  }

  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch (error) {
    console.warn('Could not clear legacy preview caches', error);
  }

  const reloadKey = `bfid-preview-reset:${buildId}`;
  if (hadController && !sessionStorage.getItem(reloadKey)) {
    sessionStorage.setItem(reloadKey, '1');
    const url = new URL(location.href);
    url.searchParams.set('build', buildId);
    location.replace(url.toString());
    return true;
  }

  return false;
}

async function start(): Promise<void> {
  try {
    installCompatibilityPolyfills();
    setBootStage('Application JavaScript loaded. Preparing the core interface.');

    const reloading = await clearHostedPreviewCaches();
    if (reloading) return;

    setBootStage('Loading the core interface module.');
    const { default: App } = await withTimeout(
      import('./App.svelte'),
      15_000,
      'The core interface module did not load within 15 seconds.'
    );

    const target = document.getElementById('app');
    if (!target) throw new Error('Application mount element is missing.');

    setBootStage('Mounting the core interface.');
    mount(App, { target });
    clearBootPanel();

    window.setTimeout(() => {
      void installStartupPatches();
    }, 0);
  } catch (error) {
    reportFatalStartup(error);
  }
}

void start();
