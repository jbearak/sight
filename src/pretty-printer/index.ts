import {
    StataAST,
    StataNode,
    CommandNode,
    ProgramNode,
    MacroDefNode,
    MacroRefNode,
    ControlFlowNode,
    StringLiteralNode,
    IdentifierNode,
    DirectiveNode,
    TriviaNode,
    PrefixNode,
    OptionNode,
    EmbeddedLanguageBlockNode,
    SyntaxNode,
    SourceLine
} from '../types';
import { compare_positions } from '../utils/scope-position';
import { format_expression_spacing } from './expression-spacing';

/**
 * Determines if a space should be omitted between two varlist items
 * that had a gap between them in the source. Items with no gap are
 * always printed together; see printCommand.
 */
function should_omit_space(current: string, next: string): boolean {
    // Whitespace already present
    if (/\s$/.test(current) || /^\s/.test(next)) return true;

    // Wildcard patterns - no space before * or ? when they follow a word-like token
    // This handles patterns like var*, x?, _*
    if ((next === '*' || next === '?') && /^[a-zA-Z0-9_]+$/.test(current)) return true;

    return false;
}

/** True when `previous` ends where `next` starts in the source. */
function is_source_adjacent(previous: IdentifierNode, next: IdentifierNode): boolean {
    return previous.range.end.line === next.range.start.line &&
        previous.range.end.character === next.range.start.character;
}

/**
 * Options for configuring the PrettyPrinter output.
 */
export interface PrintOptions {
    indent_size: number;
    indent_style: 'spaces' | 'tabs';
    line_width: number;
}

/**
 * Default print options.
 */
const DEFAULT_PRINT_OPTIONS: PrintOptions = {
    indent_size: 4,
    indent_style: 'spaces',
    line_width: 80,
};

/**
 * PrettyPrinter converts AST nodes back to valid Stata source code.
 * 
 * Key responsibilities:
 * - Print AST nodes back to valid Stata source
 * - Track #delimit mode for correct statement terminators
 * - Preserve trivia (comments)
 * - Support configurable indent size/style
 */
export class PrettyPrinter {
    private options: PrintOptions;
    private current_indent: number = 0;
    private delimiter_mode: 'cr' | 'semicolon' = 'cr';

    constructor(options?: Partial<PrintOptions>) {
        this.options = { ...DEFAULT_PRINT_OPTIONS, ...options };
    }

    /**
     * Print an entire AST to valid Stata source code.
     */
    print(ast: StataAST, options?: Partial<PrintOptions>): string {
        if (options) {
            this.options = { ...this.options, ...options };
        }
        this.current_indent = 0;
        this.delimiter_mode = 'cr';

        const the_lines: string[] = [];

        for (const my_node of ast.nodes) {
            const my_printed = this.printNode(my_node, options);
            the_lines.push(my_printed);
        }

        the_lines.push(this.printTriviaLines(ast.trailingTrivia ?? []));

        return the_lines.join('');
    }

    /**
     * Print a single AST node to valid Stata source code.
     */
    printNode(node: StataNode, options?: Partial<PrintOptions>): string {
        if (options) {
            this.options = { ...this.options, ...options };
        }

        const parts = this.printNodeParts(node);

        // `#delimit` itself always ends at the end of its line; the new
        // mode applies to the statements after it.
        const terminator = node.type === 'directive'
            ? '\n'
            : this.getStatementTerminator();

        return parts.code + terminator + parts.own_line;
    }

