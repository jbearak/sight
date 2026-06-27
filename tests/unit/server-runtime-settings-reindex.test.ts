import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

// Wiring guards for #223: a client-pushed (onDidChangeConfiguration) change to
// an indexing-affecting setting must trigger a full workspace re-index, sharing
// one last-applied signature with the sight.toml reload path. The handler logic
// lives in create_server closures, so (matching the existing wiring-test style
// in server-project-config-wiring.test.ts) we assert structure via source text.
describe('server-factory runtime settings re-index wiring (#223)', () => {
    const server_factory_path = path.join(
        __dirname,
        '../../src/server-factory.ts'
    );
    const source = fs.readFileSync(server_factory_path, 'utf8');

    function extract_function_body(
        text: string,
        header: string
    ): string {
        const start = text.indexOf(header);
        expect(start).toBeGreaterThanOrEqual(0);
        // Walk braces from the first '{' after the header to its match.
        const brace_start = text.indexOf('{', start);
        let depth = 0;
        for (let i = brace_start; i < text.length; i++) {
            if (text[i] === '{') depth++;
            else if (text[i] === '}') {
                depth--;
                if (depth === 0) {
                    return text.slice(brace_start, i + 1);
                }
            }
        }
        throw new Error(`Unbalanced braces after ${header}`);
    }

    it('declares last_applied_indexing_signature exactly once', () => {
        const the_matches = source.match(
            /let\s+last_applied_indexing_signature/g
        );
        expect(the_matches?.length).toBe(1);
    });

    it('initializes last_applied_indexing_signature to the empty sentinel',
        () => {
            expect(source).toMatch(
                /let\s+last_applied_indexing_signature\s*=\s*''/
            );
        });

    it('declares a config_change_seq counter', () => {
        expect(source).toMatch(/let\s+config_change_seq\s*=\s*0/);
    });

    it('sets last_applied_indexing_signature inside ' +
        'configure_workspace_indexing', () => {
        const body = extract_function_body(
            source,
            'function configure_workspace_indexing('
        );
        expect(body).toMatch(
            /last_applied_indexing_signature\s*=\s*indexing_affecting_signature\(\s*settings\s*\)/
        );
    });

    it('apply_runtime_settings_change compares the signature and ' +
        're-indexes on change', () => {
        const body = extract_function_body(
            source,
            'function apply_runtime_settings_change('
        );
        expect(body).toContain('indexing_affecting_signature(');
        expect(body).toContain('last_applied_indexing_signature');
        expect(body).toMatch(
            /configure_workspace_indexing\(\s*settings,\s*active_workspace_roots,\s*true\s*\)/
        );
        // Lightweight branch revalidates open docs immediately.
        expect(body).toContain('revalidate_all_open_docs()');
    });

    it('routes both onDidChangeConfiguration branches through ' +
        'apply_runtime_settings_change behind the seq guard', () => {
        const body = extract_function_body(
            source,
            'connection.onDidChangeConfiguration('
        );
        // Latest-wins guard.
        expect(body).toMatch(/\+\+config_change_seq/);
        expect(body).toMatch(/my_seq\s*!==\s*config_change_seq/);
        // Both branches delegate to the shared helper.
        const the_calls = body.match(/apply_runtime_settings_change\(/g);
        expect(the_calls?.length).toBeGreaterThanOrEqual(2);
        // The old unconditional immediate validate-all post-block is gone
        // (it would re-introduce the empty-index flicker on re-index).
        expect(body).not.toMatch(
            /documents\.all\(\)\.forEach\([^)]*validate_text_document/
        );
    });

    it('reload path still does a full re-index when indexing changed', () => {
        const body = extract_function_body(
            source,
            'async function reload_project_config_once('
        );
        // Reuses the shared signature comparison.
        expect(body).toContain('last_applied_indexing_signature');
        expect(body).toMatch(
            /configure_workspace_indexing\(\s*settings,\s*active_workspace_roots,\s*true\s*\)/
        );
    });
});
