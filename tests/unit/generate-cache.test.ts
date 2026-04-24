import { describe, expect, test } from 'bun:test';
import {
    apply_builtin_metadata_fallback,
    build_abbreviations,
} from '../../scripts/generate-cache';
import type { CommandInfo } from '../../src/command-database/types';

function command(name: string, min_abbreviation: number): CommandInfo {
    return {
        name,
        min_abbreviation,
        options: [],
        priority: 3,
    };
}

describe('generate-cache build_abbreviations', () => {
    test('uses explicit override for di when dir is inserted first', () => {
        const abbreviations = build_abbreviations({
            dir: command('dir', 1),
            display: command('display', 2),
        });

        expect(abbreviations.di).toBe('display');
        expect(abbreviations.d).toBe('dir');
    });

    test('keeps first command for ordinary abbreviation collisions', () => {
        const abbreviations = build_abbreviations({
            detail: command('detail', 1),
            describe: command('describe', 1),
        });

        expect(abbreviations.d).toBe('detail');
    });

    test('does not let documented-minimum claims rewrite stable collisions', () => {
        const abbreviations = build_abbreviations({
            display: command('display', 2),
            dissimilarity: command('dissimilarity', 3),
        });

        expect(abbreviations.dis).toBe('display');
    });
});

describe('generate-cache apply_builtin_metadata_fallback', () => {
    test('adds builtin subcommands when SMCL extraction omits them', () => {
        const commands: Record<string, CommandInfo> = {
            frame: command('frame', 5),
            mi: command('mi', 2),
        };

        const result = apply_builtin_metadata_fallback(commands);

        expect(result.subcommands_fallback_count).toBe(2);
        expect(commands.frame.subcommands?.map(sub => sub.name)).toEqual([
            'create',
            'change',
            'copy',
            'drop',
            'rename',
            'put',
            'post',
            'dir',
            'reset',
            'list',
            'prefix',
        ]);
        expect(commands.mi.subcommands?.map(sub => sub.name)).toEqual([
            'set',
            'describe',
            'estimate',
            'impute',
            'register',
            'unregister',
            'passive',
            'varying',
            'convert',
            'export',
            'import',
            'merge',
            'append',
            'expand',
            'reshape',
            'update',
            'xeq',
        ]);
    });

    test('does not overwrite extracted subcommands', () => {
        const commands: Record<string, CommandInfo> = {
            file: {
                ...command('file', 1),
                subcommands: [{ name: 'custom', min_abbreviation: 3 }],
            },
        };

        const result = apply_builtin_metadata_fallback(commands);

        expect(result.subcommands_fallback_count).toBe(0);
        expect(commands.file.subcommands).toEqual([
            { name: 'custom', min_abbreviation: 3 },
        ]);
    });
});
