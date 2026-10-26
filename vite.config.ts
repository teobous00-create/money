import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// BASE is set by the GitHub Pages workflow to "/<repo>/"; "/" locally.
const base = process.env.BASE || '/';

const version = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').slice(2);

export default defineConfig({
  base,
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png', 'sc-voice.png', 'sc-add.png', 'sc-shift.png'],
      manifest: {
        name: 'Money',
        short_name: 'Money',
        description: 'Personal budgeting with a shared joint account',
        theme_color: '#0f766e',
        background_color: '#f5f4f0',
        display: 'standalone',
        orientation: 'portrait',
        start_url: base,
        scope: base,
        // long-press the app icon
        shortcuts: [
          { name: 'Say an entry', short_name: 'Say entry', url: base + '?a=voice', icons: [{ src: 'sc-voice.png', sizes: '96x96', type: 'image/png' }] },
          { name: 'New expense', short_name: 'Expense', url: base + '?a=expense', icons: [{ src: 'sc-add.png', sizes: '96x96', type: 'image/png' }] },
          { name: 'Today’s shift', short_name: 'Shift', url: base + '?a=shift', icons: [{ src: 'sc-shift.png', sizes: '96x96', type: 'image/png' }] },
        ],
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: base + 'index.html',
        cleanupOutdatedCaches: true
      }
    })
  ]
});
