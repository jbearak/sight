/**
 * Tab completion for console input, from Sight's completion provider.
 *
 * Completion is static: the provider analyzes a virtual do-file made of
 * the lines entered this session (so locals, globals, programs and
 * variables created with `generate` and the like are known) followed by
 * the line being edited. It does not ask the running Stata, which would
 * clobber `r()` results and show up in logs, so it does not know data
 * loaded with `use` or names created by do-files.
 */

import * as path from 'path';
import { pathToFileURL } from 'url';
import type { CompletionItem } from 'vscode-languageserver';
import { DocumentStore } from '../document-store';
import { CompletionProvider } from '../providers/completion';
import { CommandDatabase } from '../command-database';
import embedded_cache_raw from '../command-database/caches/v18.json' with { type: 'json' };
import type { CommandCache } from '../command-database/types';
import type { CompletionCandidate } from './line-editor';

const embedded_cache = embedded_cache_raw as CommandCache;

/** Transcript lines kept for analysis; older lines are dropped. */
export const MAX_TRANSCRIPT_LINES = 2_000;
const MAX_CANDIDATES = 200;
// Characters that make up the word being completed when the provider
// gives no explicit replacement range (path segments, names, options).
const COMPLETION_WORD_CHAR = /[\p{L}\p{N}_.~-]/u;
const SNIPPET_PLACEHOLDER = /\$\{\d+(?::([^}]*))?\}|\$\d+/g;
const SNIPPET_FORMAT = 2;

export class SessionCompleter {
    private readonly transcript: string[] = [];
    private readonly store = new DocumentStore();
    private readonly provider: CompletionProvider;
    private readonly uri: string;
    private version = 0;

    constructor(working_directory: string = process.cwd()) {
        const command_database = new CommandDatabase();
        try {
            command_database.load_cache(embedded_cache);
            command_database.load_addon_commands();
        } catch {
            // Fall back to whatever loaded; completion stays best-effort.
        }
        this.provider = new CompletionProvider(command_database, { snippet_support: false });
        // A file URI in the working directory lets relative path
        // completion (`use "data/`) resolve against it.
        this.uri = pathToFileURL(path.join(working_directory, 'sight-console.do')).toString();
    }

    /** Record a line entered at a Stata prompt. */
    add_line(line: string): void {
        this.transcript.push(line);
        if (this.transcript.length > MAX_TRANSCRIPT_LINES) {
            this.transcript.splice(0, this.transcript.length - MAX_TRANSCRIPT_LINES);
        }
    }

    /** Forget the most recent line (its command failed). */
    drop_last_line(): void {
        this.transcript.pop();
    }

    transcript_lines(): readonly string[] {
        return this.transcript;
    }

    async complete(line: string, cursor: number): Promise<CompletionCandidate[]> {
        const content = this.transcript.length > 0
            ? `${this.transcript.join('\n')}\n${line}`
            : line;
        this.version++;
        await this.store.open(this.uri, content, this.version);
        const document = this.store.get(this.uri);
        if (!document) {
            return [];
        }
        const items = await this.provider.get_completions(document, {
            line: this.transcript.length,
            character: cursor,
        });
        return to_candidates(items, line, cursor);
    }

    async dispose(): Promise<void> {
        await this.store.dispose();
    }
}

/** Convert LSP items into buffer replacements matching the typed prefix. */
export function to_candidates(
    items: readonly CompletionItem[],
    line: string,
    cursor: number
): CompletionCandidate[] {
    const default_start = word_start(line, cursor);
    const seen = new Set<string>();
    const ordered = [...items].sort((left, right) =>
        (left.sortText ?? left.label).localeCompare(right.sortText ?? right.label));
    const candidates: CompletionCandidate[] = [];
    for (const my_item of ordered) {
        let start = default_start;
        let end = cursor;
        let insert = my_item.insertText ?? my_item.label;
        const edit = my_item.textEdit;
        if (edit && 'range' in edit) {
            start = edit.range.start.character;
            end = edit.range.end.character;
            insert = edit.newText;
        }
        if (my_item.insertTextFormat === SNIPPET_FORMAT) {
            insert = strip_snippet(insert);
        }
        if (start < 0 || end < start || end > line.length || start > cursor) {
            continue;
        }
        const typed = line.slice(start, cursor);
        const filter_text = my_item.filterText ?? my_item.label;
        // Exact-case prefix match: Stata names are case-sensitive.
        if (!filter_text.startsWith(typed) && !insert.startsWith(typed)) {
            continue;
        }
        const key = `${start}:${end}:${insert}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        candidates.push({ label: my_item.label, insert, start, end });
        if (candidates.length >= MAX_CANDIDATES) {
            break;
        }
    }
    return candidates;
}

function word_start(line: string, cursor: number): number {
    let index = cursor;
    while (index > 0 && COMPLETION_WORD_CHAR.test(line[index - 1] ?? '')) {
        index--;
    }
    return index;
}

function strip_snippet(text: string): string {
    return text.replace(SNIPPET_PLACEHOLDER, (_match, placeholder: string | undefined) =>
        placeholder ?? '');
}
