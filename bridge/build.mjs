// SPDX-License-Identifier: AGPL-3.0-only
// Bundles the CLI/MCP server and the native host into two self-contained files
// (no runtime dependencies, so install can copy the host out of the npx cache).
import { build } from '../node_modules/esbuild/lib/main.js';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url)));
const common = {
    bundle: true, platform: 'node', format: 'esm', target: 'node22', sourcemap: false, legalComments: 'none',
    define: { __PACKAGE_VERSION__: JSON.stringify(pkg.version) },
};
await build({ ...common, entryPoints: ['src/cli.ts'], outfile: 'dist/cli.js', banner: { js: '#!/usr/bin/env node\n// SPDX-License-Identifier: AGPL-3.0-only' } });
await build({ ...common, entryPoints: ['src/host.ts'], outfile: 'dist/host.js', banner: { js: '#!/usr/bin/env node\n// SPDX-License-Identifier: AGPL-3.0-only' } });
fs.chmodSync('dist/cli.js', 0o755);
fs.chmodSync('dist/host.js', 0o755);
console.log(`built ${pkg.name}@${pkg.version}: dist/cli.js, dist/host.js`);
