/**
 * Shared fs-backed ContentProvider for tests that wire a real ScopeResolver
 * against files in a temp directory. Extracted (#208 review round 1) so new
 * tests stop copy-pasting the ~20-line read_file/exists/stat stub; older
 * suites keep their local copies until touched.
 */

import * as fs from 'fs';
import { URI } from 'vscode-uri';
import type { ContentProvider } from '../src/types';

export function make_fs_content_provider(): ContentProvider {
    return {
        read_file: async (uri: string) => {
            return fs.promises.readFile(URI.parse(uri).fsPath, 'utf8');
        },
        exists: async (uri: string) => {
            try {
                await fs.promises.access(URI.parse(uri).fsPath);
                return true;
            } catch {
                return false;
            }
        },
        stat: async (uri: string) => {
            try {
                const stats = await fs.promises.stat(URI.parse(uri).fsPath);
                return { mtimeMs: stats.mtimeMs, size: stats.size };
            } catch {
                return undefined;
            }
        },
    };
}
