import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    deep_merge_config,
    discover_and_load_project_config,
    map_public_config_to_partial_config,
} from '../../src/config-file';
import { validate_comment_formatting_config } from '../../src/utils/config-validator';
import { DEFAULT_SETTINGS } from '../../src/server-handlers';

function make_temp_dir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'sight-lsp-config-'));
}

describe('sight.toml server config precedence', () => {
    it('project config overrides client config while silent client keys survive', () => {
        const client = {
            formatting: {
                lineWidth: 100,
                indentSize: 2,
            },
        };
        const project = {
            formatting: {
                indentSize: 4,
            },
        };

        const settings = validate_comment_formatting_config(
            deep_merge_config(client, project)
        );

        expect(settings.formatting.lineWidth).toBe(100);
        expect(settings.formatting.indentSize).toBe(4);
    });

    it('applies crossFile.backwardDependencies through load merge and validation', () => {
        const root = make_temp_dir();
        fs.writeFileSync(
            path.join(root, 'sight.toml'),
            '[crossFile]\nbackwardDependencies = "EXPLICIT"\n'
        );

        const client = {
            cross_file: {
                backward_dependencies: 'auto',
            },
        };
        const loaded = discover_and_load_project_config(root);

        expect(loaded.kind).toBe('loaded');
        if (loaded.kind === 'loaded') {
            const settings = validate_comment_formatting_config(
                deep_merge_config(client, loaded.partial_config)
            );

            expect(settings.cross_file.backward_dependencies).toBe('explicit');
        }
    });

    it('maps camelCase initialization options into the internal config shape', () => {
        // Regression: non-VS-Code clients (Neovim/Helix/Zed/Claude Code) pass
        // config via LSP initializationOptions in the public camelCase schema.
        // These must be mapped (crossFile -> cross_file, preserveAlignment ->
        // preserve_alignment) or the validator silently drops them.
        const init_options = {
            crossFile: {
                maxChainDepth: 5,
                indexWorkspace: false,
                backwardDependencies: 'explicit',
            },
            formatting: { preserveAlignment: true },
        };

        const mapped = map_public_config_to_partial_config(init_options);
        const settings = validate_comment_formatting_config(
            deep_merge_config(DEFAULT_SETTINGS, mapped)
        );

        expect(settings.cross_file.max_chain_depth).toBe(5);
        expect(settings.cross_file.index_workspace).toBe(false);
        expect(settings.cross_file.backward_dependencies).toBe('explicit');
        expect(settings.formatting.preserve_alignment).toBe(true);
    });

    it('malformed nearest sight.toml yields no project layer', () => {
        const root = make_temp_dir();
        fs.writeFileSync(path.join(root, 'sight.toml'), 'bad = = toml\n');

        const loaded = discover_and_load_project_config(root);

        expect(loaded.kind).toBe('load-failed');
    });

    it('deleting sight.toml removes the project layer on rediscovery', () => {
        const root = make_temp_dir();
        const config_path = path.join(root, 'sight.toml');
        fs.writeFileSync(config_path, 'debug = true\n');

        expect(discover_and_load_project_config(root).kind).toBe('loaded');
        fs.unlinkSync(config_path);

        const loaded = discover_and_load_project_config(root, { max_depth: 1 });

        expect(loaded.kind).toBe('none');
    });
});
