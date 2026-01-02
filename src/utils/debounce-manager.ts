/**
 * Debounce Manager for batching rapid document changes.
 * Prevents excessive re-parsing by coalescing multiple edits within a
 * configurable window, with backpressure handling and metrics tracking.
 */

import { logger } from './logger';

/**
 * Interface for debounce manager operations.
 */
export interface DebounceManager {
    /**
     * Schedule a document validation after debounce window.
     * Cancels any pending validation for the same URI.
     */
    schedule_validation(
        uri: string,
        version: number,
        callback: () => Promise<void>
    ): void;

    /**
     * Cancel pending validation for a document.
     */
    cancel(uri: string): void;

    /**
     * Clean up when document is closed.
     */
    on_close(uri: string): void;

    /**
     * Get debounce window in milliseconds.
     */
    get_debounce_ms(): number;

    /**
     * Set debounce window in milliseconds.
     */
    set_debounce_ms(ms: number): void;

    /**
     * Check if a document has a pending parse (in debounce or queue).
     * Used to determine if diagnostics request should wait or use cached.
     */
    is_pending(uri: string): boolean;

    /**
     * Get current metrics.
     */
    get_metrics(): DebounceMetrics;
}

/**
 * Metrics tracked by the debounce manager.
 */
export interface DebounceMetrics {
    merged_parses: number;      // Parses avoided due to debounce
    dropped_parses: number;     // Parses dropped due to queue full
    stale_parses: number;       // Parses skipped due to version staleness
}

/**
 * Internal queue item for pending parses.
 */
interface ParseQueueItem {
    uri: string;
    version: number;
    callback: () => Promise<void>;
}

/**
 * DocumentDebounceManager implements debouncing for document validation.
 *
 * Features:
 * - Batches rapid document changes within a configurable window
 * - Manages concurrent parse operations with backpressure
 * - Tracks version staleness to skip obsolete parses
 * - Auto-scales max_concurrent_parses based on CPU cores
 * - Provides metrics for monitoring and debugging
 */
export class DocumentDebounceManager implements DebounceManager {
    private pending_timers: Map<string, NodeJS.Timeout> = new Map();
    // Spec compliance: debounce window defaults to 100ms.
    private debounce_ms: number = 100;
    private active_parses: number = 0;
    private max_concurrent_parses: number;
    private readonly MAX_QUEUE_LENGTH = 20;
    private parse_queue: ParseQueueItem[] = [];
    private current_versions: Map<string, number> = new Map();

    // Metrics
    private metrics: DebounceMetrics = {
        merged_parses: 0,      // Parses avoided due to debounce
        dropped_parses: 0,     // Parses dropped due to queue full
        stale_parses: 0,       // Parses skipped due to version staleness
    };

    /**
     * Create a new DocumentDebounceManager.
     *
     * @param config Optional configuration
     * @param config.max_concurrent_parses Maximum concurrent parses
     *        (default: auto-scaled based on CPU cores)
     */
    constructor(config?: { max_concurrent_parses?: number }) {
        // Default to min(2, cores/2), prefer os.cpus() for Node.js LSP
        let cpu_count = 2;
        try {
            // Node.js environment
            cpu_count = require('os').cpus().length;
        } catch {
            // Browser environment (unlikely for LSP, but safe fallback)
            const nav = (globalThis as { navigator?: { hardwareConcurrency?: number } }).navigator;
            if (nav?.hardwareConcurrency) {
                cpu_count = nav.hardwareConcurrency;
            }
        }
        this.max_concurrent_parses =
            config?.max_concurrent_parses ??
            Math.max(1, Math.min(2, Math.floor(cpu_count / 2)));
    }

    /**
     * Schedule a document validation after debounce window.
     * Cancels any pending validation for the same URI.
     */
    schedule_validation(
        uri: string,
        version: number,
        callback: () => Promise<void>
    ): void {
        // Track current version for staleness check
        const prev_version = this.current_versions.get(uri);
        this.current_versions.set(uri, version);

        // If we're replacing a pending timer, count as merged
        if (this.pending_timers.has(uri)) {
            this.metrics.merged_parses++;
        }

        // Cancel existing timer for this URI
        this.cancel(uri);

        // Schedule new timer
        const timer = setTimeout(() => {
            this.pending_timers.delete(uri);
            this.enqueue_parse(uri, version, callback);
        }, this.debounce_ms);

        this.pending_timers.set(uri, timer);
    }

