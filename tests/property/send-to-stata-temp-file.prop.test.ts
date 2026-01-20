import { describe, test, expect, afterAll } from 'bun:test';
import * as fc from 'fast-check';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { create_temp_file, get_temp_dir } from '../../client/src/send-to-stata/temp-file';

/**
 * Property-based tests for temp file creation in send-to-stata.
 * 
 * Feature: send-to-stata
 * Property 2: Temp File Creation
 * Validates: Requirements 1.5, 12.1, 12.2, 12.4
 */

// Track created files for cleanup
const created_files: string[] = [];

afterAll(async () => {
    // Clean up test files
    for (const my_file of created_files) {
        try {
            await fs.unlink(my_file);
        } catch {
            // Ignore cleanup errors
        }
    }
});

describe('Feature: send-to-stata - Temp File Creation Properties', () => {
    test('Property 2: get_temp_dir returns system temp directory', () => {
        const temp_dir = get_temp_dir();
        expect(temp_dir).toBe(os.tmpdir());
    });

    test('Property 2: Temp file is created in system temp directory', async () => {
        await fc.assert(fc.asyncProperty(
            fc.string({ minLength: 0, maxLength: 100 }),
            async (content) => {
                const file_path = await create_temp_file(content);
                created_files.push(file_path);

                const dir = path.dirname(file_path);
                expect(dir).toBe(os.tmpdir());
            }
        ), { numRuns: 10 });
    });

    test('Property 2: Temp file has .do extension', async () => {
        await fc.assert(fc.asyncProperty(
            fc.string({ minLength: 0, maxLength: 100 }),
            async (content) => {
                const file_path = await create_temp_file(content);
                created_files.push(file_path);

                expect(file_path.endsWith('.do')).toBe(true);
            }
        ), { numRuns: 10 });
    });

    test('Property 2: Temp file contains exact content', async () => {
        await fc.assert(fc.asyncProperty(
            fc.string({ minLength: 0, maxLength: 500 }),
            async (content) => {
                const file_path = await create_temp_file(content);
                created_files.push(file_path);

                const read_content = await fs.readFile(file_path, 'utf8');
                expect(read_content).toBe(content);
            }
        ), { numRuns: 20 });
    });

    test('Property 2: Unique filenames for concurrent executions', async () => {
        const content = 'display "test"';
        const the_paths: string[] = [];

        // Create multiple files concurrently
        const the_promises = Array.from({ length: 10 }, () =>
            create_temp_file(content)
        );
        const results = await Promise.all(the_promises);

        for (const my_path of results) {
            created_files.push(my_path);
            the_paths.push(my_path);
        }

        // All paths should be unique
        const unique_paths = new Set(the_paths);
        expect(unique_paths.size).toBe(the_paths.length);
    });

    test('Property 2: Filename follows expected pattern', async () => {
        const file_path = await create_temp_file('test content');
        created_files.push(file_path);

        const filename = path.basename(file_path);
        // Pattern: stata_send_${random_hex}.do (32 hex chars from 16 random bytes)
        const pattern = /^stata_send_[0-9a-f]{32}\.do$/;
        expect(pattern.test(filename)).toBe(true);
    });

    test('Property 2: Stata code content is preserved', async () => {
        const stata_code = `
local x = 1
display "Hello, World!"
gen y = x + 2 ///
    if condition
summarize y
`;
        const file_path = await create_temp_file(stata_code);
        created_files.push(file_path);

        const read_content = await fs.readFile(file_path, 'utf8');
        expect(read_content).toBe(stata_code);
    });
});
