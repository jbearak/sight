import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as crypto from 'crypto';

export interface ExecutableInfo {
    path: string;
    version: string;
    architecture: 'x64' | 'arm64';
}

export interface DownloadResult {
    success: boolean;
    path?: string;
    error?: string;
}

export const CURRENT_EXE_VERSION = '0.1.11';
export const CHECKSUMS: Record<string, string> = {
    'x64':   '2c7becace23c10f4f888f7f61eedfde8108f4e16ce21c1f8a8b625038a22c1d6',
    'arm64': 'aa1fd6dfd2e14bcc2fdb2d06b4ca950ef5ecd5891bd7de0a833b12dc46feb20a',
};
const BASE_URL = 'https://raw.githubusercontent.com/jbearak/zed-stata/365ced02951833e43d4d7a5be73e61dbe73ab5f4';

export function get_windows_architecture(): 'x64' | 'arm64' {
    return process.env.PROCESSOR_ARCHITECTURE === 'ARM64' ? 'arm64' : 'x64';
}

export function get_executable_info(context: vscode.ExtensionContext): ExecutableInfo | null {
    const exe_path = path.join(context.globalStorageUri.fsPath, 'send-to-stata', 'send-to-stata.exe');
    const version_path = path.join(context.globalStorageUri.fsPath, 'send-to-stata', 'version.json');
    
    if (!fs.existsSync(exe_path) || !fs.existsSync(version_path)) {
        return null;
    }
    
    try {
        const version_data = JSON.parse(fs.readFileSync(version_path, 'utf8'));
        return {
            path: exe_path,
            version: version_data.version,
            architecture: version_data.architecture
        };
    } catch {
        return null;
    }
}

export async function prompt_download(): Promise<boolean> {
    const result = await vscode.window.showInformationMessage(
        'Windows support for send-to-stata requires downloading a helper executable (~1.7 MB).',
        'Download',
        'Cancel'
    );
    return result === 'Download';
}

export async function download_executable(context: vscode.ExtensionContext): Promise<DownloadResult> {
    const architecture = get_windows_architecture();
    const url = `${BASE_URL}/send-to-stata-${architecture}.exe`;
    const storage_dir = path.join(context.globalStorageUri.fsPath, 'send-to-stata');
    const exe_path = path.join(storage_dir, 'send-to-stata.exe');
    const version_path = path.join(storage_dir, 'version.json');
    
    return vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Downloading send-to-stata executable...',
        cancellable: false
    }, async (progress) => {
        try {
            // Ensure directory exists
            fs.mkdirSync(storage_dir, { recursive: true });
            
            // Download file with timeout and size limits
            const data = await new Promise<Buffer>((resolve, reject) => {
                const max_size_bytes = 5 * 1024 * 1024; // 5MB limit
                let total_size = 0;
                
                const request = https.get(url, { timeout: 30000 }, (response) => {
                    if (response.statusCode !== 200) {
                        reject(new Error(`HTTP ${response.statusCode}`));
                        return;
                    }
                    
                    const the_chunks: Buffer[] = [];
                    response.on('data', (chunk) => {
                        total_size += chunk.length;
                        if (total_size > max_size_bytes) {
                            request.destroy();
                            reject(new Error('Download size exceeds 5MB limit'));
                            return;
                        }
                        the_chunks.push(chunk);
                    });
                    response.on('end', () => resolve(Buffer.concat(the_chunks)));
                });
                
                request.on('timeout', () => {
                    request.destroy();
                    reject(new Error('Download timeout'));
                });
                request.on('error', reject);
            });
            
            // Verify checksum
            const hash = crypto.createHash('sha256').update(data).digest('hex');
            if (hash !== CHECKSUMS[architecture]) {
                return { success: false, error: 'Checksum verification failed' };
            }
            
            // Write files
            fs.writeFileSync(exe_path, data);
            fs.writeFileSync(version_path, JSON.stringify({
                version: CURRENT_EXE_VERSION,
                architecture
            }));
            
            return { success: true, path: exe_path };
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    });
}

export function check_for_updates(context: vscode.ExtensionContext): boolean {
    const info = get_executable_info(context);
    return info ? info.version !== CURRENT_EXE_VERSION : true;
}

