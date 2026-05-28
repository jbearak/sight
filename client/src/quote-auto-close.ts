import {
    Disposable,
    Position,
    Range,
    Selection,
    TextDocument,
    TextDocumentChangeEvent,
    window,
    workspace,
    WorkspaceEdit,
    commands,
} from 'vscode';
import { compute_quote_auto_close, compute_deletion_cleanup } from './quote-auto-close-core.js';

/**
 * Maximum characters to look at before/after cursor for context.
 */
const MAX_CONTEXT_CHARS = 4;

/**
 * Recursion guard to prevent re-triggering on our own edits.
 */
let is_applying_edit = false;

/**
 * Cache of document line content for tracking deleted characters.
 * Maps URI string -> Map of line number -> line content.
 * This cache stores the line content BEFORE the current change,
 * so we can determine what character was deleted.
 */
const document_line_cache: Map<string, Map<number, string>> = new Map();

/**
 * Gets the cached line content for a document.
 * Returns the content that was there BEFORE the current change.
 */
function get_cached_line(the_document: TextDocument, my_line_number: number): string | undefined {
    const my_uri = the_document.uri.toString();
    const my_line_cache = document_line_cache.get(my_uri);
    if (my_line_cache && my_line_cache.has(my_line_number)) {
        return my_line_cache.get(my_line_number);
    }
    // If not cached, we can't know what was deleted
    return undefined;
}

/**
 * Updates the line cache for a document.
 * Should be called AFTER processing a change to store the new state
 * for the NEXT change.
 */
function update_line_cache(the_document: TextDocument, my_line_number: number): void {
    const my_uri = the_document.uri.toString();
    let my_line_cache = document_line_cache.get(my_uri);
    if (!my_line_cache) {
        my_line_cache = new Map();
        document_line_cache.set(my_uri, my_line_cache);
    }
    if (my_line_number < the_document.lineCount) {
        my_line_cache.set(my_line_number, the_document.lineAt(my_line_number).text);
    }
}

/**
 * Initializes the cache for a document by caching all lines.
 * Called when we first see a document to ensure we have the initial state.
 */
function initialize_document_cache(the_document: TextDocument): void {
    const my_uri = the_document.uri.toString();
    if (document_line_cache.has(my_uri)) {
        return; // Already initialized
    }
    const my_line_cache = new Map<number, string>();
    for (let i = 0; i < the_document.lineCount; i++) {
        my_line_cache.set(i, the_document.lineAt(i).text);
    }
    document_line_cache.set(my_uri, my_line_cache);
}

/**
 * Clears the cache for a document (called when document is closed).
 */
function clear_document_cache(my_uri: string): void {
    document_line_cache.delete(my_uri);
}

function clamp_to_document_end(the_document: TextDocument, the_position: Position): Position {
    const my_line = Math.min(the_position.line, the_document.lineCount - 1);
    const my_line_text = the_document.lineAt(my_line).text;
    const my_character = Math.min(the_position.character, my_line_text.length);
    return new Position(my_line, my_character);
}

function get_text_before_cursor(the_document: TextDocument, the_position: Position, my_max_chars: number): string {
    const my_pos = clamp_to_document_end(the_document, the_position);
    const my_start_character = Math.max(0, my_pos.character - my_max_chars);
    const my_range = new Range(my_pos.line, my_start_character, my_pos.line, my_pos.character);
    return the_document.getText(my_range);
}

function get_text_after_cursor(the_document: TextDocument, the_position: Position, my_max_chars: number): string {
    const my_pos = clamp_to_document_end(the_document, the_position);
    const my_line_text = the_document.lineAt(my_pos.line).text;
    const my_end_character = Math.min(my_line_text.length, my_pos.character + my_max_chars);
    const my_range = new Range(my_pos.line, my_pos.character, my_pos.line, my_end_character);
    return the_document.getText(my_range);
}

/**
 * Handles document changes to implement Stata quote auto-closing.
 * 
 * This listener fires AFTER the character is inserted by VS Code.
 * We detect Stata quote patterns and insert appropriate closing characters.
 */
