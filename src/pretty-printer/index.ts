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
    IdentifierNode,
    EmbeddedLanguageBlockNode
} from '../types';

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

        // Print variable list
        if (node.varlist && node.varlist.length > 0) {
            the_parts.push(' ');
            const the_var_names = node.varlist.map(v => v.name);
            the_parts.push(the_var_names.join(' '));
        }

        // Print expression (assignment)
        if (node.expression) {
            the_parts.push(' = ');
            the_parts.push(node.expression);
        }

        // Print if-qualifier
        if (node.ifExpression) {
            the_parts.push(' if ');
            the_parts.push(node.ifExpression);
        }

        // Print in-qualifier
        if (node.inExpression) {
            the_parts.push(' in ');
            the_parts.push(node.inExpression);
        }

        // Print options (after comma)
        if (node.options && node.options.length > 0) {
            the_parts.push(', ');
            const the_option_strs = node.options.map(o => this.printOption(o));
            the_parts.push(the_option_strs.join(' '));
        }

        return the_parts.join('');
    }

    /**
     * Print a prefix command.
     */
    private printPrefix(prefix: PrefixNode): string {
        let result = prefix.name;

        // Handle 'by' prefix with variable list
        if (prefix.varlist && prefix.varlist.length > 0) {
            result += ' ' + prefix.varlist.join(' ');
        }

        // Add colon for by prefix
        if (prefix.name === 'by') {
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
            result += `(${option.argument})`;
        }

        return result;
    }

    /**
     * Print a program definition.
     */
    private printProgram(node: ProgramNode): string {
        const the_lines: string[] = [];

        // Print program header
        the_lines.push(`${this.getIndent()}program define ${node.name}`);
        the_lines.push(this.getStatementTerminator());

        // Increase indent for body
        this.current_indent++;

        // Print body statements
        for (const my_stmt of node.body) {
            the_lines.push(this.printNode(my_stmt));
        }

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
        const scope_keyword = node.scope;
        
        // Handle extended macro functions (e.g., local x : list posof "y" in z)
        if (node.extendedFunction) {
            const func = node.extendedFunction;
            const args_part = func.args ? ` ${func.args}` : '';
            return `${this.getIndent()}${scope_keyword} ${node.name} : ${func.name}${args_part}`.trimEnd();
        }
        
        // Use '=' if the original definition had it
        if (node.hasEquals) {
            return `${this.getIndent()}${scope_keyword} ${node.name} = ${node.value}`.trimEnd();
        }
        
        return `${this.getIndent()}${scope_keyword} ${node.name} ${node.value}`.trimEnd();
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
     * Print a control flow statement (if, else, foreach, forvalues, while).
     */
    private printControlFlow(node: ControlFlowNode): string {
        const the_lines: string[] = [];

        // Print the control flow header
        let header = this.getIndent();

        switch (node.type) {
            case 'if':
                header += `if ${node.condition || ''} {`;
                break;
            case 'else':
                header += 'else {';
                break;
            case 'foreach':
                header += `foreach ${node.loopVar || ''} ${node.loopSpec || ''} {`;
                break;
            case 'forvalues':
                header += `forvalues ${node.loopVar || ''} ${node.loopSpec || ''} {`;
                break;
            case 'while':
                header += `while ${node.condition || ''} {`;
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
        const the_lines: string[] = [];

        // Print start delimiter
        the_lines.push(`${this.getIndent()}${node.start_command}`);
        the_lines.push(this.getStatementTerminator());

        // Print content unchanged (preserve embedded language code)
        the_lines.push(node.content);

        // Ensure content ends with newline if not single-line
        if (!node.is_single_line && !node.content.endsWith('\n')) {
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
            node.type === 'while'
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
