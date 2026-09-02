/// <reference lib="dom" />
/**
 * Client entry — Layouts Free-Layout controller.
 * `vite build --config vite.layouts.config.ts` → public/static/layouts.js
 * Užtikrina: window.HgfxLayouts.* API, kuriuo naudojasi terminal.js.
 */
import { mount, unmount, refresh, disposeItem, getItemTypeLabel } from '../ui/layouts/free-layout-controller'

interface HgfxLayoutsApi {
  mount: typeof mount
  unmount: typeof unmount
  refresh: typeof refresh
  disposeItem: typeof disposeItem
  getItemTypeLabel: typeof getItemTypeLabel
}

declare global {
  interface Window {
    HgfxLayouts?: HgfxLayoutsApi
  }
}

if (typeof window !== 'undefined') {
  const api: HgfxLayoutsApi = { mount, unmount, refresh, disposeItem, getItemTypeLabel }
  window.HgfxLayouts = api
}
export default {}
