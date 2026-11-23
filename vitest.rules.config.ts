import { defineConfig } from 'vitest/config'
// globals: true is required: the rules tests call describe/it/beforeAll without importing them.
export default defineConfig({ test: { environment: 'node', globals: true, include: ['tests/rules/**/*.test.ts'], testTimeout: 20000 } })
