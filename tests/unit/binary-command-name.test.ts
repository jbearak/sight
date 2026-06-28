import { describe, expect, it } from 'bun:test';
import {
    existsSync,
    chmodSync,
    lstatSync,
    mkdtempSync,
    mkdirSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { basename, join } from 'path';
import { spawnSync } from 'child_process';
import {
    get_binary_shadow_paths_to_check,
    get_binary_name,
    get_binary_names_to_install,
    get_binary_names_to_uninstall,
} from '../../scripts/binary-names';
import {
    get_sight_binary_spawn_invocation,
    is_sight_binary,
} from '../../scripts/binary-ownership';
import {
    install_binary_files,
} from '../../scripts/install';
import {
    uninstall_from_bin_dir,
} from '../../scripts/uninstall';
import {
    CLI_DESCRIPTION,
    NATIVE_BINARY_NAME_PATTERN,
    SUPPORTED_BINARY_ARCHS,
    SUPPORTED_BINARY_PLATFORMS,
} from '../../src/cli-binary-names';
import {
    build_all_binaries,
    build_binary_by_output_name,
    get_build_targets,
} from '../../scripts/build-binary';
import {
    get_branch_push_ref,
    get_bump_version_args,
} from '../../scripts/release';

function make_temp_dir(): string {
    return mkdtempSync(join(tmpdir(), 'sight-binary-command-'));
}

function write_version_script(
    script_path: string,
    version_output: string
): void {
    writeFileSync(
        script_path,
        `#!/bin/sh\nprintf '%s\\n' '${version_output}'\n`
    );
    chmodSync(script_path, 0o755);
}

function write_sight_script(script_path: string, version_output: string): void {
    writeFileSync(
        script_path,
        [
            '#!/bin/sh',
            'case "$1" in',
            `  --version) printf '%s\\n' '${version_output}' ;;`,
            `  --help) printf '%s\\n' '${CLI_DESCRIPTION}' ;;`,
            '  *) exit 0 ;;',
            'esac',
            '',
        ].join('\n')
    );
    chmodSync(script_path, 0o755);
}

function write_legacy_sight_native_binary(binary_path: string): void {
    writeFileSync(
        binary_path,
        [
            'Sight - Language Server Protocol implementation for Stata',
            'sight-server.js',
        ].join('\0')
    );
    chmodSync(binary_path, 0o755);
}

function write_npm_shell_shim(script_path: string): void {
    writeFileSync(
        script_path,
        [
            '#!/bin/sh',
            'basedir=$(dirname "$(echo "$0" | sed -e \'s,\\\\,/,g\')")',
            'exec "$basedir/node" "$basedir/dist/sight-server.js" "$@"',
            '',
        ].join('\n')
    );
}

function write_npm_cmd_shim(script_path: string): void {
    writeFileSync(
        script_path,
        [
            '@ECHO off',
            'GOTO start',
            ':find_dp0',
            'SET dp0=%~dp0',
            'EXIT /b',
            ':start',
            'SETLOCAL',
            'CALL :find_dp0',
            '"%dp0%\\node.exe" "%dp0%\\dist\\sight-server.js" %*',
            '',
        ].join('\r\n')
    );
}

function write_npm_powershell_shim(script_path: string): void {
    writeFileSync(
        script_path,
        [
            '#!/usr/bin/env pwsh',
            '$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent',
            '& "$basedir/node.exe" "$basedir/dist/sight-server.js" $args',
            'exit $LASTEXITCODE',
            '',
        ].join('\n')
    );
}

function get_paths_filter_entries(
    workflow_content: string,
    filter_name: string
): string[] {
    const the_lines = workflow_content.split('\n');
    const filters_index = the_lines.findIndex(
        (line) => /^\s*filters:\s*\|$/.test(line)
    );

    expect(filters_index).toBeGreaterThanOrEqual(0);

    const filter_header_pattern = new RegExp(`^\\s*${filter_name}:\\s*$`);
    const start_index = the_lines.findIndex(
        (line, index) =>
            index > filters_index &&
            filter_header_pattern.test(line)
    );

    expect(start_index).toBeGreaterThan(filters_index);

    const the_entries: string[] = [];

    for (let i = start_index + 1; i < the_lines.length; i++) {
        const line = the_lines[i];

        if (/^\s*[A-Za-z0-9_-]+:\s*$/.test(line)) {
            break;
        }

        const entry_match = line.match(/^\s*-\s*['"]?(.+?)['"]?$/);
        if (entry_match) {
            the_entries.push(entry_match[1]);
        }
    }

    return the_entries;
}

function list_repo_files(root_path: string): string[] {
    const supported_extensions = new Set([
        '.js',
        '.json',
        '.lua',
        '.md',
        '.sh',
        '.ts',
        '.yaml',
        '.yml',
    ]);

    const result = spawnSync('git', ['ls-files'], {
        cwd: root_path,
        encoding: 'utf8',
    });

    expect(result.status).toBe(0);

    return result.stdout
        .split('\n')
        .filter(Boolean)
        .filter((relative_path) => existsSync(join(root_path, relative_path)))
        .filter((relative_path) => {
            const extension = relative_path.match(/\.[^.]+$/)?.[0] ?? '';
            return supported_extensions.has(extension);
        })
        .sort();
}

function is_historical_legacy_reference_path(relative_path: string): boolean {
    return (
        relative_path === '.kiro/specs/SPEC_AUDIT.md' ||
        relative_path.startsWith('.kiro/specs/archive/') ||
        relative_path.startsWith('tests/')
    );
}

function strip_intentional_legacy_alias_checks(
    relative_path: string,
    file_content: string
): string {
    if (relative_path !== '.github/workflows/ci.yml') {
        return file_content;
    }

    return file_content.replace(
        /^\s*sight-language-server --version \| grep -E .*$/gm,
        ''
    );
}

function has_old_command_invocation(file_content: string): boolean {
    return [
        /["']command["']\s*:\s*["']sight-language-server["']/,
        /["']command["']\s*:\s*\[\s*["']sight-language-server(?:\.exe)?["']/,
        /\bcommand\s*:\s*sight-language-server(?:\.exe)?\b/,
        /\bcommand\s*:\s*\n\s*-\s*["']?sight-language-server(?:\.exe)?["']?\b/,
        /\bcommand\s*=\s*["']sight-language-server(?:\.exe)?["']/,
        /\bcmd\s*:\s*sight-language-server(?:\.exe)?\b/,
        /\bcmd\s*:\s*\n\s*-\s*["']?sight-language-server(?:\.exe)?["']?\b/,
        /\bcmd\s*=\s*\{\s*["']sight-language-server["']/,
        /\bcmd\s*=\s*["']sight-language-server(?:\.exe)?["']/,
        /["']sight-language-server["']\s*,\s*["']--/,
        /(?:^|[\s`"'])sight-language-server(?:\.exe)?\s+--/,
        /\b(?:run|which|command -v|exec)\s+sight-language-server(?:\.exe)?\b/,
    ].some((pattern) => pattern.test(file_content));
}

function get_workflow_run_commands(workflow_content: string): string[] {
    const the_lines = workflow_content.split('\n');
    const the_commands: string[] = [];

    for (let i = 0; i < the_lines.length; i++) {
        const line = the_lines[i];
        const single_line_match = line.match(/^\s*run:\s*(.+)$/);

        if (single_line_match && single_line_match[1] !== '|') {
            the_commands.push(single_line_match[1]);
            continue;
        }

        if (!/^\s*run:\s*\|$/.test(line)) {
            continue;
        }

        const block_lines: string[] = [];

        for (i = i + 1; i < the_lines.length; i++) {
            const block_line = the_lines[i];

            if (block_line.trim() === '') {
                continue;
            }

            if (/^\s{8,}\S/.test(block_line)) {
                block_lines.push(block_line.trim());
                continue;
            }

            i -= 1;
            break;
        }

        the_commands.push(block_lines.join('\n'));
    }

    return the_commands;
}

function expect_workflow_runs_stdio_smoke_helper(
    workflow_content: string,
    command_name: string
): void {
    const the_run_commands = get_workflow_run_commands(workflow_content);
    const escaped_command = command_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const smoke_pattern = new RegExp(
        `bun scripts/smoke-stdio-startup\\.ts ["']?${escaped_command}` +
        `["']?(?:\\s|$)`
    );

    expect(the_run_commands.some(
        (run_command) => smoke_pattern.test(run_command)
    )).toBe(true);
}

function get_workflow_job_block(
    workflow_content: string,
    job_name: string
): string {
    const the_lines = workflow_content.split('\n');
    const job_header_pattern = new RegExp(`^  ${job_name}:\\s*$`);
    const start_index = the_lines.findIndex(
        (line) => job_header_pattern.test(line)
    );

    expect(start_index).toBeGreaterThanOrEqual(0);

    const block_lines = [the_lines[start_index]];

    for (let i = start_index + 1; i < the_lines.length; i++) {
        if (/^  [A-Za-z0-9_-]+:\s*$/.test(the_lines[i])) {
            break;
        }

        block_lines.push(the_lines[i]);
    }

    return block_lines.join('\n');
}

function expect_job_needs(
    workflow_content: string,
    job_name: string,
    expected_needs: string[]
): void {
    const job_block = get_workflow_job_block(workflow_content, job_name);
    const inline_match = job_block.match(/^\s+needs:\s*\[(.+)\]\s*$/m);

    if (inline_match) {
        expect(inline_match[1].split(',').map((name) => name.trim()))
            .toEqual(expected_needs);
        return;
    }

    const single_match = job_block.match(/^\s+needs:\s*(\S+)\s*$/m);
    expect(single_match?.[1] ? [single_match[1]] : []).toEqual(
        expected_needs
    );
}

function get_workflow_step_index(
    workflow_content: string,
    job_name: string,
    step_name: string
): number {
    return get_workflow_job_block(workflow_content, job_name)
        .split('\n')
        .findIndex((line) => line.includes(`- name: ${step_name}`));
}

function get_workflow_step_block(
    workflow_content: string,
    job_name: string,
    step_name: string
): string {
    const the_lines = get_workflow_job_block(workflow_content, job_name)
        .split('\n');
    const start_index = the_lines.findIndex(
        (line) => line.includes(`- name: ${step_name}`)
    );

    expect(start_index).toBeGreaterThanOrEqual(0);

    const block_lines = [the_lines[start_index]];

    for (let i = start_index + 1; i < the_lines.length; i++) {
        if (/^      -\s/.test(the_lines[i])) {
            break;
        }

        block_lines.push(the_lines[i]);
    }

    return block_lines.join('\n');
}

function get_upload_artifact_paths(
    workflow_content: string,
    job_name: string,
    step_name: string
): string[] {
    const the_lines = get_workflow_step_block(
        workflow_content,
        job_name,
        step_name
    ).split('\n');
    const path_index = the_lines.findIndex(
        (line) => /^\s+path:\s*\|\s*$/.test(line)
    );

    expect(path_index).toBeGreaterThanOrEqual(0);

    const path_indent = the_lines[path_index].match(/^\s*/)?.[0].length ?? 0;
    const the_paths: string[] = [];

    for (let i = path_index + 1; i < the_lines.length; i++) {
        const line = the_lines[i];

        if (line.trim() === '') {
            continue;
        }

        const indent = line.match(/^\s*/)?.[0].length ?? 0;
        if (indent <= path_indent) {
            break;
        }

        the_paths.push(line.trim());
    }

    return the_paths;
}

function expect_step_before(
    workflow_content: string,
    job_name: string,
    first_step: string,
    second_step: string
): void {
    const first_index = get_workflow_step_index(
        workflow_content,
        job_name,
        first_step
    );
    const second_index = get_workflow_step_index(
        workflow_content,
        job_name,
        second_step
    );

    expect(first_index).toBeGreaterThanOrEqual(0);
    expect(second_index).toBeGreaterThanOrEqual(0);
    expect(first_index).toBeLessThan(second_index);
}

describe('binary command name', () => {
    it('uses the shipped bundle for package main and the npm executable', () => {
        const package_json_path = join(__dirname, '../../package.json');
        const package_content = JSON.parse(
            readFileSync(package_json_path, 'utf8')
        );

        expect(package_content.name).toBe('@jbearak/sight');
        expect(package_content.description).toBe(
            'A static analyzer and language server for the Stata statistical programming language'
        );
        expect(package_content.main).toBe('dist/sight-server.js');
        expect(package_content.main).toBe(package_content.bin.sight);
        expect(package_content.bin).toEqual({
            sight: 'dist/sight-server.js',
        });
    });

    it('uses shared command names for supported platforms', () => {
        const the_cases = [
            ['darwin', 'sight'],
            ['linux', 'sight'],
            ['win32', 'sight.exe'],
        ] as const;

        for (const [my_platform, expected_command_name] of the_cases) {
            expect(get_binary_name(my_platform)).toBe(expected_command_name);
        }
    });

    it('defines native binary names from shared platform and arch lists', () => {
        expect(SUPPORTED_BINARY_PLATFORMS).toEqual([
            'darwin',
            'linux',
            'windows',
        ]);
        expect(SUPPORTED_BINARY_ARCHS).toEqual(['x64', 'arm64']);

        for (const my_platform of SUPPORTED_BINARY_PLATFORMS) {
            for (const my_arch of SUPPORTED_BINARY_ARCHS) {
                const my_suffix = my_platform === 'windows' ? '.exe' : '';
                expect(NATIVE_BINARY_NAME_PATTERN.test(
                    `sight-${my_platform}-${my_arch}${my_suffix}`
                )).toBe(true);
            }
        }

        expect(NATIVE_BINARY_NAME_PATTERN.source).toBe(
            '^sight-(darwin|linux|windows)-(x64|arm64)(\\.exe)?$'
        );
    });

    it('uses Windows-aware spawn modes for command shims', () => {
        const cmd_invocation = get_sight_binary_spawn_invocation(
            'C:\\bin\\sight.cmd',
            ['--version'],
            'win32'
        );
        const bat_invocation = get_sight_binary_spawn_invocation(
            'C:\\bin\\sight.bat',
            ['--version'],
            'win32'
        );
        const ps1_invocation = get_sight_binary_spawn_invocation(
            'C:\\bin\\sight.ps1',
            ['--help'],
            'win32'
        );
        const exe_invocation = get_sight_binary_spawn_invocation(
            'C:\\bin\\sight.exe',
            ['--version'],
            'win32'
        );

        expect(cmd_invocation.options.shell).toBe(true);
        expect(bat_invocation.options.shell).toBe(true);
        expect(ps1_invocation.command).toBe('powershell.exe');
        expect(ps1_invocation.args).toEqual([
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            'C:\\bin\\sight.ps1',
            '--help',
        ]);
        expect(exe_invocation.options.shell).toBeUndefined();
    });

    it('recognizes Windows npm shims without POSIX execution', () => {
        const temp_root = make_temp_dir();
        const shell_shim_path = join(temp_root, 'sight');
        const cmd_shim_path = join(temp_root, 'sight.cmd');
        const ps1_shim_path = join(temp_root, 'sight.ps1');

        try {
            write_npm_shell_shim(shell_shim_path);
            write_npm_cmd_shim(cmd_shim_path);
            write_npm_powershell_shim(ps1_shim_path);

            expect(is_sight_binary(shell_shim_path, 'win32')).toBe(true);
            expect(is_sight_binary(cmd_shim_path, 'win32')).toBe(true);
            expect(is_sight_binary(ps1_shim_path, 'win32')).toBe(true);
        } finally {
            rmSync(temp_root, { recursive: true, force: true });
        }
    });

    it('does not execute an existing command while checking ownership', () => {
        const temp_root = make_temp_dir();
        const binary_path = join(temp_root, 'sight');
        const marker_path = join(temp_root, 'executed');

        try {
            writeFileSync(
                binary_path,
                [
                    '#!/bin/sh',
                    `printf ran > '${marker_path}'`,
                    'case "$1" in',
                    "  --version) printf 'sight 1.2.3\\n' ;;",
                    "  --help) printf 'a static analyzer '",
                    "          printf 'and language server for Stata.\\n' ;;",
                    '  *) exit 0 ;;',
                    'esac',
                    '',
                ].join('\n')
            );
            chmodSync(binary_path, 0o755);

            expect(is_sight_binary(binary_path, 'linux')).toBe(false);
            expect(existsSync(marker_path)).toBe(false);
        } finally {
            rmSync(temp_root, { recursive: true, force: true });
        }
    });

    it('recognizes legacy source-installed native binary markers', () => {
        const temp_root = make_temp_dir();
        const binary_path = join(temp_root, 'sight-language-server');

        try {
            write_legacy_sight_native_binary(binary_path);

            expect(is_sight_binary(binary_path, 'linux')).toBe(true);
        } finally {
            rmSync(temp_root, { recursive: true, force: true });
        }
    });

    it('source install writes only the primary command name', () => {
        const temp_root = make_temp_dir();
        const source_path = join(temp_root, 'source-binary');
        const user_bin_path = join(temp_root, 'bin');

        try {
            writeFileSync(source_path, 'new-binary');
            mkdirSync(user_bin_path, { recursive: true });
            write_sight_script(
                join(user_bin_path, 'sight-language-server'),
                'sight 0.1.0'
            );

            const the_target_paths = install_binary_files(
                source_path,
                user_bin_path,
                'linux'
            );

            expect(the_target_paths.map((target_path) => basename(target_path)))
                .toEqual(['sight']);
            expect(readFileSync(join(user_bin_path, 'sight'), 'utf8'))
                .toBe('new-binary');
            expect(existsSync(join(user_bin_path, 'sight-language-server')))
                .toBe(false);
        } finally {
            rmSync(temp_root, { recursive: true, force: true });
        }
    });

    it('source install removes legacy source-installed native binary', () => {
        const temp_root = make_temp_dir();
        const source_path = join(temp_root, 'source-binary');
        const user_bin_path = join(temp_root, 'bin');
        const legacy_path = join(user_bin_path, 'sight-language-server');

        try {
            writeFileSync(source_path, 'new-binary');
            mkdirSync(user_bin_path, { recursive: true });
            write_legacy_sight_native_binary(legacy_path);

            install_binary_files(source_path, user_bin_path, 'linux');

            expect(readFileSync(join(user_bin_path, 'sight'), 'utf8'))
                .toBe('new-binary');
            expect(existsSync(legacy_path)).toBe(false);
        } finally {
            rmSync(temp_root, { recursive: true, force: true });
        }
    });

    it('source install refuses semver-looking unrelated commands', () => {
        const temp_root = make_temp_dir();
        const source_path = join(temp_root, 'source-binary');
        const user_bin_path = join(temp_root, 'bin');
        const existing_sight_path = join(user_bin_path, 'sight');

        try {
            writeFileSync(source_path, 'new-binary');
            mkdirSync(user_bin_path, { recursive: true });
            write_version_script(existing_sight_path, 'sight 1.2.3');

            expect(() => install_binary_files(
                source_path,
                user_bin_path,
                'linux'
            )).toThrow(/Refusing to overwrite/);

            expect(readFileSync(existing_sight_path, 'utf8'))
                .toContain('sight 1.2.3');
        } finally {
            rmSync(temp_root, { recursive: true, force: true });
        }
    });

    it('source install replaces symlink without mutating its target', () => {
        if (process.platform === 'win32') {
            return;
        }

        const temp_root = make_temp_dir();
        const source_path = join(temp_root, 'source-binary');
        const managed_path = join(temp_root, 'managed-sight');
        const user_bin_path = join(temp_root, 'bin');
        const existing_sight_path = join(user_bin_path, 'sight');

        try {
            writeFileSync(source_path, 'new-binary');
            mkdirSync(user_bin_path, { recursive: true });
            write_sight_script(managed_path, 'sight 0.1.0');
            symlinkSync(managed_path, existing_sight_path);

            install_binary_files(source_path, user_bin_path, 'linux');

            expect(lstatSync(existing_sight_path).isSymbolicLink()).toBe(false);
            expect(readFileSync(existing_sight_path, 'utf8'))
                .toBe('new-binary');
            expect(readFileSync(managed_path, 'utf8'))
                .toContain(CLI_DESCRIPTION);
        } finally {
            rmSync(temp_root, { recursive: true, force: true });
        }
    });

    it('source install leaves unrelated legacy aliases during cleanup', () => {
        if (process.platform === 'win32') {
            return;
        }

        const temp_root = make_temp_dir();
        const source_path = join(temp_root, 'source-binary');
        const managed_path = join(temp_root, 'managed-sight');
        const user_bin_path = join(temp_root, 'bin');
        const existing_sight_path = join(user_bin_path, 'sight');
        const legacy_path = join(user_bin_path, 'sight-language-server');

        try {
            writeFileSync(source_path, 'new-binary');
            mkdirSync(user_bin_path, { recursive: true });
            write_sight_script(managed_path, 'sight 0.1.0');
            symlinkSync(managed_path, existing_sight_path);
            write_version_script(legacy_path, 'other 1.0.0');

            const the_target_paths = install_binary_files(
                source_path,
                user_bin_path,
                'linux'
            );

            expect(the_target_paths.map((target_path) => basename(target_path)))
                .toEqual(['sight']);
            expect(lstatSync(existing_sight_path).isSymbolicLink()).toBe(false);
            expect(readFileSync(existing_sight_path, 'utf8'))
                .toBe('new-binary');
            expect(readFileSync(legacy_path, 'utf8'))
                .toContain('other 1.0.0');
        } finally {
            rmSync(temp_root, { recursive: true, force: true });
        }
    });

    it('source install refuses dangling command symlinks', () => {
        if (process.platform === 'win32') {
            return;
        }

        const temp_root = make_temp_dir();
        const source_path = join(temp_root, 'source-binary');
        const dangling_target_path = join(temp_root, 'missing-sight');
        const user_bin_path = join(temp_root, 'bin');
        const existing_sight_path = join(user_bin_path, 'sight');

        try {
            writeFileSync(source_path, 'new-binary');
            mkdirSync(user_bin_path, { recursive: true });
            symlinkSync(dangling_target_path, existing_sight_path);

            expect(() => install_binary_files(
                source_path,
                user_bin_path,
                'linux'
            )).toThrow(/dangling symlink/);

            expect(lstatSync(existing_sight_path).isSymbolicLink()).toBe(true);
            expect(existsSync(dangling_target_path)).toBe(false);
        } finally {
            rmSync(temp_root, { recursive: true, force: true });
        }
    });

    it('source install refuses to overwrite unrelated commands', () => {
        const temp_root = make_temp_dir();
        const source_path = join(temp_root, 'source-binary');
        const user_bin_path = join(temp_root, 'bin');
        const existing_sight_path = join(user_bin_path, 'sight');

        try {
            writeFileSync(source_path, 'new-binary');
            mkdirSync(user_bin_path, { recursive: true });
            write_version_script(existing_sight_path, 'other 1.0.0');

            expect(() => install_binary_files(
                source_path,
                user_bin_path,
                'linux'
            )).toThrow(/Refusing to overwrite/);

            expect(readFileSync(existing_sight_path, 'utf8'))
                .toContain('other 1.0.0');
            expect(existsSync(join(user_bin_path, 'sight-language-server')))
                .toBe(false);
        } finally {
            rmSync(temp_root, { recursive: true, force: true });
        }
    });

    it('source install leaves unrelated legacy alias in place', () => {
        const temp_root = make_temp_dir();
        const source_path = join(temp_root, 'source-binary');
        const user_bin_path = join(temp_root, 'bin');
        const legacy_path = join(user_bin_path, 'sight-language-server');

        try {
            writeFileSync(source_path, 'new-binary');
            mkdirSync(user_bin_path, { recursive: true });
            write_version_script(legacy_path, 'other 1.0.0');

            const the_target_paths = install_binary_files(
                source_path,
                user_bin_path,
                'linux'
            );

            expect(the_target_paths.map((target_path) => basename(target_path)))
                .toEqual(['sight']);
            expect(readFileSync(join(user_bin_path, 'sight'), 'utf8'))
                .toBe('new-binary');
            expect(readFileSync(legacy_path, 'utf8'))
                .toContain('other 1.0.0');
        } finally {
            rmSync(temp_root, { recursive: true, force: true });
        }
    });

    it('source uninstall removes primary and legacy command names', () => {
        const temp_root = make_temp_dir();
        const user_bin_path = join(temp_root, 'bin');

        try {
            mkdirSync(user_bin_path, { recursive: true });
            write_sight_script(join(user_bin_path, 'sight'), 'sight 0.2.0');
            write_sight_script(
                join(user_bin_path, 'sight-language-server'),
                'sight 0.1.0'
            );

            const result = uninstall_from_bin_dir(user_bin_path, 'linux');

            expect(result.success).toBe(true);
            expect(existsSync(join(user_bin_path, 'sight'))).toBe(false);
            expect(existsSync(
                join(user_bin_path, 'sight-language-server')
            )).toBe(false);
        } finally {
            rmSync(temp_root, { recursive: true, force: true });
        }
    });

    it('source uninstall removes legacy source-installed native binary', () => {
        const temp_root = make_temp_dir();
        const user_bin_path = join(temp_root, 'bin');
        const legacy_path = join(user_bin_path, 'sight-language-server');

        try {
            mkdirSync(user_bin_path, { recursive: true });
            write_legacy_sight_native_binary(legacy_path);

            const result = uninstall_from_bin_dir(user_bin_path, 'linux');

            expect(result.success).toBe(true);
            expect(existsSync(legacy_path)).toBe(false);
        } finally {
            rmSync(temp_root, { recursive: true, force: true });
        }
    });

    it('source uninstall leaves unrelated command names in place', () => {
        const temp_root = make_temp_dir();
        const user_bin_path = join(temp_root, 'bin');
        const existing_sight_path = join(user_bin_path, 'sight');

        try {
            mkdirSync(user_bin_path, { recursive: true });
            write_version_script(existing_sight_path, 'other 1.0.0');
            write_sight_script(
                join(user_bin_path, 'sight-language-server'),
                'sight 0.1.0'
            );

            const result = uninstall_from_bin_dir(user_bin_path, 'linux');

            expect(result.success).toBe(true);
            expect(result.message).toContain('Skipped existing non-Sight');
            expect(existsSync(existing_sight_path)).toBe(true);
            expect(existsSync(
                join(user_bin_path, 'sight-language-server')
            )).toBe(false);
        } finally {
            rmSync(temp_root, { recursive: true, force: true });
        }
    });

    it('source uninstall leaves semver-looking unrelated commands in place', () => {
        const temp_root = make_temp_dir();
        const user_bin_path = join(temp_root, 'bin');
        const existing_sight_path = join(user_bin_path, 'sight');

        try {
            mkdirSync(user_bin_path, { recursive: true });
            write_version_script(existing_sight_path, 'sight 1.2.3');

            const result = uninstall_from_bin_dir(user_bin_path, 'linux');

            expect(result.success).toBe(true);
            expect(result.message).toContain('No Sight-owned binaries found');
            expect(existsSync(existing_sight_path)).toBe(true);
        } finally {
            rmSync(temp_root, { recursive: true, force: true });
        }
    });

    it('source uninstall leaves unrelated legacy alias in place', () => {
        const temp_root = make_temp_dir();
        const user_bin_path = join(temp_root, 'bin');
        const legacy_path = join(user_bin_path, 'sight-language-server');

        try {
            mkdirSync(user_bin_path, { recursive: true });
            write_sight_script(join(user_bin_path, 'sight'), 'sight 0.2.0');
            write_version_script(legacy_path, 'other 1.0.0');

            const result = uninstall_from_bin_dir(user_bin_path, 'linux');

            expect(result.success).toBe(true);
            expect(result.message).toContain('Skipped existing non-Sight');
            expect(existsSync(join(user_bin_path, 'sight'))).toBe(false);
            expect(existsSync(legacy_path)).toBe(true);
        } finally {
            rmSync(temp_root, { recursive: true, force: true });
        }
    });

    it('source uninstall reports dangling command symlinks as skipped', () => {
        if (process.platform === 'win32') {
            return;
        }

        const temp_root = make_temp_dir();
        const user_bin_path = join(temp_root, 'bin');
        const existing_sight_path = join(user_bin_path, 'sight');
        const dangling_target_path = join(temp_root, 'missing-sight');

        try {
            mkdirSync(user_bin_path, { recursive: true });
            symlinkSync(dangling_target_path, existing_sight_path);

            const result = uninstall_from_bin_dir(user_bin_path, 'linux');

            expect(result.success).toBe(true);
            expect(result.message).toContain('No Sight-owned binaries found');
            expect(result.message).toContain(existing_sight_path);
            expect(lstatSync(existing_sight_path).isSymbolicLink()).toBe(true);
        } finally {
            rmSync(temp_root, { recursive: true, force: true });
        }
    });

    it('source install writes only the Windows primary command name', () => {
        const temp_root = make_temp_dir();
        const source_path = join(temp_root, 'source-binary.exe');
        const user_bin_path = join(temp_root, 'bin');

        try {
            writeFileSync(source_path, 'new-binary');
            mkdirSync(user_bin_path, { recursive: true });

            const the_target_paths = install_binary_files(
                source_path,
                user_bin_path,
                'win32'
            );

            expect(the_target_paths.map((target_path) => basename(target_path)))
                .toEqual(['sight.exe']);
            expect(readFileSync(join(user_bin_path, 'sight.exe'), 'utf8'))
                .toBe('new-binary');
            expect(existsSync(
                join(user_bin_path, 'sight-language-server.exe')
            )).toBe(false);
        } finally {
            rmSync(temp_root, { recursive: true, force: true });
        }
    });

    it('source uninstall removes Windows primary and legacy command names',
        () => {
            const temp_root = make_temp_dir();
            const user_bin_path = join(temp_root, 'bin');

            try {
                mkdirSync(user_bin_path, { recursive: true });
                writeFileSync(join(user_bin_path, 'sight.exe'), 'primary');
                writeFileSync(
                    join(user_bin_path, 'sight-language-server.exe'),
                    'legacy'
                );

                const the_checked_names: string[] = [];

                const result = uninstall_from_bin_dir(
                    user_bin_path,
                    'win32',
                    (binary_path, platform) => {
                        the_checked_names.push(basename(binary_path));
                        expect(platform).toBe('win32');
                        return true;
                    }
                );

                expect(result.success).toBe(true);
                expect(the_checked_names).toEqual([
                    'sight.exe',
                    'sight-language-server.exe',
                ]);
                expect(existsSync(join(user_bin_path, 'sight.exe')))
                    .toBe(false);
                expect(existsSync(
                    join(user_bin_path, 'sight-language-server.exe')
                )).toBe(false);
            } finally {
                rmSync(temp_root, { recursive: true, force: true });
            }
        }
    );

    it('source install refuses Windows command shims that would be shadowed',
        () => {
            const temp_root = make_temp_dir();
            const source_path = join(temp_root, 'source-binary.exe');
            const user_bin_path = join(temp_root, 'bin');
            const existing_cmd_path = join(user_bin_path, 'sight.cmd');

            try {
                writeFileSync(source_path, 'new-binary');
                mkdirSync(user_bin_path, { recursive: true });
                write_version_script(existing_cmd_path, 'other 1.0.0');

                const the_checked_names: string[] = [];

                expect(() => install_binary_files(
                    source_path,
                    user_bin_path,
                    'win32',
                    (binary_path) => {
                        the_checked_names.push(basename(binary_path));
                        throw new Error(
                            `Refusing to overwrite ${binary_path}`
                        );
                    }
                )).toThrow(/Refusing to overwrite/);

                expect(readFileSync(existing_cmd_path, 'utf8'))
                    .toContain('other 1.0.0');
                expect(the_checked_names).toEqual(['sight.cmd']);
                expect(existsSync(join(user_bin_path, 'sight.exe')))
                    .toBe(false);
            } finally {
                rmSync(temp_root, { recursive: true, force: true });
            }
        }
    );

    it('source install removes Windows command shims owned by Sight', () => {
        const temp_root = make_temp_dir();
        const source_path = join(temp_root, 'source-binary.exe');
        const user_bin_path = join(temp_root, 'bin');
        const existing_shell_path = join(user_bin_path, 'sight');
        const existing_cmd_path = join(user_bin_path, 'sight.cmd');
        const existing_bat_path = join(user_bin_path, 'sight.bat');
        const existing_ps1_path = join(user_bin_path, 'sight.ps1');

        try {
            writeFileSync(source_path, 'new-binary');
            mkdirSync(user_bin_path, { recursive: true });
            writeFileSync(existing_shell_path, 'old-shell-shim');
            writeFileSync(existing_cmd_path, 'old-cmd-shim');
            writeFileSync(existing_bat_path, 'old-bat-shim');
            writeFileSync(existing_ps1_path, 'old-powershell-shim');

            const the_checked_names: string[] = [];

            install_binary_files(
                source_path,
                user_bin_path,
                'win32',
                (binary_path) => {
                    the_checked_names.push(basename(binary_path));
                }
            );

            expect(readFileSync(join(user_bin_path, 'sight.exe'), 'utf8'))
                .toBe('new-binary');
            expect(existsSync(existing_shell_path)).toBe(false);
            expect(existsSync(existing_cmd_path)).toBe(false);
            expect(existsSync(existing_bat_path)).toBe(false);
            expect(existsSync(existing_ps1_path)).toBe(false);
            expect(the_checked_names).toEqual([
                'sight',
                'sight.cmd',
                'sight.bat',
                'sight.ps1',
            ]);
        } finally {
            rmSync(temp_root, { recursive: true, force: true });
        }
    });

    it('detects quoted stale legacy command invocations', () => {
        expect(has_old_command_invocation(
            'cmd = "sight-language-server --stdio"'
        )).toBe(true);
        expect(has_old_command_invocation(
            '"sight-language-server --stdio"'
        )).toBe(true);
        expect(has_old_command_invocation(
            '"sight-language-server", "--stdio"'
        )).toBe(true);
        expect(has_old_command_invocation(
            '"command": ["sight-language-server"]'
        )).toBe(true);
        expect(has_old_command_invocation(
            '"command": ["sight-language-server.exe"]'
        )).toBe(true);
        expect(has_old_command_invocation(
            'command: sight-language-server\nargs: ["--stdio"]'
        )).toBe(true);
        expect(has_old_command_invocation(
            'cmd: sight-language-server --stdio'
        )).toBe(true);
        expect(has_old_command_invocation(
            'cmd:\n  - sight-language-server\n  - --stdio'
        )).toBe(true);
        expect(has_old_command_invocation(
            'cmd = "sight-language-server"'
        )).toBe(true);
        expect(has_old_command_invocation(
            'cmd = { "sight-language-server", "--stdio" }'
        )).toBe(true);
        expect(has_old_command_invocation(
            'command:\n  - sight-language-server\n  - --stdio'
        )).toBe(true);
        expect(has_old_command_invocation(
            'command:\n  - "sight-language-server"\n  - --stdio'
        )).toBe(true);
        expect(has_old_command_invocation(
            'cmd = "sight-language-server" \\\n  "--stdio"'
        )).toBe(true);
        expect(has_old_command_invocation(
            'command = "sight-language-server"\nargs = ["--stdio"]'
        )).toBe(true);
    });

    it('tracks primary source-install names and legacy cleanup names', () => {
        expect(get_binary_names_to_install('darwin')).toEqual(['sight']);
        expect(get_binary_names_to_install('linux')).toEqual(['sight']);
        expect(get_binary_names_to_install('win32')).toEqual(['sight.exe']);
        expect(get_binary_shadow_paths_to_check('/bin', 'win32').map(
            (target_path) => basename(target_path)
        )).toEqual([
            'sight',
            'sight.cmd',
            'sight.bat',
            'sight.ps1',
        ]);
        expect(get_binary_shadow_paths_to_check('/bin', 'linux')).toEqual([]);

        expect(get_binary_names_to_uninstall('darwin')).toEqual([
            'sight',
            'sight-language-server',
        ]);
        expect(get_binary_names_to_uninstall('linux')).toEqual([
            'sight',
            'sight-language-server',
        ]);
        expect(get_binary_names_to_uninstall('win32')).toEqual([
            'sight.exe',
            'sight-language-server.exe',
        ]);
    });

    it('does not leave stale user-facing old-command invocations', () => {
        const repo_root = join(__dirname, '../..');

        for (const my_file of list_repo_files(repo_root)) {
            if (is_historical_legacy_reference_path(my_file)) {
                continue;
            }

            const file_content = readFileSync(
                join(repo_root, my_file),
                'utf8'
            );
            const scan_content = strip_intentional_legacy_alias_checks(
                my_file,
                file_content
            );

            expect(has_old_command_invocation(scan_content)).toBe(false);
        }
    });

    it('asserts npm command smoke-test output in CI', () => {
        const workflow_path = join(__dirname, '../../.github/workflows/ci.yml');
        const workflow_content = readFileSync(workflow_path, 'utf8');

        expect(workflow_content).toContain(
            "VERSION_PATTERN='^sight [0-9]+\\.[0-9]+\\.[0-9]+"
        );
        expect(workflow_content).toContain(
            "VERSION_PATTERN+='(-[0-9A-Za-z.-]+)?$'"
        );
        expect(workflow_content).toContain(
            "sight --version | grep -E \"$VERSION_PATTERN\""
        );
        expect(workflow_content).toMatch(
            /sight --help \| grep 'static analyzer and language server for Stata'/
        );
        expect(workflow_content).not.toContain(
            'sight-language-server --version | grep -E "$VERSION_PATTERN"'
        );
        expect_workflow_runs_stdio_smoke_helper(
            workflow_content,
            'sight'
        );
        expect_workflow_runs_stdio_smoke_helper(
            workflow_content,
            '$BINARY'
        );
        expect(workflow_content).toContain(
            'os: [ubuntu-latest, macos-latest, windows-latest]'
        );
    });

    it('does not accept the legacy alias for primary CI smoke assertions', () => {
        const workflow_content = [
            'steps:',
            '  - name: Test LSP stdio startup',
            '    run: bun scripts/smoke-stdio-startup.ts ' +
                'sight-language-server',
            '',
        ].join('\n');

        expect(() => expect_workflow_runs_stdio_smoke_helper(
            workflow_content,
            'sight'
        )).toThrow();
    });

    it('runs verification when the CI workflow changes', () => {
        const workflow_path = join(__dirname, '../../.github/workflows/ci.yml');
        const workflow_content = readFileSync(workflow_path, 'utf8');

        expect(get_paths_filter_entries(workflow_content, 'server')).toContain(
            '.github/workflows/ci.yml'
        );
        expect(get_paths_filter_entries(workflow_content, 'server')).toContain(
            '.github/workflows/release-build.yml'
        );
        expect(get_paths_filter_entries(workflow_content, 'server')).toContain(
            '.github/workflows/release-publish.yml'
        );
        expect(get_paths_filter_entries(workflow_content, 'server')).toContain(
            '.npmignore'
        );
        expect(get_paths_filter_entries(workflow_content, 'server')).toContain(
            'README.md'
        );
        expect(get_paths_filter_entries(workflow_content, 'server')).toContain(
            'DEVELOPMENT.md'
        );
        expect(get_paths_filter_entries(workflow_content, 'server')).toContain(
            'docs/**'
        );
        expect(get_paths_filter_entries(workflow_content, 'client'))
            .toContain('.github/workflows/release-build.yml');
        expect(get_paths_filter_entries(workflow_content, 'binaries'))
            .toContain('scripts/binary-names.ts');
        expect(get_paths_filter_entries(workflow_content, 'binaries'))
            .toContain('.github/workflows/release-build.yml');
        expect(get_paths_filter_entries(workflow_content, 'binaries'))
            .toContain('scripts/binary-ownership.ts');
        expect(get_paths_filter_entries(workflow_content, 'binaries'))
            .toContain('scripts/smoke-stdio-startup.ts');
        expect(get_paths_filter_entries(workflow_content, 'binaries'))
            .toContain('.github/workflows/ci.yml');
        expect(get_paths_filter_entries(workflow_content, 'formula'))
            .not.toContain('scripts/release.ts');
    });

    it('keeps release script version bump side effects centralized', () => {
        expect(get_bump_version_args('1.2.3')).toEqual([
            'scripts/bump-version.ts',
            '1.2.3',
            '--no-git',
        ]);
        expect(get_branch_push_ref('release-branch')).toBe(
            'HEAD:release-branch'
        );
        expect(() => get_branch_push_ref('')).toThrow(/detached HEAD/);
    });

    it('runs tests before publishing release artifacts', () => {
        const workflow_path = join(
            __dirname,
            '../../.github/workflows/release-build.yml'
        );
        const workflow_content = readFileSync(workflow_path, 'utf8');

        expect_job_needs(workflow_content, 'package', ['verify']);
        expect_job_needs(workflow_content, 'linux-binaries', ['verify']);
        expect_job_needs(workflow_content, 'darwin-binaries', ['verify']);
        expect_job_needs(workflow_content, 'windows-binaries', ['verify']);
        expect_job_needs(workflow_content, 'assemble', [
            'package',
            'linux-binaries',
            'darwin-binaries',
            'windows-binaries',
        ]);
        expect_step_before(
            workflow_content,
            'assemble',
            'Validate release artifacts',
            'Calculate checksums'
        );
        expect_step_before(
            workflow_content,
            'assemble',
            'Calculate checksums',
            'Upload release artifacts'
        );
        expect_step_before(
            workflow_content,
            'assemble',
            'Upload release artifacts',
            'Trigger release publish workflow'
        );
        expect(workflow_content).toContain('run: bun test ./tests');
        expect(workflow_content).toContain(
            'bun scripts/smoke-stdio-startup.ts ./dist/sight-server.js'
        );
        expect(workflow_content).toContain(
            'bun scripts/smoke-stdio-startup.ts ./bin/sight-linux-x64'
        );
        expect(workflow_content).toContain(
            'chmod +x dist/sight-server.js'
        );
        expect(workflow_content).toContain(
            'chmod +x bin/sight-darwin-arm64 bin/sight-linux-x64 ' +
            'bin/sight-linux-arm64'
        );
        expect(workflow_content).toContain('runs-on: macos-latest');
        expect(workflow_content).toContain('runs-on: windows-latest');
        expect(workflow_content).toContain(
            'bun scripts/build-binary.ts target sight-darwin-arm64'
        );
        expect(workflow_content).toContain(
            'codesign --verify --verbose ./bin/sight-darwin-arm64'
        );
        expect(workflow_content).toContain(
            'bun scripts/smoke-stdio-startup.ts ./bin/sight-darwin-arm64'
        );
        expect(workflow_content).toContain(
            'bun scripts/build-binary.ts target sight-windows-x64.exe'
        );
        expect(workflow_content).toContain(
            'bun scripts/build-binary.ts target sight-windows-arm64.exe'
        );
        expect(workflow_content).toContain(
            'bun scripts/smoke-stdio-startup.ts ./bin/sight-windows-x64.exe'
        );
        expect(workflow_content).toContain(
            'gh run download "$GITHUB_RUN_ID" --name release-linux --dir bin'
        );
        expect(workflow_content).toContain(
            'gh run download "$GITHUB_RUN_ID" --name release-darwin --dir bin'
        );
        expect(workflow_content).toContain(
            'gh run download "$GITHUB_RUN_ID" --name release-windows-x64 --dir bin'
        );
        expect(workflow_content).toContain(
            'gh run download "$GITHUB_RUN_ID" --name release-windows-arm64 --dir bin'
        );
        expect(get_upload_artifact_paths(
            workflow_content,
            'linux-binaries',
            'Upload Linux binaries'
        )).toEqual([
            'bin/sight-linux-x64',
            'bin/sight-linux-arm64',
        ]);
        expect(get_upload_artifact_paths(
            workflow_content,
            'darwin-binaries',
            'Upload macOS binary'
        )).toEqual(['bin/sight-darwin-arm64']);
        expect(get_upload_artifact_paths(
            workflow_content,
            'windows-binaries',
            'Upload Windows x64 binary'
        )).toEqual([
            'bin/sight-windows-x64.exe',
        ]);
        expect(get_upload_artifact_paths(
            workflow_content,
            'linux-binaries',
            'Upload Windows ARM64 binary'
        )).toEqual([
            'bin/sight-windows-arm64.exe',
        ]);
        expect(get_upload_artifact_paths(
            workflow_content,
            'assemble',
            'Upload release artifacts'
        )).toEqual([
            'bin/sight-*',
            'dist/sight-server.js',
            'dist/sight-server.js.sha256',
            'client/*.vsix',
            'client/*.vsix.sha256',
        ]);
        expect(workflow_content).toContain(
            'name: release-${{ inputs.tag || github.ref_name }}'
        );
        expect(workflow_content).toContain(
            '-f build_run_id="$GITHUB_RUN_ID"'
        );
        const workflow_header = workflow_content.split('\njobs:\n')[0];
        expect(workflow_header).toContain('contents: read');
        expect(workflow_header).not.toContain('actions: write');
        for (const my_job_name of [
            'package',
            'linux-binaries',
            'darwin-binaries',
            'windows-binaries',
            'assemble',
        ]) {
            expect(workflow_content).toContain(
                `  ${my_job_name}:\n` +
                '    permissions:\n' +
                '      actions: write\n' +
                '      contents: read'
            );
        }
        for (const my_binary_name of [
            'sight-darwin-arm64',
            'sight-linux-x64',
            'sight-linux-arm64',
            'sight-windows-x64.exe',
            'sight-windows-arm64.exe',
        ]) {
            expect(workflow_content).toContain(my_binary_name);
        }
    });

    it('grants release publish workflow access to release artifacts', () => {
        const workflow_path = join(
            __dirname,
            '../../.github/workflows/release-publish.yml'
        );
        const workflow_content = readFileSync(workflow_path, 'utf8');

        expect(workflow_content).toContain('actions: read');
        expect(workflow_content).toContain('contents: write');
        expect(workflow_content).toContain('id-token: write');
        expect(workflow_content).toContain(
            'registry-url: https://registry.npmjs.org'
        );
        expect(workflow_content).toContain(
            'npm install -g npm@latest'
        );
        expect(workflow_content).toContain(
            'npm publish --ignore-scripts --access public'
        );
        expect_step_before(
            workflow_content,
            'publish',
            'Verify checksums',
            'Publish to npm'
        );
        expect_step_before(
            workflow_content,
            'publish',
            'Publish to npm',
            'Create GitHub Release'
        );
        expect(workflow_content).toContain(
            'build_run_id:'
        );
        expect(workflow_content).toContain(
            'if [[ ! "$the_build_run_id" =~ ^[0-9]+$ ]]; then'
        );
        expect(workflow_content).toContain(
            'the_build_run_id="$BUILD_RUN_ID_INPUT"'
        );
        expect(workflow_content).toContain(
            'ERROR: build_run_id must be numeric.'
        );
        expect(workflow_content).toContain(
            'BUILD_RUN_ID="$the_build_run_id"'
        );
        expect(workflow_content).not.toContain(
            'BUILD_RUN_ID="${{ inputs.build_run_id }}"'
        );
        expect(workflow_content).toContain(
            'BUILD_RUN_ID_INPUT: ${{ inputs.build_run_id }}'
        );
        expect(workflow_content).toContain(
            'gh run download "$BUILD_RUN_ID" --name "$ARTIFACT_NAME"'
        );
        expect(workflow_content).not.toContain('head -1');
    });

    it('builds a single named binary target', async () => {
        const the_built_targets: string[] = [];

        await build_binary_by_output_name(
            'sight-linux-x64',
            async (target) => {
                the_built_targets.push(target.output_name);
            }
        );

        expect(the_built_targets).toEqual(['sight-linux-x64']);
        await expect(build_binary_by_output_name(
            'missing-target',
            async () => {}
        )).rejects.toThrow(/Unknown binary target/);
    });

    it('fails the binary build when any target fails', async () => {
        const original_log = console.log;
        const original_error = console.error;
        const failed_target = 'sight-linux-arm64';
        const the_attempted_targets: string[] = [];

        console.log = () => {};
        console.error = () => {};

        try {
            await expect(build_all_binaries(async (target) => {
                the_attempted_targets.push(target.output_name);

                if (target.output_name === failed_target) {
                    throw new Error('simulated failure');
                }
            })).rejects.toThrow(`Failed to build targets: ${failed_target}`);
        } finally {
            console.log = original_log;
            console.error = original_error;
        }

        expect(the_attempted_targets).toEqual(
            get_build_targets().map((target) => target.output_name)
        );
    });

    it('returns independent build target objects', () => {
        const first_targets = get_build_targets();
        const second_targets = get_build_targets();

        first_targets[0].output_name = 'mutated';

        expect(second_targets[0].output_name).toBe('sight-darwin-arm64');
        expect(get_build_targets()[0].output_name).toBe('sight-darwin-arm64');
    });

    it('keeps release docs on the release script path', () => {
        const docs_path = join(__dirname, '../../DEVELOPMENT.md');
        const docs_content = readFileSync(docs_path, 'utf8');

        expect(docs_content).not.toContain(
            'bun scripts/bump-version.ts 0.1.19 ' + '--push'
        );
        expect(docs_content).toContain('bun scripts/release.ts x.y.z');
    });
});
