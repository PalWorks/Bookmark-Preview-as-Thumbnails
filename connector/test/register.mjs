// SPDX-License-Identifier: AGPL-3.0-only
// The shared bridge files (src/lib/bridge/*.ts) import each other without an
// extension, as the extension's bundler expects. Node needs one, so for tests
// only: retry an unresolved relative import with ".ts".
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(specifier, context, next) {
    try {
        return await next(specifier, context);
    } catch (err) {
        if (err && err.code === 'ERR_MODULE_NOT_FOUND' && /^\\.\\.?\\//.test(specifier) && !/\\.[a-z]+$/.test(specifier)) {
            return next(specifier + '.ts', context);
        }
        throw err;
    }
}`));