    /**
     * Print a node in the two parts that go around its statement
     * terminator: the code, with comments on its last line, and the
     * comments from later lines, each on a line of its own.
     */
    private printNodeParts(node: StataNode): { code: string; own_line: string } {
        let result = '';
        let body_own_line = '';

        // Print leading trivia (comments before the node)
        result += this.printLeadingTrivia(node);

        // Print the node itself
        switch (node.type) {
            case 'directive':
                result += this.printDirective(node);
                break;
            case 'command':
                result += this.printCommand(node);
                break;
            case 'program':
                result += this.printProgram(node);
                break;
            case 'macro_def':
                result += this.printMacroDef(node);
                break;
            case 'macro_ref':
                result += this.printMacroRef(node);
                break;
            case 'if':
            case 'else':
            case 'foreach':
            case 'forvalues':
            case 'while':
            case 'frame': {
                const control_flow = this.printControlFlow(node);
                result += control_flow.code;
                body_own_line = control_flow.own_line;
                break;
            }
            case 'string':
                result += this.printStringLiteral(node);
                break;
            case 'embedded_block':
                result += this.printEmbeddedBlock(node);
                break;
            case 'syntax':
                result += this.printSyntax(node);
                break;
            default:
                // Unknown node type - should not happen
                break;
        }

        // Print trailing trivia (comments after the node). Comments on the
        // node's last line go before the terminator; comments from later
        // lines go after it, on lines of their own.
        const trailing = this.printTrailingTrivia(node);
        result += trailing.same_line;

        return { code: result, own_line: body_own_line + trailing.own_line };
    }

    /**
     * Print a #delimit directive and update delimiter mode.
     */
    private printDirective(node: DirectiveNode): string {
        // Update delimiter mode for subsequent statements
        this.delimiter_mode = node.mode;

        const mode_str = node.mode === 'semicolon' ? ';' : 'cr';
        return `${this.getIndent()}#delimit ${mode_str}`;
    }

