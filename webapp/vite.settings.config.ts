/**
 * Atskiras client bundle build — settings.js (Chart Settings engine).
 * `npm run build:settings` → public/static/settings.js
 * Analogiški layouts.js (vite.layouts.config.ts).
 */
import { defineConfig } from 'vite'

export default defineConfig({
  publicDir: false,
  build: {
    lib: {
      entry: 'src/client/settings-entry.ts',
      formats: ['es'],
      fileName: () => 'settings.js'
    },
    outDir: 'public/static',
    emptyOutDir: false,
    minify: true,
    sourcemap: false
  }
})