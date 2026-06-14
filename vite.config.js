import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Build a version string (package version + short git SHA) injected into the
// client so logged errors can be attributed to a specific build.
function resolveAppVersion() {
  let version = '0.0.0';
  try {
    version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url))).version || version;
  } catch { /* ignore */ }
  let sha = 'unknown';
  try {
    sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch { /* not a git checkout */ }
  return `${version}+${sha}`;
}

export default defineConfig({
  root: '.',
  define: {
    __APP_VERSION__: JSON.stringify(resolveAppVersion()),
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1200,
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@tiptap') || id.includes('prosemirror')) {
              return 'tiptap';
            }
            if (id.includes('firebase')) {
              return 'firebase';
            }
            if (id.includes('/yjs/') || id.includes('/y-') || id.includes('yjs')) {
              return 'yjs';
            }
            return 'vendor';
          }
        }
      }
    }
  },
  server: {
    port: 3000,
    open: true,
  },
  resolve: {
    alias: {
      crypto: 'crypto-browserify',
      stream: 'stream-browserify',
    }
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Insel-Wiki',
        short_name: 'InselWiki',
        description: 'Kollaboratives Echtzeit-Wiki für das Inselspital Bern',
        theme_color: '#04120e',
        background_color: '#04120e',
        display: 'standalone',
        icons: [
          {
            src: 'favicon.svg',
            sizes: '192x192',
            type: 'image/svg+xml'
          },
          {
            src: 'favicon.svg',
            sizes: '512x512',
            type: 'image/svg+xml'
          },
          {
            src: 'favicon.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          }
        ]
      }
    })
  ]
});