    /**
     * Print a command node.
     */
    private printCommand(node: CommandNode): string {
        if (node.noted_lines) {
            return this.printNotedLines(node.noted_lines);
        }
        const the_parts: string[] = [];

        // Add indentation
        the_parts.push(this.getIndent());

        // Print prefix commands (by, quietly, capture, etc.)
        if (node.prefix && node.prefix.length > 0) {
            for (const my_prefix of node.prefix) {
                the_parts.push(this.printPrefix(my_prefix));
                the_parts.push(' ');
            }
        }

        // Print command name
        the_parts.push(node.name);

        // Print the arguments in source order: varlist items, and argument
        // tokens after the varlist (e.g. `> 0` in `assert x > 0`). A `using`
        // clause after them is appended to the varlist, so sort by position
        // (`infix id 1-3 using f`). Items with no gap between them in the
        // source stay together: Stata splits arguments at whitespace, and
        // the lexer splits one argument into several items, as in the
        // pieces of `"n=`n'"` around its macro or in `` `p'`i' `` and
        // `gen x:lbl = 1`. Varlist items that had a gap keep their
        // spacing rules.
        // For unab commands with has_colon_before_varlist, emit colon after macro name
        // An interior comment goes back before the argument that
        // followed it in the source. One after the last argument goes at
        // the end of the statement, outside the expression, qualifiers,
        // and options, which are printed from strings. A `//` comment
        // (interior only under `#delimit ;`) ends its line, so the rest
        // of the statement goes on the next one.
        const the_comments = node.interiorTrivia ?? [];
        let comment_index = 0;
        const the_items = [
            ...(node.varlist ?? []).map((item, index) => ({ item, is_extra: false, index })),
            ...(node.extra_args ?? []).map((item, index) => ({ item, is_extra: true, index })),
        ];
        if (node.extra_args && node.extra_args.length > 0) {
            the_items.sort((a, b) =>
                a.item.range.start.line - b.item.range.start.line ||
                a.item.range.start.character - b.item.range.start.character);
        }
        for (let i = 0; i < the_items.length; i++) {
            const my_entry = the_items[i];
            const previous = the_items[i - 1];
            let after_comment = false;
            let at_line_start = false;
            while (comment_index < the_comments.length &&
                compare_positions(
                    the_comments[comment_index].range.end,
                    my_entry.item.range.start) <= 0) {
                at_line_start = this.push_interior_comment(
                    the_parts, the_comments[comment_index], at_line_start,
                    this.getContinuationIndent());
                comment_index++;
                after_comment = true;
            }
            if (at_line_start) {
                // The comment's line break and indentation separate them.
            } else if (previous === undefined || after_comment) {
                the_parts.push(' ');
            } else {
                const omit_space =
                    is_source_adjacent(previous.item, my_entry.item) ||
                    (!my_entry.is_extra && !previous.is_extra &&
                        should_omit_space(previous.item.name, my_entry.item.name));
                if (!omit_space) {
                    the_parts.push(' ');
                }
            }
            the_parts.push(my_entry.item.name);

            // For unab commands: emit colon after the first item (macro name)
            if (!my_entry.is_extra && my_entry.index === 0 && node.has_colon_before_varlist) {
                the_parts.push(':');
            }
        }

        // Print expression (assignment) with proper spacing
        if (node.expression) {
            the_parts.push(' = ');
            the_parts.push(format_expression_spacing(node.expression));
        }

        // Print if-qualifier with proper spacing
        if (node.ifExpression) {
            the_parts.push(' if ');
            the_parts.push(format_expression_spacing(node.ifExpression));
        }

        // Print in-qualifier with proper spacing
        if (node.inExpression) {
            the_parts.push(' in ');
            the_parts.push(format_expression_spacing(node.inExpression));
        }

        // Print weight clause
        if (node.weight) {
            const the_weight = node.weight;
            const separator = the_weight.kind === null ? '' : '=';
            const expression = format_expression_spacing(the_weight.expression);
            the_parts.push(` [${the_weight.keyword}${separator}${expression}]`);
        }

        // Print options (after comma)
        if (node.options && node.options.length > 0) {
            the_parts.push(', ');
            const the_option_strs = node.options.map(o => this.printOption(o));
            the_parts.push(the_option_strs.join(' '));
        }

        // Under `#delimit ;`, a `;` after a `//` comment goes on the
        // next line.
        let at_line_start = false;
        for (const my_comment of the_comments.slice(comment_index)) {
            at_line_start = this.push_interior_comment(
                the_parts, my_comment, at_line_start,
                this.getTerminatorLineIndent());
        }

        // Handle prefix command brace blocks (e.g., capture { }, quietly { })
        // Determine format upfront rather than manipulating array after construction
        if (node.body) {
            // Decision tree for brace block formatting:
            // 1. Standalone brace block: name === '{' with no prefixes
            // 2. Prefix brace block: name === '{' with prefixes (e.g., capture { })
            // 3. Regular command with body: name !== '{' (e.g., program foo { })
            
            const is_standalone_brace = node.name === '{' && (!node.prefix || node.prefix.length === 0);
            const is_prefix_brace_block = node.name === '{' && node.prefix && node.prefix.length > 0;
            
            if (is_standalone_brace) {
                // Standalone brace block: just indent + brace
                // Clear and rebuild since we don't want the '{' as command name
                the_parts.length = 0;
                the_parts.push(this.getIndent());
                the_parts.push('{');
            } else if (is_prefix_brace_block) {
                // Prefix brace block: the prefixes, then comments that
                // were among them (`quietly /* c */ {`), then the brace.
                the_parts.length = 0;
                the_parts.push(this.getIndent());
                the_parts.push(this.printPrefixes(node.prefix));
                the_parts.push(this.printInteriorComments(node));
                the_parts.push('{');
            } else {
                // Regular command with body: add space and brace
                the_parts.push(' {');
            }
            the_parts.push(this.getStatementTerminator());

            // Increase indent for body
            this.current_indent++;

            // Print body statements
            for (const my_stmt of node.body) {
                the_parts.push(this.printNode(my_stmt));
            }

            the_parts.push(this.printBlockEndingTrivia(node));

            // Decrease indent
            this.current_indent--;

            // Print closing brace (without statement terminator - printNode adds it)
            the_parts.push(`${this.getIndent()}}`);
        }

        return the_parts.join('');
    }

