/**
 * Diagnostics for `end` lines, read from the parsed statements.
 *
 * The parser consumes every `end` that closes something: a program
 * definition, a mata or python block, and `input` data. Stata ends a
 * program definition at the first line whose first word is `end`,
 * even one inside a brace block or a mata/python block, and the
 * parser does too. So:
 *
 * - an `end` left as a statement of its own closes nothing
 *   (UNEXPECTED_END); StataMP 18 stops with "command end is
 *   unrecognized" (r(199)), after `end foo` and `end;` too;
 * - a program that ends at a mata/python block's `end` has its
 *   definition cut short there (EMBEDDED_BLOCK_ENDS_PROGRAM).
 *
 * `end mata` and `end python` as statements are reported by the
 * context tracker, with their own advice, and are skipped here. So is
 * an `end` with code before it on its line (`<end>`), which Stata does
 * not read as one, and everything after an `exit` outside any block,
 * where Stata stops reading the file (notes at the end of ado-files).
 */
import { ContextDiagnostic, ContextErrorCode } from '../context-tracker/types';
import { EmbeddedLanguageBlockNode, StataNode } from '../types';
import { nested_statements } from '../utils/node-body';
import { get_line_text, compute_line_offsets } from '../utils/line-utils';

const UNEXPECTED_END_MESSAGE =
    'Unexpected "end" command - not closing any program, mata, python, ' +
    'or input block';

/** `end mata` and `end python`, which the context tracker reports. */
function is_end_with_language(node: StataNode): boolean {
    if (node.type !== 'command') return false;
    const first = node.varlist?.[0]?.name;
    return first === 'mata' || first === 'python';
}

/**
 * Does the `end` at `start` begin its line? Blanks, a block comment, or
 * the `;` of the statement before may precede it.
 */
function begins_line(line_text: string, character: number): boolean {
    const before = line_text.slice(0, character).trimEnd();
    return before === '' || before.endsWith(';') || before.endsWith('*/');
}

/**
 * Is `node` an `exit` that stops Stata reading the file? Under
 * `capture`, Stata catches the return code of `exit 198` and goes on.
 */
function is_unconditional_exit(node: StataNode): boolean {
    return node.type === 'command' && node.fullName === 'exit' &&
        !(node.prefix ?? []).some((my_prefix) => my_prefix.fullName === 'capture');
}

/** The last mata/python block among `nodes`, searching nested blocks. */
function last_embedded_block(
    the_nodes: readonly StataNode[]
): EmbeddedLanguageBlockNode | undefined {
    for (let i = the_nodes.length - 1; i >= 0; i--) {
        const my_node = the_nodes[i];
        if (my_node.type === 'embedded_block') return my_node;
        const my_inner = last_embedded_block(nested_statements(my_node) ?? []);
        if (my_inner) return my_inner;
    }
    return undefined;
}

/** The diagnostic for a block's `end` that also ends its program. */
function embedded_end_diagnostic(
    block: EmbeddedLanguageBlockNode,
    line_text: string
): ContextDiagnostic {
    const language = block.language;
    const line = block.range.end.line;
    return {
        message:
            `Stata ends the program definition at this "end", so a ${language} ` +
            `block cannot be inside a program. Move the block outside the ` +
            `program, or use one-line "${language}:" statements.`,
        range: {
            start: {
                line,
                character: line_text.length - line_text.trimStart().length,
            },
            end: { line, character: line_text.trimEnd().length },
        },
        severity: 'error',
        code: ContextErrorCode.EMBEDDED_BLOCK_ENDS_PROGRAM,
    };
}

/**
 * The `end` diagnostics for the statements `nodes` of a document whose
 * text is `content`, in source order.
 */
export function find_end_diagnostics(
    the_nodes: readonly StataNode[],
    content: string
): ContextDiagnostic[] {
    const document = { content, line_offsets: compute_line_offsets(content) };
    const the_diagnostics: ContextDiagnostic[] = [];
    const visit = (my_nodes: readonly StataNode[], is_top_level: boolean): void => {
        for (const my_node of my_nodes) {
            if (is_top_level && is_unconditional_exit(my_node)) {
                return;
            }
            if (my_node.type === 'command' && my_node.fullName === 'end' &&
                my_node.body === undefined && !is_end_with_language(my_node) &&
                begins_line(
                    get_line_text(document, my_node.range.start.line),
                    my_node.range.start.character)) {
                the_diagnostics.push({
                    message: UNEXPECTED_END_MESSAGE,
                    range: my_node.range,
                    severity: 'error',
                    code: ContextErrorCode.UNEXPECTED_END,
                });
            }
            visit(nested_statements(my_node) ?? [], false);
            if (my_node.type === 'program' &&
                my_node.ends_at_embedded_block === true) {
                const block = last_embedded_block(my_node.body);
                if (block) {
                    the_diagnostics.push(embedded_end_diagnostic(
                        block, get_line_text(document, block.range.end.line)));
                }
            }
        }
    };
    visit(the_nodes, true);
    return the_diagnostics;
}
