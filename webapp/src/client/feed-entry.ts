/// <reference lib="dom" />
/**
 * Client entry — FeedManager.
 * `vite build --config vite.feed.config.ts` → public/static/feed.js
 * Eksponuoja: window.HgfxFeed.FeedManager
 */
import { FeedManager } from './feed-manager'

interface HgfxFeedApi {
  FeedManager: typeof FeedManager
}

declare global {
  interface Window {
    HgfxFeed?: HgfxFeedApi
  }
}

if (typeof window !== 'undefined') {
  const api: HgfxFeedApi = { FeedManager }
  window.HgfxFeed = api
}
export default {}