    /** Print prefixes, each followed by a space. */
    private printPrefixes(the_prefixes: PrefixNode[] | undefined): string {
        return (the_prefixes ?? [])
            .map(my_prefix => `${this.printPrefix(my_prefix)} `)
            .join('');
    }

    /**
     * Print a node's interior block comments, each followed by a space.
     * Stata reads them as whitespace, so any place between two words of
     * the statement keeps its meaning.
     */
    private printInteriorComments(
        node: CommandNode | ControlFlowNode | EmbeddedLanguageBlockNode
    ): string {
        return (node.interiorTrivia ?? [])
            .map(my_comment => `${this.printTrivia(my_comment)} `)
            .join('');
    }

    /**
     * Print a prefix command.
     */
    private printPrefix(prefix: PrefixNode): string {
        let result = prefix.name;

        // Handle frame prefix with frame name
        if (prefix.frameName) {
            result += ' ' + prefix.frameName;
        }
        // Handle 'by' prefix with variable list
        else if (prefix.varlist && prefix.varlist.length > 0) {
            result += ' ' + prefix.varlist.join(' ');
        }

        // Arguments of colon prefixes such as `version 14:` or `svy linearized:`,
        // as written: they are not always expressions (`fp <x_pow>:`)
        if (prefix.arguments) {
            result += ' ' + prefix.arguments;
        }

        // Prefix options, e.g. `by g, sort:` or `bootstrap, reps(100):`
        if (prefix.options && prefix.options.length > 0) {
            result += ', ' + prefix.options.map(o => this.printOption(o)).join(' ');
        }

        // Add colon if the prefix had one
        if (prefix.has_colon) {
            result += ':';
        }

        return result;
    }

    /**
     * Print a command option.
     */
    private printOption(option: OptionNode): string {
        let result = option.name;

        if (option.argument !== undefined) {
            const close_paren = option.argument_unclosed ? '' : ')';
            const argument = format_expression_spacing(option.argument);
            result += `(${argument}${close_paren}`;
        }

        return result;
    }

    /**
     * Print a program definition.
     */
    private printProgram(node: ProgramNode): string {
        const the_lines: string[] = [];

        // Print program header
        // `define` is optional in Stata; print it only when the source had it
        const define_part = node.define_keyword !== undefined
            ? `${node.define_keyword} `
            : '';
        const options_part = node.define_options ? `, ${node.define_options}` : '';
        the_lines.push(`${this.getIndent()}program ${define_part}${node.name}${options_part}`);
        the_lines.push(this.getStatementTerminator());

        // Increase indent for body
        this.current_indent++;

        // Print body statements
        for (const my_stmt of node.body) {
            the_lines.push(this.printNode(my_stmt));
        }

        the_lines.push(this.printBlockEndingTrivia(node));

        // Decrease indent
        this.current_indent--;

        // Print end
        the_lines.push(`${this.getIndent()}end`);

        return the_lines.join('');
    }

