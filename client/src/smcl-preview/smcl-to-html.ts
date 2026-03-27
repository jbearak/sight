/**
 * SMCL-to-HTML Renderer
 *
 * Converts SMCL (Stata Markup Control Language) content to HTML for
 * webview display. Handles nested directives, two-column tables,
 * synopt tables, paragraph modes, and cross-reference links.
 */

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface SmclHtmlResult {
    html: string;
    cross_references: SmclCrossRef[];
}

export interface SmclCrossRef {
    topic: string;
    display_text: string;
    element_id: string;
}

// ---------------------------------------------------------------------------
// Character escape table for {c ...} directives
// ---------------------------------------------------------------------------

const CHAR_MAP: Record<string, string> = {
    '-(': '{',
    ')-': '}',
    'S|': '$',
    "'g": '`',
    '-': '\u2500',   // box-drawing horizontal
    '|': '\u2502',   // box-drawing vertical
    '+': '\u253C',   // box-drawing cross
    'TT': '\u252C',  // top T
    'BT': '\u2534',  // bottom T
    'LT': '\u251C',  // left T
    'RT': '\u2524',  // right T
    'TLC': '\u250C', // top-left corner
    'TRC': '\u2510', // top-right corner
    'BLC': '\u2514', // bottom-left corner
    'BRC': '\u2518', // bottom-right corner
};

// ---------------------------------------------------------------------------
// HTML escaping
// ---------------------------------------------------------------------------

