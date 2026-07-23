import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';
import 'maplibre-gl/dist/maplibre-gl.css';

const buildId = import.meta.env.VITE_BUILD_ID || 'dev-local';

function runRawWebglTest(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 8;

  for (const type of ['webgl2', 'webgl'] as const) {
    try {
      const gl = canvas.getContext(type, {
        alpha: false,
        antialias: false,
        failIfMajorPerformanceCaveat: false,
        powerPreference: 'low-power',
        preserveDrawingBuffer: true
      }) as WebGLRenderingContext | WebGL2RenderingContext | null;

      if (!gl) continue;

      gl.viewport(0, 0, 8, 8);
      gl.clearColor(0.1, 0.8, 0.25, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);

      const pixel = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      const rendered = pixel[1] > 120 && pixel[3] > 200;
      return `${type.toUpperCase()} ${rendered ? 'PASS' : 'CONTEXT-ONLY'}`;
    } catch (error) {
      console.warn(`Raw ${type} test failed`, error);
    }
  }

  return 'WEBGL FAIL';
}

function installBuildBadge(glStatus: string): void {
  const badge = document.createElement('div');
  badge.id = 'bfid-build-badge';
  badge.textContent = `BUILD ${buildId} · ${glStatus}`;
  Object.assign(badge.style, {
    position: 'fixed',
    left: '50%',
    bottom: '4px',
    transform: 'translateX(-50%)',
    zIndex: '99999',
    maxWidth: 'calc(100vw - 12px)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    padding: '4px 8px',
    border: '1px solid #8ab49b',
    borderRadius: '6px',
    background: 'rgba(4, 13, 9, 0.94)',
    color: '#d9f3e1',
    font: '700 11px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    pointerEvents: 'none'
  });
  document.body.appendChild(badge);
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
  const rawGlStatus = runRawWebglTest();
  installBuildBadge(rawGlStatus);

  const reloading = await clearHostedPreviewCaches();
  if (reloading) return;

  mount(App, {
    target: document.getElementById('app')!
  });
}

void start();
