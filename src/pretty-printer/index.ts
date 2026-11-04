import {
    StataAST,
    StataNode,
    CommandNode,
    ProgramNode,
    MacroDefNode,
    MacroRefNode,
    ControlFlowNode,
    StringLiteralNode,
    DirectiveNode,
    TriviaNode,
    PrefixNode,
    OptionNode,
    EmbeddedLanguageBlockNode
} from '../types';
import { compare_positions } from '../utils/scope-position';
import { format_expression_spacing } from './expression-spacing';

/**
 * Determines if a space should be omitted between two adjacent varlist tokens.
 * Returns true when tokens are string delimiters that should "stick" together,
 * when the next token is a colon qualifier, or when dealing with wildcard patterns.
 */
function should_omit_space(current: string, next: string): boolean {
    // Whitespace already present
    if (/\s$/.test(current) || /^\s/.test(next)) return true;
    
    // Compound string delimiters: `" and "'
    if (current.endsWith('`"') || next.startsWith(`"'`)) return true;
    
    // Double-quote delimiter adjacent to content
    if (current === '"' || next === '"') return true;
    
    // Wildcard patterns - no space before * or ? when they follow a word-like token
    // This handles patterns like var*, x?, _*
    if ((next === '*' || next === '?') && /^[a-zA-Z0-9_]+$/.test(current)) return true;
    
    return false;
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

        return the_lines.join('');
    }

    /**
     * Print a single AST node to valid Stata source code.
     */
    printNode(node: StataNode, options?: Partial<PrintOptions>): string {
        if (options) {
            this.options = { ...this.options, ...options };
        }

        let result = '';

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
            case 'frame':
                result += this.printControlFlow(node);
                break;
            case 'string':
                result += this.printStringLiteral(node);
                break;
            case 'embedded_block':
                result += this.printEmbeddedBlock(node);
                break;
            default:
                // Unknown node type - should not happen
                break;
        }

        // Print trailing trivia (comments after the node)
        result += this.printTrailingTrivia(node);

        // Add statement terminator
        result += this.getStatementTerminator();

        return result;
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
        // (`infix id 1-3 using f`). Varlist neighbors keep their spacing
        // rules; extra args, already grouped by adjacency, are attached only
        // where the source had no gap (`gen x:lbl = 1`).
        // For unab commands with has_colon_before_varlist, emit colon after macro name
        // An interior block comment goes back before the argument that
        // followed it in the source. One after the last argument goes at
        // the end of the statement, outside the expression, qualifiers,
        // and options, which are printed from strings.
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
            while (comment_index < the_comments.length &&
                compare_positions(
                    the_comments[comment_index].range.end,
                    my_entry.item.range.start) <= 0) {
                the_parts.push(' ', this.printTrivia(the_comments[comment_index]));
                comment_index++;
                after_comment = true;
            }
            if (previous === undefined || after_comment) {
                the_parts.push(' ');
            } else {
                const is_attached =
                    previous.item.range.end.line === my_entry.item.range.start.line &&
                    previous.item.range.end.character === my_entry.item.range.start.character;
                const omit_space = my_entry.is_extra || previous.is_extra
                    ? is_attached
                    : should_omit_space(previous.item.name, my_entry.item.name);
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

        for (const my_comment of the_comments.slice(comment_index)) {
            the_parts.push(' ', this.printTrivia(my_comment));
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
                // Prefix brace block: prefixes are already in the_parts
                // We need to remove the trailing space and '{' that were added as command name
                // Expected state: [..., 'prefix', ' ', '{']
                // We want: [..., 'prefix', ' {']
                
                // Remove the '{' command name we added earlier
                if (the_parts.length > 0 && the_parts[the_parts.length - 1] === '{') {
                    the_parts.pop();
                }
                // Remove trailing space after command name (which was '{')
                if (the_parts.length > 0 && the_parts[the_parts.length - 1] === ' ') {
                    the_parts.pop();
                }
                the_parts.push(' {');
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
        const prefix_text = (node.prefix ?? [])
            .map(p => `${this.printPrefix(p)} `)
            .join('');
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

        // Interior block comments go at the end, outside the value.
        const the_comments = (node.interiorTrivia ?? [])
            .map(my_comment => ` ${this.printTrivia(my_comment)}`);
        return statement + the_comments.join('');
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
    private printControlFlow(node: ControlFlowNode): string {
        const prefix_text = (node.prefix ?? [])
            .map(p => `${this.printPrefix(p)} `)
            .join('');
        if (node.type === 'if' && node.is_single_statement) {
            const body_node = node.body[0];
            const body = body_node ? this.printNode(body_node) : '';
            // The enclosing node supplies indentation and the one statement
            // terminator shared by the condition and its inline command.
            const inline_body = body
                .trimStart()
                .slice(0, -this.getStatementTerminator().length);
            // Preserve expression fragments, comments, and Unicode names.
            return `${this.getIndent()}${prefix_text}if ${node.condition || ''} ${inline_body}`;
        }

        const the_lines: string[] = [];

        // Print the control flow header
        let header = this.getIndent() + prefix_text;

        switch (node.type) {
            case 'if':
                header += `if ${this.normalizeCondition(node.condition || '')} {`;
                break;
            case 'else':
                header += 'else {';
                break;
            case 'foreach':
                header += `foreach ${node.loopVar || ''} ${format_expression_spacing(node.loopSpec || '')} {`;
                break;
            case 'forvalues':
                header += `forvalues ${node.loopVar || ''} ${format_expression_spacing(node.loopSpec || '')} {`;
                break;
            case 'while':
                header += `while ${this.normalizeCondition(node.condition || '')} {`;
                break;
            case 'frame':
                header += `frame ${node.frameName || ''} {`;
                break;
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

        return the_lines.join('');
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
        if (node.is_single_line) {
            // For single-line embedded blocks, print everything on one line
            return `${this.getIndent()}${node.start_command} ${node.content}`;
        }

        const the_lines: string[] = [];

        // Print start delimiter
        the_lines.push(`${this.getIndent()}${node.start_command}`);
        the_lines.push(this.getStatementTerminator());

        // Print content unchanged (preserve embedded language code)
        the_lines.push(node.content);

        // Ensure content ends with newline if not single-line
        if (!node.content.endsWith('\n')) {
            the_lines.push('\n');
        }

        // Print end delimiter if present
        if (node.end_command) {
            the_lines.push(`${this.getIndent()}${node.end_command}`);
        }

        return the_lines.join('');
    }

    /**
     * Print leading trivia (comments before a node).
     */
    private printLeadingTrivia(node: StataNode): string {
        if (!this.hasTrivia(node)) {
            return '';
        }

        const trivia_node = node as CommandNode | ProgramNode | MacroDefNode | ControlFlowNode | DirectiveNode | EmbeddedLanguageBlockNode;
        if (!trivia_node.leadingTrivia || trivia_node.leadingTrivia.length === 0) {
            return '';
        }

        const the_parts: string[] = [];
        for (const my_trivia of trivia_node.leadingTrivia) {
            the_parts.push(this.getIndent());
            the_parts.push(this.printTrivia(my_trivia));
            the_parts.push(this.getStatementTerminator());
        }

        return the_parts.join('');
    }

    /**
     * Print trailing trivia (comments after a node).
     */
    private printTrailingTrivia(node: StataNode): string {
        if (!this.hasTrivia(node)) {
            return '';
        }

        const trivia_node = node as CommandNode | ProgramNode | MacroDefNode | ControlFlowNode | DirectiveNode | EmbeddedLanguageBlockNode;
        if (!trivia_node.trailingTrivia || trivia_node.trailingTrivia.length === 0) {
            return '';
        }

        const the_parts: string[] = [];
        for (const my_trivia of trivia_node.trailingTrivia) {
            // Trailing trivia on same line - add space before
            the_parts.push(' ');
            the_parts.push(this.printTrivia(my_trivia));
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
     * Print a trivia node (comment).
     */
    private printTrivia(trivia: TriviaNode): string {
        // Return the original comment content (already includes markers)
        return trivia.content;
    }

    /**
     * Check if a node can have trivia attached.
     */
    private hasTrivia(node: StataNode): boolean {
        return (
            node.type === 'command' ||
            node.type === 'program' ||
            node.type === 'macro_def' ||
            node.type === 'directive' ||
            node.type === 'embedded_block' ||
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
