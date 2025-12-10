import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

import { resolve } from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'index.html'),
        sw: resolve(__dirname, 'src/sw.ts'),
        content: resolve(__dirname, 'src/content/capture.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'sw') return 'sw.js';
          if (chunkInfo.name === 'content') return 'content-script.js';
          return 'assets/[name]-[hash].js';
        },
      },
    },
  },
})
