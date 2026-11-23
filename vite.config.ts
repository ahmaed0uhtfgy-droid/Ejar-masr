/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks: { firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'], react: ['react', 'react-dom', 'react-router-dom'] },
      },
    },
  },
  test: {
    environment: 'jsdom', globals: true, setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'functions/**/*.test.ts'],
    coverage: { provider: 'v8', reporter: ['text-summary', 'lcov'], include: ['src/lib/**', 'functions/**'], exclude: ['**/*.test.*', 'functions/_tests/**', 'src/lib/types.ts'] },
  },
})
