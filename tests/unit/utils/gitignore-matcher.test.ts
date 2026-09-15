import {
    afterEach, beforeEach, describe, expect, it, spyOn,
} from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { create_gitignore_matcher } from '../../../src/utils/gitignore-matcher';
import { logger } from '../../../src/utils/logger';

describe('workspace Gitignore matching', () => {
    let temp_dir: string;
    let workspace: string;

    /** Paths start above the workspace so fixtures can supply ancestor rules. */
    function write(relative_path: string, content: string): string {
        const file_path = path.join(temp_dir, relative_path);
        fs.mkdirSync(path.dirname(file_path), { recursive: true });
        fs.writeFileSync(file_path, content);
        return file_path;
    }

    beforeEach(() => {
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-gitignore-'));
        workspace = path.join(temp_dir, 'project');
        fs.mkdirSync(workspace);
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    it('applies standalone root rules and prunes ignored directories', () => {
        write('project/.gitignore', 'archive/\n*.generated.do\n');
        const matcher = create_gitignore_matcher([workspace]);

        expect(matcher.is_ignored(
            path.join(workspace, 'archive'), 'directory'
        )).toBe(true);
        expect(matcher.is_ignored(
            path.join(workspace, 'archive', 'old.do'), 'file'
        )).toBe(true);
        expect(matcher.is_ignored(
            path.join(workspace, 'nested', 'a.generated.do'), 'file'
        )).toBe(true);
        expect(matcher.is_ignored(
            path.join(workspace, 'analysis.do'), 'file'
        )).toBe(false);
        expect(matcher.is_ignored(workspace, 'directory')).toBe(false);
    });

    it('distinguishes anchored and directory-only patterns', () => {
        write('project/.gitignore', '/top.do\nbuild/\n');
        const matcher = create_gitignore_matcher([workspace]);
        const cases: Array<[string, 'file' | 'directory', boolean]> = [
            ['top.do', 'file', true],
            ['nested/top.do', 'file', false],
            ['build', 'directory', true],
            ['build', 'file', false],
            ['nested/build', 'directory', true],
        ];
        for (const [relative, kind, expected] of cases) {
            expect(matcher.is_ignored(path.join(workspace, relative), kind))
                .toBe(expected);
        }
    });

    it('uses deeper negation and later rules for reachable files', () => {
        write('project/.gitignore', '*.do\n');
        write('project/analysis/.gitignore', '!keep.do\n!again.do\nagain.do\n');
        const matcher = create_gitignore_matcher([workspace]);

        expect(matcher.is_ignored(
            path.join(workspace, 'analysis', 'keep.do'), 'file'
        )).toBe(false);
        expect(matcher.is_ignored(
            path.join(workspace, 'analysis', 'again.do'), 'file'
        )).toBe(true);
        expect(matcher.is_ignored(
            path.join(workspace, 'analysis', 'other.do'), 'file'
        )).toBe(true);
    });

    it('does not read nested rules beneath an ignored parent', () => {
        write('project/.gitignore', 'archive/\n');
        const nested_ignore = write('project/archive/.gitignore', '!keep.do\n');
        const read_file = spyOn(fs, 'readFileSync');
        try {
            const matcher = create_gitignore_matcher([workspace]);
            expect(matcher.is_ignored(
                path.join(workspace, 'archive', 'keep.do'), 'file'
            )).toBe(true);
            expect(read_file.mock.calls.some(([file]) => file === nested_ignore))
                .toBe(false);
        } finally {
            read_file.mockRestore();
        }
    });

    it('can reopen a directory before applying its nested rules', () => {
        write('project/.gitignore', 'archive/*\n!archive/keep/\n*.do\n');
        write('project/archive/keep/.gitignore', '!analysis.do\n');
        const matcher = create_gitignore_matcher([workspace]);

        expect(matcher.is_ignored(
            path.join(workspace, 'archive', 'keep'), 'directory'
        )).toBe(false);
        expect(matcher.is_ignored(
            path.join(workspace, 'archive', 'keep', 'analysis.do'), 'file'
        )).toBe(false);
        expect(matcher.is_ignored(
            path.join(workspace, 'archive', 'other', 'analysis.do'), 'file'
        )).toBe(true);
    });

    it('keeps descendants of a directory reopened by a deeper rule', () => {
        write('project/.gitignore', 'x/\n');
        write('project/a/.gitignore', '!x/\n');
        const matcher = create_gitignore_matcher([workspace]);

        expect(matcher.is_ignored(path.join(workspace, 'a', 'x'), 'directory'))
            .toBe(false);
        expect(matcher.is_ignored(
            path.join(workspace, 'a', 'x', 'analysis.do'), 'file'
        )).toBe(false);
        expect(matcher.is_ignored(
            path.join(workspace, 'a', 'x', 'deeper', 'analysis.do'), 'file'
        )).toBe(false);
    });

    it('applies descendant exclusions after reopening a directory', () => {
        write('project/.gitignore', 'x/\n*.secret.do\n');
        write('project/a/.gitignore', '!x/\nx/private.do\n');
        const matcher = create_gitignore_matcher([workspace]);

        expect(matcher.is_ignored(
            path.join(workspace, 'a', 'x', 'analysis.do'), 'file'
        )).toBe(false);
        for (const my_name of ['private.do', 'data.secret.do']) {
            expect(matcher.is_ignored(
                path.join(workspace, 'a', 'x', my_name), 'file'
            )).toBe(true);
        }
    });

    it('scopes nested patterns to directories with literal metacharacters', () => {
        write('project/.gitignore', 'x/\n');
        write('project/dir[1]/.gitignore', '!x/\nx/private.do\n');
        const matcher = create_gitignore_matcher([workspace]);

        expect(matcher.is_ignored(
            path.join(workspace, 'dir[1]', 'x', 'analysis.do'), 'file'
        )).toBe(false);
        expect(matcher.is_ignored(
            path.join(workspace, 'dir[1]', 'x', 'private.do'), 'file'
        )).toBe(true);
    });

    it.skipIf(process.platform === 'win32')(
        'handles a literal question mark without affecting sibling rules',
        () => {
            write('project/.gitignore', 'x/\n');
            write('project/dir?/.gitignore', '!x/\n');
            write('project/dir?/deeper/.gitignore', '*.private.do\n');
            const matcher = create_gitignore_matcher([workspace]);

            expect(matcher.is_ignored(
                path.join(workspace, 'dir?', 'x', 'analysis.do'), 'file'
            )).toBe(false);
            expect(matcher.is_ignored(
                path.join(workspace, 'dirA', 'x', 'analysis.do'), 'file'
            )).toBe(true);
            expect(matcher.is_ignored(
                path.join(workspace, 'dir?', 'deeper', 'x', 'analysis.do'),
                'file'
            )).toBe(false);
            expect(matcher.is_ignored(
                path.join(workspace, 'dir?', 'deeper', 'x', 'data.private.do'),
                'file'
            )).toBe(true);
        }
    );

    it('preserves nested escapes and anchored versus basename rules', () => {
        write('project/nested/.gitignore', [
            '# comment.do',
            '\\#literal.do',
            '\\!literal.do',
            'space.do\\ ',
            '/top.do',
            'direct/file.do',
            'cache/   ',
            '/',
            '',
        ].join('\n'));
        const matcher = create_gitignore_matcher([workspace]);
        const nested = path.join(workspace, 'nested');
        for (const my_name of [
            '#literal.do', '!literal.do', 'space.do ', 'top.do',
            'direct/file.do', 'cache/a.do', 'deeper/cache/a.do',
        ]) {
            expect(matcher.is_ignored(path.join(nested, my_name), 'file'))
                .toBe(true);
        }
        for (const my_name of [
            'comment.do', 'space.do', 'deeper/top.do',
            'deeper/direct/file.do', 'unrelated.do',
        ]) {
            expect(matcher.is_ignored(path.join(nested, my_name), 'file'))
                .toBe(false);
        }
    });

    it('removes an initial BOM before rebasing nested patterns', () => {
        write('project/nested/.gitignore', '\uFEFF*.do\n');
        const matcher = create_gitignore_matcher([workspace]);

        expect(matcher.is_ignored(
            path.join(workspace, 'nested', 'analysis.do'), 'file'
        )).toBe(true);
        expect(matcher.is_ignored(
            path.join(workspace, 'analysis.do'), 'file'
        )).toBe(false);
    });

    it('removes an initial BOM from rebased ancestor rules', () => {
        fs.mkdirSync(path.join(temp_dir, '.git'));
        write('project/.gitignore', '\uFEFF*.do\n');
        const selected_workspace = path.join(workspace, 'analysis');
        fs.mkdirSync(selected_workspace);
        const matcher = create_gitignore_matcher([selected_workspace]);

        expect(matcher.is_ignored(
            path.join(selected_workspace, 'main.do'), 'file'
        )).toBe(true);
    });

    it('classifies comments and negation after an initial BOM', () => {
        write('project/.gitignore', '*.do\n');
        write('project/keep/.gitignore', '\uFEFF!analysis.do\n');
        write('project/comment/.gitignore', '\uFEFF# !analysis.do\n');
        const matcher = create_gitignore_matcher([workspace]);

        expect(matcher.is_ignored(
            path.join(workspace, 'keep', 'analysis.do'), 'file'
        )).toBe(false);
        expect(matcher.is_ignored(
            path.join(workspace, 'comment', 'analysis.do'), 'file'
        )).toBe(true);
    });

    it('supports comments, escaped prefixes and significant spaces', () => {
        write('project/.gitignore', [
            '# comment.do',
            '\\#literal.do',
            '\\!literal.do',
            'trimmed.do   ',
            'space.do\\ ',
            '',
        ].join('\n'));
        const matcher = create_gitignore_matcher([workspace]);
        for (const my_name of [
            '#literal.do', '!literal.do', 'trimmed.do', 'space.do ',
        ]) {
            expect(matcher.is_ignored(path.join(workspace, my_name), 'file'))
                .toBe(true);
        }
        for (const my_name of ['comment.do', 'space.do']) {
            expect(matcher.is_ignored(path.join(workspace, my_name), 'file'))
                .toBe(false);
        }
    });

    it('matches patterns case-sensitively on every platform', () => {
        write('project/.gitignore', 'Exact.do\n');
        const matcher = create_gitignore_matcher([workspace]);
        expect(matcher.is_ignored(path.join(workspace, 'Exact.do'), 'file'))
            .toBe(true);
        expect(matcher.is_ignored(path.join(workspace, 'exact.do'), 'file'))
            .toBe(false);
    });

    for (const my_marker_kind of ['file', 'directory']) {
        it(`inherits ancestors up to a .git ${my_marker_kind}`, () => {
            write('.gitignore', '*.outside.do\n');
            const repo = path.join(temp_dir, 'repo');
            const root = path.join(repo, 'analysis', 'project');
            fs.mkdirSync(root, { recursive: true });
            if (my_marker_kind === 'file') {
                write('repo/.git', 'gitdir: ../metadata\n');
            } else {
                fs.mkdirSync(path.join(repo, '.git'));
            }
            write('repo/.gitignore', '*.root.do\n');
            write('repo/analysis/.gitignore', '*.middle.do\n');
            write('repo/analysis/project/.gitignore', '!keep.root.do\n');
            const matcher = create_gitignore_matcher([root]);

            for (const my_name of ['a.root.do', 'a.middle.do']) {
                expect(matcher.is_ignored(path.join(root, my_name), 'file'))
                    .toBe(true);
            }
            for (const my_name of ['a.outside.do', 'keep.root.do']) {
                expect(matcher.is_ignored(path.join(root, my_name), 'file'))
                    .toBe(false);
            }
            expect(matcher.watch_directories).toEqual([
                { directory: root, recursive: true },
                { directory: path.dirname(root), recursive: false },
                { directory: repo, recursive: false },
            ]);
        });
    }

    it('does not inherit outside a standalone workspace', () => {
        write('.gitignore', '*.do\n');
        const matcher = create_gitignore_matcher([workspace]);
        expect(matcher.is_ignored(path.join(workspace, 'analysis.do'), 'file'))
            .toBe(false);
        expect(matcher.watch_directories).toEqual([
            { directory: workspace, recursive: true },
        ]);
    });

    it('keeps the root eligible while honoring ignored ancestors below it', () => {
        fs.mkdirSync(path.join(temp_dir, '.git'));
        write('.gitignore', 'project/\n');
        write('project/.gitignore', '!keep.do\n');
        const matcher = create_gitignore_matcher([workspace]);

        expect(matcher.is_ignored(workspace, 'directory')).toBe(false);
        expect(matcher.is_ignored(path.join(workspace, 'keep.do'), 'file'))
            .toBe(true);
    });

    it('retains workspace hierarchy across incidental nested repositories', () => {
        write('project/.gitignore', '*.do\n');
        write('project/nested/.git', 'gitdir: elsewhere\n');
        write('project/nested/.gitignore', '!keep.do\n');
        const nested_root = path.join(workspace, 'nested');
        const matcher = create_gitignore_matcher([workspace]);
        expect(matcher.is_ignored(path.join(nested_root, 'other.do'), 'file'))
            .toBe(true);
        expect(matcher.is_ignored(path.join(nested_root, 'keep.do'), 'file'))
            .toBe(false);

        const explicit_nested = create_gitignore_matcher([
            workspace, nested_root,
        ]);
        expect(explicit_nested.is_ignored(
            path.join(nested_root, 'other.do'), 'file'
        )).toBe(false);
    });

    it('leaves external paths and similarly prefixed directories eligible', () => {
        write('project/.gitignore', '*.do\n');
        write('ado/.gitignore', '*.do\n');
        const matcher = create_gitignore_matcher([workspace]);
        for (const my_path of ['ado/a.do', 'project-copy/a.do']) {
            expect(matcher.is_ignored(path.join(temp_dir, my_path), 'file'))
                .toBe(false);
        }
        expect(matcher.is_ignored(path.join(workspace, '..inside.do'), 'file'))
            .toBe(true);
    });

    it('handles multiple roots and deduplicates watch directories', () => {
        fs.mkdirSync(path.join(temp_dir, '.git'));
        write('.gitignore', '*.do\n');
        write('other/.gitignore', '!keep.do\n');
        const other = path.join(temp_dir, 'other');
        const matcher = create_gitignore_matcher([
            workspace, other, workspace,
        ]);
        expect(matcher.is_ignored(path.join(other, 'keep.do'), 'file'))
            .toBe(false);
        expect(matcher.is_ignored(path.join(workspace, 'keep.do'), 'file'))
            .toBe(true);
        expect(matcher.watch_directories.filter(
            my_watch => my_watch.directory === temp_dir
        )).toEqual([{ directory: temp_dir, recursive: false }]);
        expect(matcher.watch_directories).toHaveLength(3);
    });

    it('ignores symlinked and non-file .gitignore entries', () => {
        const target = write('ignore-rules', '*.do\n');
        fs.symlinkSync(target, path.join(workspace, '.gitignore'));
        fs.mkdirSync(path.join(workspace, 'nested', '.gitignore'), {
            recursive: true,
        });
        const matcher = create_gitignore_matcher([workspace]);
        expect(matcher.is_ignored(path.join(workspace, 'a.do'), 'file'))
            .toBe(false);
        expect(matcher.is_ignored(path.join(workspace, 'nested', 'a.do'), 'file'))
            .toBe(false);
    });

    it('caches loaded and absent rules until the matcher is replaced', () => {
        write('project/.gitignore', 'old.do\n');
        fs.mkdirSync(path.join(workspace, 'nested'));
        const matcher = create_gitignore_matcher([workspace]);
        expect(matcher.is_ignored(path.join(workspace, 'old.do'), 'file'))
            .toBe(true);
        expect(matcher.is_ignored(path.join(workspace, 'nested', 'new.do'), 'file'))
            .toBe(false);

        write('project/.gitignore', 'new.do\n');
        write('project/nested/.gitignore', 'added.do\n');
        expect(matcher.is_ignored(path.join(workspace, 'old.do'), 'file'))
            .toBe(true);
        expect(matcher.is_ignored(path.join(workspace, 'nested', 'added.do'), 'file'))
            .toBe(false);

        const fresh = create_gitignore_matcher([workspace]);
        expect(fresh.is_ignored(path.join(workspace, 'old.do'), 'file'))
            .toBe(false);
        expect(fresh.is_ignored(path.join(workspace, 'nested', 'added.do'), 'file'))
            .toBe(true);

        fs.unlinkSync(path.join(workspace, '.gitignore'));
        expect(create_gitignore_matcher([workspace]).is_ignored(
            path.join(workspace, 'new.do'), 'file'
        )).toBe(false);
    });

    it('warns once for unreadable rules and preserves other available rules', () => {
        write('project/.gitignore', '*.do\n');
        const nested_ignore = write('project/nested/.gitignore', '!a.do\n');
        const other_ignore = write('project/other/.gitignore', '!a.do\n');
        const original_read = fs.readFileSync;
        const warning = spyOn(logger, 'warn').mockImplementation(() => {});
        const read_file = spyOn(fs, 'readFileSync').mockImplementation(
            (file, options) => {
                if (file === nested_ignore || file === other_ignore) {
                    throw Object.assign(new Error('denied'), { code: 'EACCES' });
                }
                return original_read(file, options);
            }
        );
        try {
            const matcher = create_gitignore_matcher([workspace]);
            for (const my_dir of ['nested', 'other']) {
                expect(matcher.is_ignored(
                    path.join(workspace, my_dir, 'a.do'), 'file'
                )).toBe(true);
            }
            expect(warning).toHaveBeenCalledTimes(1);
        } finally {
            read_file.mockRestore();
            warning.mockRestore();
        }
    });

    it('performs no filesystem reads when disabled or without roots', () => {
        const read_file = spyOn(fs, 'readFileSync');
        const stat = spyOn(fs, 'lstatSync');
        try {
            for (const matcher of [
                create_gitignore_matcher([workspace], false),
                create_gitignore_matcher([]),
            ]) {
                expect(matcher.is_ignored(path.join(workspace, 'a.do'), 'file'))
                    .toBe(false);
                expect(matcher.watch_directories).toEqual([]);
            }
            expect(read_file).not.toHaveBeenCalled();
            expect(stat).not.toHaveBeenCalled();
        } finally {
            read_file.mockRestore();
            stat.mockRestore();
        }
    });
});
