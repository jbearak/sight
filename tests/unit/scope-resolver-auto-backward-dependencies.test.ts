import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { URI } from 'vscode-uri';
import { ScopeResolver } from '../../src/scope-resolver';

describe('ScopeResolver auto backward dependencies', () => {
    let temp_dir: string;
    let resolver: ScopeResolver;

    beforeEach(() => {
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-auto-backward-'));
        resolver = new ScopeResolver();
        resolver.set_workspace_root(temp_dir);
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    function write_test_file(name: string, content: string): string {
        const file_path = path.join(temp_dir, name);
        fs.writeFileSync(file_path, content);
        return file_path;
    }

    function seed_forward_calls(file_path: string, content: string): void {
        const file_uri = URI.file(file_path).toString();
        const parse_result = (resolver as any).parse_file(file_uri, content);
        resolver.update_reverse_dependencies(
            file_uri,
            parse_result.forward_calls,
            parse_result.symbols
        );
    }

    it('inherits parent scope from indexed forward calls in auto mode', async () => {
        const child_path = write_test_file('child.do', 'display $AUTO_PARENT');
        const parent_content =
            'global AUTO_PARENT "1"\n' +
            'do "child.do"\n';
        const parent_path = write_test_file('parent.do', parent_content);

        seed_forward_calls(parent_path, parent_content);

        const child_uri = URI.file(child_path).toString();
        const resolved_scope = await resolver.resolve(
            child_uri,
            fs.readFileSync(child_path, 'utf8'),
            { backward_dependencies: 'auto' }
        );

        expect(resolved_scope.has_directives).toBe(false);
        expect(resolved_scope.chain.length).toBeGreaterThan(1);
        expect(resolved_scope.symbols.globalMacros.has('AUTO_PARENT')).toBe(true);
    });

    it('does not infer parent scope in explicit mode', async () => {
        const child_path = write_test_file('child.do', 'display $AUTO_PARENT');
        const parent_content =
            'global AUTO_PARENT "1"\n' +
            'do "child.do"\n';
        const parent_path = write_test_file('parent.do', parent_content);

        seed_forward_calls(parent_path, parent_content);

        const child_uri = URI.file(child_path).toString();
        const resolved_scope = await resolver.resolve(
            child_uri,
            fs.readFileSync(child_path, 'utf8'),
            { backward_dependencies: 'explicit' }
        );

        expect(resolved_scope.chain).toHaveLength(1);
        expect(resolved_scope.symbols.globalMacros.has('AUTO_PARENT')).toBe(false);
    });

    it('prefers explicit backward directives over auto-inferred parents', async () => {
        const child_content =
            '// @lsp-done-by "explicit-parent.do"\n' +
            'display $EXPLICIT_PARENT\n';
        const child_path = write_test_file('child.do', child_content);
        const explicit_parent_path = write_test_file(
            'explicit-parent.do',
            'global EXPLICIT_PARENT "1"\n'
        );
        const auto_parent_content =
            'global AUTO_PARENT "1"\n' +
            'do "child.do"\n';
        const auto_parent_path = write_test_file('auto-parent.do', auto_parent_content);

        seed_forward_calls(auto_parent_path, auto_parent_content);

        const child_uri = URI.file(child_path).toString();
        const resolved_scope = await resolver.resolve(
            child_uri,
            child_content,
            { backward_dependencies: 'auto' }
        );

        expect(
            resolved_scope.symbols.globalMacros.has('EXPLICIT_PARENT')
        ).toBe(true);
        expect(resolved_scope.symbols.globalMacros.has('AUTO_PARENT')).toBe(false);
        expect(
            resolved_scope.chain.some(
                (my_entry) => my_entry.uri === URI.file(explicit_parent_path).toString()
            )
        ).toBe(true);
    });

    it('follows multi-hop inferred parents in auto mode', async () => {
        const child_path = write_test_file('child.do', 'display $FROM_GRANDPARENT');
        const parent_content =
            'do \"child.do\"\n';
        const parent_path = write_test_file('parent.do', parent_content);
        const grandparent_content =
            'global FROM_GRANDPARENT \"1\"\n' +
            'do \"parent.do\"\n';
        const grandparent_path = write_test_file(
            'grandparent.do',
            grandparent_content
        );

        seed_forward_calls(parent_path, parent_content);
        seed_forward_calls(grandparent_path, grandparent_content);

        const child_uri = URI.file(child_path).toString();
        const resolved_scope = await resolver.resolve(
            child_uri,
            fs.readFileSync(child_path, 'utf8'),
            { backward_dependencies: 'auto' }
        );

        expect(resolved_scope.symbols.globalMacros.has('FROM_GRANDPARENT')).toBe(true);
        expect(
            resolved_scope.chain.some(
                (my_entry) => my_entry.uri === URI.file(parent_path).toString()
            )
        ).toBe(true);
        expect(
            resolved_scope.chain.some(
                (my_entry) => my_entry.uri === URI.file(grandparent_path).toString()
            )
        ).toBe(true);
    });

    it('inherits working directories through multi-hop inferred parents', async () => {
        const data_dir = path.join(temp_dir, 'data');
        fs.mkdirSync(data_dir, { recursive: true });
        const child_path = path.join(data_dir, 'child.do');
        fs.writeFileSync(child_path, 'display \"hello\"');
        const parent_content =
            'do \"child.do\"\n';
        const parent_path = path.join(data_dir, 'parent.do');
        fs.writeFileSync(parent_path, parent_content);
        const grandparent_content =
            '// @lsp-cd /data\n' +
            'do \"parent.do\"\n';
        const grandparent_path = write_test_file(
            'grandparent.do',
            grandparent_content
        );

        seed_forward_calls(parent_path, parent_content);
        seed_forward_calls(grandparent_path, grandparent_content);

        const child_uri = URI.file(child_path).toString();
        const resolved_scope = await resolver.resolve(
            child_uri,
            fs.readFileSync(child_path, 'utf8'),
            { backward_dependencies: 'auto' }
        );

        expect(resolved_scope.inherited_working_directory).toBe(data_dir);
    });
});
