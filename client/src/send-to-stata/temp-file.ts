import * as os from 'os';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

export function get_temp_dir(): string {
    return os.tmpdir();
}

const MAX_RETRY_ATTEMPTS = 5;

export async function create_temp_file(content: string): Promise<string> {
    for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
        const timestamp = Date.now();
        const random = crypto.randomInt(0, 1000000);
        const filename = `stata_send_${timestamp}_${random}.do`;
        const file_path = path.join(get_temp_dir(), filename);
        
        try {
            await fs.writeFile(file_path, content, { encoding: 'utf8', flag: 'wx' });
            return file_path;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
                // File already exists, retry with new random value
                continue;
            }
            throw error;
        }
    }
    
    throw new Error(
        `Failed to create temp file after ${MAX_RETRY_ATTEMPTS} attempts`
    );
}