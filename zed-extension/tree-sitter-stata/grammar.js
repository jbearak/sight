/**
 * Tree-sitter grammar for Stata
 *
 * Simplified grammar focusing on core parsing needs.
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

module.exports = grammar({
    name: 'stata',

    // External tokens handled by scanner.c
    externals: $ => [
        $._line_start,          // Emitted at beginning of line when next char is *
    ],

    // Whitespace handling - spaces and tabs are extras, newlines are meaningful
    extras: $ => [
        /[ \t]+/,
    ],

    // Word token for keyword extraction
    word: $ => $.identifier,

    rules: {
        // Root rule - a file is a sequence of lines
        source_file: $ => repeat($._line),

        // A line is either a statement followed by newline, or just a newline
        _line: $ => choice(
            seq($._statement, $._newline),
            $._newline,
        ),

        _newline: _ => /\r?\n/,

        // Statements
        _statement: $ => choice(
            $.comment,
            $.program_definition,
            $.mata_block,
            $.macro_definition,
            $.command,
        ),

        // =========================================================================
        // COMMENTS
        // =========================================================================

        comment: $ => choice(
            $.line_comment,
            $.block_comment,
        ),

        // Line comments
        line_comment: $ => choice(
            // Standard line comments - tokenized to prevent // from being split
            token(seq('//', /[^\r\n]*/)),
            // Continuation line comments
            token(seq('///', /[^\r\n]*/)),
            // Star comments - only valid at line start (external scanner provides _line_start)
            seq($._line_start, '*', /[^\r\n]*/),
        ),

        // Block comments
        block_comment: _ => token(seq(
            '/*',
            /[^*]*\*+([^/*][^*]*\*+)*/,
            '/',
        )),

        // =========================================================================
        // STRINGS
        // =========================================================================

        // Double strings with global macro expansion support
        double_string: $ => seq(
            '"',
            repeat(choice(
                /[^"$\\\r\n]+/,   // Regular content (excluding $)
                /\\./,            // Escape sequences
                '""',             // Escaped quote
                $.global_macro,   // Allow $name and ${name}
            )),
            '"',
        ),

        // Compound strings with depth encoding (1-6, wrap-around)
        compound_string_depth_1: $ => seq(
            '`"',
            repeat($._compound_content_1),
            "\"'",
        ),

        _compound_content_1: $ => choice(
            $.compound_string_depth_2,
            $.local_macro_depth_1,
            $.global_macro,
            $.double_string,
            $._compound_text,
        ),

        compound_string_depth_2: $ => seq(
            '`"',
            repeat($._compound_content_2),
            "\"'",
        ),

        _compound_content_2: $ => choice(
            $.compound_string_depth_3,
            $.local_macro_depth_1,
            $.global_macro,
            $.double_string,
            $._compound_text,
        ),

        compound_string_depth_3: $ => seq(
            '`"',
            repeat($._compound_content_3),
            "\"'",
        ),

        _compound_content_3: $ => choice(
            $.compound_string_depth_4,
            $.local_macro_depth_1,
            $.global_macro,
            $.double_string,
            $._compound_text,
        ),

        compound_string_depth_4: $ => seq(
            '`"',
            repeat($._compound_content_4),
            "\"'",
        ),

        _compound_content_4: $ => choice(
            $.compound_string_depth_5,
            $.local_macro_depth_1,
            $.global_macro,
            $.double_string,
            $._compound_text,
        ),

        compound_string_depth_5: $ => seq(
            '`"',
            repeat($._compound_content_5),
            "\"'",
        ),

        _compound_content_5: $ => choice(
            $.compound_string_depth_6,
            $.local_macro_depth_1,
            $.global_macro,
            $.double_string,
            $._compound_text,
        ),

        compound_string_depth_6: $ => seq(
            '`"',
            repeat($._compound_content_6),
            "\"'",
        ),

        // Wrap-around: depth 6 contains depth 1
        _compound_content_6: $ => choice(
            $.compound_string_depth_1,
            $.local_macro_depth_1,
            $.global_macro,
            $.double_string,
            $._compound_text,
        ),

        _compound_text: _ => token(prec(-1, /[^`"$\r\n]+/)),

        string: $ => choice(
            $.double_string,
            $.compound_string_depth_1,
        ),

        // =========================================================================
        // MACROS
        // =========================================================================

        // Local macros with depth encoding (1-6, wrap-around)
        // Also allows global macros inside local macros (e.g., `$global')
        local_macro_depth_1: $ => seq(
            '`',
            choice($.local_macro_depth_2, $.global_macro, $._macro_name),
            "'",
        ),

        local_macro_depth_2: $ => seq(
            '`',
            choice($.local_macro_depth_3, $.global_macro, $._macro_name),
            "'",
        ),

        local_macro_depth_3: $ => seq(
            '`',
            choice($.local_macro_depth_4, $.global_macro, $._macro_name),
            "'",
        ),

        local_macro_depth_4: $ => seq(
            '`',
            choice($.local_macro_depth_5, $.global_macro, $._macro_name),
            "'",
        ),

        local_macro_depth_5: $ => seq(
            '`',
            choice($.local_macro_depth_6, $.global_macro, $._macro_name),
            "'",
        ),

        local_macro_depth_6: $ => seq(
            '`',
            choice($.local_macro_depth_1, $.global_macro, $._macro_name),
            "'",
        ),

        _macro_name: $ => choice(
            $.identifier,
            /[0-9]+/,
        ),

        // Global macros
        global_macro: $ => choice(
            seq('$', $.identifier),
            seq('${', $.identifier, '}'),
        ),

        // =========================================================================
        // PROGRAM DEFINITIONS
        // =========================================================================

        program_definition: $ => seq(
            'program',
            optional('define'),
            field('name', $.identifier),
            repeat($._program_line),
            'end',
        ),

        _program_line: $ => choice(
            seq($._statement, $._newline),
            $._newline,
        ),

        // =========================================================================
        // MATA BLOCKS
        // =========================================================================

        // Mata blocks - supports all valid forms:
        // 1. mata\n...\nend (multiline)
        // 2. mata:\n...\nend (multiline with colon)
        // 3. mata { ... } (brace-delimited)
        // 4. mata: expr (inline with colon)
        // 5. mata expr (inline without colon)
        mata_block: $ => choice(
            // Brace-delimited: mata { ... }
            seq('mata', optional(':'), '{', repeat($._mata_brace_content), '}'),
            // Multiline: mata ... end
            seq('mata', optional(':'), $._newline, repeat($._mata_line), 'end'),
            // Inline: mata: expr or mata expr (on same line, no end required)
            seq('mata', optional(':'), $._mata_inline_content),
        ),
        
        _mata_line: $ => seq(/[^\n]*/, $._newline),
        _mata_inline_content: _ => token(prec(-1, /[^\n{]+/)),
        _mata_brace_content: _ => /[^{}]+/,

        // =========================================================================
        // MACRO DEFINITIONS
        // =========================================================================

        macro_definition: $ => choice(
            seq(choice('local', 'loc'), field('name', $.identifier), optional($._rest_of_line)),
            seq(choice('global', 'gl'), field('name', $.identifier), optional($._rest_of_line)),
            seq(choice('tempvar', 'tempname', 'tempfile'), repeat1(field('name', $.identifier))),
        ),

        // =========================================================================
        // COMMANDS
        // =========================================================================

        command: $ => seq(
            optional($.prefix),
            field('name', $.identifier),
            optional($._rest_of_line),
        ),

        prefix: _ => choice(
            'by', 'bysort', 'bys',
            'quietly', 'qui',
            'noisily', 'noi',
            'capture', 'cap',
            'sortpreserve',
        ),

        _rest_of_line: _ => token(prec(-1, /[^\r\n]+/)),

        // =========================================================================
        // ATOMS
        // =========================================================================

        // Control flow keywords (parsed as distinct nodes for highlighting)
        control_keyword: _ => choice(
            'if', 'else',                              // Conditional
            'foreach', 'forvalues', 'forv', 'while',  // Loop
            'continue', 'break',                       // Control
            'end',                                     // Block terminator
        ),

        // Type keywords
        type_keyword: _ => choice(
            'byte', 'int', 'long', 'float', 'double',  // Numeric types
            // String types str1-str2045 (using regex patterns)
            /str[1-9]/,
            /str[1-9][0-9]/,
            /str[1-9][0-9][0-9]/,
            /str1[0-9][0-9][0-9]/,
            /str20[0-3][0-9]/,
            /str204[0-5]/,
            'strL',                                     // Long string type
        ),

        number: _ => token(choice(
            /[0-9]+/,
            /[0-9]+\.[0-9]*/,
            /\.[0-9]+/,
            /[0-9]+(\.[0-9]*)?[eE][+-]?[0-9]+/,
        )),

        missing_value: _ => /\.[a-z]?/,

        builtin_variable: _ => choice(
            // Observation
            '_n', '_N',
            // Estimation
            '_b', '_coef', '_cons', '_rc', '_se',
            // Constants
            '_pi',
            // Display
            '_skip', '_dup', '_newline', '_column', '_continue', '_request', '_char',
        ),

        identifier: _ => /[A-Za-z_][A-Za-z0-9_]*/,

        operator: _ => choice(
            '+', '-', '*', '/', '^',
            '==', '!=', '~=', '<', '>', '<=', '>=',
            '&', '|', '!', '~',
            '=',
            '#',  // Interaction operator
        ),
    },
});