    /**
     * Print a macro definition.
     */
    private printMacroDef(node: MacroDefNode): string {
        if (node.noted_lines) {
            return this.printNotedLines(node.noted_lines);
        }
        const prefix_text = this.printPrefixes(node.prefix);
        const scope_keyword = `${prefix_text}${node.scope}`;
        
        // `local ++i` keeps its operator before the name. The parser puts
        // the operator at the start of `value`, where expression spacing
        // would turn `++` into `+ +`.
        const increment = node.increment ?? '';
        const name_text = `${increment}${node.name}`;
        const value = node.value.slice(increment.length).trim();

        let statement: string;
        // Handle extended macro functions (e.g., local x : list posof "y" in z)
        if (node.extendedFunction) {
            const func = node.extendedFunction;
            const args_part = func.args ? ` ${func.args}` : '';
            statement = `${this.getIndent()}${scope_keyword} ${node.name} : ${func.name}${args_part}`.trimEnd();
        } else if (node.hasEquals) {
            // Use '=' if the original definition had it
            statement = `${this.getIndent()}${scope_keyword} ${name_text} = ${format_expression_spacing(value)}`.trimEnd();
        } else {
            // Without '=', the value is literal text: `local t a+b` stores
            // "a+b", so spacing it would change the macro.
            statement = `${this.getIndent()}${scope_keyword} ${name_text} ${value}`.trimEnd();
        }

        // Interior comments go at the end, outside the value. Under
        // `#delimit ;`, a `;` after a `//` comment goes on the next line.
        const the_parts = [statement];
        let at_line_start = false;
        for (const my_comment of node.interiorTrivia ?? []) {
            at_line_start = this.push_interior_comment(
                the_parts, my_comment, at_line_start,
                this.getTerminatorLineIndent());
        }
        return the_parts.join('');
    }

    /**
     * Print a macro reference.
     */
    private printMacroRef(node: MacroRefNode): string {
        if (node.scope === 'local') {
            return `\`${node.name}'`;
        } else {
            // Global macro - use $name form
            return `$${node.name}`;
        }
    }

    /**
     * Normalize condition formatting by removing spaces around parentheses.
     */
    private normalizeCondition(condition: string): string {
        if (!condition) return condition;
        
        // Apply expression spacing first, then remove spaces around parentheses
        const spaced = format_expression_spacing(condition);
        return spaced.replace(/\(\s+/g, '(').replace(/\s+\)/g, ')');
    }

    /**
     * Print a control flow statement (if, else, foreach, forvalues, while).
     */
    private printControlFlow(node: ControlFlowNode): { code: string; own_line: string } {
        const prefix_text = this.printPrefixes(node.prefix);
        // Comments among the prefixes and in the header go before the
        // body: before `{`, or before an inline if's command. In the
        // condition or loop spec they would be read as operators.
        const comment_text = this.printInteriorComments(node);
        if (node.type === 'if' && node.is_single_statement && node.noted_lines) {
            // The lines hold the inline command too, but not the comments
            // after it, which belong to the innermost inline statement.
            let trailing = { same_line: '', own_line: '' };
            let body_node: StataNode | undefined = node.body[0];
            while (body_node !== undefined) {
                const body_trailing = this.printTrailingTrivia(body_node);
                trailing = {
                    same_line: body_trailing.same_line + trailing.same_line,
                    own_line: body_trailing.own_line + trailing.own_line,
                };
                body_node = body_node.type === 'if' && body_node.is_single_statement
                    ? body_node.body[0]
                    : undefined;
            }
            return {
                code: this.printNotedLines(node.noted_lines) + trailing.same_line,
                own_line: trailing.own_line,
            };
        }
        if (node.type === 'if' && node.is_single_statement) {
            const body_node = node.body[0];
            const body = body_node
                ? this.printNodeParts(body_node)
                : { code: '', own_line: '' };
            // The enclosing node supplies indentation and the one statement
            // terminator shared by the condition and its inline command.
            // Comments from the body's later lines follow that terminator.
            const inline_body = body.code.trimStart();
            // Preserve expression fragments, comments, and Unicode names.
            return {
                code: `${this.getIndent()}${prefix_text}if ${node.condition || ''} ${comment_text}${inline_body}`,
                own_line: body.own_line,
            };
        }

        const the_lines: string[] = [];

        // Print the control flow header
        let header = this.getIndent() + prefix_text;

        switch (node.type) {
            case 'if':
                header += `if ${this.normalizeCondition(node.condition || '')} `;
                break;
            case 'else':
                header += 'else ';
                break;
            case 'foreach':
                header += `foreach ${node.loopVar || ''} ${format_expression_spacing(node.loopSpec || '')} `;
                break;
            case 'forvalues':
                header += `forvalues ${node.loopVar || ''} ${format_expression_spacing(node.loopSpec || '')} `;
                break;
            case 'while':
                header += `while ${this.normalizeCondition(node.condition || '')} `;
                break;
            case 'frame':
                header += `frame ${node.frameName || ''} `;
                break;
        }
        header += `${comment_text}{`;

        if (node.noted_lines) {
            // The header as written, through `{`
            header = this.printNotedLines(node.noted_lines);
        }

        the_lines.push(header);
        the_lines.push(this.getStatementTerminator());

        // Increase indent for body
        this.current_indent++;

        // Print body statements
        for (const my_stmt of node.body) {
            the_lines.push(this.printNode(my_stmt));
        }

        the_lines.push(this.printBlockEndingTrivia(node));

        // Decrease indent
        this.current_indent--;

        // Print closing brace
        the_lines.push(`${this.getIndent()}}`);

        return { code: the_lines.join(''), own_line: '' };
    }

