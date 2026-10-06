import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/unit/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // The real package throws outside a react-server bundle; tests import server modules directly.
      'server-only': path.resolve(__dirname, './node_modules/server-only/empty.js'),
    },
  },
})