async function handle_document_change(my_event: TextDocumentChangeEvent): Promise<void> {
    // Skip if we're applying our own edit (recursion guard)
    if (is_applying_edit) {
        return;
    }

    const my_document = my_event.document;

    // Only handle Stata files
    if (my_document.languageId !== 'stata') {
        return;
    }

    // Initialize cache if this is the first time we see this document
    initialize_document_cache(my_document);

    // Only handle single-character insertions and deletions
    if (my_event.contentChanges.length !== 1) {
        // Update cache for all affected lines
        for (const my_change of my_event.contentChanges) {
            update_line_cache(my_document, my_change.range.start.line);
        }
        return;
    }

    const my_change = my_event.contentChanges[0];
    const my_line_number = my_change.range.start.line;

    // Handle single character insertion
    if (my_change.text.length === 1 && my_change.rangeLength === 0) {
        // Get the active editor
        const my_editor = window.activeTextEditor;
        if (!my_editor || my_editor.document !== my_document) {
            // Update cache for next time
            update_line_cache(my_document, my_line_number);
            return;
        }
        await handle_character_insertion(my_document, my_change, my_editor);
        // Update cache after processing
        update_line_cache(my_document, my_line_number);
    }
    // Handle single character deletion (backspace/delete)
    else if (my_change.text.length === 0 && my_change.rangeLength === 1) {
        // Get the active editor
        const my_editor = window.activeTextEditor;
        if (!my_editor || my_editor.document !== my_document) {
            // Update cache for next time
            update_line_cache(my_document, my_line_number);
            return;
        }
        await handle_character_deletion(my_document, my_change, my_editor);
        // Update cache after processing
        update_line_cache(my_document, my_line_number);
    } else {
        // For other changes, just update the cache
        update_line_cache(my_document, my_line_number);
    }
}

async function handle_character_insertion(
    my_document: TextDocument,
    my_change: any,
    my_editor: any
): Promise<void> {
    const my_typed = my_change.text;

    // Only handle backtick, double quote, and apostrophe
    if (my_typed !== '`' && my_typed !== '"' && my_typed !== "'") {
        return;
    }

    // Only handle single cursor, empty selection
    if (my_editor.selections.length !== 1 || !my_editor.selection.isEmpty) {
        return;
    }

    // Calculate cursor position from the change event
    const my_cursor_pos = new Position(
        my_change.range.start.line,
        my_change.range.start.character + 1
    );

    // Get context around cursor
    const my_before = get_text_before_cursor(my_document, my_cursor_pos, MAX_CONTEXT_CHARS);
    const my_after = get_text_after_cursor(my_document, my_cursor_pos, MAX_CONTEXT_CHARS);

    // Compute what to insert
    const my_result = compute_quote_auto_close(my_typed, my_before, my_after);

    // Only apply our custom logic if we're handling a special case
    // Let VS Code's built-in autoClosingPairs handle simple cases
    if (!my_result.handled) {
        return;
    }

    await apply_auto_close_edit(my_document, my_editor, my_cursor_pos, my_result, my_typed);
}

async function handle_character_deletion(
    my_document: TextDocument,
    my_change: any,
    my_editor: any
): Promise<void> {
    // Only handle single cursor, empty selection
    if (my_editor.selections.length !== 1 || !my_editor.selection.isEmpty) {
        return;
    }

    // Current cursor position after deletion
    const my_cursor_pos = new Position(my_change.range.start.line, my_change.range.start.character);
    const my_line_number = my_change.range.start.line;
    const my_char_position = my_change.range.start.character;
    
    // Get the deleted character from the cache
    const my_cached_line = get_cached_line(my_document, my_line_number);
    if (my_cached_line === undefined || my_char_position >= my_cached_line.length) {
        // Can't determine what was deleted, skip cleanup
        return;
    }
    const my_deleted_char = my_cached_line[my_char_position];
    
    // Get the character to the right of the cursor (now at the deletion position)
    const my_current_line = my_document.lineAt(my_line_number).text;
    const my_char_to_right = my_char_position < my_current_line.length 
        ? my_current_line[my_char_position] 
        : '';
    
    const chars_to_delete = compute_deletion_cleanup(my_deleted_char, my_char_to_right);
    
    if (chars_to_delete > 0) {
        is_applying_edit = true;
        try {
            const my_edit = new WorkspaceEdit();
            const my_delete_range = new Range(
                my_cursor_pos.line,
                my_cursor_pos.character,
                my_cursor_pos.line,
                my_cursor_pos.character + chars_to_delete
            );
            my_edit.delete(my_document.uri, my_delete_range);
            await workspace.applyEdit(my_edit);
        } finally {
            is_applying_edit = false;
        }
    }
}