    /**
     * Print a statement, or a block's header, as written, because a
     * `///` in it has a note after it. Each line moves with the
     * statement's indentation and keeps its own relative to it. After
     * a `///` with no space before it, whether a line is indented at
     * all decides whether it joins the token before the `///` (`b///`
     * then `c` is `bc`), so such a line at column 0 stays there and an
     * indented one keeps at least one space.
     */
    private printNotedLines(the_lines: SourceLine[]): string {
        const indent = this.getIndent();
        const first_column = the_lines[0]?.column ?? 0;
        return the_lines.map((my_line, i) => {
            if (i === 0) {
                return indent + my_line.text;
            }
            if (my_line.text === '') {
                return '';
            }
            const is_tight = my_line.after_tight_continuation === true;
            if (is_tight && my_line.column === 0) {
                return my_line.text;
            }
            const leading = indent +
                ' '.repeat(Math.max(0, my_line.column - first_column));
            return (is_tight && leading === '' ? ' ' : leading) + my_line.text;
        }).join('\n');
    }

    /**
     * Print a string literal.
     */
    private printStringLiteral(node: StringLiteralNode): string {
        if (node.quoteStyle === 'compound') {
            return `\`"${node.value}"'`;
        } else {
            return `"${node.value}"`;
        }
    }

    /**
     * Print an embedded language block (Mata or Python).
     * Preserves the content unchanged while formatting delimiters.
     */
    private printEmbeddedBlock(node: EmbeddedLanguageBlockNode): string {
        // `capture mata: ...`: the prefixes and the comments among them
        const start = `${this.getIndent()}${this.printPrefixes(node.prefix)}` +
            `${this.printInteriorComments(node)}${node.start_command}`;
        if (node.is_single_line) {
            // For single-line embedded blocks, print everything on one line
            return `${start} ${node.content}`;
        }

        const the_lines: string[] = [];

        // Print start delimiter
        the_lines.push(start);
        the_lines.push(this.getStatementTerminator());

        // Print content unchanged (preserve embedded language code)
        the_lines.push(node.content);

        // Ensure content ends with newline if not single-line
        if (!node.content.endsWith('\n')) {
            the_lines.push('\n');
        }

        // Print end delimiter if present
        if (node.end_command) {
            // Stata ends a Python block only at an `end` in column 0;
            // indenting it would leave the block open.
            const my_end_indent =
                node.language === 'python' && node.end_command === 'end'
                    ? ''
                    : this.getIndent();
            the_lines.push(`${my_end_indent}${node.end_command}`);
        }

        return the_lines.join('');
    }

