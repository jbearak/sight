import { describe, test, expect } from 'bun:test';
import * as fc from 'fast-check';
import { escape_for_applescript } from '../../client/src/send-to-stata/applescript';
import { StataVariant, StataCommand } from '../../client/src/send-to-stata/index';

/**
 * Property-based tests for AppleScript execution in send-to-stata.
 * 
 * Feature: send-to-stata
 * Property 3: AppleScript Path Escaping
 * Property 4: AppleScript Command Generation
 * Validates: Requirements 1.6, 1.7, 3.3
 */

// Helper to generate AppleScript command (mirrors implementation logic)
function generate_applescript_command(
    stata_app: StataVariant,
    command: StataCommand,
    temp_file_path: string
): string {
    const escaped_path = escape_for_applescript(temp_file_path);
    return `tell application "${stata_app}" to ` +
        `DoCommandAsync "${command} \\"${escaped_path}\\""`;
}

describe('Feature: send-to-stata - AppleScript Properties', () => {
    // Generator for file paths with special characters
    const path_gen = fc.oneof(
        fc.constant('/tmp/stata_send_123.do'),
        fc.constant('/Users/test/My Documents/file.do'),
        fc.constant('/path/with spaces/test.do'),
        fc.constant('/path/with"quote/test.do'),
        fc.constant('/path/with\\backslash/test.do'),
        fc.constant('/path/with"quote\\and\\backslash/test.do'),
        fc.stringOf(
            fc.oneof(
                fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789/_-.'),
                fc.constant(' '),
                fc.constant('"'),
                fc.constant('\\')
            ),
            { minLength: 5, maxLength: 100 }
        ).map(s => '/tmp/' + s + '.do')
    );

    // Generator for Stata variants
    const variant_gen = fc.constantFrom<StataVariant>(
        'StataMP', 'StataSE', 'StataIC', 'Stata'
    );

    // Generator for Stata commands
    const command_gen = fc.constantFrom<StataCommand>('do', 'include');

    test('Property 3: Backslashes are escaped', () => {
        fc.assert(fc.property(
            fc.string({ minLength: 0, maxLength: 50 }),
            (content) => {
                const path_with_backslash = `/tmp/${content}\\test.do`;
                const escaped = escape_for_applescript(path_with_backslash);
                
                // Original backslash should be escaped to double backslash
                expect(escaped).toContain('\\\\');
                // No unescaped single backslashes (except as part of \\)
                const unescaped_count = (escaped.match(/(?<!\\)\\(?!\\)/g) || []).length;
                expect(unescaped_count).toBe(0);
            }
        ), { numRuns: 50 });
    });

    test('Property 3: Double quotes are escaped', () => {
        fc.assert(fc.property(
            fc.string({ minLength: 0, maxLength: 50 }),
            (content) => {
                const path_with_quote = `/tmp/${content}"test.do`;
                const escaped = escape_for_applescript(path_with_quote);
                
                // Original quote should be escaped
                expect(escaped).toContain('\\"');
                // No unescaped quotes
                const unescaped_quotes = (escaped.match(/(?<!\\)"/g) || []).length;
                expect(unescaped_quotes).toBe(0);
            }
        ), { numRuns: 50 });
    });

    test('Property 3: Paths without special chars unchanged', () => {
        const simple_paths = [
            '/tmp/test.do',
            '/Users/user/Documents/analysis.do',
            '/Applications/Stata/test.do'
        ];

        for (const my_path of simple_paths) {
            expect(escape_for_applescript(my_path)).toBe(my_path);
        }
    });

    test('Property 3: Escaping is idempotent for already-safe paths', () => {
        fc.assert(fc.property(
            fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789/_-.')),
            (safe_content) => {
                const safe_path = `/tmp/${safe_content}.do`;
                const escaped = escape_for_applescript(safe_path);
                expect(escaped).toBe(safe_path);
            }
        ), { numRuns: 50 });
    });

    test('Property 4: Command uses correct Stata application name', () => {
        fc.assert(fc.property(
            variant_gen,
            command_gen,
            path_gen,
            (variant, command, path) => {
                const applescript = generate_applescript_command(variant, command, path);
                expect(applescript).toContain(`tell application "${variant}"`);
            }
        ), { numRuns: 100 });
    });

    test('Property 4: Command uses correct Stata command (do or include)', () => {
        fc.assert(fc.property(
            variant_gen,
            command_gen,
            path_gen,
            (variant, command, path) => {
                const applescript = generate_applescript_command(variant, command, path);
                expect(applescript).toContain(`DoCommandAsync "${command}`);
            }
        ), { numRuns: 100 });
    });

    test('Property 4: Command includes escaped path', () => {
        fc.assert(fc.property(
            variant_gen,
            command_gen,
            path_gen,
            (variant, command, path) => {
                const applescript = generate_applescript_command(variant, command, path);
                const escaped_path = escape_for_applescript(path);
                expect(applescript).toContain(escaped_path);
            }
        ), { numRuns: 100 });
    });

    test('Property 4: Command follows expected format', () => {
        const applescript = generate_applescript_command(
            'StataMP',
            'do',
            '/tmp/test.do'
        );
        expect(applescript).toBe(
            'tell application "StataMP" to DoCommandAsync "do \\"/tmp/test.do\\""'
        );
    });

    test('Property 4: Include command format', () => {
        const applescript = generate_applescript_command(
            'StataSE',
            'include',
            '/tmp/test.do'
        );
        expect(applescript).toBe(
            'tell application "StataSE" to DoCommandAsync "include \\"/tmp/test.do\\""'
        );
    });

    test('Property 3: Complex path with multiple special chars', () => {
        const complex_path = '/Users/test/"My\\Documents"/file.do';
        const escaped = escape_for_applescript(complex_path);
        expect(escaped).toBe('/Users/test/\\"My\\\\Documents\\"/file.do');
    });

    test('Property 3: Unicode characters preserved', () => {
        const unicode_path = '/tmp/文件/données/αβγ.do';
        const escaped = escape_for_applescript(unicode_path);
        expect(escaped).toBe(unicode_path);
    });
});
