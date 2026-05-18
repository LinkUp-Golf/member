import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/lib/auth/**', 'src/lib/cache/**', 'src/lib/logger/**', 'src/lib/errors/**'],
    },
    setupFiles: ['./src/__tests__/setup.ts'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
})
