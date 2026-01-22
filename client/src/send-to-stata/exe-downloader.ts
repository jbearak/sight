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

export const CURRENT_EXE_VERSION = '0.1.0';
const BASE_URL = 'https://github.com/jbearak/send-to-stata/releases/download/v0.1.0';

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

async function fetch_url(url: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const request = https.get(url, { timeout: 30000 }, (response) => {
            // Handle redirects (GitHub releases use them)
            if (response.statusCode === 302 || response.statusCode === 301) {
                const redirect_url = response.headers.location;
                if (redirect_url) {
                    fetch_url(redirect_url).then(resolve).catch(reject);
                    return;
                }
            }
            if (response.statusCode !== 200) {
                reject(new Error(`HTTP ${response.statusCode}`));
                return;
            }
            const chunks: Buffer[] = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => resolve(Buffer.concat(chunks)));
        });
        request.on('timeout', () => { request.destroy(); reject(new Error('Download timeout')); });
        request.on('error', reject);
    });
}

export async function download_executable(context: vscode.ExtensionContext): Promise<DownloadResult> {
    const architecture = get_windows_architecture();
    const exe_url = `${BASE_URL}/send-to-stata-${architecture}.exe`;
    const checksum_url = `${BASE_URL}/send-to-stata-${architecture}.exe.sha256`;
    const storage_dir = path.join(context.globalStorageUri.fsPath, 'send-to-stata');
    const exe_path = path.join(storage_dir, 'send-to-stata.exe');
    const version_path = path.join(storage_dir, 'version.json');
    
    return vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Downloading send-to-stata executable...',
        cancellable: false
    }, async () => {
        try {
            fs.mkdirSync(storage_dir, { recursive: true });
            
            // Fetch expected checksum
            const checksum_data = await fetch_url(checksum_url);
            const expected_hash = checksum_data.toString('utf8').trim().toLowerCase();
            
            // Download executable
            const data = await fetch_url(exe_url);
            if (data.length > 5 * 1024 * 1024) {
                return { success: false, error: 'Download size exceeds 5MB limit' };
            }
            
            // Verify checksum
            const actual_hash = crypto.createHash('sha256').update(data).digest('hex');
            if (actual_hash !== expected_hash) {
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
