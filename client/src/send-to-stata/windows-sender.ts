import * as vscode from 'vscode';
import * as child_process from 'child_process';
import { StataCommand } from './index';
import { 
    get_executable_info, 
    prompt_download, 
    download_executable, 
    check_for_updates 
} from './exe-downloader';

export interface WindowsSendResult {
    success: boolean;
    error_message?: string;
}

export async function ensure_executable(context: vscode.ExtensionContext): Promise<string | null> {
    let info = get_executable_info(context);
    
    if (!info) {
        const should_download = await prompt_download();
        if (!should_download) {
            return null;
        }
        
        const result = await download_executable(context);
        if (!result.success) {
            vscode.window.showErrorMessage(`Failed to download executable: ${result.error}`);
            return null;
        }
        
        info = get_executable_info(context);
        if (!info) {
            return null;
        }
    } else if (check_for_updates(context)) {
        const should_update = await vscode.window.showInformationMessage(
            'A newer version of the send-to-stata executable is available.',
            'Update',
            'Skip'
        );
        
        if (should_update === 'Update') {
            const result = await download_executable(context);
            if (!result.success) {
                vscode.window.showErrorMessage(`Failed to update executable: ${result.error}`);
            } else {
                info = get_executable_info(context);
                if (!info) {
                    return null;
                }
            }
        }
    }
    
    return info.path;
}

export function map_exit_code_to_message(code: number, stderr: string): string {
    switch (code) {
        case 1: return 'Invalid arguments';
        case 2: return 'File not found';
        case 3: return 'Failed to create temp file';
        case 4: return 'No running Stata instance found. Start Stata before sending code.';
        case 5: return 'Failed to send keystrokes. Ensure Stata is not running as Administrator.';
        default: return stderr || `Unknown error (exit code ${code})`;
    }
}

export function check_automation_error(stderr: string): boolean {
    const lower = stderr.toLowerCase();
    return lower.includes('automation') || 
           lower.includes('80040154') || 
           lower.includes('regdb_e_classnotreg');
}

export async function send_to_stata_windows(
    command: StataCommand, 
    temp_file_path: string, 
    context: vscode.ExtensionContext
): Promise<void> {
    const exe_path = await ensure_executable(context);
    if (!exe_path) {
        throw new Error('Executable not available');
    }
    
    const config = vscode.workspace.getConfiguration('sight.sendToStata');
    const focus_stata = config.get<boolean>('focusStataWindow', false);
    
    const args = ['-FileMode', '-File', temp_file_path];
    
    if (command === 'include') {
        args.push('-Include');
    }
    
    if (focus_stata) {
        args.push('-ActivateStata');
    }
    
    return new Promise((resolve, reject) => {
        const process = child_process.spawn(exe_path, args);
        let stderr_data = '';
        
        process.stderr.on('data', (data) => {
            stderr_data += data.toString();
        });
        
        process.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                const error_message = map_exit_code_to_message(code || -1, stderr_data);
                
                if (check_automation_error(stderr_data)) {
                    vscode.window.showErrorMessage(
                        'COM automation registration error. Stata may need to be registered.',
                        'Copy Command'
                    ).then(selection => {
                        if (selection === 'Copy Command') {
                            vscode.env.clipboard.writeText('"C:\\Program Files\\Stata18\\StataSE-64.exe" /Register');
                        }
                    });
                }
                
                reject(new Error(error_message));
            }
        });
        
        process.on('error', (error) => {
            reject(new Error(`Failed to spawn process: ${error.message}`));
        });
    });
}