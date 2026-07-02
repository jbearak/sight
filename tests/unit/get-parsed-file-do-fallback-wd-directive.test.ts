/**
 * PR #278 review (coderabbit) — the `.do`-fallback mtime-match cache-HIT
 * return in `_get_parsed_file_impl` was the only success return that
 * dropped `working_directory_directive`. `discover_working_directory`
 * relies on that field to detect a parent's OWN working-directory
 * directive; a parent served from that branch silently lost its directive
 * and WD inheritance fell through to deeper ancestors.
 *
 * This drives `get_parsed_file` through that exact branch: the file is
 * referenced WITHOUT its `.do` extension (read of the extensionless URI
 * throws), the `.do` fallback is read and cached on the first call, and
 * the second call hits the fallback stat/mtime fast path.
 */

import { describe, it, expect } from 'bun:test';
import { ScopeResolver } from '../../src/scope-resolver';
import type { ContentProvider } from '../../src/types';
import { create_test_scope_resolver_logger } from '../test-logger';

describe('get_parsed_file .do-fallback mtime HIT (#278)', () => {
    it('preserves working_directory_directive across the fallback cache hit', async () => {
        const do_uri = 'file:///ws/parent.do';
        const content = '// @lsp-cd: "/data"\nglobal p_g 1\n';

        const provider: ContentProvider = {
            read_file: async (uri: string) => {
                if (uri === do_uri) {
                    return content;
                }
                // The extensionless URI does not exist on "disk".
                throw new Error('ENOENT');
            },
            exists: async (uri: string) => uri === do_uri,
            stat: async (uri: string) =>
                uri === do_uri
                    ? {
                        mtimeMs: 1000,
                        size: Buffer.byteLength(content, 'utf8'),
                    }
                    : undefined,
        };
        const scope_resolver = new ScopeResolver(
            create_test_scope_resolver_logger(), provider);
        // A leading-slash @lsp-cd path is workspace-relative; a root must
        // be set for `working_directory` to resolve.
        scope_resolver.set_workspace_roots(['/ws']);

        // First call: extensionless read throws → .do fallback read,
        // parsed, and cached under the .do URI.
        const first = await scope_resolver.get_parsed_file(
            'file:///ws/parent', '/ws/parent');
        if ('error' in first) throw new Error(first.error);
        expect(first.working_directory_directive).toBeDefined();
        expect(first.working_directory).toBeDefined();

        // Second call: extensionless read throws again → the fallback
        // stat matches the cached entry → the fallback mtime-HIT return.
        // It must carry the directive like every other success return.
        const second = await scope_resolver.get_parsed_file(
            'file:///ws/parent', '/ws/parent');
        if ('error' in second) throw new Error(second.error);
        expect(second.working_directory_directive).toBeDefined();
        expect(second.working_directory).toBe(first.working_directory);
    });
});
