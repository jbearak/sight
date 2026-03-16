/**
 * Unit tests for multi-root workspace root selection utility.
 *
 * Tests get_workspace_root_for_path and get_workspace_root_for_uri
 * which pick the deepest matching workspace root for a given file.
 */

import { describe, test, expect } from 'bun:test';
import * as path from 'path';
import {
    get_workspace_root_for_path,
    get_workspace_root_for_uri,
} from '../../src/utils/workspace-roots';

describe('get_workspace_root_for_path', () => {
    test('returns undefined for empty workspace_roots', () => {
        expect(get_workspace_root_for_path([], '/some/file.do')).toBeUndefined();
    });

    test('returns the single root when only one root exists', () => {
        const roots = ['/workspace/project'];
        expect(get_workspace_root_for_path(roots, '/workspace/project/src/file.do'))
            .toBe(path.resolve('/workspace/project'));
    });

    test('falls back to first root when file is outside all roots', () => {
        const roots = ['/workspace/a', '/workspace/b'];
        expect(get_workspace_root_for_path(roots, '/other/path/file.do'))
            .toBe('/workspace/a');
    });

    test('selects the correct root in a two-root workspace', () => {
        const roots = ['/workspace/project-a', '/workspace/project-b'];
        expect(get_workspace_root_for_path(roots, '/workspace/project-b/src/file.do'))
            .toBe(path.resolve('/workspace/project-b'));
    });

    test('selects the deepest matching root for nested roots', () => {
        const roots = ['/workspace', '/workspace/subproject'];
        expect(get_workspace_root_for_path(roots, '/workspace/subproject/src/file.do'))
            .toBe(path.resolve('/workspace/subproject'));
    });

    test('matches root directory itself (not just children)', () => {
        const roots = ['/workspace/a', '/workspace/b'];
        expect(get_workspace_root_for_path(roots, '/workspace/a'))
            .toBe(path.resolve('/workspace/a'));
    });

    test('does not match partial prefix (project-a vs project-ab)', () => {
        const roots = ['/workspace/project-a', '/workspace/project-ab'];
        // file is in project-ab, not project-a
        expect(get_workspace_root_for_path(roots, '/workspace/project-ab/file.do'))
            .toBe(path.resolve('/workspace/project-ab'));
    });

    test('handles three roots correctly', () => {
        const roots = ['/a', '/b', '/c'];
        expect(get_workspace_root_for_path(roots, '/b/deep/nested/file.do'))
            .toBe(path.resolve('/b'));
    });
});

describe('get_workspace_root_for_uri', () => {
    test('returns undefined for empty workspace_roots', () => {
        expect(get_workspace_root_for_uri([], 'file:///some/file.do')).toBeUndefined();
    });

    test('resolves file:// URI and picks correct root', () => {
        const roots = ['/workspace/project-a', '/workspace/project-b'];
        expect(get_workspace_root_for_uri(roots, 'file:///workspace/project-b/src/file.do'))
            .toBe(path.resolve('/workspace/project-b'));
    });

    test('falls back to first root for invalid URI', () => {
        const roots = ['/workspace/a'];
        expect(get_workspace_root_for_uri(roots, 'not-a-valid-uri'))
            .toBe('/workspace/a');
    });
});
