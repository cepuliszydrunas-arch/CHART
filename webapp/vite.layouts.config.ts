/**
 * Atskiras client bundle build — layouts.js (Free Layout controller).
 * `npm run build:layouts` → public/static/layouts.js
 */
import { defineConfig } from 'vite'

export default defineConfig({
  publicDir: false,
  build: {
    lib: {
      entry: 'src/client/layouts-entry.ts',
      formats: ['es'],
      fileName: () => 'layouts.js'
    },
    outDir: 'public/static',
    emptyOutDir: false,
    minify: true,
    sourcemap: false
  }
})
