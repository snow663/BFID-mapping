import { mount } from 'svelte';
import 'maplibre-gl/dist/maplibre-gl.css';
import './app.css';
import './map-overrides.css';

type Installer = {
  name: string;
  run: () => Promise<void>;
};

const buildId = import.meta.env.VITE_BUILD_ID || 'dev-local';

function errorText(error: unknown): string {
  if (error instanceof Error) return error.stack || error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return 'Unknown startup error';
  }
}

function reportFatalStartup(error: unknown): void {
  const message = errorText(error);
  console.error('BFID Mapping startup failed', error);

  const boot = document.getElementById('bfid-boot');
  if (!boot) return;
  boot.classList.add('failed');

  const heading = boot.querySelector<HTMLElement>('[data-boot-heading]');
  const detail = boot.querySelector<HTMLElement>('[data-boot-detail]');
  if (heading) heading.textContent = 'BFID Mapping could not start';
  if (detail) detail.textContent = message;
}

function clearBootPanel(): void {
  const boot = document.getElementById('bfid-boot');
  if (!boot) return;
  window.requestAnimationFrame(() => boot.remove());
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
      await installer.run();
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
    const reloading = await clearHostedPreviewCaches();
    if (reloading) return;

    await installStartupPatches();

    const { default: App } = await import('./App.svelte');
    const target = document.getElementById('app');
    if (!target) throw new Error('Application mount element is missing.');

    mount(App, { target });
    clearBootPanel();
  } catch (error) {
    reportFatalStartup(error);
  }
}

void start();
