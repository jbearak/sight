import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    load_check_config,
} from '../../../src/cli/check';

function temp_dir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'sight-check-config-'));
}

describe('sight check config loading', () => {
    it('uses built-in defaults under --no-config', () => {
        const root = temp_dir();
        fs.writeFileSync(path.join(root, 'sight.toml'), '[diagnostics]\nenabled = false\n');

        const result = load_check_config({
            cwd: root,
            workspace_root: root,
            no_config: true,
        });

        expect(result.kind).toBe('loaded');
        if (result.kind === 'loaded') {
            expect(result.config.diagnostics.enabled).toBe(true);
        }
    });

    it('loads explicit config relative to cwd', () => {
        const cwd = temp_dir();
        const workspace = temp_dir();
        fs.writeFileSync(path.join(cwd, 'custom.toml'), '[diagnostics]\nenabled = false\n');

        const result = load_check_config({
            cwd,
            workspace_root: workspace,
            config_path: 'custom.toml',
            no_config: false,
        });

        expect(result.kind).toBe('loaded');
        if (result.kind === 'loaded') {
            expect(result.config.diagnostics.enabled).toBe(false);
        }
    });

    it('discovers config from workspace root and reports stale json warnings', () => {
        const root = temp_dir();
        fs.writeFileSync(path.join(root, '.sight.json'), '{}\n');
        fs.writeFileSync(path.join(root, 'sight.toml'), '[diagnostics]\nindentation = true\n');

        const result = load_check_config({
            cwd: root,
            workspace_root: root,
            no_config: false,
        });

        expect(result.kind).toBe('loaded');
        if (result.kind === 'loaded') {
            expect(result.config.diagnostics.indentation).toBe(true);
            expect(result.warnings.some((warning) =>
                warning.message.includes('.sight.json is no longer supported')
            )).toBe(true);
        }
    });

    it('surfaces comment-formatting validation warnings', () => {
        const root = temp_dir();
        fs.writeFileSync(
            path.join(root, 'sight.toml'),
            '[formatting]\nindentSize = -4\n'
        );

        const result = load_check_config({
            cwd: root,
            workspace_root: root,
            no_config: false,
        });

        expect(result.kind).toBe('loaded');
        if (result.kind === 'loaded') {
            // Invalid value is reported (not silently swallowed) and the
            // default is applied.
            expect(result.warnings.some((warning) =>
                warning.message.includes('Invalid indentSize')
            )).toBe(true);
            expect(result.config.formatting.indentSize).toBe(4);
        }
    });

    it('returns operator error for malformed discovered config', () => {
        const root = temp_dir();
        fs.writeFileSync(path.join(root, 'sight.toml'), 'bad = = toml\n');

        const result = load_check_config({
            cwd: root,
            workspace_root: root,
            no_config: false,
        });

        expect(result.kind).toBe('operator-error');
        if (result.kind === 'operator-error') {
            expect(result.message).toContain('failed to load');
        }
    });

    it('surfaces stale json warnings when the config fails to parse', () => {
        const root = temp_dir();
        fs.writeFileSync(path.join(root, '.sight.json'), '{}\n');
        fs.writeFileSync(path.join(root, 'sight.toml'), 'bad = = toml\n');

        const result = load_check_config({
            cwd: root,
            workspace_root: root,
            no_config: false,
        });

        expect(result.kind).toBe('operator-error');
        if (result.kind === 'operator-error') {
            expect(result.message).toContain('failed to load');
            expect(result.warnings.some((warning) =>
                warning.message.includes('.sight.json is no longer supported')
            )).toBe(true);
        }
    });
});
