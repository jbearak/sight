import { describe, test, expect } from 'bun:test';
import * as fs from 'fs/promises';
import {
    create_temp_file,
    hold_temp_file,
    release_temp_file,
    schedule_temp_file_cleanup
} from '../../../client/src/send-to-stata/temp-file';

/**
 * Wait for `file_path` to be removed. The removal follows a timer and
 * an asynchronous unlink, and a loaded Windows host can take well over
 * the timer's delay, so this polls instead of sleeping a fixed time.
 */
async function expect_removed(file_path: string): Promise<void> {
    const deadline_ms = Date.now() + 5000;
    for (;;) {
        try {
            await fs.readFile(file_path, 'utf8');
        } catch (error) {
            expect(error).toMatchObject({ code: 'ENOENT' });
            return;
        }
        if (Date.now() > deadline_ms) {
            throw new Error(`Still present after 5 s: ${file_path}`);
        }
        await new Promise(resolve => setTimeout(resolve, 10));
    }
}

describe('Feature: send-to-stata temp file cleanup', () => {
    test('scheduled cleanup preserves the file until the delay elapses', async () => {
        const my_file_path = await create_temp_file('display "hello"');

        schedule_temp_file_cleanup(my_file_path, 25);

        const my_initial_content = await fs.readFile(my_file_path, 'utf8');
        expect(my_initial_content).toBe('display "hello"');

        await expect_removed(my_file_path);
    });

    test('a held file outlives cleanup scheduled before its release', async () => {
        const my_file_path = await create_temp_file('display "held"');
        hold_temp_file(my_file_path);
        schedule_temp_file_cleanup(my_file_path, 10);
        await new Promise(resolve => setTimeout(resolve, 40));
        expect(await fs.readFile(my_file_path, 'utf8')).toBe('display "held"');

        // Released before a hand-off's cleanup fires: that cleanup
        // still leaves it, so the new delay counts from the release.
        schedule_temp_file_cleanup(my_file_path, 30);
        release_temp_file(my_file_path);
        await new Promise(resolve => setTimeout(resolve, 50));
        expect(await fs.readFile(my_file_path, 'utf8')).toBe('display "held"');

        schedule_temp_file_cleanup(my_file_path, 10);
        await expect_removed(my_file_path);
    });
});
