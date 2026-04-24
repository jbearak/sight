/**
 * Property tests for hover disambiguation between command and expression
 * position.
 */

import { describe, expect, it } from 'bun:test';
import * as fc from 'fast-check';
import { HoverProvider } from '../../src/providers/hover';
import { CommandDatabase } from '../../src/commands';
import type { CommandCache } from '../../src/command-database/types';
import { DocumentState } from '../../src/document-store';
import { StataLexer } from '../../src/lexer';
import { SymbolTable } from '../../src/types';
import { compute_line_offsets } from '../../src/utils/line-utils';
import { arbitrary_non_reserved_identifier } from './generators';

function create_document(content: string): DocumentState {
    const lexer = new StataLexer();
    const lex_result = lexer.tokenize(content);

    return {
        uri: 'file:///hover-position.do',
        version: 1,
        content,
        tokens: lex_result.tokens,
        ast: null,
        symbols: {
            programs: new Map(),
            localMacros: new Map(),
            globalMacros: new Map(),
            variables: new Map(),
            scalars: new Map(),
            matrices: new Map(),
        } as SymbolTable,
        diagnostics: [],
        line_offsets: compute_line_offsets(content),
    } as DocumentState;
}

const AMBIGUOUS_FUNCTION_CASES = [
    { alias: 'mi', target: 'missing' },
    { alias: 'missing', target: 'missing' },
    { alias: 'sum', target: 'sum' },
    { alias: 'byte', target: 'byte' },
    { alias: 'double', target: 'double' },
    { alias: 'exp', target: 'exp' },
    { alias: 'float', target: 'float' },
    { alias: 'int', target: 'int' },
    { alias: 'long', target: 'long' },
    { alias: 'log', target: 'log' },
    { alias: 'max', target: 'max' },
    { alias: 'min', target: 'min' },
    { alias: 'mod', target: 'mod' },
    { alias: 'string', target: 'string' },
    { alias: 'lower', target: 'lower' },
    { alias: 'upper', target: 'upper' },
    { alias: 'proper', target: 'proper' },
    { alias: 'date', target: 'date' },
    { alias: 'daily', target: 'daily' },
    { alias: 'weekly', target: 'weekly' },
    { alias: 'monthly', target: 'monthly' },
    { alias: 'quarterly', target: 'quarterly' },
    { alias: 'halfyearly', target: 'halfyearly' },
    { alias: 'yearly', target: 'yearly' },
    { alias: 'normal', target: 'normal' },
    { alias: 'poisson', target: 'poisson' },
    { alias: 'recode', target: 'recode' },
    { alias: 'trunc', target: 'trunc' },
] as const;

function create_command(name: string, option_name: string) {
    return {
        name,
        min_abbreviation: name.length,
        options: [
            {
                name: option_name,
                min_abbreviation: Math.min(3, option_name.length),
                has_argument: false,
            },
        ],
        priority: 3 as const,
    };
}

function create_ambiguous_command_db(): CommandDatabase {
    const db = new CommandDatabase();
    const cache: CommandCache = {
        version: 18,
        commands: {
            mi: {
                name: 'mi',
                min_abbreviation: 2,
                options: [
                    {
                        name: 'offset',
                        min_abbreviation: 3,
                        has_argument: true,
                    },
                    {
                        name: 'augment',
                        min_abbreviation: 3,
                        has_argument: false,
                    },
                    {
                        name: 'conditional',
                        min_abbreviation: 4,
                        has_argument: true,
                    },
                    {
                        name: 'bootstrap',
                        min_abbreviation: 4,
                        has_argument: false,
                    },
                ],
                priority: 3,
            },
            byte: create_command('byte', 'format'),
            double: create_command('double', 'precision'),
            missing: create_command('missing', 'within'),
            sum: create_command('sum', 'detail'),
            exp: create_command('exp', 'replace'),
            float: create_command('float', 'storage'),
            interval: create_command('interval', 'step'),
            long: create_command('long', 'display'),
            log: create_command('log', 'append'),
            max: create_command('max', 'iterate'),
            min: create_command('min', 'trace'),
            models: create_command('models', 'all'),
            string: create_command('string', 'format'),
            lower: create_command('lower', 'casewise'),
            upper: create_command('upper', 'uppercase'),
            proper: create_command('proper', 'locale'),
            date: create_command('date', 'mask'),
            daily: create_command('daily', 'clock'),
            weekly: create_command('weekly', 'week'),
            monthly: create_command('monthly', 'month'),
            quarterly: create_command('quarterly', 'quarter'),
            halfyearly: create_command('halfyearly', 'half'),
            yearly: create_command('yearly', 'year'),
            normal: create_command('normal', 'standard'),
            poisson: create_command('poisson', 'mean'),
            recode: create_command('recode', 'generate'),
            truncate: create_command('truncate', 'limit'),
        },
        abbreviations: {
            int: 'interval',
            miss: 'missing',
            missi: 'missing',
            missin: 'missing',
            mod: 'models',
            trunc: 'truncate',
        },
    };
    db.load_cache(cache);
    return db;
}

