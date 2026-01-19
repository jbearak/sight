import { exec } from 'child_process';
import { StataVariant, StataCommand } from './index';

/**
 * Escapes a path for use in AppleScript string.
 */
export function escape_for_applescript(path: string): string {
    return path.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Sends a command to Stata via AppleScript.
 */
export function send_to_stata_app(
    stata_app: StataVariant,
    command: StataCommand,
    temp_file_path: string
): Promise<void> {
    return new Promise((resolve, reject) => {
        const escaped_path = escape_for_applescript(temp_file_path);
        const applescript_cmd = `tell application "${stata_app}" to ` +
            `DoCommandAsync "${command} \\"${escaped_path}\\""`;
        
        exec(`osascript -e "${applescript_cmd}"`, (error) => {
            if (error) {
                reject(error);
            } else {
                resolve();
            }
        });
    });
}