function escape_html(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// SMCL Tokenizer (recursive-descent, handles nested braces)
// ---------------------------------------------------------------------------

interface SmclDirective {
    name: string;
    args: string;
    content: SmclNode[];
    line?: number;
}

interface SmclText {
    text: string;
    line?: number;
}

type SmclNode = SmclDirective | SmclText;

function is_directive(node: SmclNode): node is SmclDirective {
    return 'name' in node;
}

/**
 * Directives whose arguments may contain colons that are NOT
 * content separators. For these directives, everything between
 * the name and the closing brace is treated as args (no recursive
 * content parsing on `:`)
 */
const ARGS_ONLY_DIRECTIVES = new Set([
    'opt', 'opth', 'cmdab', 'browse', 'c', 'char',
    'viewerjumpto', 'viewerdialog', 'mansection',
    'marker', 'col', 'space', 'hline', 'dup',
    'p', 'p2colset',
]);

/**
 * Parse SMCL source into a tree of nodes. Handles nested directives
 * like {synopt:{opt vce(robust)}}.
 */
function build_line_offsets(source: string): number[] {
    const the_offsets: number[] = [0];
    for (let i = 0; i < source.length; i++) {
        if (source[i] === '\n') {
            the_offsets.push(i + 1);
        }
    }
    return the_offsets;
}

function line_of(offset: number, line_offsets: number[]): number {
    // Binary search for the line containing this offset
    let lo = 0;
    let hi = line_offsets.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (line_offsets[mid] <= offset) {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    return lo;
}

function parse_smcl(source: string): SmclNode[] {
    let pos = 0;
    const the_line_offsets = build_line_offsets(source);

    function current_line(): number {
        return line_of(pos, the_line_offsets);
    }

    function parse_nodes(stop_at_close_brace: boolean): SmclNode[] {
        const the_nodes: SmclNode[] = [];
        let text_start = pos;

        while (pos < source.length) {
            const my_char = source[pos];

            if (my_char === '{') {
                // Flush accumulated text
                if (pos > text_start) {
                    the_nodes.push({
                        text: source.substring(text_start, pos),
                        line: line_of(text_start, the_line_offsets),
                    });
                }

                const my_directive = parse_directive();
                if (my_directive) {
                    the_nodes.push(my_directive);
                }
                text_start = pos;
            } else if (my_char === '}' && stop_at_close_brace) {
                // Flush text before the brace
                if (pos > text_start) {
                    the_nodes.push({
                        text: source.substring(text_start, pos),
                        line: line_of(text_start, the_line_offsets),
                    });
                }
                pos++; // consume '}'
                return the_nodes;
            } else {
                pos++;
            }
        }

        // Flush remaining text
        if (pos > text_start) {
            the_nodes.push({
                text: source.substring(text_start, pos),
                line: line_of(text_start, the_line_offsets),
            });
        }
        return the_nodes;
    }

    function parse_directive(): SmclDirective | null {
        const my_directive_line = current_line();
        pos++; // consume '{'

        // Skip leading whitespace
        while (pos < source.length && source[pos] === ' ') pos++;

        // Read directive name
        const name_start = pos;
        while (
            pos < source.length &&
            source[pos] !== '}' &&
            source[pos] !== ':' &&
            source[pos] !== ' ' &&
            source[pos] !== '\n'
        ) {
            pos++;
        }
        const my_name = source.substring(name_start, pos);

        // Handle special case: {*:comment} - skip to matching }
        if (my_name === '*') {
            let brace_depth = 0;
            while (pos < source.length) {
                if (source[pos] === '{') brace_depth++;
                else if (source[pos] === '}') {
                    if (brace_depth === 0) { pos++; break; }
                    brace_depth--;
                }
                pos++;
            }
            return null;
        }

        // Handle special case: {...} continuation
        if (my_name === '...' || my_name === '.-') {
            while (pos < source.length && source[pos] !== '}') pos++;
            if (pos < source.length) pos++; // consume '}'
            if (my_name === '...') {
                return { name: '...', args: '', content: [], line: my_directive_line };
            }
            return { name: '.-', args: '', content: [], line: my_directive_line };
        }

        const is_args_only = ARGS_ONLY_DIRECTIVES.has(
            my_name.toLowerCase()
        );

        // For args-only directives, collect everything to } as args
        if (is_args_only) {
            // Skip optional space after name
            if (pos < source.length && source[pos] === ' ') pos++;
            // Also skip colon if present (some args-only directives
            // have the form {c -(} with no colon, but {cmdab:x:y} has)
            if (pos < source.length && source[pos] === ':') pos++;

            const args_start = pos;
            let brace_depth = 0;
            while (pos < source.length) {
                if (source[pos] === '{') {
                    brace_depth++;
                } else if (source[pos] === '}') {
                    if (brace_depth === 0) break;
                    brace_depth--;
                }
                pos++;
            }
            const my_raw_args = source.substring(args_start, pos).trim();
            if (pos < source.length) pos++; // consume '}'
            return { name: my_name, args: my_raw_args, content: [], line: my_directive_line };
        }

        // Read args (between name and colon, or name and closing brace)
        let my_args = '';
        if (pos < source.length && source[pos] === ' ') {
            // There are arguments before a potential colon
            pos++; // skip space
            const args_start = pos;
            // Read until colon or closing brace, but be careful with
            // nested braces in arguments
            let brace_depth = 0;
            while (pos < source.length) {
                if (source[pos] === '{') {
                    brace_depth++;
                } else if (source[pos] === '}') {
                    if (brace_depth === 0) break;
                    brace_depth--;
                } else if (source[pos] === ':' && brace_depth === 0) {
                    break;
                }
                pos++;
            }
            my_args = source.substring(args_start, pos).trim();
        }

        // Check if there's content after a colon
        const the_content: SmclNode[] = [];
        if (pos < source.length && source[pos] === ':') {
            pos++; // consume ':'
            // Parse content recursively until matching '}'
            the_content.push(...parse_nodes(true));
        } else {
            // No colon - skip to closing brace
            // But the args may already contain everything we need
            if (pos < source.length && source[pos] === '}') {
                pos++; // consume '}'
            }
        }

        return { name: my_name, args: my_args, content: the_content, line: my_directive_line };
    }

    return parse_nodes(false);
}

// ---------------------------------------------------------------------------
// Rendering context
// ---------------------------------------------------------------------------

interface RenderContext {
    cross_references: SmclCrossRef[];
    ref_counter: number;
    in_synopt_table: boolean;
    synopt_col_width: number;
    in_p2col: boolean;
    p2col_widths: number[];
    pending_continuation: boolean;
    in_table_row: boolean;
    active_style: string | null;
    active_formats: string[];
}

function create_context(): RenderContext {
    return {
        cross_references: [],
        ref_counter: 0,
        in_synopt_table: false,
        synopt_col_width: 20,
        in_p2col: false,
        p2col_widths: [5, 19, 21, 2],
        pending_continuation: false,
        in_table_row: false,
        active_style: null,
        active_formats: [],
    };
}

function switch_style(ctx: RenderContext, new_style: string): string {
    const my_close = ctx.active_style ? '</span>' : '';
    ctx.active_style = new_style;
    return `${my_close}<span class="smcl-${new_style}">`;
}

const FORMAT_TAGS: Record<string, { open: string; close: string }> = {
    'bf': { open: '<strong>', close: '</strong>' },
    'it': { open: '<em>', close: '</em>' },
    'ul': { open: '<u>', close: '</u>' },
};

function push_format(ctx: RenderContext, fmt: string): string {
    ctx.active_formats.push(fmt);
    return FORMAT_TAGS[fmt].open;
}

function close_all_formats(ctx: RenderContext): string {
    let result = '';
    while (ctx.active_formats.length > 0) {
        const my_fmt = ctx.active_formats.pop()!;
        result += FORMAT_TAGS[my_fmt].close;
    }
    return result;
}

// ---------------------------------------------------------------------------
// data-line attribute helper
// ---------------------------------------------------------------------------

function data_line_attr(node: SmclNode): string {
    if (node.line !== undefined) {
        return ` data-line="${node.line}"`;
    }
    return '';
}

// ---------------------------------------------------------------------------
// Node rendering
// ---------------------------------------------------------------------------

function render_nodes(
    the_nodes: SmclNode[],
    ctx: RenderContext
): string {
    const the_parts: string[] = [];

    for (let i = 0; i < the_nodes.length; i++) {
        const my_node = the_nodes[i];

        if (is_directive(my_node)) {
            the_parts.push(render_directive(my_node, ctx));
        } else {
            let my_text = my_node.text;
            // Handle line continuation: if previous was {...}, join lines
            if (ctx.pending_continuation) {
                my_text = my_text.replace(/^\n/, '');
                ctx.pending_continuation = false;
            }
            // Wrap text with data-line for scroll sync anchors
            if (my_node.line !== undefined) {
                the_parts.push(
                    `<span${data_line_attr(my_node)}>${escape_html(my_text)}</span>`
                );
            } else {
                the_parts.push(escape_html(my_text));
            }
        }
    }

    return the_parts.join('');
}

function render_content(
    directive: SmclDirective,
    ctx: RenderContext
): string {
    if (directive.content.length > 0) {
        return render_nodes(directive.content, ctx);
    }
    return escape_html(directive.args);
}

function render_directive(
    directive: SmclDirective,
    ctx: RenderContext
): string {
    const my_name = directive.name.toLowerCase();

    switch (my_name) {
        // -- Document control --
        case 'smcl':
        case 's6hlp':
            return '';
        case 'reset': {
            const my_fmt_close = close_all_formats(ctx);
            const my_style_close = ctx.active_style ? '</span>' : '';
            ctx.active_style = null;
            return my_fmt_close + my_style_close;
        }
        case '...':
            ctx.pending_continuation = true;
            return '';
        case '.-':
            return `<hr class="smcl-hline"${data_line_attr(directive)}>`;

        // -- Asis mode --
        case 'asis':
            return '<pre class="smcl-asis">';

        // -- Text formatting (scoped: {bf:text}) --
        case 'bf':
            if (directive.content.length > 0) {
                return `<strong>${render_content(directive, ctx)}</strong>`;
            }
            return push_format(ctx, 'bf');
        case 'it':
            if (directive.content.length > 0) {
                return `<em>${render_content(directive, ctx)}</em>`;
            }
            return push_format(ctx, 'it');
        case 'ul':
            if (directive.content.length > 0) {
                return `<u>${render_content(directive, ctx)}</u>`;
            }
            if (directive.args === 'off') {
                // Close the most recent 'ul' format
                const my_idx = ctx.active_formats.lastIndexOf('ul');
                if (my_idx >= 0) {
                    ctx.active_formats.splice(my_idx, 1);
                    return '</u>';
                }
                return '';
            }
            return push_format(ctx, 'ul');
        case 'sf':
        case 'rm':
            // Reset font face: close all open formats
            return close_all_formats(ctx) + switch_style(ctx, 'txt');

        // -- Color/style modes --
        case 'txt':
        case 'text':
            if (directive.content.length > 0) {
                return `<span class="smcl-txt">${render_content(directive, ctx)}</span>`;
            }
            return switch_style(ctx, 'txt');
        case 'com':
            if (directive.content.length > 0) {
                return `<span class="smcl-com">${render_content(directive, ctx)}</span>`;
            }
            return switch_style(ctx, 'com');
        case 'cmd':
            return `<code class="smcl-cmd">${render_content(directive, ctx)}</code>`;
        case 'cmdab':
            return render_cmdab(directive);
        case 'res':
        case 'result':
            if (directive.content.length > 0) {
                return `<span class="smcl-res">${render_content(directive, ctx)}</span>`;
            }
            return switch_style(ctx, 'res');
        case 'err':
        case 'error':
            if (directive.content.length > 0) {
                return `<span class="smcl-err">${render_content(directive, ctx)}</span>`;
            }
            return switch_style(ctx, 'err');
        case 'inp':
        case 'input':
            if (directive.content.length > 0) {
                return `<span class="smcl-inp">${render_content(directive, ctx)}</span>`;
            }
            return switch_style(ctx, 'inp');
        case 'hi':
        case 'hilite':
            if (directive.content.length > 0) {
                return `<span class="smcl-hi">${render_content(directive, ctx)}</span>`;
            }
            return switch_style(ctx, 'hi');

        // -- Semantic text --
        case 'opt':
            return render_opt(directive, ctx);
        case 'opth':
            return render_opth(directive, ctx);

        // -- Paragraph mode --
        case 'p':
            return render_paragraph_open(directive);
        case 'p_end':
            if (ctx.in_table_row) {
                ctx.in_table_row = false;
                return '</td></tr>';
            }
            return '</p>';
        case 'pstd':
            return `<p class="smcl-pstd"${data_line_attr(directive)}>`;
        case 'psee':
            return `<p class="smcl-psee"${data_line_attr(directive)}>`;
        case 'phang':
            return `<p class="smcl-phang"${data_line_attr(directive)}>`;
        case 'phang2':
            return `<p class="smcl-phang2"${data_line_attr(directive)}>`;
        case 'phang3':
            return `<p class="smcl-phang3"${data_line_attr(directive)}>`;
        case 'pmore':
            return `<p class="smcl-pmore"${data_line_attr(directive)}>`;
        case 'pmore2':
            return `<p class="smcl-pmore2"${data_line_attr(directive)}>`;
        case 'pmore3':
            return `<p class="smcl-pmore3"${data_line_attr(directive)}>`;
        case 'pin':
            return `<p class="smcl-pin"${data_line_attr(directive)}>`;
        case 'pin2':
            return `<p class="smcl-pin2"${data_line_attr(directive)}>`;
        case 'pin3':
            return `<p class="smcl-pin3"${data_line_attr(directive)}>`;


        // -- Line control --
        case 'bind':
            return `<span class="smcl-bind">${render_content(directive, ctx)}</span>`;
        case 'break':
            return '<br>';

        // -- Layout --
        case 'hline':
            return render_hline(directive);
        case 'col':
            return render_col(directive);
        case 'space':
            return render_space(directive);
        case 'tab':
            return '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;';
        case 'center':
        case 'centre':
            return `<div class="smcl-center"${data_line_attr(directive)}>${render_content(directive, ctx)}</div>`;
        case 'right':
            return `<div class="smcl-right"${data_line_attr(directive)}>${render_content(directive, ctx)}</div>`;
        case 'lalign': {
            const my_width = parse_first_number(directive.args);
            const my_style = my_width
                ? ` style="display:inline-block;min-width:${my_width}ch;text-align:left"`
                : '';
            return `<span class="smcl-lalign"${my_style}>${render_content(directive, ctx)}</span>`;
        }
        case 'ralign': {
            const my_width = parse_first_number(directive.args);
            const my_style = my_width
                ? ` style="display:inline-block;min-width:${my_width}ch;text-align:right"`
                : '';
            return `<span class="smcl-ralign"${my_style}>${render_content(directive, ctx)}</span>`;
        }
        case 'dup': {
            // Args-only: args is "3:abc" for {dup 3:abc}
            const my_dup_match = directive.args.match(/^(\d+):(.*)$/);
            if (my_dup_match) {
                const my_count = parseInt(my_dup_match[1], 10);
                const my_text = escape_html(my_dup_match[2]);
                return my_text.repeat(my_count);
            }
            return escape_html(directive.args);
        }

        // -- Titles and headings --
        case 'title':
            return `<h2 class="smcl-title"${data_line_attr(directive)}>${render_content(directive, ctx)}</h2>`;
        case 'dlgtab':
            return `<h3 class="smcl-dlgtab"${data_line_attr(directive)}>${render_content(directive, ctx)}</h3>`;

        // -- Synopt tables --
        case 'synoptset':
            return render_synoptset(directive, ctx);
        case 'synopthdr':
            return render_synopthdr(directive, ctx);
        case 'synoptline':
            return render_synoptline(ctx);
        case 'syntab':
            return render_syntab(directive, ctx);
        case 'synopt':
            return render_synopt(directive, ctx);

        // -- Two-column layout --
        case 'p2colset':
            return render_p2colset(directive, ctx);
        case 'p2col':
            return render_p2col(directive, ctx);
        case 'p2colreset': {
            let my_close = '';
            if (ctx.in_synopt_table) {
                ctx.in_synopt_table = false;
                my_close += '</tbody></table>';
            }
            if (ctx.in_p2col) {
                ctx.in_p2col = false;
                my_close += '</table>';
            }
            return my_close || '</table>';
        }
        case 'p2line':
            return '<tr><td colspan="2"><hr class="smcl-hline"></td></tr>';
        case 'p2coldent':
            return render_p2col(directive, ctx);
        case 'p2colhdr':
            return '';

        // -- Links --
        case 'help':
            return render_help_link(directive, ctx, false, false);
        case 'helpb':
            return render_help_link(directive, ctx, true, false);
        case 'manhelp':
            return render_manhelp(directive, ctx, false);
        case 'manhelpi':
            return render_manhelp(directive, ctx, true);
        case 'manlink':
            return render_manlink(directive, ctx, false);
        case 'manlinki':
            return render_manlink(directive, ctx, true);
        case 'mansection':
            return render_mansection(directive);
        case 'browse':
            return render_browse(directive, ctx);
        case 'marker':
            return render_marker(directive);
        case 'viewerjumpto':
            return render_viewerjumpto(directive);
        case 'viewerdialog':
            return '';
        case 'stata':
            return render_stata_link(directive, ctx);
        case 'dialog':
            return render_content(directive, ctx);
        case 'view':
            return render_content(directive, ctx);
        case 'search':
            return render_content(directive, ctx);
        case 'findalias':
            return '';

        // -- Special characters --
        case 'c':
        case 'char':
            return render_char(directive);

        // -- Syntax variable placeholders --
        case 'varname':
        case 'newvar':
        case 'varlist':
        case 'vars':
        case 'depvar':
        case 'depvars':
        case 'indepvars':
        case 'dtype':
            return `<em class="smcl-varplaceholder">${my_name}</em>`;
        case 'ifin':
            return '<span class="smcl-ifin">[<em>if</em>] [<em>in</em>]</span>';
        case 'weight':
            return '<span class="smcl-weight">[<em>weight</em>]</span>';

        default:
            // Unknown directive: render content or args as plain text
            if (directive.content.length > 0) {
                return render_content(directive, ctx);
            }
            if (directive.args) {
                return escape_html(directive.args);
            }
            return '';
    }
}

// ---------------------------------------------------------------------------
// Directive-specific renderers
// ---------------------------------------------------------------------------

function render_cmdab(directive: SmclDirective): string {
    // {cmdab:ab:rest} -> <code><u>ab</u>rest</code>
    const my_text = directive.args ||
        directive.content.map(n => 'text' in n ? n.text : '').join('');
    const the_parts = my_text.split(':');
    if (the_parts.length >= 2) {
        const my_abbrev = escape_html(the_parts[0]);
        const my_rest = escape_html(the_parts.slice(1).join(':'));
        return `<code class="smcl-cmd"><u>${my_abbrev}</u>${my_rest}</code>`;
    }
    return `<code class="smcl-cmd">${escape_html(my_text)}</code>`;
}

function render_opt(
    directive: SmclDirective,
    ctx: RenderContext
): string {
    // Multiple forms:
    // {opt name} {opt name(arg)} {opt ab:rest} {opt ab:rest(arg)}
    const my_text = directive.content.length > 0
        ? render_content(directive, ctx)
        : escape_html(directive.args);

    // Check for abbreviation pattern (contains colon not from nested content)
    if (directive.args && directive.args.includes(':')) {
        const colon_pos = directive.args.indexOf(':');
        const my_abbrev = escape_html(directive.args.substring(0, colon_pos));
        const my_rest = escape_html(directive.args.substring(colon_pos + 1));
        return `<code class="smcl-opt"><u>${my_abbrev}</u>${my_rest}</code>`;
    }

    return `<code class="smcl-opt">${my_text}</code>`;
}

function render_opth(
    directive: SmclDirective,
    ctx: RenderContext
): string {
    // Like {opt} but argument type is a help link
    const my_text = directive.content.length > 0
        ? render_content(directive, ctx)
        : escape_html(directive.args);
    return `<code class="smcl-opt">${my_text}</code>`;
}

function render_paragraph_open(directive: SmclDirective): string {
    const my_dl = data_line_attr(directive);
    if (!directive.args) {
        return `<p class="smcl-p"${my_dl}>`;
    }
    // {p #1 #2 #3} - indent parameters
    const the_nums = directive.args.split(/\s+/).map(Number);
    const my_first = the_nums[0] || 0;
    const my_cont = the_nums[1] || 0;
    const indent_ch = my_cont * 0.6;
    const text_indent_ch = (my_first - my_cont) * 0.6;
    return `<p class="smcl-p"${my_dl} style="margin-left:${indent_ch}ch;text-indent:${text_indent_ch}ch">`;
}

function render_hline(directive: SmclDirective): string {
    const my_width = parse_first_number(directive.args);
    if (my_width) {
        const my_line = '\u2500'.repeat(my_width);
        return `<span class="smcl-hline-inline">${my_line}</span>`;
    }
    return `<hr class="smcl-hline"${data_line_attr(directive)}>`;
}

function render_col(directive: SmclDirective): string {
    const my_col = parse_first_number(directive.args);
    if (my_col) {
        return `<span class="smcl-col" style="display:inline-block;min-width:${my_col}ch"></span>`;
    }
    return '';
}

function render_space(directive: SmclDirective): string {
    const my_count = parse_first_number(directive.args) || 1;
    return '&nbsp;'.repeat(my_count);
}

// -- Synopt tables --

function render_synoptset(
    directive: SmclDirective,
    ctx: RenderContext
): string {
    // Implicitly close any previous open table
    let my_prefix = '';
    if (ctx.in_synopt_table) {
        my_prefix += '</tbody></table>';
    }
    if (ctx.in_p2col) {
        my_prefix += '</table>';
        ctx.in_p2col = false;
    }
    const my_width = parse_first_number(directive.args) || 20;
    ctx.in_synopt_table = true;
    ctx.synopt_col_width = my_width;
    return `${my_prefix}<table class="smcl-synopt-table"${data_line_attr(directive)}>`;
}

function render_synopthdr(
    directive: SmclDirective,
    ctx: RenderContext
): string {
    const my_heading = directive.args || 'Options';
    const my_left = directive.content.length > 0
        ? render_content(directive, ctx)
        : escape_html(my_heading);
    return [
        '<thead><tr class="smcl-synopthdr">',
        `<th class="smcl-synopt-col1">${my_left}</th>`,
        '<th class="smcl-synopt-col2">Description</th>',
        '</tr></thead><tbody>',
        '<tr class="smcl-synoptline"><td colspan="2"><hr></td></tr>',
    ].join('');
}

function render_synoptline(ctx: RenderContext): string {
    if (!ctx.in_synopt_table) return '<hr class="smcl-hline">';
    return '<tr class="smcl-synoptline"><td colspan="2"><hr></td></tr>';
}

function render_syntab(
    directive: SmclDirective,
    ctx: RenderContext
): string {
    const my_text = render_content(directive, ctx);
    if (ctx.in_synopt_table) {
        return `<tr class="smcl-syntab"${data_line_attr(directive)}><td colspan="2"><strong>${my_text}</strong></td></tr>`;
    }
    return `<h4 class="smcl-syntab-heading"${data_line_attr(directive)}>${my_text}</h4>`;
}

function render_synopt(
    directive: SmclDirective,
    ctx: RenderContext
): string {
    // {synopt:option_text}description text{p_end}
    // The content between : and } is the first column (option).
    // Text after the directive until {p_end} forms the second column,
    // but in our parsed tree, the content is inside the directive.
    const my_option_html = render_content(directive, ctx);
    // The description comes after this node as sibling text/nodes,
    // terminated by {p_end}. We render the option cell here;
    // the parent caller handles the description.
    if (ctx.in_synopt_table) {
        ctx.in_table_row = true;
        return `<tr class="smcl-synopt-row"${data_line_attr(directive)}><td class="smcl-synopt-col1">${my_option_html}</td><td class="smcl-synopt-col2">`;
    }
    return `<div class="smcl-synopt-inline">${my_option_html}</div>`;
}

// -- Two-column layout --

function render_p2colset(
    directive: SmclDirective,
    ctx: RenderContext
): string {
    const the_nums = (directive.args || '').split(/\s+/).map(Number);
    ctx.in_p2col = true;
    ctx.p2col_widths = [
        the_nums[0] || 5,
        the_nums[1] || 19,
        the_nums[2] || 21,
        the_nums[3] || 2,
    ];
    return `<table class="smcl-p2col-table"${data_line_attr(directive)}>`;
}

function render_p2col(
    directive: SmclDirective,
    ctx: RenderContext
): string {
    const my_first_col = render_content(directive, ctx);
    // Second column text comes as sibling nodes until {p_end}
    ctx.in_table_row = true;
    return `<tr class="smcl-p2col-row"${data_line_attr(directive)}><td class="smcl-p2col-col1">${my_first_col}</td><td class="smcl-p2col-col2">`;
}

// -- Links --

function render_help_link(
    directive: SmclDirective,
    ctx: RenderContext,
    bold: boolean,
    italic: boolean
): string {
    // {help topic} or {help topic:display_text}
    const my_topic = directive.args || '';
    const my_display = directive.content.length > 0
        ? render_content(directive, ctx)
        : escape_html(my_topic);

    // Extract topic name (may have ## suffix for anchor)
    const my_topic_name = my_topic.split('#')[0].split(' ')[0].trim();

    const my_id = `smcl-ref-${ctx.ref_counter++}`;
    ctx.cross_references.push({
        topic: my_topic_name,
        display_text: my_topic,
        element_id: my_id,
    });

    let my_html =
        `<a class="smcl-help-link" id="${my_id}" ` +
        `href="#" data-smcl-topic="${escape_html(my_topic_name)}"` +
        `>${my_display}</a>`;
    if (bold) my_html = `<strong>${my_html}</strong>`;
    if (italic) my_html = `<em>${my_html}</em>`;
    return my_html;
}

function render_manhelp(
    directive: SmclDirective,
    ctx: RenderContext,
    italic: boolean
): string {
    // {manhelp topic MANUAL} or {manhelp topic MANUAL:display}
    const the_parts = (directive.args || '').split(/\s+/);
    const my_topic = the_parts[0] || '';
    const my_manual = the_parts[1] || '';
    const my_display = directive.content.length > 0
        ? render_content(directive, ctx)
        : `[${escape_html(my_manual)}] <strong>${escape_html(my_topic)}</strong>`;

    const my_id = `smcl-ref-${ctx.ref_counter++}`;
    ctx.cross_references.push({
        topic: my_topic,
        display_text: `[${my_manual}] ${my_topic}`,
        element_id: my_id,
    });

    let my_html =
        `<a class="smcl-help-link" id="${my_id}" ` +
        `href="#" data-smcl-topic="${escape_html(my_topic)}"` +
        `>${my_display}</a>`;
    if (italic) my_html = `<em>${my_html}</em>`;
    return my_html;
}

function render_manlink(
    directive: SmclDirective,
    ctx: RenderContext,
    italic: boolean
): string {
    // {manlink MANUAL entry}
    const the_parts = (directive.args || '').split(/\s+/);
    const my_manual = the_parts[0] || '';
    const my_entry = the_parts.slice(1).join(' ') || '';
    const my_display = directive.content.length > 0
        ? render_content(directive, ctx)
        : `[${escape_html(my_manual)}] ${escape_html(my_entry)}`;

    let my_html = `<span class="smcl-manlink">${my_display}</span>`;
    if (italic) my_html = `<em>${my_html}</em>`;
    else my_html = `<strong>${my_html}</strong>`;
    return my_html;
}

function render_mansection(directive: SmclDirective): string {
    const my_text = directive.args ||
        directive.content.map(n => 'text' in n ? n.text : '').join('');
    return `<span class="smcl-mansection">${escape_html(my_text)}</span>`;
}

function is_safe_url(url: string): boolean {
    const my_lower = url.toLowerCase().trimStart();
    return my_lower.startsWith('http://') ||
        my_lower.startsWith('https://') ||
        my_lower.startsWith('mailto:');
}

function render_browse(
    directive: SmclDirective,
    _ctx: RenderContext
): string {
    // {browse URL} or {browse URL:display}
    // Since browse is args-only, the full text is in directive.args.
    // We need to split URL from display text. The display separator
    // is the FIRST colon that is NOT part of :// in a protocol.
    const my_raw = directive.args || '';
    const my_split = split_browse_args(my_raw);
    const my_display = my_split.display
        ? escape_html(my_split.display)
        : escape_html(my_split.url);

    // Reject non-http(s)/mailto URLs to prevent javascript: XSS
    if (!is_safe_url(my_split.url)) {
        return my_display;
    }

    const my_url = escape_html(my_split.url);
    return `<a class="smcl-browse" href="${my_url}" target="_blank">${my_display}</a>`;
}

function split_browse_args(
    raw: string
): { url: string; display: string | null } {
    // Stata's {browse} uses the LAST colon as the URL:display
    // separator. Scanning from the end correctly handles port
    // numbers (http://host:8080) and mailto: URLs since the
    // display separator is always the final colon.
    const my_last_colon = raw.lastIndexOf(':');
    if (my_last_colon < 0) {
        return { url: raw, display: null };
    }

    const my_url = raw.substring(0, my_last_colon);
    const my_display = raw.substring(my_last_colon + 1);

    // If the "display" part looks like it's part of the URL
    // (e.g., "//host" from "http://host", digits from port,
    // or email-like text after "mailto:"), treat as URL only.
    if (
        my_display.startsWith('//') ||
        /^\d+$/.test(my_display) ||
        /^\d+\//.test(my_display) ||
        /^(https?|mailto|ftp)$/i.test(my_url)
    ) {
        return { url: raw, display: null };
    }

    return { url: my_url, display: my_display };
}

function render_marker(directive: SmclDirective): string {
    const my_name = directive.args || '';
    return `<a id="${escape_html(my_name)}"></a>`;
}

function render_viewerjumpto(directive: SmclDirective): string {
    // {viewerjumpto "Display" "topic##anchor"}
    // Args are typically two quoted strings
    const my_match = directive.args.match(
        /"([^"]*)"[\s,]*"([^"]*)"/
    );
    if (my_match) {
        const my_display = escape_html(my_match[1]);
        const my_target = my_match[2];
        const my_anchor = my_target.includes('##')
            ? my_target.split('##')[1]
            : my_target;
        return `<a class="smcl-jumpto" href="#${escape_html(my_anchor)}">${my_display}</a>`;
    }
    return escape_html(directive.args);
}

function render_stata_link(
    directive: SmclDirective,
    ctx: RenderContext
): string {
    // {stata cmd} or {stata cmd:display}
    const my_cmd = directive.args ? escape_html(directive.args) : '';
    const my_display = directive.content.length > 0
        ? render_content(directive, ctx)
        : my_cmd;
    return `<a class="smcl-stata" title="Stata command: ${my_cmd}">${my_display}</a>`;
}

// -- Special characters --

function render_char(directive: SmclDirective): string {
    const my_arg = directive.args.trim();

    // Check named chars
    if (CHAR_MAP[my_arg]) {
        return escape_html(CHAR_MAP[my_arg]);
    }

    // Check hex: {c 0xFF}
    if (my_arg.startsWith('0x') || my_arg.startsWith('0X')) {
        const my_code = parseInt(my_arg, 16);
        if (!isNaN(my_code) && my_code > 0 && my_code < 65536) {
            return escape_html(String.fromCharCode(my_code));
        }
    }

    // Check decimal: {c 169}
    const my_num = parseInt(my_arg, 10);
    if (!isNaN(my_num) && my_num > 0 && my_num < 65536) {
        return escape_html(String.fromCharCode(my_num));
    }

    return escape_html(my_arg);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parse_first_number(args: string): number | null {
    if (!args) return null;
    const my_match = args.match(/(\d+)/);
    return my_match ? parseInt(my_match[1], 10) : null;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function smcl_to_html(smcl: string): SmclHtmlResult {
    const the_nodes = parse_smcl(smcl);
    const ctx = create_context();
    let html = render_nodes(the_nodes, ctx);
    // Close any trailing persistent formats and style span
    html += close_all_formats(ctx);
    if (ctx.active_style) {
        html += '</span>';
    }
    return {
        html,
        cross_references: ctx.cross_references,
    };
}
