/**
 * Atskiras client bundle build — core/orderflow į naršyklę.
 * `npm run build:client` → public/static/orderflow.js
 */
import { defineConfig } from 'vite'

export default defineConfig({
  publicDir: false,
  build: {
    lib: {
      entry: 'src/client/orderflow-entry.ts',
      formats: ['es'],
      fileName: () => 'orderflow.js'
    },
    outDir: 'public/static',
    emptyOutDir: false,
    minify: true,
    sourcemap: false
  }
})
