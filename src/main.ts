import { mount } from 'svelte';
import App from './App.svelte';
import 'maplibre-gl/dist/maplibre-gl.css';
import './app.css';
import './map-overrides.css';

const buildId = import.meta.env.VITE_BUILD_ID || 'dev-local';

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
  const reloading = await clearHostedPreviewCaches();
  if (reloading) return;

  mount(App, {
    target: document.getElementById('app')!
  });
}

void start();
