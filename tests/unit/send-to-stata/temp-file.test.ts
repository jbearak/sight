import { describe, test, expect } from 'bun:test';
import * as fs from 'fs/promises';
import {
    create_temp_file,
    get_temp_dir,
    schedule_temp_file_cleanup
} from '../../../client/src/send-to-stata/temp-file';
import { is_editor_send_file } from '../../../src/console/editor-send-channel';

describe('Feature: send-to-stata temp file cleanup', () => {
    test('scheduled cleanup preserves the file until the delay elapses', async () => {
        const my_file_path = await create_temp_file('display "hello"');

        schedule_temp_file_cleanup(my_file_path, 25);

        const my_initial_content = await fs.readFile(my_file_path, 'utf8');
        expect(my_initial_content).toBe('display "hello"');

        await new Promise(resolve => setTimeout(resolve, 60));

        await expect(fs.readFile(my_file_path, 'utf8')).rejects.toMatchObject({
            code: 'ENOENT'
        });
    });

    // A console on a terminal deletes only files it can tell are
    // these (src/console/editor-send-channel.ts).
    test('temp files are named as the console expects', async () => {
        const my_file_path = await create_temp_file('display 1');
        try {
            expect(is_editor_send_file(my_file_path, get_temp_dir())).toBe(true);
        } finally {
            await fs.unlink(my_file_path);
        }
    });
});