    /**
     * Internal: Enqueue a parse for execution.
     * Executes immediately if capacity available, otherwise queues.
     */
    private enqueue_parse(
        uri: string,
        version: number,
        callback: () => Promise<void>
    ): void {
        // Drop if queue is full (backpressure)
        if (this.parse_queue.length >= this.MAX_QUEUE_LENGTH) {
            logger.warn(
                `Parse queue full, dropping ${uri} v${version}`
            );
            this.metrics.dropped_parses++;
            return;
        }

        if (this.active_parses < this.max_concurrent_parses) {
            // Fire and forget, but handle errors
            this.execute_parse(uri, version, callback).catch((err) => {
                logger.error(`Parse failed for ${uri}: ${err}`);
            });
        } else {
            // Queue for later execution (backpressure)
            this.parse_queue.push({ uri, version, callback });
        }
    }

    /**
     * Internal: Execute a parse operation.
     * Handles version staleness checks and error handling.
     */
    private async execute_parse(
        uri: string,
        version: number,
        callback: () => Promise<void>
    ): Promise<void> {
        // Version guard: skip if stale
        const current = this.current_versions.get(uri);
        if (current !== undefined && version < current) {
            logger.debug(
                `Skipping stale parse for ${uri} v${version} ` +
                    `(current: v${current})`
            );
            this.metrics.stale_parses++;
            return;
        }

        this.active_parses++;
        try {
            // Yield to event loop before starting parse
            await new Promise((resolve) => setImmediate(resolve));
            await callback();
        } catch (error) {
            // Log but don't rethrow - parse failures shouldn't crash server
            logger.error(`Parse error for ${uri}: ${error}`);
        } finally {
            this.active_parses--;
            this.process_queue();
        }
    }

    /**
     * Internal: Process queued parses.
     * Removes stale items and executes next item if capacity available.
     */
    private process_queue(): void {
        // Remove stale items from queue
        const before_length = this.parse_queue.length;
        this.parse_queue = this.parse_queue.filter((item) => {
            const current = this.current_versions.get(item.uri);
            return current === undefined || item.version >= current;
        });
        this.metrics.stale_parses += before_length - this.parse_queue.length;

        if (
            this.parse_queue.length > 0 &&
            this.active_parses < this.max_concurrent_parses
        ) {
            const next = this.parse_queue.shift()!;
            // Fire and forget with error handling
            this.execute_parse(next.uri, next.version, next.callback).catch(
                (err) => {
                    logger.error(
                        `Queued parse failed for ${next.uri}: ${err}`
                    );
                }
            );
        }
    }

    /**
     * Check if a document has a pending parse (in debounce or queue).
     * Used to determine if diagnostics request should wait or use cached.
     */
    is_pending(uri: string): boolean {
        return (
            this.pending_timers.has(uri) ||
            this.parse_queue.some((item) => item.uri === uri)
        );
    }

    /**
     * Cancel pending validation for a document.
     */
    cancel(uri: string): void {
        const existing = this.pending_timers.get(uri);
        if (existing) {
            clearTimeout(existing);
            this.pending_timers.delete(uri);
        }
        // Also remove from queue if pending
        this.parse_queue = this.parse_queue.filter(
            (item) => item.uri !== uri
        );
    }

    /**
     * Call when document is closed to clean up tracking.
     */
    on_close(uri: string): void {
        this.cancel(uri);
        this.current_versions.delete(uri);
    }

    /**
     * Get debounce window in milliseconds.
     */
    get_debounce_ms(): number {
        return this.debounce_ms;
    }

    /**
     * Set debounce window in milliseconds.
     */
    set_debounce_ms(ms: number): void {
        this.debounce_ms = ms;
    }

    /**
     * Get current metrics.
     */
    get_metrics(): DebounceMetrics {
        return { ...this.metrics };
    }
}
