import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    build_check_context,
    load_check_config,
} from '../../../src/cli/check';

function temp_dir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'sight-check-context-'));
}

describe('sight check batch context', () => {
    it('marks dependency graph scan complete and indexes workspace symbols', async () => {
        const root = temp_dir();
        fs.writeFileSync(path.join(root, 'parent.do'), 'global g 1\ndo child.do\n');
        fs.writeFileSync(path.join(root, 'child.do'), 'display "$g"\n');
        const config_result = load_check_config({
            cwd: root,
            workspace_root: root,
            no_config: true,
        });
        expect(config_result.kind).toBe('loaded');
        if (config_result.kind !== 'loaded') return;

        const context = await build_check_context(root, config_result.config);

        expect(context.dependency_graph.is_scan_complete()).toBe(true);
        // Workspace root must be set on the dependency graph so case-only
        // paths are normalised to real-cased URIs (#205).
        expect(
            context.dependency_graph.get_workspace_roots()
        ).toContain(root);
        expect(context.workspace_indexer.get_all_symbols().globalMacros.has('g')).toBe(true);
        expect(context.scope_resolver).toBeDefined();
        await context.document_store.dispose();
    });
});
