import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

const isGitHubPages = process.env.GITHUB_PAGES === 'true';
const base = isGitHubPages ? '/BFID-mapping/' : './';

const pwaPlugin = VitePWA({
  registerType: 'autoUpdate',
  includeAssets: ['icon.svg'],
  manifest: {
    name: 'BFID Mapping',
    short_name: 'BFID Map',
    description: 'Local-first field mapping for BFID mowing and access work',
    theme_color: '#102b1f',
    background_color: '#091611',
    display: 'standalone',
    orientation: 'any',
    start_url: './',
    scope: './',
    icons: [
      {
        src: 'icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any maskable'
      }
    ]
  },
  workbox: {
    navigateFallback: 'index.html',
    globPatterns: ['**/*.{js,css,html,svg,woff2}'],
    maximumFileSizeToCacheInBytes: 8 * 1024 * 1024
  }
});

export default defineConfig({
  base,
  plugins: [svelte(), ...(!isGitHubPages ? [pwaPlugin] : [])],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: '0.0.0.0'
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'es2022',
    minify: process.env.TAURI_ENV_DEBUG ? false : 'esbuild',
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG)
  }
});
