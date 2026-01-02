/**
 * File Rename Handler
 * 
 * Handles file rename operations with atomic save detection and delayed removal.
 * Detects when editors perform atomic saves (create temp file, rename to target)
 * and prevents premature cache invalidation.
 */

import { URI } from 'vscode-uri';

export interface AtomicSaveState {
    /** Timestamp when the file was deleted */
    deleted_at: number;
    /** Original file path that was deleted */
    original_path: string;
    /** Timer ID for delayed removal */
    timer_id: NodeJS.Timeout;
}

export class RenameHandler {
    private pending_removals = new Map<string, AtomicSaveState>();
    private readonly ATOMIC_SAVE_DELAY_MS = 100;

    constructor(
        private on_file_removed: (file_path: string) => void,
        private on_file_added: (file_path: string) => void,
        private log: (message: string) => void,
        private scope_resolver?: { invalidate_file_cache: (file_uri: string) => void; remove_uri_from_reverse_deps: (uri: string) => void }
    ) {}

    /**
     * Handle file system change events with atomic save detection.
     */
    handle_file_change(file_path: string, change_type: 'created' | 'changed' | 'deleted'): void {
        // Only handle Stata-related files
        if (!(
            file_path.endsWith('.do') ||
            file_path.endsWith('.ado') ||
            file_path.endsWith('.doh') ||
            file_path.endsWith('.mata')
        )) {
            return;
        }

        switch (change_type) {
            case 'deleted':
                this.handle_file_deleted(file_path);
                break;
            case 'created':
            case 'changed':
                this.handle_file_created_or_changed(file_path);
                break;
        }
    }

    private handle_file_deleted(file_path: string): void {
        // Cancel any existing removal for this file
        const existing = this.pending_removals.get(file_path);
        if (existing) {
            clearTimeout(existing.timer_id);
        }

        // Schedule delayed removal to detect atomic saves
        const timer_id = setTimeout(() => {
            this.pending_removals.delete(file_path);
            
            const file_uri = URI.file(file_path).toString();
            
            // Invalidate scope cache before removing file
            if (this.scope_resolver) {
                this.scope_resolver.invalidate_file_cache(file_uri);
                // Also remove from reverse deps (Req 1.5)
                this.scope_resolver.remove_uri_from_reverse_deps(file_uri);
            }
            
            this.on_file_removed(file_path);
            this.log(`File removed after delay: ${file_path}`);
        }, this.ATOMIC_SAVE_DELAY_MS);

        this.pending_removals.set(file_path, {
            deleted_at: Date.now(),
            original_path: file_path,
            timer_id,
        });

        this.log(`File deletion scheduled for removal: ${file_path}`);
    }

    private handle_file_created_or_changed(file_path: string): void {
        // Invalidate scope cache for changed/created file
        if (this.scope_resolver) {
            const file_uri = URI.file(file_path).toString();
            this.scope_resolver.invalidate_file_cache(file_uri);
        }

        // Check if this is an atomic save (file was recently deleted)
        const pending = this.pending_removals.get(file_path);
        if (pending) {
            // Cancel the removal - this was an atomic save
            clearTimeout(pending.timer_id);
            this.pending_removals.delete(file_path);
            this.log(`Atomic save detected, cancelling removal: ${file_path}`);
            
            // Treat as file change instead of removal + creation
            this.on_file_added(file_path);
        } else {
            // Normal file creation/change
            this.on_file_added(file_path);
        }
    }

    /**
     * Clean up any pending timers on shutdown.
     */
    dispose(): void {
        for (const state of this.pending_removals.values()) {
            clearTimeout(state.timer_id);
        }
        this.pending_removals.clear();
    }

    /**
     * Get current pending removals (for testing).
     */
    get_pending_removals(): ReadonlyMap<string, AtomicSaveState> {
        return this.pending_removals;
    }
}