async function apply_auto_close_edit(
    my_document: TextDocument,
    my_editor: any,
    my_cursor_pos: Position,
    my_result: any,
    my_typed: string
): Promise<void> {
    // Apply the edit
    is_applying_edit = true;
    try {
        const my_edit = new WorkspaceEdit();

        // If we need to delete characters before cursor (for skip-over behavior)
        if (my_result.delete_before > 0) {
            const my_delete_before_range = new Range(
                my_cursor_pos.line,
                my_cursor_pos.character - my_result.delete_before,
                my_cursor_pos.line,
                my_cursor_pos.character
            );
            my_edit.delete(my_document.uri, my_delete_before_range);
        }

        // If we need to delete characters after cursor
        if (my_result.delete_after > 0) {
            // Adjust position if we deleted before
            const my_adjusted_pos = my_result.delete_before > 0
                ? my_cursor_pos.character - my_result.delete_before
                : my_cursor_pos.character;
            const my_delete_range = new Range(
                my_cursor_pos.line,
                my_adjusted_pos,
                my_cursor_pos.line,
                my_adjusted_pos + my_result.delete_after
            );
            my_edit.delete(my_document.uri, my_delete_range);
        }

        // Insert the closing text at cursor position (adjusted for delete_before)
        if (my_result.insert_text.length > 0) {
            const my_insert_pos = my_result.delete_before > 0
                ? new Position(my_cursor_pos.line, my_cursor_pos.character - my_result.delete_before)
                : my_cursor_pos;
            my_edit.insert(my_document.uri, my_insert_pos, my_result.insert_text);
        }

        const my_applied = await workspace.applyEdit(my_edit);

        if (my_applied) {
            // Position cursor based on cursor_offset
            // Account for delete_before when calculating new position
            const my_base_character = my_cursor_pos.character - my_result.delete_before;
            const my_new_character = my_base_character + my_result.cursor_offset;
            const my_new_pos = new Position(my_cursor_pos.line, my_new_character);
            my_editor.selection = new Selection(my_new_pos, my_new_pos);
            
            // If we just inserted a backtick pattern, trigger completion manually
            if (my_typed === '`' && my_result.insert_text.includes("'")) {
                // Small delay to ensure the edit is fully applied
                setTimeout(() => {
                    if (window.activeTextEditor === my_editor) {
                        // Trigger completion
                        commands.executeCommand('editor.action.triggerSuggest');
                    }
                }, 10);
            }
        }
    } finally {
        is_applying_edit = false;
    }
}

/**
 * Registers the quote auto-close listener for Stata files.
 * 
 * Uses onDidChangeTextDocument instead of the `type` command interceptor
 * to avoid conflicts with other extensions (Vim, etc.).
 */
export function register_quote_auto_close(): Disposable {
    // Initialize cache for all currently open Stata documents
    for (const my_document of workspace.textDocuments) {
        if (my_document.languageId === 'stata') {
            initialize_document_cache(my_document);
        }
    }
    
    const my_change_listener = workspace.onDidChangeTextDocument(handle_document_change);
    const my_open_listener = workspace.onDidOpenTextDocument((my_document) => {
        if (my_document.languageId === 'stata') {
            initialize_document_cache(my_document);
        }
    });
    const my_close_listener = workspace.onDidCloseTextDocument((my_document) => {
        clear_document_cache(my_document.uri.toString());
    });
    
    return {
        dispose: () => {
            my_change_listener.dispose();
            my_open_listener.dispose();
            my_close_listener.dispose();
        }
    };
}