function hover_value(hover: Awaited<ReturnType<HoverProvider['get_hover']>>): string {
    if (!hover || typeof hover.contents !== 'object' || !('value' in hover.contents)) {
        throw new Error('Expected markdown hover contents');
    }
    return hover.contents.value;
}

function index_inside_word(content: string, word: string): number {
    const start = content.indexOf(word);
    if (start < 0) {
        throw new Error(`Could not find ${word} in ${content}`);
    }
    return start + Math.floor(word.length / 2);
}

function command_hover_name(
    command_db: CommandDatabase,
    command_name: string
): string | null {
    return command_db.lookup(command_name)?.name ?? null;
}

describe('Hover Command vs Expression Position Property Tests', () => {
    const command_db = create_ambiguous_command_db();
    const hover_provider = new HoverProvider(command_db);

    const identifier = arbitrary_non_reserved_identifier();
    const function_case = fc.constantFrom(...AMBIGUOUS_FUNCTION_CASES);
    const optional_space = fc.constantFrom('', ' ', '  ');

    it('resolves ambiguous expression function calls to function hover', () => {
        fc.assert(
            fc.asyncProperty(
                function_case,
                optional_space,
                identifier,
                fc.constantFrom(
                    (fn: string, space: string, arg: string) =>
                        `replace foo = . if ${fn}${space}(${arg})`,
                    (fn: string, space: string, arg: string) =>
                        `generate flag = ${fn}${space}(${arg})`,
                    (fn: string, space: string, arg: string) =>
                        `display ${fn}${space}(${arg})`
                ),
                async (my_case, space, arg, template) => {
                    const content = template(my_case.alias, space, arg);
                    const document = create_document(content);
                    const hover = await hover_provider.get_hover(
                        document,
                        {
                            line: 0,
                            character: index_inside_word(
                                content,
                                my_case.alias
                            ),
                        }
                    );
                    const value = hover_value(hover);

                    expect(value).toContain('**Function:**');
                    expect(value).toContain(`**${my_case.target}**()`);
                    expect(value).not.toContain('**Options:**');
                }
            ),
            { numRuns: 100 }
        );
    });

    it('keeps ambiguous names in command position on command hover', () => {
        fc.assert(
            fc.asyncProperty(
                fc.constantFrom('', 'quietly ', 'capture ', 'by id: '),
                fc.constantFrom(
                    ...AMBIGUOUS_FUNCTION_CASES.map(my_case => my_case.alias)
                ),
                identifier,
                async (prefix, command_name, variable_name) => {
                    const content = `${prefix}${command_name} ${variable_name}`;
                    const document = create_document(content);
                    const hover = await hover_provider.get_hover(
                        document,
                        {
                            line: 0,
                            character: index_inside_word(content, command_name),
                        }
                    );
                    const expected_hover_name = command_hover_name(
                        command_db,
                        command_name
                    );
                    if (expected_hover_name === null) {
                        expect(hover).toBeNull();
                        return;
                    }

                    const value = hover_value(hover);

                    expect(value).toContain(
                        `**${expected_hover_name}**`
                    );
                    expect(value).toContain('**Options:**');
                    expect(value).not.toContain('**Function:**');
                }
            ),
            { numRuns: 100 }
        );
    });
});
