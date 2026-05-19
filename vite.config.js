import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@tiptap')) {
              return 'tiptap';
            }
            if (id.includes('firebase')) {
              return 'firebase';
            }
            if (id.includes('yjs')) {
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
