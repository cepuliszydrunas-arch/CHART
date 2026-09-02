import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Global jsdom – pigiau nei projects konfigūracija; core testai (js-only)
    // veikia ir po jsdom, nes nenaudoja Node-specifinių API.
    environment: 'jsdom',
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.ts', 'src/api/**/*.ts'],
      exclude: ['src/core/**/*.test.ts', 'src/core/**/index.ts', 'src/api/**/*.test.ts'],
      thresholds: {
        // CI vartai (§7): PR nepriimamas be šių ribų
        // src/api/* uses an in-memory D1 shim; thresholds are relaxed there until
        // @cloudflare/vitest-pool-workers is added for real D1 integration tests.
        lines: 85,
        functions: 85,
        branches: 80,
        statements: 85
      }
    }
  }
})
