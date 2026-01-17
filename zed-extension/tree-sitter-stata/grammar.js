/**
 * Tree-sitter grammar for Stata
 *
 * This grammar focuses on parsing Stata structure needed for editor features:
 * - Comments (line comments with //, ///, *, and block comments)
 * - Strings (double-quoted and compound strings with depth encoding)
 * - Macro references (local and global with depth encoding for locals)
 * - Program definitions
 * - Mata blocks
 * - Generic commands (without embedding versioned command lists)
 * - Basic atoms (identifiers, numbers, operators)
 *
 * Key design decisions:
 * 1. External scanner for line-start detection (to disambiguate * comments)
 * 2. External scanner for Mata block content
 * 3. Depth-encoded nodes for compound strings and local macros (1-6, wrap-around)
 * 4. Local macro depth is independent of compound string nesting
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

module.exports = grammar({
    name: 'stata',

    // External tokens handled by scanner.c
    externals: $ => [
        $._line_start,          // Emitted at beginning of line (after whitespace)
        $._mata_block_content,  // Content inside mata...end blocks
    ],

    // Whitespace handling - spaces and tabs are extras, newlines are meaningful
    extras: $ => [
        /[ \t]+/,
    ],

    // Word token for keyword extraction
    word: $ => $.identifier,

    // Conflict resolution
    conflicts: $ => [
        // Allow command to match with or without prefix
        [$.command],
    ],

    rules: {
        // Root rule
        source_file: $ => repeat($._item),

        _item: $ => choice(
            $._statement,
            $._newline,
        ),

        _newline: _ => /\r?\n/,

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

        // Line comments: //, ///, and * (when at line start)
        line_comment: $ => choice(
            // Standard line comments
            seq('//', /[^\r\n]*/),
            // Continuation line comments
            seq('///', /[^\r\n]*/),
            // Star comments - only valid at line start (external scanner provides _line_start)
            seq($._line_start, '*', /[^\r\n]*/),
        ),

        // Block comments: /* ... */
        block_comment: _ => token(seq(
            '/*',
            /[^*]*\*+([^/*][^*]*\*+)*/,
            '/',
        )),

        // =========================================================================
        // STRINGS
        // =========================================================================

        // Double-quoted strings with escape handling
        double_string: _ => token(seq(
            '"',
            repeat(choice(
                /[^"\\\r\n]+/,  // Regular characters
                /\\./,          // Escape sequences
                '""',           // Escaped double quote
            )),
            '"',
        )),

        // Compound strings with depth encoding (1-6, wrap-around)
        // Each depth level can contain the next depth level and local macros
        compound_string_depth_1: $ => seq(
            alias('`"', $.compound_string_start),
            repeat($._compound_string_content_1),
            alias("\"'", $.compound_string_end),
        ),

        _compound_string_content_1: $ => choice(
            $.compound_string_depth_2,
            $.local_macro_depth_1,
            $.global_macro,
            $.double_string,
            $._compound_string_text,
        ),

        compound_string_depth_2: $ => seq(
            alias('`"', $.compound_string_start),
            repeat($._compound_string_content_2),
            alias("\"'", $.compound_string_end),
        ),

        _compound_string_content_2: $ => choice(
            $.compound_string_depth_3,
            $.local_macro_depth_1,
            $.global_macro,
            $.double_string,
            $._compound_string_text,
        ),

        compound_string_depth_3: $ => seq(
            alias('`"', $.compound_string_start),
            repeat($._compound_string_content_3),
            alias("\"'", $.compound_string_end),
        ),

        _compound_string_content_3: $ => choice(
            $.compound_string_depth_4,
            $.local_macro_depth_1,
            $.global_macro,
            $.double_string,
            $._compound_string_text,
        ),

        compound_string_depth_4: $ => seq(
            alias('`"', $.compound_string_start),
            repeat($._compound_string_content_4),
            alias("\"'", $.compound_string_end),
        ),

        _compound_string_content_4: $ => choice(
            $.compound_string_depth_5,
            $.local_macro_depth_1,
            $.global_macro,
            $.double_string,
            $._compound_string_text,
        ),

        compound_string_depth_5: $ => seq(
            alias('`"', $.compound_string_start),
            repeat($._compound_string_content_5),
            alias("\"'", $.compound_string_end),
        ),

        _compound_string_content_5: $ => choice(
            $.compound_string_depth_6,
            $.local_macro_depth_1,
            $.global_macro,
            $.double_string,
            $._compound_string_text,
        ),

        compound_string_depth_6: $ => seq(
            alias('`"', $.compound_string_start),
            repeat($._compound_string_content_6),
            alias("\"'", $.compound_string_end),
        ),

        // Wrap-around: depth 6 contains depth 1
        _compound_string_content_6: $ => choice(
            $.compound_string_depth_1,  // Wrap-around
            $.local_macro_depth_1,
            $.global_macro,
            $.double_string,
            $._compound_string_text,
        ),

        // Text content inside compound strings (excludes delimiters and special chars)
        _compound_string_text: _ => token(prec(-1, /[^`"$\r\n]+/)),

        // Unified string type for use in expressions
        string: $ => choice(
            $.double_string,
            $.compound_string_depth_1,
        ),

        // =========================================================================
        // MACROS
        // =========================================================================

        // Local macros with depth encoding (1-6, wrap-around)
        // Depth is based only on local macro nesting, not compound string nesting
        local_macro_depth_1: $ => seq(
            alias('`', $.local_macro_start),
            choice(
                $.local_macro_depth_2,
                $._macro_name,
            ),
            alias("'", $.local_macro_end),
        ),

        local_macro_depth_2: $ => seq(
            alias('`', $.local_macro_start),
            choice(
                $.local_macro_depth_3,
                $._macro_name,
            ),
            alias("'", $.local_macro_end),
        ),

        local_macro_depth_3: $ => seq(
            alias('`', $.local_macro_start),
            choice(
                $.local_macro_depth_4,
                $._macro_name,
            ),
            alias("'", $.local_macro_end),
        ),

        local_macro_depth_4: $ => seq(
            alias('`', $.local_macro_start),
            choice(
                $.local_macro_depth_5,
                $._macro_name,
            ),
            alias("'", $.local_macro_end),
        ),

        local_macro_depth_5: $ => seq(
            alias('`', $.local_macro_start),
            choice(
                $.local_macro_depth_6,
                $._macro_name,
            ),
            alias("'", $.local_macro_end),
        ),

        local_macro_depth_6: $ => seq(
            alias('`', $.local_macro_start),
            choice(
                $.local_macro_depth_1,  // Wrap-around
                $._macro_name,
            ),
            alias("'", $.local_macro_end),
        ),

        // Macro name (identifier or positional argument number)
        _macro_name: $ => choice(
            $.identifier,
            /[0-9]+/,  // Positional arguments like `1', `2', etc.
        ),

        // Global macros (non-depth, single capture)
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
            optional($._program_options),
            repeat($._program_item),
            'end',
        ),

        _program_options: $ => seq(
            ',',
            repeat1(choice(
                'rclass',
                'eclass',
                'sclass',
                'nclass',
                'sortpreserve',
                'byable',
                seq('byable', '(', choice('recall', 'onecall'), ')'),
                'properties',
                seq('properties', '(', /[^)]+/, ')'),
            )),
        ),

        _program_item: $ => choice(
            $._statement,
            $._newline,
        ),

        // =========================================================================
        // MATA BLOCKS
        // =========================================================================

        mata_block: $ => seq(
            'mata',
            optional(':'),
            $._mata_block_content,
            'end',
        ),

        // =========================================================================
        // MACRO DEFINITIONS
        // =========================================================================

        macro_definition: $ => choice(
            // Local macro definition
            seq(
                choice('local', 'loc'),
                field('name', $.identifier),
                optional($._expression),
            ),
            // Global macro definition
            seq(
                choice('global', 'gl'),
                field('name', $.identifier),
                optional($._expression),
            ),
            // Temporary names
            seq(
                choice('tempvar', 'tempname', 'tempfile'),
                repeat1(field('name', $.identifier)),
            ),
        ),

        // =========================================================================
        // COMMANDS (Generic)
        // =========================================================================

        command: $ => seq(
            optional($.prefix),
            field('name', $.identifier),
            optional($._command_args),
        ),

        prefix: _ => choice(
            'by', 'bysort', 'bys',
            'quietly', 'qui',
            'noisily', 'noi',
            'capture', 'cap',
            'sortpreserve',
        ),

        _command_args: $ => repeat1($._expression),

        // =========================================================================
        // EXPRESSIONS
        // =========================================================================

        _expression: $ => choice(
            $.string,
            $.local_macro_depth_1,
            $.global_macro,
            $.number,
            $.missing_value,
            $.builtin_variable,
            $.identifier,
            $.operator,
            $._punctuation,
        ),

        // =========================================================================
        // ATOMS
        // =========================================================================

        // Numbers (integers, decimals, scientific notation)
        number: _ => token(choice(
            // Integer
            /[0-9]+/,
            // Decimal
            /[0-9]+\.[0-9]*/,
            /\.[0-9]+/,
            // Scientific notation
            /[0-9]+(\.[0-9]*)?[eE][+-]?[0-9]+/,
            /\.[0-9]+[eE][+-]?[0-9]+/,
        )),

        // Missing values: ., .a, .b, ..., .z
        missing_value: _ => /\.[a-z]?/,

        // Built-in system variables
        builtin_variable: _ => choice(
            '_n', '_N',
            '_b', '_coef', '_cons',
            '_rc', '_se', '_pi',
        ),

        // Stata types
        type: _ => choice(
            'byte', 'int', 'long', 'float', 'double',
            /str[0-9]+/,  // str1, str2, ..., str2045
            'strL',
        ),

        // Identifiers
        identifier: _ => /[A-Za-z_][A-Za-z0-9_]*/,

        // =========================================================================
        // OPERATORS
        // =========================================================================

        operator: _ => choice(
            // Arithmetic
            '+', '-', '*', '/', '^',
            // Comparison
            '==', '!=', '~=', '<', '>', '<=', '>=',
            // Logical
            '&', '|', '!', '~',
            // Assignment
            '=',
            // String operators
            '+',
        ),

        // Punctuation (for tokenization)
        _punctuation: _ => choice(
            '(', ')', '[', ']', '{', '}',
            ',', ';', ':',
        ),
    },
});
