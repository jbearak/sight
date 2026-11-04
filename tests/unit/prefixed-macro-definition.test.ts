import { describe, expect, it } from 'bun:test';
import { SemanticAnalyzer } from '../../src/analyzer';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { CodeFormatter } from '../../src/providers/formatter';
import { StataDiagnosticCode, StataNode } from '../../src/types';
import { create_document_state } from '../property/helpers/document-utils';
import {
    create_formatter_config,
    DEFAULT_FORMATTING_OPTIONS,
    for_each_formatter_mode,
    FormatterMode,
} from '../property/helpers/formatter-test-utils';

function parse(source: string) {
    const { tokens } = new StataLexer().tokenize(source);
    return { ...new StataParser().parse(tokens), tokens };
}

function undefined_macro_messages(source: string): string[] {
    const { ast, tokens } = parse(source);
    const result = new SemanticAnalyzer().analyze(
        ast, 'test://file.do', undefined, { undefined_macro_enabled: true }, tokens
    );
    return result.diagnostics
        .filter((d) => d.code === StataDiagnosticCode.UNDEFINED_MACRO)
        .map((d) => d.message);
}

function format(source: string, mode: FormatterMode): string {
    const edits = new CodeFormatter().format(
        create_document_state(source),
        DEFAULT_FORMATTING_OPTIONS,
        create_formatter_config(mode)
    );
    return edits[0]?.newText ?? source;
}

/** Prefixed definitions, each followed by a use of the macro. */
const THE_DEFINITIONS: Array<{ source: string; use: string; prefixes: string[] }> = [
    { source: 'capture local y 2', use: "display `y'", prefixes: ['capture'] },
    { source: 'quietly local y = 1', use: "display `y'", prefixes: ['quietly'] },
    { source: 'noisily global g "a"', use: 'display "$g"', prefixes: ['noisily'] },
    { source: 'qui: local z 3', use: "display `z'", prefixes: ['quietly'] },
    { source: 'cap noi local w 4', use: "display `w'", prefixes: ['capture', 'noisily'] },
    { source: 'capture local ++i', use: "display `i'", prefixes: ['capture'] },
    { source: "capture local n : word count `x'", use: "display `n'", prefixes: ['capture'] },
    { source: 'by g: local b 1', use: "display `b'", prefixes: ['by'] },
    { source: 'frame f: local fl 1', use: "display `fl'", prefixes: ['frame'] },
    { source: 'capture frame f: qui local fq 1', use: "display `fq'", prefixes: ['capture', 'frame', 'quietly'] },
    { source: 'capture local text a+b', use: "display `text'", prefixes: ['capture'] },
];

describe('prefixed macro definitions', () => {
    it('parse as macro definitions with their prefixes', () => {
        for (const my_case of THE_DEFINITIONS) {
            const { ast, errors } = parse(my_case.source);
            expect(errors).toEqual([]);
            expect(ast.nodes).toHaveLength(1);
            const node: StataNode = ast.nodes[0];
            if (node.type !== 'macro_def') {
                throw new Error(`${my_case.source}: expected macro_def, got ${node.type}`);
            }
            expect(node.prefix?.map((p) => p.fullName)).toEqual(my_case.prefixes);
            expect(node.range.start.character).toBe(0);
            expect(node.range.end.character).toBe(my_case.source.length);
        }
    });

    it('keep the definition details', () => {
        const [increment] = parse('capture local ++i').ast.nodes;
        expect(increment).toMatchObject({
            type: 'macro_def', scope: 'local', name: 'i', increment: '++',
        });

        const [extended] = parse("capture local n : word count `x'").ast.nodes;
        expect(extended).toMatchObject({
            type: 'macro_def', name: 'n', extendedFunction: { name: 'word' },
        });

        const [expression] = parse('quietly local y = 1+2').ast.nodes;
        expect(expression).toMatchObject({
            type: 'macro_def', name: 'y', value: '1+2', hasEquals: true,
        });
    });

    it('stay commands when the macro name is not a plain word', () => {
        // Same as unprefixed `` global `name' = 1 ``.
        const [node] = parse("capture global `name' = 1").ast.nodes;
        expect(node).toMatchObject({ type: 'command', name: 'global' });
    });

    it('keep program after a prefix a command', () => {
        const [node] = parse('capture program drop foo').ast.nodes;
        expect(node).toMatchObject({ type: 'command', name: 'program' });
    });

    it('define the macro for later references', () => {
        for (const my_case of THE_DEFINITIONS) {
            const source = my_case.source.includes("`x'")
                ? `local x a b\n${my_case.source}\n${my_case.use}`
                : `${my_case.source}\n${my_case.use}`;
            expect(undefined_macro_messages(source)).toEqual([]);
        }
    });

    it('still check macro references in the value', () => {
        expect(undefined_macro_messages("capture local y `nope'")).toEqual([
            "`nope' is not defined",
        ]);
    });

    for_each_formatter_mode('print unchanged and idempotently', (mode) => {
        for (const my_case of THE_DEFINITIONS) {
            const once = format(my_case.source, mode);
            expect(once.trimEnd()).toBe(my_case.source);
            expect(format(once, mode)).toBe(once);
        }
    });

    for_each_formatter_mode('keep interior block comments', (mode) => {
        const once = format('capture local x a /* c */ b', mode);
        expect(once).toContain('/* c */');
        expect(parse(once).ast.nodes[0]).toMatchObject({ type: 'macro_def', value: 'a b' });
        expect(format(once, mode)).toBe(once);
    });

    for_each_formatter_mode('keep the increment operator before the name', (mode) => {
        for (const my_source of ['local ++i', 'local --i', 'global ++g', 'qui local --j']) {
            expect(format(my_source, mode).trimEnd()).toBe(my_source);
        }
    });
});
