import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    build: {
      lib: { entry: 'electron/main.ts' },
      rollupOptions: {
        external: ['electron', 'uiohook-napi', '@nut-tree-fork/nut-js', '@lancedb/lancedb', 'apache-arrow'],
        output: { format: 'cjs', entryFileNames: '[name].js' }
      }
    }
  },
  preload: {
    build: {
      lib: { entry: 'electron/preload.ts' }
    }
  },
  renderer: {
    plugins: [react()],
    root: '.',
    build: {
      rollupOptions: {
        input: {
          panel: resolve(__dirname, 'index.html'),
          settings: resolve(__dirname, 'settings.html'),
          toast: resolve(__dirname, 'toast.html'),
          icon: resolve(__dirname, 'icon.html'),
          history: resolve(__dirname, 'history.html'),
          dashboard: resolve(__dirname, 'dashboard.html'),
          voice: resolve(__dirname, 'voice.html'),
          screenshotbtn: resolve(__dirname, 'screenshotbtn.html'),
        }
      }
    }
  }
});
