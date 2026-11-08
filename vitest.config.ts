// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
    // JSX transform for component tests (tests/**/*.test.tsx).
    plugins: [react()],
    test: {
        environment: 'jsdom',
        setupFiles: ['./tests/setup.ts'],
        include: ['tests/**/*.test.{ts,tsx}'],
        globals: true,
    },
});
