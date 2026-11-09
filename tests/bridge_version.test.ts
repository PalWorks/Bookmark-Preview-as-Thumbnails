// SPDX-License-Identifier: AGPL-3.0-only
// The setup snippet pins the package version; it must be the one bridge/ publishes,
// and docs/bridge.md must document every error code the protocol has.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { ERROR_CODES, EXIT_CODES, PACKAGE_NAME, PACKAGE_VERSION, SETUP_COMMAND } from '../src/lib/bridge/protocol';

describe('bridge package and docs stay in step', () => {
    it('the pinned version matches bridge/package.json', () => {
        const pkg = JSON.parse(fs.readFileSync('bridge/package.json', 'utf8'));
        expect(pkg.name).toBe(PACKAGE_NAME);
        expect(pkg.version).toBe(PACKAGE_VERSION);
        expect(SETUP_COMMAND).toContain(`${PACKAGE_NAME}@${PACKAGE_VERSION}`);
    });

    it('docs/bridge.md has a section and the exit status for every error code', () => {
        const doc = fs.readFileSync('docs/bridge.md', 'utf8');
        for (const code of ERROR_CODES) {
            expect(doc).toContain(`### ${code}`);
            expect(doc).toContain(`| \`${code}\` | ${EXIT_CODES[code]} |`);
        }
    });
});
