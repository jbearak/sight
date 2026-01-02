/**
 * Integration Tests for Import Verification
 *
 * Validates that all production source files use the new command-database module
 * and do not import from the legacy ./commands module.
 *
 * **Validates: Requirements 4.1, 4.2, 4.3, 4.4**
 */

import { describe, it, expect } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * Recursively get all TypeScript files in a directory.
 */
function get_typescript_files(dir_path: string, base_path: string = dir_path): string[] {
    const the_files: string[] = [];
    const the_entries = readdirSync(dir_path);

    for (const my_entry of the_entries) {
        const my_full_path = join(dir_path, my_entry);
        const my_stat = statSync(my_full_path);

        if (my_stat.isDirectory()) {
            // Skip node_modules and dist directories
            if (my_entry !== 'node_modules' && my_entry !== 'dist') {
                the_files.push(...get_typescript_files(my_full_path, base_path));
            }
        } else if (my_entry.endsWith('.ts') && !my_entry.endsWith('.d.ts')) {
            the_files.push(relative(base_path, my_full_path));
        }
    }

    return the_files;
}

/**
 * Check if a file imports from the legacy commands module.
 * Returns the import statements found, or empty array if none.
 */
function find_legacy_imports(file_path: string): string[] {
    const content = readFileSync(file_path, 'utf-8');
    const the_legacy_imports: string[] = [];

    // Match import statements that reference ./commands or ../commands
    // but NOT ./command-database or ../command-database
    const import_pattern = /import\s+.*\s+from\s+['"]([^'"]+)['"]/g;
    let my_match: RegExpExecArray | null;

    while ((my_match = import_pattern.exec(content)) !== null) {
        const import_path = my_match[1];
        
        // Check if this is a legacy commands import
        // Match patterns like './commands', '../commands', '../../commands', etc.
        // But exclude 'command-database' imports
        if (
            (import_path.includes('/commands') || import_path === './commands' || import_path === '../commands') &&
            !import_path.includes('command-database')
        ) {
            the_legacy_imports.push(my_match[0]);
        }
    }

    return the_legacy_imports;
}

describe('Import Verification', () => {
    const src_path = join(__dirname, '../../src');
    const tests_path = join(__dirname, '../../tests');

    it('should not have any non-test source files importing from legacy ./commands', () => {
        const the_source_files = get_typescript_files(src_path);
        const the_violations: { file: string; imports: string[] }[] = [];

        for (const my_file of the_source_files) {
            const my_full_path = join(src_path, my_file);
            const my_legacy_imports = find_legacy_imports(my_full_path);

            if (my_legacy_imports.length > 0) {
                the_violations.push({
                    file: my_file,
                    imports: my_legacy_imports,
                });
            }
        }

        if (the_violations.length > 0) {
            console.error('Source files with legacy ./commands imports:');
            for (const my_violation of the_violations) {
                console.error(`  ${my_violation.file}:`);
                for (const my_import of my_violation.imports) {
                    console.error(`    ${my_import}`);
                }
            }
        }

        expect(the_violations).toEqual([]);
    });

    it('should have completion.ts importing from command-database', () => {
        const completion_path = join(src_path, 'providers/completion.ts');
        const content = readFileSync(completion_path, 'utf-8');

        // Check for command-database import
        const has_command_db_import = content.includes("from '../command-database'") ||
                                       content.includes('from "../command-database"');

        expect(has_command_db_import).toBe(true);
    });

    it('should have hover.ts importing from command-database', () => {
        const hover_path = join(src_path, 'providers/hover.ts');
        const content = readFileSync(hover_path, 'utf-8');

        // Check for command-database import
        const has_command_db_import = content.includes("from '../command-database'") ||
                                       content.includes('from "../command-database"');

        expect(has_command_db_import).toBe(true);
    });

    it('should have server-factory.ts importing from command-database', () => {
        const server_factory_path = join(src_path, 'server-factory.ts');
        const content = readFileSync(server_factory_path, 'utf-8');

        // Check for command-database import
        const has_command_db_import = content.includes("from './command-database'") ||
                                       content.includes('from "./command-database"');

        expect(has_command_db_import).toBe(true);
    });

    it('should have server.ts NOT importing from ./commands', () => {
        const server_path = join(src_path, 'server.ts');
        const legacy_imports = find_legacy_imports(server_path);

        expect(legacy_imports).toEqual([]);
    });

    it('should have server-factory.ts NOT importing from ./commands', () => {
        const server_factory_path = join(src_path, 'server-factory.ts');
        const legacy_imports = find_legacy_imports(server_factory_path);

        expect(legacy_imports).toEqual([]);
    });

    it('test files may import from legacy ./commands for validation purposes', () => {
        // This test documents that test files ARE allowed to import from
        // the legacy commands module for validation/comparison purposes
        const superset_test_path = join(tests_path, 'integration/command-database-superset.test.ts');
        const content = readFileSync(superset_test_path, 'utf-8');

        // The superset test should import from builtin-commands for comparison
        const has_legacy_import = content.includes('builtin-commands');

        expect(has_legacy_import).toBe(true);
    });
});
