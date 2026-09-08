import { describe, expect, it } from 'bun:test';
import * as path from 'path';
import { is_hidden_source_path } from '../../../src/utils/source-discovery-policy';

const ROOT = path.resolve('workspace');

function source_path(relative_path: string): string {
    return path.join(ROOT, relative_path);
}

describe('hidden source discovery policy', () => {
    it('excludes hidden directories at any descendant depth', () => {
        for (const my_path of [
            '.claude/worktrees/copy/main.do',
            'src/.cache/generated.ado',
            '.git/hooks/example.do',
        ]) {
            expect(is_hidden_source_path(source_path(my_path), [ROOT]))
                .toBe(true);
        }
    });

    it('allows hidden filenames and ordinary dotted directories', () => {
        for (const my_path of ['.helper.do', 'src/.helper.do', 'v1.2/main.do']) {
            expect(is_hidden_source_path(source_path(my_path), [ROOT]))
                .toBe(false);
        }
    });

    it('uses the deepest selected root regardless of root order', () => {
        const selected = source_path('.claude/worktrees/selected');
        const file = path.join(selected, 'main.do');
        expect(is_hidden_source_path(file, [ROOT, selected])).toBe(false);
        expect(is_hidden_source_path(file, [selected, ROOT])).toBe(false);
        expect(is_hidden_source_path(
            path.join(selected, '.cache/main.do'), [ROOT, selected]
        )).toBe(true);
    });

    it('does not exclude paths outside all roots or without roots', () => {
        const outside = path.resolve('other/.cache/main.do');
        expect(is_hidden_source_path(outside, [ROOT])).toBe(false);
        expect(is_hidden_source_path(outside, [])).toBe(false);
        expect(is_hidden_source_path(`${ROOT}-other/.cache/main.do`, [ROOT]))
            .toBe(false);
    });
});
