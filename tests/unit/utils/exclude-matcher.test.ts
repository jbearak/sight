import { describe, expect, it } from 'bun:test';
import * as path from 'path';
import { create_exclude_matcher } from '../../../src/utils/exclude-matcher';

const ROOT = path.resolve('/workspace/project');

function abs(rel: string): string {
    return path.join(ROOT, ...rel.split('/'));
}

describe('exclude-matcher', () => {
    it('treats an empty pattern list as a no-op', () => {
        const matcher = create_exclude_matcher([]);
        expect(matcher.is_empty).toBe(true);
        expect(matcher.is_excluded_file(abs('output/a.do'), [ROOT])).toBe(false);
        expect(matcher.is_excluded_dir(abs('output'), [ROOT])).toBe(false);
    });

    it('drops blank patterns and stays empty', () => {
        const matcher = create_exclude_matcher(['  ', '']);
        expect(matcher.is_empty).toBe(true);
    });

    it('matches files under a globstar directory pattern', () => {
        const matcher = create_exclude_matcher(['output/**']);
        expect(matcher.is_excluded_file(abs('output/a.do'), [ROOT])).toBe(true);
        expect(matcher.is_excluded_file(abs('output/sub/b.do'), [ROOT])).toBe(true);
        expect(matcher.is_excluded_file(abs('src/a.do'), [ROOT])).toBe(false);
    });

    it('prunes the directory itself for dir/**, dir/**/*, and dir/', () => {
        for (const my_pattern of ['output/**', 'output/**/*', 'output/']) {
            const matcher = create_exclude_matcher([my_pattern]);
            expect(matcher.is_excluded_dir(abs('output'), [ROOT])).toBe(true);
        }
    });

    it('does not prune (or exclude contents of) a bare directory name', () => {
        // Under picomatch, a bare `output` matches only the literal path
        // `output`, not files inside it, so it must not prune the directory.
        const matcher = create_exclude_matcher(['output']);
        expect(matcher.is_excluded_dir(abs('output'), [ROOT])).toBe(false);
        expect(matcher.is_excluded_file(abs('output/a.do'), [ROOT])).toBe(false);
    });

    it('does not over-prune sibling or parent directories', () => {
        const matcher = create_exclude_matcher(['data/{raw,tmp}/**']);
        expect(matcher.is_excluded_dir(abs('data/raw'), [ROOT])).toBe(true);
        expect(matcher.is_excluded_dir(abs('data/tmp'), [ROOT])).toBe(true);
        // `data` may still hold non-excluded subdirs, so it must not be pruned.
        expect(matcher.is_excluded_dir(abs('data'), [ROOT])).toBe(false);
        expect(matcher.is_excluded_dir(abs('data/keep'), [ROOT])).toBe(false);
    });

    it('supports leading **/ and file globs without pruning unrelated dirs', () => {
        const matcher = create_exclude_matcher(['**/_generated/**', '**/*.gen.do']);
        expect(
            matcher.is_excluded_file(abs('a/b/_generated/x.do'), [ROOT])
        ).toBe(true);
        expect(matcher.is_excluded_dir(abs('a/b/_generated'), [ROOT])).toBe(true);
        expect(matcher.is_excluded_file(abs('a/build.gen.do'), [ROOT])).toBe(true);
        // A bare *.gen.do file glob must not prune an ordinary directory.
        expect(matcher.is_excluded_dir(abs('a'), [ROOT])).toBe(false);
    });

    it('normalizes backslash and ./ prefixes in patterns', () => {
        const matcher = create_exclude_matcher(['./output\\**']);
        expect(matcher.is_excluded_file(abs('output/a.do'), [ROOT])).toBe(true);
    });

    it('never matches paths outside any workspace root', () => {
        const matcher = create_exclude_matcher(['output/**']);
        const outside = path.resolve('/elsewhere/output/a.do');
        expect(matcher.is_excluded_file(outside, [ROOT])).toBe(false);
        expect(matcher.is_excluded_dir(path.resolve('/elsewhere/output'), [ROOT]))
            .toBe(false);
    });

    it('still matches a filename that begins with .. inside the root', () => {
        // A leading `..` in a filename is not a parent-directory component, so
        // the path is inside the workspace and exclusion still applies.
        const matcher = create_exclude_matcher(['**/*.do']);
        expect(matcher.is_excluded_file(abs('..foo.do'), [ROOT])).toBe(true);
        expect(matcher.is_excluded_file(abs('sub/..bar.do'), [ROOT])).toBe(true);
    });

    it('never matches a path equal to the workspace root', () => {
        const matcher = create_exclude_matcher(['**']);
        expect(matcher.is_excluded_dir(ROOT, [ROOT])).toBe(false);
    });

    it('matches relative to the deepest containing workspace root', () => {
        const parent = path.resolve('/workspace/project');
        const nested = path.resolve('/workspace/project/sub');
        const matcher = create_exclude_matcher(['output/**']);
        const target = path.join(nested, 'output', 'a.do');
        // Relative to the parent the path is `sub/output/a.do` (no match), but
        // relative to the deeper `sub` root it is `output/a.do` (match).
        expect(matcher.is_excluded_file(target, [parent, nested])).toBe(true);
    });

    it('does not prune a directory for a single-star (direct-child) glob', () => {
        const matcher = create_exclude_matcher(['build/*']);
        // `build/*` matches only direct children, so the tree must be walked —
        // neither `build` nor the intermediate `build/nested` may be pruned.
        expect(matcher.is_excluded_dir(abs('build'), [ROOT])).toBe(false);
        expect(matcher.is_excluded_dir(abs('build/nested'), [ROOT])).toBe(false);
        expect(matcher.is_excluded_file(abs('build/a.do'), [ROOT])).toBe(true);
        // Nested files do not match `build/*` and must survive.
        expect(
            matcher.is_excluded_file(abs('build/nested/keep.do'), [ROOT])
        ).toBe(false);
    });

    it('does not prune any directory for a bare file glob', () => {
        const matcher = create_exclude_matcher(['*.do']);
        expect(matcher.is_excluded_dir(abs('src'), [ROOT])).toBe(false);
        expect(matcher.is_excluded_file(abs('a.do'), [ROOT])).toBe(true);
    });

    it('disables directory pruning when no pattern is globstar-terminated', () => {
        // Neither `build/*` nor `*.gen.do` can ever prune a directory, so
        // is_excluded_dir is a short-circuit no-op (no false pruning at any
        // depth) while file exclusion still applies.
        const matcher = create_exclude_matcher(['build/*', '*.gen.do']);
        expect(matcher.is_excluded_dir(abs('build'), [ROOT])).toBe(false);
        expect(matcher.is_excluded_dir(abs('build/nested'), [ROOT])).toBe(false);
        expect(matcher.is_excluded_file(abs('build/a.do'), [ROOT])).toBe(true);
        expect(matcher.is_excluded_file(abs('x.gen.do'), [ROOT])).toBe(true);
    });

    it('drops a bare slash pattern (no over-exclusion)', () => {
        const matcher = create_exclude_matcher(['/']);
        expect(matcher.is_empty).toBe(true);
    });

    it('treats a trailing slash as the whole subtree', () => {
        const matcher = create_exclude_matcher(['output/']);
        expect(matcher.is_excluded_dir(abs('output'), [ROOT])).toBe(true);
        expect(matcher.is_excluded_file(abs('output/a.do'), [ROOT])).toBe(true);
        expect(matcher.is_excluded_file(abs('output/sub/b.do'), [ROOT])).toBe(true);
    });

    it('disables directory pruning when a negation pattern is present', () => {
        const matcher = create_exclude_matcher(['output/**', '!output/keep.do']);
        // Pruning would skip the re-included file, so dir pruning is off.
        expect(matcher.is_excluded_dir(abs('output'), [ROOT])).toBe(false);
        // File matching still honors the negation.
        expect(matcher.is_excluded_file(abs('output/a.do'), [ROOT])).toBe(true);
        expect(matcher.is_excluded_file(abs('output/keep.do'), [ROOT])).toBe(false);
    });

    it('applies gitignore-style last-match-wins ordering for negation', () => {
        // A later positive re-excludes a path that an earlier `!` re-included.
        const reexcluded = create_exclude_matcher([
            '!output/keep.do',
            'output/**',
        ]);
        expect(reexcluded.is_excluded_file(abs('output/keep.do'), [ROOT])).toBe(
            true
        );

        // A later `!` re-includes a path that an earlier positive excluded.
        const reincluded = create_exclude_matcher([
            'output/**',
            '!output/keep.do',
        ]);
        expect(reincluded.is_excluded_file(abs('output/keep.do'), [ROOT])).toBe(
            false
        );
    });

    it('excludes nothing when given only negation patterns', () => {
        const matcher = create_exclude_matcher(['!output/keep.do']);
        expect(matcher.is_empty).toBe(true);
    });

    it('normalizes ./ and trailing slash inside a negation pattern', () => {
        const matcher = create_exclude_matcher(['output/**', '!./output/keep/']);
        // `!./output/keep/` normalizes to `!output/keep/**` and re-includes
        // everything under output/keep.
        expect(matcher.is_excluded_file(abs('output/a.do'), [ROOT])).toBe(true);
        expect(
            matcher.is_excluded_file(abs('output/keep/b.do'), [ROOT])
        ).toBe(false);
    });
});
