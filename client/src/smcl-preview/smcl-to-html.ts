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

export interface SmclToHtmlOptions {
    /**
     * Resolved `{findalias X}` substitutions keyed by the alias name
     * (the argument passed to `{findalias}`). Values are raw SMCL that
     * replace the directive in place and are rendered through the same
     * parser / renderer. When the map is absent or a lookup misses,
     * `{findalias}` renders as nothing — matching the pre-resolver
     * behavior so diffs on unresolved files stay empty.
     */
    findalias_map?: Map<string, string>;
    /**
     * The topic name of the currently rendered help page (e.g. "regress"
     * for regress.sthlp). Used to distinguish same-page anchor links from
     * cross-page links.
     */
    current_topic?: string;
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
    'viewerjumpto', 'viewerdialog', 'vieweralsosee', 'mansection',
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
    in_asis: boolean;
    findalias_map?: Map<string, string>;
    // Guard against infinite recursion when a `{findalias X}`
    // substitution itself contains another `{findalias Y}`
    // (or loops back to `X`).
    findalias_stack: string[];
    current_topic?: string;
}

function create_context(
    findalias_map?: Map<string, string>,
    current_topic?: string
): RenderContext {
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
        in_asis: false,
        findalias_map,
        findalias_stack: [],
        current_topic,
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

function close_asis(ctx: RenderContext): string {
    if (!ctx.in_asis) {
        return '';
    }
    ctx.in_asis = false;
    return '</pre>';
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
            // Drop whitespace-only text between table rows. HTML
            // parsing foster-parents any text-child of <table> that
            // isn't inside a cell, which would hoist the newlines
            // between our {synopt} rows up in front of the table and
            // render them as tall blank gaps via `white-space:
            // pre-wrap`. When we're inside a synopt / p2col table but
            // not inside a row, swallow blank text so the table stays
            // contiguous.
            if (
                (ctx.in_synopt_table || ctx.in_p2col)
                && !ctx.in_table_row
                && /^\s*$/.test(my_text)
            ) {
                continue;
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
            return close_asis(ctx);
        case 'reset': {
            const my_fmt_close = close_all_formats(ctx);
            const my_style_close = ctx.active_style ? '</span>' : '';
            ctx.active_style = null;
            return close_asis(ctx) + my_fmt_close + my_style_close;
        }
        case '...':
            ctx.pending_continuation = true;
            return '';
        case '.-':
            return `<hr class="smcl-hline"${data_line_attr(directive)}>`;

        // -- Asis mode --
        case 'asis':
            if (ctx.in_asis) {
                return '';
            }
            ctx.in_asis = true;
            return '<pre class="smcl-asis">';

        // -- Text formatting (scoped: {bf:text}) --
        case 'bf':
            if (directive.content.length > 0) {
                // Detect inline manual references like `{bf:[R] regress}`
                // or `{bf:[U] 12.5 Formats}` and route them through the
                // same help-link / PDF-link machinery as `{manlink}`.
                const my_ref = detect_bracketed_manual_ref(directive);
                if (my_ref) {
                    const my_inner = build_manlink_anchor_inner(
                        my_ref.manual,
                        my_ref.entry,
                        escape_html(my_ref.display_text),
                        ctx
                    );
                    return `<strong>${my_inner}</strong>`;
                }
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
            if (directive.content.length > 0) {
                return `<code class="smcl-cmd">${render_content(directive, ctx)}</code>`;
            }
            return switch_style(ctx, 'cmd');
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
        case '__help_title__':
            return render_help_title(directive);
        case 'browse':
            return render_browse(directive, ctx);
        case 'marker':
            return render_marker(directive);
        // Preamble metadata directives that Stata's native viewer uses
        // to populate a top nav / "See Also" sidebar. We suppress them
        // for now so the help file starts at its actual title.
        // Tracking enhancement:
        // https://github.com/jbearak/sight/issues/156
        case 'viewerjumpto':
        case 'viewerdialog':
        case 'vieweralsosee':
            return '';
        case 'stata':
            return render_stata_link(directive, ctx);
        case 'dialog':
            return render_content(directive, ctx);
        case 'view':
            return render_view_link(directive, ctx);
        case 'search':
            return render_search_link(directive, ctx);
        case 'findalias':
            return render_findalias(directive, ctx);

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
    // {help topic} or {help topic##anchor} or {help topic:display_text}
    const my_full_topic = directive.args || '';
    const my_display = directive.content.length > 0
        ? render_content(directive, ctx)
        : escape_html(my_full_topic);

    // Split topic##anchor — Stata uses ## as the anchor separator.
    // When a ## is present, the topic portion may contain spaces
    // (e.g. "diagnostic plots##options2") and is kept whole so the
    // resolver can map it to "diagnostic_plots.sthlp". Without ##,
    // only the first word is used (e.g. "matrix list" → "matrix")
    // because Stata's {help} without an anchor typically addresses the
    // parent page rather than a subcommand variant.
    const my_anchor_idx = my_full_topic.indexOf('##');
    const my_topic_name = (my_anchor_idx >= 0
        ? my_full_topic.substring(0, my_anchor_idx)
        : my_full_topic.split(' ')[0]
    ).trim();
    const my_anchor = my_anchor_idx >= 0
        ? my_full_topic.substring(my_anchor_idx + 2).split(' ')[0].trim()
        : '';

    const my_id = `smcl-ref-${ctx.ref_counter++}`;
    ctx.cross_references.push({
        topic: my_topic_name,
        display_text: my_full_topic,
        element_id: my_id,
    });

    let my_html: string;

    // Same-page anchor: render as in-page jump link
    if (
        my_anchor &&
        ctx.current_topic &&
        my_topic_name === ctx.current_topic
    ) {
        my_html =
            `<a class="smcl-jumpto" id="${my_id}" ` +
            `href="#${escape_html(my_anchor)}"` +
            `>${my_display}</a>`;
    } else if (my_anchor) {
        // Cross-page anchor: navigate link with anchor data
        my_html =
            `<a class="smcl-help-link" id="${my_id}" ` +
            `href="#" data-smcl-topic="${escape_html(my_topic_name)}" ` +
            `data-smcl-anchor="${escape_html(my_anchor)}"` +
            `>${my_display}</a>`;
    } else {
        // No anchor: standard navigate link
        my_html =
            `<a class="smcl-help-link" id="${my_id}" ` +
            `href="#" data-smcl-topic="${escape_html(my_topic_name)}"` +
            `>${my_display}</a>`;
    }

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
    // {manlink MANUAL entry} — e.g. {manlink R display} or
    // {manlink U 12.5FormatsControllinghowdataaredisplayed}. Stata's
    // native viewer opens these in the manual, so we emit a clickable
    // link: topic-shaped entries go through the help viewer (same
    // mechanism as `{help}`); manual-section refs link to stata.com
    // PDFs via `build_manual_url`. Fall back to the plain bold/italic
    // span when neither path applies.
    const the_parts = (directive.args || '').trim().split(/\s+/);
    const my_manual = the_parts[0] || '';
    const my_entry = the_parts.slice(1).join(' ').trim();
    const my_display = directive.content.length > 0
        ? render_content(directive, ctx)
        : `[${escape_html(my_manual)}] ${escape_html(my_entry)}`;

    const my_inner = build_manlink_anchor_inner(
        my_manual,
        my_entry,
        my_display,
        ctx
    );

    let my_html = my_inner;
    if (italic) my_html = `<em>${my_html}</em>`;
    else my_html = `<strong>${my_html}</strong>`;
    return my_html;
}

/**
 * Shared anchor / span rendering for `{manlink}` and inline-bold
 * `[X] name` references. Matches Stata's native viewer behavior: these
 * references always target the Reference Manual PDF on stata.com, not
 * the sthlp help file for a similarly-named command. Falls back to a
 * plain `.smcl-manlink` span when we can't build a manual URL (e.g.
 * the target doesn't match the `<MANUAL> <entry>` shape).
 */
function build_manlink_anchor_inner(
    manual: string,
    entry: string,
    display_html: string,
    _ctx: RenderContext
): string {
    if (manual.length === 0 || entry.length === 0) {
        return `<span class="smcl-manlink">${display_html}</span>`;
    }

    const my_url = build_manual_url(`${manual} ${entry.replace(/\s+/g, '')}`);
    if (my_url) {
        return (
            `<a class="smcl-browse smcl-mansection smcl-manlink-pdf" `
            + `href="${escape_html(my_url)}">${display_html}</a>`
        );
    }

    return `<span class="smcl-manlink">${display_html}</span>`;
}

function render_mansection(directive: SmclDirective): string {
    // Args format: `<manual_section>:<display_text>`, e.g.
    // `P display:View complete PDF manual entry`. When we can build
    // a stata.com URL from the target, emit a browse-style link so the
    // existing webview click handler opens it externally. We
    // deliberately omit `target="_blank"` so VS Code's webview link
    // interception doesn't race with our `postMessage('openExternal')`
    // handler — otherwise the PDF opens twice / prompts twice.
    const my_args = directive.args
        || directive.content.map(n => 'text' in n ? n.text : '').join('');
    const my_parsed = parse_mansection_args(my_args);
    const my_display_text = my_parsed?.display ?? my_args;
    const my_url = my_parsed
        ? build_manual_url(my_parsed.target)
        : null;
    const my_display_safe = escape_html(my_display_text);
    if (my_url) {
        return `<a class="smcl-browse smcl-mansection" href="${escape_html(my_url)}">${my_display_safe}</a>`;
    }
    return `<span class="smcl-mansection">${my_display_safe}</span>`;
}

interface MansectionParsed {
    target: string;   // e.g. "P display"
    display: string;  // e.g. "View complete PDF manual entry"
}

function parse_mansection_args(args: string): MansectionParsed | null {
    const my_colon = args.indexOf(':');
    if (my_colon <= 0) return null;
    const my_target = args.substring(0, my_colon).trim();
    const my_display = args.substring(my_colon + 1).trim();
    if (my_target.length === 0 || my_display.length === 0) return null;
    return { target: my_target, display: my_display };
}

function build_manual_url(target: string): string | null {
    // Stata's online manual URLs follow a predictable convention that
    // was reverse-engineered by inspecting the per-entry PDFs on
    // stata.com (e.g. /manuals/pdisplay.pdf, /manuals/rregress.pdf,
    // /manuals/u12.pdf):
    //
    //   * Filename: `<letter_lower><root_lower>.pdf`, where `root` is
    //     the lowercase/digit prefix of the sthlp `{mansection}` target
    //     (everything up to the first uppercase letter or period).
    //   * Named destinations inside the PDF preserve the original
    //     case of the target. The destination name is the lowercase
    //     manual letter concatenated with the target verbatim.
    //
    // Examples (all verified against actual PDFs on stata.com):
    //   "P display"                              → pdisplay.pdf
    //   "P displayRemarksandexamples"            → pdisplay.pdf#pdisplayRemarksandexamples
    //   "R regressMethodsandformulas"            → rregress.pdf#rregressMethodsandformulas
    //   "U 12.5FormatsControllinghowdataaredisplayed"
    //                                            → u12.pdf#u12.5FormatsControllinghowdataaredisplayed
    //
    // The entry may start with a digit (User's Guide section refs) and
    // may contain periods. Anything that fails to produce a root
    // returns null so the caller falls back to plain text.
    const my_match = target.trim().match(
        /^([A-Z]+(?:-\d+)?)\s+([A-Za-z0-9][A-Za-z0-9_. ]*)$/
    );
    if (!my_match) return null;
    const my_letter = my_match[1].toLowerCase();
    const my_entry_raw = my_match[2].replace(/\s+/g, '');
    if (my_entry_raw.length === 0) return null;

    // Root = longest lowercase/digit/underscore prefix. Anything after
    // (a period or an uppercase letter) is the PDF subsection.
    const my_root_match = my_entry_raw.match(/^([a-z0-9_]+)/);
    let my_root: string;
    let my_has_subsection: boolean;
    if (my_root_match && my_root_match[1].length < my_entry_raw.length) {
        my_root = my_root_match[1];
        my_has_subsection = true;
    } else if (my_root_match) {
        // Entire entry is lowercase/digit/underscore; no subsection.
        my_root = my_entry_raw;
        my_has_subsection = false;
    } else {
        // Entry starts with uppercase (rare; e.g. "SEM Intro5").
        // Treat the entire entry as the root and skip the anchor.
        my_root = my_entry_raw.toLowerCase();
        my_has_subsection = false;
    }

    const my_base =
        `https://www.stata.com/manuals/${my_letter}${my_root.toLowerCase()}.pdf`;
    if (!my_has_subsection) {
        return my_base;
    }
    // Destination name is `<letter_lower><target_case_preserved>`,
    // matching what Stata embeds in the PDF's /Names tree.
    return `${my_base}#${my_letter}${my_entry_raw}`;
}

/**
 * Detect a `{bf:[X] name}` pattern in a directive's content and
 * extract the manual code / entry / original text. Returns null when
 * the content has nested markup or doesn't match the shape — in that
 * case the caller should render a plain `<strong>` as before.
 *
 * The content must be a single text node (with optional surrounding
 * whitespace) of the form `[MANUAL] entry` where MANUAL is one or
 * more uppercase letters and entry is non-empty.
 */
function detect_bracketed_manual_ref(
    directive: SmclDirective
): { manual: string; entry: string; display_text: string } | null {
    if (directive.content.length !== 1) return null;
    const my_node = directive.content[0];
    if (is_directive(my_node)) return null;
    const my_raw = my_node.text;
    const my_match = my_raw.match(/^\s*\[([A-Z]+(?:-\d+)?)\]\s+(.+?)\s*$/);
    if (!my_match) return null;
    const my_entry = my_match[2].trim();
    if (my_entry.length === 0) return null;
    return {
        manual: my_match[1],
        entry: my_entry,
        display_text: my_raw.trim(),
    };
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
    // No `target="_blank"`: the webview click handler calls
    // `vscode.env.openExternal` via postMessage. Emitting target=_blank
    // would make VS Code's native link interception open the URL a
    // second time and trigger a duplicate trust prompt.
    return `<a class="smcl-browse" href="${my_url}">${my_display}</a>`;
}

function split_browse_args(
    raw: string
): { url: string; display: string | null } {
    // Stata's {browse} uses the LAST colon as the URL:display
    // separator. Scanning from the end correctly handles port
    // numbers (http://host:8080) and mailto: URLs since the
    // display separator is always the final colon.
    // Stata allows quoting the URL in {browse} — e.g.:
    //   {browse "https://example.com"}
    //   {browse "https://example.com":display text}
    // In both forms the URL is wrapped in double quotes. Handle the
    // quoted form first so later colon-splitting works on bare URLs.
    if (raw.startsWith('"')) {
        const my_close = raw.indexOf('"', 1);
        if (my_close > 0) {
            const my_url = raw.substring(1, my_close);
            // After the closing quote, expect either nothing or ":display"
            const my_after = raw.substring(my_close + 1);
            const my_display = my_after.startsWith(':')
                ? my_after.substring(1)
                : null;
            return { url: my_url, display: my_display };
        }
    }

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

/**
 * Render `{findalias X}` by looking up the alias in the current
 * render context's `findalias_map` and rendering the resulting SMCL
 * substitution in place. When no map is present or the alias is not
 * in the map, emit nothing (matching pre-resolver behavior).
 *
 * Substitutions are parsed and rendered through the same pipeline as
 * the outer document so nested directives (`{manlink …}`,
 * `{vieweralsosee …}`, etc.) render identically to how they would if
 * they had been inlined by hand.
 */
function render_findalias(
    directive: SmclDirective,
    ctx: RenderContext
): string {
    if (!ctx.findalias_map) return '';
    const my_alias = (directive.args ?? '').trim();
    if (my_alias.length === 0) return '';
    const my_smcl = ctx.findalias_map.get(my_alias);
    if (my_smcl === undefined) return '';
    if (ctx.findalias_stack.includes(my_alias)) {
        // Recursive substitution — bail to avoid infinite expansion.
        return '';
    }
    ctx.findalias_stack.push(my_alias);
    try {
        const the_sub_nodes = parse_smcl(my_smcl);
        return render_nodes(the_sub_nodes, ctx);
    } finally {
        ctx.findalias_stack.pop();
    }
}

function render_search_link(
    directive: SmclDirective,
    ctx: RenderContext
): string {
    // {search keyword} or {search keyword:display_text}
    // Render as plain styled text — {search} opens Stata's keyword
    // search dialog, not a help page. No link, no cross-reference entry.
    // Preserve the full query — `{search mixed models}` should search
    // the phrase "mixed models", not just "mixed".
    const my_query = (directive.args || '').trim();
    if (!my_query) return render_content(directive, ctx);

    const my_display = directive.content.length > 0
        ? render_content(directive, ctx)
        : escape_html(my_query);

    return (
        `<span class="smcl-search-text" ` +
        `data-smcl-search-query="${escape_html(my_query)}"` +
        `>${my_display}</span>`
    );
}

function render_view_link(
    directive: SmclDirective,
    ctx: RenderContext
): string {
    // {view filename} or {view filename:display_text}
    const my_filename = (directive.args || '').trim();
    if (!my_filename) return render_content(directive, ctx);

    // Only render as help link if it's a .sthlp or .hlp file
    const my_match = my_filename.match(/^(.+)\.(sthlp|hlp)$/i);
    if (!my_match) return render_content(directive, ctx);

    const my_topic = my_match[1];
    const my_display = directive.content.length > 0
        ? render_content(directive, ctx)
        : escape_html(my_filename);

    const my_id = `smcl-ref-${ctx.ref_counter++}`;
    ctx.cross_references.push({
        topic: my_topic,
        display_text: my_filename,
        element_id: my_id,
    });

    return (
        `<a class="smcl-help-link" id="${my_id}" ` +
        `href="#" data-smcl-topic="${escape_html(my_topic)}"` +
        `>${my_display}</a>`
    );
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
// viewerjumpto TOC
// ---------------------------------------------------------------------------

interface ViewerJumptoEntry {
    label: string;
    anchor: string;
}

/**
 * Extract `{viewerjumpto "Label" "topic##anchor"}` directives from
 * the node list. Returns the entries and the filtered node list with
 * viewerjumpto nodes removed.
 */
function collect_viewerjumpto_entries(
    nodes: SmclNode[]
): { entries: ViewerJumptoEntry[]; filtered: SmclNode[] } {
    const the_entries: ViewerJumptoEntry[] = [];
    const the_filtered: SmclNode[] = [];

    for (const my_node of nodes) {
        if (
            is_directive(my_node) &&
            my_node.name.toLowerCase() === 'viewerjumpto'
        ) {
            const my_args = my_node.args || '';
            // Parse: "Label" "topic##anchor"
            const my_match = my_args.match(
                /^"([^"]*)"\s+"[^#]*##([^"]*)"/
            );
            if (my_match) {
                the_entries.push({
                    label: my_match[1],
                    anchor: my_match[2],
                });
            }
        } else {
            the_filtered.push(my_node);
        }
    }

    return { entries: the_entries, filtered: the_filtered };
}

/**
 * Render collected viewerjumpto entries as a horizontal TOC bar.
 */
function render_viewerjumpto_toc(
    entries: ViewerJumptoEntry[]
): string {
    if (entries.length === 0) return '';

    const the_links = entries.map(my_entry =>
        `<a class="smcl-jumpto" href="#${escape_html(my_entry.anchor)}"` +
        `>${escape_html(my_entry.label)}</a>`
    );

    return (
        '<nav class="smcl-toc">' +
        the_links.join('<span class="smcl-toc-separator"> | </span>') +
        '</nav>'
    );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function smcl_to_html(
    smcl: string,
    options?: SmclToHtmlOptions
): SmclHtmlResult {
    const the_raw_nodes = parse_smcl(smcl);
    // Drop the `{title:Title}` placeholder many Stata help files put
    // at the top of the file (368 occurrences in the base ado tree as
    // of Stata 18). The word "Title" is not meaningful content — it
    // labels the upcoming title section, which is either a
    // `{p2colset}…{p2colreset}` block (handled below) or a
    // `{pstd}{findalias X}` block (resolved via the findalias_map).
    // Stripping the stand-alone heading avoids a useless "Title"
    // <h2> above the real title info.
    const the_stripped_nodes = strip_placeholder_title(the_raw_nodes);
    // Collapse the `.sthlp` header's `{p2colset}…{p2colreset}` title
    // block into a single synthetic directive so we can render it as
    // a proper heading with a PDF-manual link, rather than a narrow
    // 2-column table row.
    const the_p2col_nodes = transform_help_title(the_stripped_nodes);
    // Files that substitute a manlink via `{pstd}{findalias X}` for
    // their title block (e.g. `exp.sthlp`, `operator.sthlp`) get the
    // same `__help_title__` treatment so they render as a proper
    // heading + PDF link instead of a small inline blue reference.
    const the_findalias_nodes = transform_findalias_help_title(
        the_p2col_nodes,
        options?.findalias_map
    );
    // Collect {viewerjumpto} entries for the TOC bar, removing them
    // from the node list so they don't render inline.
    const { entries: the_toc_entries, filtered: the_nodes } =
        collect_viewerjumpto_entries(the_findalias_nodes);

    const ctx = create_context(options?.findalias_map, options?.current_topic);
    let html = render_viewerjumpto_toc(the_toc_entries);
    html += render_nodes(the_nodes, ctx);
    // Close any trailing persistent formats and style span
    html += close_asis(ctx);
    html += close_all_formats(ctx);
    if (ctx.active_style) {
        html += '</span>';
    }
    // Close any unclosed tables
    if (ctx.in_synopt_table) {
        html += '</tbody></table>';
        ctx.in_synopt_table = false;
    }
    if (ctx.in_p2col) {
        html += '</table>';
        ctx.in_p2col = false;
    }
    return {
        html,
        cross_references: ctx.cross_references,
    };
}

// ---------------------------------------------------------------------------
// Help-title preprocessor
// ---------------------------------------------------------------------------

/**
 * Remove the leading `{title:Title}` directive many Stata help files
 * use as a placeholder label for their title section.
 *
 * Across the Stata 18 base ado tree, `{title:Title}` appears 368
 * times with this exact placeholder text, always immediately followed
 * by either a `{p2colset}…{p2colreset}` header block or a
 * `{pstd}{findalias X}` block that supplies the real title content.
 * Rendering the literal word "Title" as an `<h2>` adds a noisy,
 * meaningless heading; Stata's native viewer tolerates it but we can
 * do better by skipping it.
 *
 * We only strip the FIRST top-level `{title:...}` directive, and only
 * when its content text is exactly "Title". Every other title
 * (`Syntax`, `Description`, `Remarks`, …) is meaningful and must
 * survive intact.
 */
function strip_placeholder_title(nodes: SmclNode[]): SmclNode[] {
    for (let i = 0; i < nodes.length; i++) {
        const my_node = nodes[i];
        if (!is_directive(my_node)) continue;
        if (my_node.name.toLowerCase() !== 'title') continue;
        const my_text = extract_title_plain_text(my_node).trim();
        if (my_text === 'Title') {
            return [...nodes.slice(0, i), ...nodes.slice(i + 1)];
        }
        // First title encountered was something meaningful; leave it
        // and every subsequent title alone.
        return nodes;
    }
    return nodes;
}

/**
 * Flatten a `{title:…}` directive's content into plain text so we can
 * check for the `Title` placeholder. Non-text children contribute
 * nothing (no real help file decorates the title content with
 * directives; being conservative here only means we leave such a
 * title in place).
 */
function extract_title_plain_text(directive: SmclDirective): string {
    if (directive.args) return directive.args;
    const the_parts: string[] = [];
    for (const my_child of directive.content) {
        if ('text' in my_child) {
            the_parts.push(my_child.text);
        }
    }
    return the_parts.join('');
}

interface HelpTitleInfo {
    /** Command / entry name, e.g. "display" or "frame create". */
    name: string;
    /** One-line description from the title row. */
    description: string;
    /** `{mansection}` target, e.g. "P display". Optional. */
    mansection_target?: string;
    /** `{mansection}` display text. Optional. */
    mansection_text?: string;
}

/**
 * Walk the top-level node list and, if the first `{p2colset}…
 * {p2colreset}` block matches Stata's help-title convention, replace
 * it with a single synthetic `__help_title__` directive carrying the
 * structured heading info.
 *
 * The title convention at the top of every Stata `.sthlp` file is:
 *   {p2colset N N N N}{...}
 *   {p2col:{bf:[X] name} {hline N}}description{p_end}
 *   {p2col:}({mansection X entry:display text}){p_end}
 *   {p2colreset}{...}
 *
 * We only match the first `{p2colset}` we encounter, since body-level
 * 2-col tables should continue rendering as tables.
 */
function transform_help_title(nodes: SmclNode[]): SmclNode[] {
    for (let i = 0; i < nodes.length; i++) {
        const my_node = nodes[i];
        if (!is_directive(my_node)) continue;
        if (my_node.name.toLowerCase() !== 'p2colset') continue;

        const my_match = try_match_help_title(nodes, i);
        if (!my_match) {
            // Only the first p2colset is inspected; if it isn't a
            // title, fall through and render everything normally.
            return nodes;
        }
        const my_synthetic: SmclDirective = {
            name: '__help_title__',
            args: JSON.stringify(my_match.info),
            content: [],
            line: my_node.line,
        };
        return [
            ...nodes.slice(0, i),
            my_synthetic,
            ...nodes.slice(i + my_match.consumed),
        ];
    }
    return nodes;
}

function try_match_help_title(
    nodes: SmclNode[],
    start: number
): { consumed: number; info: HelpTitleInfo } | null {
    let i = start;

    const skip_filler = (): void => {
        while (i < nodes.length) {
            const my_node = nodes[i];
            if (!is_directive(my_node)) {
                if (/^\s*$/.test(my_node.text)) { i++; continue; }
                break;
            }
            if (my_node.name === '...' || my_node.name === '.-') {
                i++;
                continue;
            }
            break;
        }
    };

    // {p2colset ...}
    if (
        i >= nodes.length
        || !is_directive(nodes[i])
        || (nodes[i] as SmclDirective).name.toLowerCase() !== 'p2colset'
    ) {
        return null;
    }
    i++;
    skip_filler();

    // {p2col:{bf:[X] name} ...}description{p_end}
    if (
        i >= nodes.length
        || !is_directive(nodes[i])
        || (nodes[i] as SmclDirective).name.toLowerCase() !== 'p2col'
    ) {
        return null;
    }
    const my_title_p2col = nodes[i] as SmclDirective;
    const my_title_ref = extract_title_ref_from_p2col(my_title_p2col);
    if (!my_title_ref) return null;
    i++;

    // Collect the description as the sibling text nodes up to {p_end}.
    // We keep this conservative: if we see a non-trivial directive in
    // the description slot, bail out and render as a regular table.
    const the_description_parts: string[] = [];
    while (i < nodes.length) {
        const my_node = nodes[i];
        if (is_directive(my_node)) {
            const my_name = my_node.name.toLowerCase();
            if (my_name === 'p_end') { i++; break; }
            if (my_name === '...' || my_name === '.-') { i++; continue; }
            // Description contains unsupported markup; bail.
            return null;
        }
        the_description_parts.push(my_node.text);
        i++;
    }
    const my_description = the_description_parts.join('').trim();
    // Some help files (e.g. function pages like f_strpos.sthlp) have
    // no inline description — the title row is just {p2col:{bf:[FN] String functions}}.
    // Fall back to the full manual reference (e.g. "[FN] String functions").
    const my_effective_description = my_description.length > 0
        ? my_description
        : my_title_ref.full_ref;
    skip_filler();

    // Optional: {p2col:}({mansection X name:text}){p_end}
    let mansection_target: string | undefined;
    let mansection_text: string | undefined;
    if (
        i < nodes.length
        && is_directive(nodes[i])
        && (nodes[i] as SmclDirective).name.toLowerCase() === 'p2col'
    ) {
        const my_p2col = nodes[i] as SmclDirective;
        // Check for mansection inside p2col content (e.g. function pages:
        // {p2col:({mansection FN Stringfunctions:...})}{p_end})
        for (const my_child of my_p2col.content) {
            if (
                is_directive(my_child)
                && my_child.name.toLowerCase() === 'mansection'
            ) {
                const my_parsed = parse_mansection_args(my_child.args);
                if (my_parsed) {
                    mansection_target = my_parsed.target;
                    mansection_text = my_parsed.display;
                }
            }
        }
        // Also check sibling nodes (standard pattern: {p2col:}({mansection ...}){p_end})
        if (!mansection_target && my_p2col.content.length === 0) {
            i++;
            while (i < nodes.length) {
                const my_node = nodes[i];
                if (is_directive(my_node) && my_node.name.toLowerCase() === 'p_end') {
                    i++;
                    break;
                }
                if (
                    is_directive(my_node)
                    && my_node.name.toLowerCase() === 'mansection'
                ) {
                    const my_parsed = parse_mansection_args(my_node.args);
                    if (my_parsed) {
                        mansection_target = my_parsed.target;
                        mansection_text = my_parsed.display;
                    }
                }
                i++;
            }
        } else {
            // Content was non-empty (mansection found inside, or no
            // mansection at all). Skip past the trailing {p_end}.
            i++;
            // Skip to {p_end}
            while (i < nodes.length) {
                const my_node = nodes[i];
                if (is_directive(my_node) && my_node.name.toLowerCase() === 'p_end') {
                    i++;
                    break;
                }
                i++;
            }
        }
        skip_filler();
    }

    // {p2colreset}
    if (
        i >= nodes.length
        || !is_directive(nodes[i])
        || (nodes[i] as SmclDirective).name.toLowerCase() !== 'p2colreset'
    ) {
        return null;
    }
    i++;

    return {
        consumed: i - start,
        info: {
            name: my_title_ref.name,
            description: my_effective_description,
            mansection_target,
            mansection_text,
        },
    };
}

/**
 * Paragraph directives that can open a title-style block. When a help
 * file substitutes its title via `{pstd}{findalias X}`, the outer
 * paragraph wrapper is almost always `{pstd}`, but we accept the full
 * family so layout-variant files still benefit.
 */
const PARAGRAPH_DIRECTIVE_NAMES: ReadonlySet<string> = new Set([
    'p', 'pstd', 'pin', 'pin2', 'pin3',
    'phang', 'phang2', 'phang3',
    'pmore', 'pmore2', 'pmore3',
    'psee',
]);

/**
 * Directive names that mark the end of the preamble / title area.
 * Hitting any of these during the findalias-title scan means the
 * title block has already been rendered (or this file doesn't follow
 * the pattern), so we leave the tree untouched.
 */
const PREAMBLE_TERMINATOR_NAMES: ReadonlySet<string> = new Set([
    'marker', 'title', 'p2colset', '__help_title__',
]);

/**
 * Walk the top-level nodes and, if the preamble contains a title-
 * style `{findalias X}` block whose substitution resolves to a
 * `{manlink A B…}` (the convention used by files like `exp.sthlp`
 * and `operator.sthlp`), collapse the whole block into a synthetic
 * `__help_title__` directive carrying the manual-reference heading.
 *
 * Without this pass the findalias resolves inline as a small bold
 * blue link inside a regular paragraph, which hides the fact that
 * the paragraph is actually the document's title.
 *
 * The scan is intentionally cheap and bails to the original node
 * list the moment it encounters any signal that the preamble is
 * already done (e.g. a `{marker}`, `{title:…}`, `{p2colset}`, or an
 * already-synthesized `__help_title__`).
 */
function transform_findalias_help_title(
    nodes: SmclNode[],
    findalias_map: Map<string, string> | undefined
): SmclNode[] {
    if (!findalias_map || findalias_map.size === 0) return nodes;

    // Remember the earliest paragraph directive we've seen so the
    // replacement range swallows the opening `{pstd}` along with the
    // `{findalias}` it contains.
    let paragraph_start = -1;

    for (let i = 0; i < nodes.length; i++) {
        const my_node = nodes[i];

        if (!is_directive(my_node)) {
            // Any non-whitespace text before a findalias means we've
            // moved into real body content; leave the tree alone.
            if (!/^\s*$/.test(my_node.text)) return nodes;
            continue;
        }

        const my_name = my_node.name.toLowerCase();
        if (PREAMBLE_TERMINATOR_NAMES.has(my_name)) {
            return nodes;
        }

        if (my_name === 'findalias') {
            const my_alias = (my_node.args ?? '').trim();
            if (my_alias.length === 0) continue;
            const my_smcl = findalias_map.get(my_alias);
            if (!my_smcl) continue;
            const my_info = extract_manlink_help_title(my_smcl);
            if (!my_info) continue;

            const my_start = paragraph_start >= 0 ? paragraph_start : i;
            // Consume through the end of the title paragraph only:
            // stop at (and include) the first {p_end}, or bail at a
            // hard preamble boundary / EOF.
            let my_end = i + 1;
            while (my_end < nodes.length) {
                const my_next = nodes[my_end];
                if (is_directive(my_next)) {
                    const my_next_name = my_next.name.toLowerCase();
                    if (my_next_name === 'p_end') {
                        my_end++;
                        break;
                    }
                    if (PREAMBLE_TERMINATOR_NAMES.has(my_next_name)) {
                        break;
                    }
                }
                my_end++;
            }

            const my_synthetic: SmclDirective = {
                name: '__help_title__',
                args: JSON.stringify(my_info),
                content: [],
                line: nodes[my_start].line,
            };
            return [
                ...nodes.slice(0, my_start),
                my_synthetic,
                ...nodes.slice(my_end),
            ];
        }

        if (
            paragraph_start < 0
            && PARAGRAPH_DIRECTIVE_NAMES.has(my_name)
        ) {
            paragraph_start = i;
        }
    }

    return nodes;
}

/**
 * Parse a findalias substitution and, if it contains a `{manlink A B}`
 * as its primary content, derive help-title metadata from it.
 *
 * The heading drops any leading section-number prefix (e.g. `13.2 `)
 * so topics like `{manlink U 13.2 Operators}` render with a clean
 * `Operators` heading. The full `[U] 13.2 Operators` reference is
 * kept as the subtitle, and the mansection target is formatted so
 * `build_manual_url` produces the canonical `u13.pdf#u13.2Operators`
 * style URL.
 */
function extract_manlink_help_title(
    smcl: string
): HelpTitleInfo | null {
    const the_nodes = parse_smcl(smcl);
    for (const my_node of the_nodes) {
        if (!is_directive(my_node)) continue;
        const my_name = my_node.name.toLowerCase();
        if (my_name !== 'manlink' && my_name !== 'manlinki') continue;

        const my_args = (my_node.args ?? '').trim();
        if (my_args.length === 0) return null;
        const my_space = my_args.indexOf(' ');
        if (my_space < 0) return null;
        const my_manual = my_args.substring(0, my_space).trim();
        const my_entry = my_args.substring(my_space + 1).trim();
        if (my_manual.length === 0 || my_entry.length === 0) return null;

        // Strip a leading section number like `13 `, `13.2 `, or
        // `11.1.3 `. Falls back to the raw entry when there's nothing
        // to strip (e.g. `regress postestimation`).
        const my_heading = my_entry.replace(/^\d+(?:\.\d+)*\s+/, '').trim()
            || my_entry;

        return {
            name: my_heading,
            description: `[${my_manual}] ${my_entry}`,
            mansection_target: `${my_manual} ${my_entry}`,
            mansection_text: 'View complete PDF manual entry',
        };
    }
    return null;
}

function extract_title_ref_from_p2col(
    p2col: SmclDirective
): { name: string; full_ref: string } | null {
    // Expected content: [{bf:[X] name}, optional text/whitespace,
    // optional {hline}]. We only look at the first directive to
    // decide whether this row is a title; trailing space + {hline} is
    // purely decorative. The leading [X] manual-reference is a
    // convention most users don't recognize, so we strip it and only
    // keep the command / entry name.
    const my_first = p2col.content[0];
    if (!my_first || !is_directive(my_first)) return null;
    if (my_first.name.toLowerCase() !== 'bf') return null;

    const my_inner_text = my_first.args
        || my_first.content
            .map(n => 'text' in n ? n.text : '')
            .join('');
    const my_match = my_inner_text.trim().match(/^\[[A-Z]+(?:-\d+)?\]\s+(.+)$/);
    if (!my_match) return null;
    return {
        name: my_match[1].trim(),
        full_ref: my_inner_text.trim(),
    };
}

function render_help_title(directive: SmclDirective): string {
    let the_info: HelpTitleInfo;
    try {
        the_info = JSON.parse(directive.args) as HelpTitleInfo;
    } catch {
        return '';
    }
    const my_name = escape_html(the_info.name);
    const my_desc = escape_html(the_info.description);

    let my_manlink_html = '';
    if (the_info.mansection_target && the_info.mansection_text) {
        const my_url = build_manual_url(the_info.mansection_target);
        // Override Stata's raw "View complete PDF manual entry" text
        // with a label that is accurate in our context: the link leaves
        // VS Code and opens the canonical ("complete") Reference Manual
        // entry as a PDF on stata.com. We intentionally do NOT override
        // `render_mansection` callers outside the title block, since
        // those may legitimately use different display text.
        const my_label = my_url
            ? 'View the complete manual entry (PDF, opens in browser)'
            : the_info.mansection_text;
        const my_label_safe = escape_html(my_label);
        if (my_url) {
            // See render_browse / render_mansection: no `target="_blank"`
            // — the webview click handler routes to openExternal once.
            my_manlink_html =
                `<p class="smcl-help-manlink">` +
                `<a class="smcl-browse smcl-mansection" ` +
                `href="${escape_html(my_url)}">` +
                `${my_label_safe}</a></p>`;
        } else {
            my_manlink_html =
                `<p class="smcl-help-manlink">${my_label_safe}</p>`;
        }
    }

    return (
        `<header class="smcl-help-title"${data_line_attr(directive)}>` +
        `<h1 class="smcl-help-title-heading">${my_name}</h1>` +
        `<p class="smcl-help-subtitle">${my_desc}</p>` +
        my_manlink_html +
        `</header>`
    );
}
