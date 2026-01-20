import * as os from 'os';
import * as fs from 'fs/promises';
import * as path from 'path';

export function get_temp_dir(): string {
    return os.tmpdir();
}

export async function create_temp_file(content: string): Promise<string> {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    const filename = `stata_send_${timestamp}_${random}.do`;
    const file_path = path.join(get_temp_dir(), filename);
    
    await fs.writeFile(file_path, content, 'utf8');
    return file_path;
}