/**
 * Send-to-Stata module for VS Code extension.
 * Provides functionality to send Stata code to Stata application (macOS) or terminal.
 */

// Core types
export type StataVariant = 'StataMP' | 'StataSE' | 'StataBE' | 'StataIC' | 'Stata';
export type StataCommand = 'do' | 'include';
export const VALID_COMMANDS: readonly StataCommand[] =
    ['do', 'include'];
export type SendTarget = 'app' | 'terminal';

// Module exports
export {
    StatementBounds,
    ends_with_continuation,
    detect_statement,
    get_statement_text,
    get_upward_bounds,
    get_downward_bounds
} from './statement-detector.js';

export {
    get_temp_dir,
    create_temp_file,
    schedule_temp_file_cleanup,
    DEFAULT_TEMP_FILE_CLEANUP_DELAY_MS
} from './temp-file.js';

export {
    detect_stata_app,
    clear_stata_cache
} from './stata-detector.js';

export {
    escape_for_applescript,
    send_to_stata_app
} from './applescript.js';

export {
    send_to_terminal
} from './terminal.js';

export {
    register_send_to_stata_commands,
    prepare_content_with_cd,
    set_language_client,
    resolve_effective_target,
    WorkingDirectoryOption,
    SendTargetSetting
} from './commands.js';

export {
    initialize_cd_context,
    register_cd_commands
} from './cd-context.js';

export {
    send_to_stata_windows,
    ensure_executable
} from './windows-sender.js';

export {
    register_open_in_stata
} from './open-in-stata.js';

export {
    detect_stata_cli,
    clear_stata_cli_cache
} from './stata-cli-detector.js';

export {
    register_stata_terminal,
    get_or_create_stata_terminal,
    send_to_stata_terminal
} from './stata-terminal-manager.js';