    /**
     * Print a `syntax` statement. The spec is printed as written: its
     * case sets option abbreviations, and spacing it as an expression
     * would change it.
     */
    private printSyntax(node: SyntaxNode): string {
        if (node.noted_lines) {
            return this.printNotedLines(node.noted_lines);
        }
        const prefix_text = (node.prefix ?? [])
            .map(p => `${this.printPrefix(p)} `)
            .join('');
        const arguments_text = node.arguments ? ` ${node.arguments}` : '';
        // Interior comments go at the end, outside the spec. Under
        // `#delimit ;`, a `;` after a `//` comment goes on the next line.
        const the_parts = [`${this.getIndent()}${prefix_text}syntax${arguments_text}`];
        let at_line_start = false;
        for (const my_comment of node.interiorTrivia ?? []) {
            at_line_start = this.push_interior_comment(
                the_parts, my_comment, at_line_start,
                this.getTerminatorLineIndent());
        }
        return the_parts.join('');
    }

    /**
     * Print leading trivia (comments before a node).
     */
    private printLeadingTrivia(node: StataNode): string {
        if (!this.hasTrivia(node)) {
            return '';
        }

        if (!node.leadingTrivia || node.leadingTrivia.length === 0) {
            return '';
        }

        // A comment is not a statement and takes no terminator. Under
        // `#delimit ;` a `*` comment runs to the next `;`, which the
        // lexer keeps in the comment (`* c;`); after a `//` comment a
        // `;` would be part of it. Either way, an added `;` would grow
        // by one on each format.
        const the_parts: string[] = [];
        for (const my_trivia of node.leadingTrivia) {
            the_parts.push(this.getIndent());
            the_parts.push(this.printTrivia(my_trivia));
            the_parts.push('\n');
        }

        return the_parts.join('');
    }

    /**
     * Print trailing trivia (comments after a node), split by where each
     * comment was in the source. Comments on the node's last line stay
     * on it. The parser also attaches comments from later lines: a
     * comment-only tail at end of file, and comments after `#delimit ;`,
     * which has no terminator token. Those keep their own lines: after
     * code, a `*` comment would read as multiplication.
     */
    private printTrailingTrivia(node: StataNode): { same_line: string; own_line: string } {
        if (!this.hasTrivia(node) || !node.trailingTrivia) {
            return { same_line: '', own_line: '' };
        }

        const the_trivia = node.trailingTrivia;
        let own_line_index = 0;
        let previous_end_line = node.range.end.line;
        const the_parts: string[] = [];
        for (const my_trivia of the_trivia) {
            if (my_trivia.range.start.line > previous_end_line) {
                break;
            }
            the_parts.push(' ');
            the_parts.push(this.printTrivia(my_trivia));
            previous_end_line = my_trivia.range.end.line;
            own_line_index++;
        }
        // Under `#delimit ;` the `;` after a `//` comment would be part
        // of it, so it goes on the next line. `#delimit` ends at the end
        // of its own line.
        const last = the_trivia[own_line_index - 1];
        if (last !== undefined && last.style !== 'block' &&
            node.type !== 'directive' &&
            this.delimiter_mode === 'semicolon') {
            the_parts.push('\n', this.getIndent());
        }

        return {
            same_line: the_parts.join(''),
            own_line: this.printTriviaLines(the_trivia.slice(own_line_index)),
        };
    }

    /**
     * Print comments that start on a line of their own, as in the source:
     * each such comment starts a new line, and a comment that followed
     * another on the same line stays beside it. Like block-ending
     * comments, they are not statements and take no `;`.
     */
    private printTriviaLines(the_trivia: TriviaNode[]): string {
        const the_parts: string[] = [];
        let previous: TriviaNode | undefined;
        for (const my_trivia of the_trivia) {
            if (previous !== undefined &&
                my_trivia.range.start.line <= previous.range.end.line) {
                the_parts.push(' ');
            } else {
                if (previous !== undefined) {
                    the_parts.push('\n');
                }
                the_parts.push(this.getIndent());
            }
            the_parts.push(this.printTrivia(my_trivia));
            previous = my_trivia;
        }
        if (previous !== undefined) {
            the_parts.push('\n');
        }

        return the_parts.join('');
    }

