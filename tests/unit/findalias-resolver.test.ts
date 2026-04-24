/**
 * Unit tests for the FindaliasResolver.
 *
 * Points a resolver at temporary ado directories that contain small
 * hand-rolled `*smcl_alias.maint` files and asserts:
 *   * line parsing preserves the full SMCL payload
 *   * lookups are case-sensitive, trimmed, and return `null` on miss
 *   * the first search directory wins on duplicate aliases
 *   * cached results reflect on-disk edits (mtime invalidation)
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
    FindaliasResolver,
    HelpAliasResolver,
    parse_maint_file,
} from '../../src/utils/findalias-resolver';

describe('parse_maint_file', () => {
    it('parses a simple alias line', () => {
        const the_map = parse_maint_file(
            'frexp                    {manlink U 13 Functions and expressions}\n'
        );
        expect(the_map.get('frexp')).toBe(
            '{manlink U 13 Functions and expressions}'
        );
    });

    it('skips blank lines', () => {
        const the_map = parse_maint_file(
            '\n\nfrexp {manlink U 13}\n\n'
        );
        expect(the_map.size).toBe(1);
        expect(the_map.get('frexp')).toBe('{manlink U 13}');
    });

    it('keeps the first definition when an alias repeats', () => {
        const the_map = parse_maint_file(
            'frexp first\nfrexp second\n'
        );
        expect(the_map.get('frexp')).toBe('first');
    });

    it('treats keys as case-sensitive', () => {
        const the_map = parse_maint_file('Frexp Value\nfrexp other\n');
        expect(the_map.get('Frexp')).toBe('Value');
        expect(the_map.get('frexp')).toBe('other');
        expect(the_map.get('FREXP')).toBeUndefined();
    });
});

describe('FindaliasResolver', () => {
    let temp_dir: string;

    beforeEach(() => {
        temp_dir = fs.mkdtempSync(
            path.join(os.tmpdir(), 'sight-findalias-')
        );
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    function write_maint(
        ado_root: string,
        letter: string,
        lines: string[]
    ): string {
        const my_dir = path.join(ado_root, letter);
        fs.mkdirSync(my_dir, { recursive: true });
        const my_path = path.join(my_dir, `${letter}smcl_alias.maint`);
        fs.writeFileSync(my_path, lines.join('\n') + '\n');
        return my_path;
    }

    it('resolves an alias from fsmcl_alias.maint', () => {
        const my_ado = path.join(temp_dir, 'ado');
        write_maint(my_ado, 'f', [
            'frexp                    {manlink U 13 Functions and expressions}',
        ]);

        const resolver = new FindaliasResolver();
        resolver.set_search_dirs([my_ado]);

        expect(resolver.lookup('frexp')).toBe(
            '{manlink U 13 Functions and expressions}'
        );
    });

    it('returns null for an unknown alias', () => {
        const my_ado = path.join(temp_dir, 'ado');
        write_maint(my_ado, 'f', ['frexp payload']);

        const resolver = new FindaliasResolver();
        resolver.set_search_dirs([my_ado]);

        expect(resolver.lookup('unknown')).toBeNull();
    });

    it('returns null when no `.maint` file is found', () => {
        const resolver = new FindaliasResolver();
        resolver.set_search_dirs([path.join(temp_dir, 'does-not-exist')]);
        expect(resolver.lookup('frexp')).toBeNull();
    });

    it('trims whitespace from the looked-up alias', () => {
        const my_ado = path.join(temp_dir, 'ado');
        write_maint(my_ado, 'f', ['frexp payload']);

        const resolver = new FindaliasResolver();
        resolver.set_search_dirs([my_ado]);

        expect(resolver.lookup('  frexp  ')).toBe('payload');
    });

    it('treats alias lookups as case-sensitive', () => {
        const my_ado = path.join(temp_dir, 'ado');
        write_maint(my_ado, 'f', ['frexp lowercase_payload']);

        const resolver = new FindaliasResolver();
        resolver.set_search_dirs([my_ado]);

        expect(resolver.lookup('frexp')).toBe('lowercase_payload');
        expect(resolver.lookup('FREXP')).toBeNull();
        expect(resolver.lookup('Frexp')).toBeNull();
    });

    it('earlier search directory wins on duplicate aliases', () => {
        const my_ado_a = path.join(temp_dir, 'ado-a');
        const my_ado_b = path.join(temp_dir, 'ado-b');
        write_maint(my_ado_a, 'f', ['frexp from_a']);
        write_maint(my_ado_b, 'f', ['frexp from_b']);

        const resolver = new FindaliasResolver();
        resolver.set_search_dirs([my_ado_a, my_ado_b]);
        expect(resolver.lookup('frexp')).toBe('from_a');

        resolver.set_search_dirs([my_ado_b, my_ado_a]);
        expect(resolver.lookup('frexp')).toBe('from_b');
    });

    it('picks up on-disk edits via mtime invalidation', () => {
        const my_ado = path.join(temp_dir, 'ado');
        const my_file = write_maint(my_ado, 'f', ['frexp initial_payload']);

        const resolver = new FindaliasResolver();
        resolver.set_search_dirs([my_ado]);
        expect(resolver.lookup('frexp')).toBe('initial_payload');

        // Rewrite the file with a different mtime so the cache refreshes.
        const my_later_time = new Date(Date.now() + 5000);
        fs.writeFileSync(my_file, 'frexp updated_payload\n');
        fs.utimesSync(my_file, my_later_time, my_later_time);

        expect(resolver.lookup('frexp')).toBe('updated_payload');
    });

    it('does not scan non-smcl maint files', () => {
        const my_ado = path.join(temp_dir, 'ado');
        // Drop a help_alias.maint (which we intentionally ignore) next
        // to a valid smcl_alias.maint.
        const my_dir = path.join(my_ado, 'f');
        fs.mkdirSync(my_dir, { recursive: true });
        fs.writeFileSync(
            path.join(my_dir, 'fhelp_alias.maint'),
            'frexp   {manlink U 99 Should not be resolved}\n'
        );

        const resolver = new FindaliasResolver();
        resolver.set_search_dirs([my_ado]);
        expect(resolver.lookup('frexp')).toBeNull();
    });
});

describe('HelpAliasResolver', () => {
    let temp_dir: string;

    beforeEach(() => {
        temp_dir = fs.mkdtempSync(
            path.join(os.tmpdir(), 'sight-helpalias-')
        );
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    function write_help_alias(
        ado_root: string,
        letter: string,
        lines: string[]
    ): string {
        const my_dir = path.join(ado_root, letter);
        fs.mkdirSync(my_dir, { recursive: true });
        const my_path = path.join(my_dir, `${letter}help_alias.maint`);
        fs.writeFileSync(my_path, lines.join('\n') + '\n');
        return my_path;
    }

    it('resolves a help-topic redirect (operators → operator)', () => {
        const my_ado = path.join(temp_dir, 'ado');
        write_help_alias(my_ado, 'o', ['operators\t\toperator']);

        const resolver = new HelpAliasResolver();
        resolver.set_search_dirs([my_ado]);

        expect(resolver.lookup('operators')).toBe('operator');
    });

    it('returns null for an unknown alias', () => {
        const my_ado = path.join(temp_dir, 'ado');
        write_help_alias(my_ado, 'o', ['operators\t\toperator']);

        const resolver = new HelpAliasResolver();
        resolver.set_search_dirs([my_ado]);

        expect(resolver.lookup('nope')).toBeNull();
    });

    it('treats lookups as case-sensitive', () => {
        const my_ado = path.join(temp_dir, 'ado');
        write_help_alias(my_ado, 'o', ['operators operator']);

        const resolver = new HelpAliasResolver();
        resolver.set_search_dirs([my_ado]);

        expect(resolver.lookup('operators')).toBe('operator');
        expect(resolver.lookup('OPERATORS')).toBeNull();
    });

    it('does not cross-read from smcl_alias.maint', () => {
        // A stray entry in `*smcl_alias.maint` must not leak into
        // help-alias lookups.
        const my_ado = path.join(temp_dir, 'ado');
        const my_dir = path.join(my_ado, 'o');
        fs.mkdirSync(my_dir, { recursive: true });
        fs.writeFileSync(
            path.join(my_dir, 'osmcl_alias.maint'),
            'operators   {manlink U 99 Should not be resolved}\n'
        );

        const resolver = new HelpAliasResolver();
        resolver.set_search_dirs([my_ado]);
        expect(resolver.lookup('operators')).toBeNull();
    });

    it('earlier search directory wins on duplicate aliases', () => {
        const my_ado_a = path.join(temp_dir, 'ado-a');
        const my_ado_b = path.join(temp_dir, 'ado-b');
        write_help_alias(my_ado_a, 'o', ['operators from_a']);
        write_help_alias(my_ado_b, 'o', ['operators from_b']);

        const resolver = new HelpAliasResolver();
        resolver.set_search_dirs([my_ado_a, my_ado_b]);
        expect(resolver.lookup('operators')).toBe('from_a');

        resolver.set_search_dirs([my_ado_b, my_ado_a]);
        expect(resolver.lookup('operators')).toBe('from_b');
    });

    it('picks up on-disk edits via mtime invalidation', () => {
        const my_ado = path.join(temp_dir, 'ado');
        const my_file = write_help_alias(my_ado, 'o', [
            'operators initial',
        ]);

        const resolver = new HelpAliasResolver();
        resolver.set_search_dirs([my_ado]);
        expect(resolver.lookup('operators')).toBe('initial');

        const my_later_time = new Date(Date.now() + 5000);
        fs.writeFileSync(my_file, 'operators updated\n');
        fs.utimesSync(my_file, my_later_time, my_later_time);

        expect(resolver.lookup('operators')).toBe('updated');
    });
});
