/**
 * Centralized logging service for Sight.
 *
 * Routes all production logs through the LSP client's log channel.
 * Provides verbosity control and graceful error handling.
 * Falls back to console.debug when no channel is provided (for CLI/tests).
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogChannelCallback = (message: string) => void;

export interface LoggerConfig {
    verbosity?: LogLevel;
    channel?: LogChannelCallback;
}

/**
 * Logger singleton for centralized logging.
 *
 * Usage:
 *   import { logger } from './utils/logger';
 *   logger.info('Message');
 *   logger.warn('Warning');
 *   logger.error('Error');
 */
class Logger {
    private static instance: Logger;
    private verbosity: LogLevel = 'info';
    private channel: LogChannelCallback;

    private constructor(config?: LoggerConfig) {
        if (config?.verbosity) {
            this.verbosity = config.verbosity;
        }
        this.channel = config?.channel || this.fallback_channel;
    }

    /**
     * Initialize the Logger singleton with configuration.
     * Should be called once during application startup.
     * Can be called after getInstance() to update configuration.
     */
    static initialize(config?: LoggerConfig): void {
        if (!Logger.instance) {
            Logger.instance = new Logger(config);
        } else if (config) {
            // Update existing instance with new configuration
            if (config.verbosity) {
                Logger.instance.verbosity = config.verbosity;
            }
            if (config.channel) {
                Logger.instance.channel = config.channel;
            }
        }
    }

    /**
     * Get the Logger singleton instance.
     * If not initialized, creates a default instance.
     */
    static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    /**
     * Log a debug message.
     * Only output if verbosity is set to 'debug'.
     */
    debug(message: string): void {
        if (this.should_log('debug')) {
            this.emit('debug', message);
        }
    }

    /**
     * Log an info message.
     * Output if verbosity is 'debug' or 'info'.
     */
    info(message: string): void {
        if (this.should_log('info')) {
            this.emit('info', message);
        }
    }

    /**
     * Log a warning message.
     * Output if verbosity is 'debug', 'info', or 'warn'.
     */
    warn(message: string): void {
        if (this.should_log('warn')) {
            this.emit('warn', message);
        }
    }

    /**
     * Log an error message.
     * Always output regardless of verbosity.
     */
    error(message: string): void {
        if (this.should_log('error')) {
            this.emit('error', message);
        }
    }

    /**
     * Check if a message at the given level should be logged.
     */
    private should_log(level: LogLevel): boolean {
        const level_order: LogLevel[] = ['debug', 'info', 'warn', 'error'];
        const verbosity_index = level_order.indexOf(this.verbosity);
        const message_index = level_order.indexOf(level);
        return message_index >= verbosity_index;
    }

    /**
     * Emit a log message through the configured channel.
     */
    private emit(level: LogLevel, message: string): void {
        try {
            const formatted_message = this.format_message(level, message);
            this.channel(formatted_message);
        } catch (error) {
            // Catch channel errors and log to console as last resort
            try {
                console.error(`Logger channel error: ${error}`);
            } catch {
                // Silently fail if even console.error fails
            }
        }
    }

    /**
     * Format a log message with timestamp and level.
     */
    private format_message(level: LogLevel, message: string): string {
        try {
            const timestamp = new Date().toISOString();
            const level_upper = level.toUpperCase();
            return `[${timestamp}] [${level_upper}] ${message}`;
        } catch (error) {
            // Fallback if formatting fails
            return `[ERROR] Failed to format message: ${message}`;
        }
    }

    /**
     * Fallback channel that uses console.debug.
     * Used when no channel is provided (for CLI/tests).
     */
    private fallback_channel: LogChannelCallback = (message: string) => {
        console.debug(message);
    };
}

// Export singleton instance
export const logger = Logger.getInstance();

// Export Logger class for testing
export { Logger };
