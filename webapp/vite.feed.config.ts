/**
 * Atskiras client bundle build — feed.js (FeedManager).
 * `npm run build:feed` → public/static/feed.js
 */
import { defineConfig } from 'vite'

export default defineConfig({
  publicDir: false,
  build: {
    lib: {
      entry: 'src/client/feed-entry.ts',
      formats: ['es'],
      fileName: () => 'feed.js'
    },
    outDir: 'public/static',
    emptyOutDir: false,
    minify: true,
    sourcemap: false
  }
})
