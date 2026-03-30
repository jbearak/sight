import { describe, test, expect } from 'bun:test';
import * as fs from 'fs/promises';
import {
    create_temp_file,
    schedule_temp_file_cleanup
} from '../../../client/src/send-to-stata/temp-file';

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
});