    /**
     * Print comments that belong immediately before a block closer.
     */
    private printBlockEndingTrivia(node: CommandNode | ProgramNode | ControlFlowNode): string {
        if (!node.blockEndingTrivia || node.blockEndingTrivia.length === 0) {
            return '';
        }

        const the_parts: string[] = [];
        for (const my_trivia of node.blockEndingTrivia) {
            the_parts.push(this.getIndent());
            the_parts.push(this.printTrivia(my_trivia));
            // Block-ending comments are not statements and do not take `;` in
            // semicolon-delimit mode, unlike leading trivia before statements.
            the_parts.push('\n');
        }

        return the_parts.join('');
    }

    /**
     * Append a comment from inside a statement to `the_parts`. A block
     * comment stays on the line. A `//` comment ends it: what follows
     * starts on a new line at `next_line_indent`, or, when that is
     * null, the statement's own line break follows. Returns whether
     * the parts now end at the start of a line.
     */
    private push_interior_comment(
        the_parts: string[],
        comment: TriviaNode,
        at_line_start: boolean,
        next_line_indent: string | null
    ): boolean {
        if (!at_line_start) {
            the_parts.push(' ');
        }
        the_parts.push(this.printTrivia(comment));
        if (comment.style === 'block' || next_line_indent === null) {
            return false;
        }
        the_parts.push('\n', next_line_indent);
        return true;
    }

    /**
     * Indentation of the line a statement's `;` moves to after a `//`
     * comment, or null under `#delimit cr`, where the terminator is
     * the line break itself.
     */
    private getTerminatorLineIndent(): string | null {
        return this.delimiter_mode === 'semicolon' ? this.getIndent() : null;
    }

    /**
     * Print a trivia node (comment).
     */
    private printTrivia(trivia: TriviaNode): string {
        // Return the original comment content (already includes markers)
        return trivia.content;
    }

    /**
     * Check if a node can have trivia attached.
     */
    private hasTrivia(node: StataNode): node is
        CommandNode | ProgramNode | MacroDefNode | ControlFlowNode |
        DirectiveNode | EmbeddedLanguageBlockNode | SyntaxNode {
        return (
            node.type === 'command' ||
            node.type === 'program' ||
            node.type === 'macro_def' ||
            node.type === 'directive' ||
            node.type === 'embedded_block' ||
            node.type === 'syntax' ||
            node.type === 'if' ||
            node.type === 'else' ||
            node.type === 'foreach' ||
            node.type === 'forvalues' ||
            node.type === 'while' ||
            node.type === 'frame'
        );
    }

    /**
     * Get the current indentation string.
     */
    private getIndent(): string {
        const indent_char = this.options.indent_style === 'tabs' ? '\t' : ' ';
        const indent_count = this.options.indent_style === 'tabs' 
            ? this.current_indent 
            : this.current_indent * this.options.indent_size;
        return indent_char.repeat(indent_count);
    }

    /** Indentation of a statement's continuation lines: one level in. */
    private getContinuationIndent(): string {
        this.current_indent++;
        const indent = this.getIndent();
        this.current_indent--;
        return indent;
    }

    /**
     * Get the statement terminator based on current delimiter mode.
     */
    private getStatementTerminator(): string {
        if (this.delimiter_mode === 'semicolon') {
            return ';\n';
        } else {
            return '\n';
        }
    }
}

/**
 * Convenience function to print an AST with default options.
 */
export function print_ast(ast: StataAST, options?: Partial<PrintOptions>): string {
    const printer = new PrettyPrinter(options);
    return printer.print(ast, options);
}

/**
 * Convenience function to print a single node with default options.
 */
export function print_node(node: StataNode, options?: Partial<PrintOptions>): string {
    const printer = new PrettyPrinter(options);
    return printer.printNode(node, options);
}

// Re-export expression spacing utility
export { format_expression_spacing, find_protected_regions } from './expression-spacing';
export type { ProtectedRegion } from './expression-spacing';
