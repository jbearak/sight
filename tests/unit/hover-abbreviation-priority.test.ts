import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { HoverProvider } from '../../src/providers/hover';
import { CommandDatabase } from '../../src/command-database';
import type { CommandCache } from '../../src/command-database/types';
import { ContextTracker } from '../../src/context-tracker';
import { DocumentState } from '../../src/document-store';
import { StataLexer } from '../../src/lexer';
import { init_tracker_from_source } from '../test-context-helper';

function load_v18_database(): CommandDatabase {
    const cache_path = join(
        __dirname,
        '../../src/command-database/caches/v18.json'
    );
    const cache = JSON.parse(readFileSync(cache_path, 'utf-8')) as CommandCache;
    const db = new CommandDatabase();
    db.load_cache(cache);
    return db;
}

function create_test_document(content: string): DocumentState {
    const my_lexer = new StataLexer();
    const my_lex_result = my_lexer.tokenize(content);
    return {
        uri: 'file:///test.do',
        version: 1,
        content,
        tokens: my_lex_result.tokens,
        ast: null,
        symbols: {
            programs: new Map(),
            localMacros: new Map(),
            globalMacros: new Map(),
            variables: new Map(),
        },
        diagnostics: [],
    } as unknown as DocumentState;
}

function get_hover_text(value: unknown): string {
    if (
        value
        && typeof value === 'object'
        && 'contents' in (value as object)
    ) {
        const the_contents = (value as { contents: unknown }).contents;
        if (
            the_contents
            && typeof the_contents === 'object'
            && 'value' in (the_contents as object)
        ) {
            return String((the_contents as { value: unknown }).value);
        }
    }
    return '';
}

describe('HoverProvider abbreviation priority', () => {
    it('hover on di shows display and notes the abbreviation', async () => {
        const command_db = load_v18_database();
        const context_tracker = new ContextTracker();
        const hover_provider = new HoverProvider(command_db, context_tracker);

        const my_content = 'di "hello"';
        const my_doc = create_test_document(my_content);
        init_tracker_from_source(context_tracker, my_content);

        const my_hover = await hover_provider.get_hover(
            my_doc,
            { line: 0, character: 1 }
        );

        const my_text = get_hover_text(my_hover);
        expect(my_text).toContain('**display**');
        expect(my_text).toContain('abbreviated as');
        expect(my_text).toContain('`di`');
        expect(my_text).not.toContain('**dir**');
    });

    it('hover on l shows list, not left', async () => {
        const command_db = load_v18_database();
        const context_tracker = new ContextTracker();
        const hover_provider = new HoverProvider(command_db, context_tracker);

        const my_content = 'l var1 var2';
        const my_doc = create_test_document(my_content);
        init_tracker_from_source(context_tracker, my_content);

        const my_hover = await hover_provider.get_hover(
            my_doc,
            { line: 0, character: 0 }
        );

        const my_text = get_hover_text(my_hover);
        expect(my_text).toContain('list');
        expect(my_text).not.toContain('**left**');
    });

    it('hover on sca shows scalar, not scatter', async () => {
        const command_db = load_v18_database();
        const context_tracker = new ContextTracker();
        const hover_provider = new HoverProvider(command_db, context_tracker);

        const my_content = 'sca x = 5';
        const my_doc = create_test_document(my_content);
        init_tracker_from_source(context_tracker, my_content);

        const my_hover = await hover_provider.get_hover(
            my_doc,
            { line: 0, character: 1 }
        );

        const my_text = get_hover_text(my_hover);
        expect(my_text).toContain('scalar');
        expect(my_text).not.toContain('**scatter**');
    });

    it('hover on display still shows the exact command, not displayknots', async () => {
        const command_db = load_v18_database();
        const context_tracker = new ContextTracker();
        const hover_provider = new HoverProvider(command_db, context_tracker);

        const my_content = 'display "hi"';
        const my_doc = create_test_document(my_content);
        init_tracker_from_source(context_tracker, my_content);

        const my_hover = await hover_provider.get_hover(
            my_doc,
            { line: 0, character: 3 }
        );

        const my_text = get_hover_text(my_hover);
        expect(my_text).toContain('**display**');
        expect(my_text).not.toContain('displayknots');
        expect(my_text).not.toContain('abbreviated as');
    });
});
