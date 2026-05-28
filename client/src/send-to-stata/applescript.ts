import { exec } from 'child_process';
import { StataVariant, StataCommand } from './index.js';

const VALID_STATA_APPS: readonly StataVariant[] = [
    'StataMP', 'StataSE', 'StataBE', 'StataIC', 'Stata'
];
const VALID_COMMANDS: readonly StataCommand[] = ['do', 'include'];

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
    temp_file_path: string,
    focus_stata: boolean
): Promise<void> {
    // Validate stata_app against allowed values
    if (!VALID_STATA_APPS.includes(stata_app)) {
        return Promise.reject(new Error(
            `Invalid Stata application: "${stata_app}". ` +
            `Must be one of: ${VALID_STATA_APPS.join(', ')}`
        ));
    }
    
    // Validate command against allowed values
    if (!VALID_COMMANDS.includes(command)) {
        return Promise.reject(new Error(
            `Invalid command: "${command}". Must be one of: ${VALID_COMMANDS.join(', ')}`
        ));
    }
    
    return new Promise((resolve, reject) => {
        const escaped_path = escape_for_applescript(temp_file_path);
        let applescript_cmd = `tell application "${stata_app}" to ` +
            `DoCommandAsync "${command} \\"${escaped_path}\\""`;
        
        // Only activate Stata if requested; otherwise focus stays in the calling
        // app naturally (no need to explicitly activate the editor by name)
        if (focus_stata) {
            applescript_cmd += `\ntell application "${stata_app}" to activate`;
        }
        
        // Shell escaping for single quotes using POSIX-standard pattern: '\''
        // This works by: ending the single-quoted string ('), adding an escaped
        // single quote (\\'), then starting a new single-quoted string (').
        // Example: "user's" becomes 'user'\''s' which the shell interprets as: user's
        // This is safe because the entire command is wrapped in single quotes,
        // preventing any shell interpretation of special characters.
        const shell_safe_cmd = applescript_cmd.replace(/'/g, "'\\''");
        exec(`osascript -e '${shell_safe_cmd}'`, (error) => {
            if (error) {
                reject(error);
            } else {
                resolve();
            }
        });
    });
}