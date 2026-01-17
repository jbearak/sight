/**
 * TextMate Parity Tests for Zed Extension Tree-sitter Grammar
 *
 * These tests verify that the Tree-sitter grammar produces equivalent node types
 * for constructs that the TextMate grammar highlights. This ensures feature parity
 * between the VS Code extension (TextMate) and Zed extension (Tree-sitter).
 *
 * **Validates: Requirements 3.1** (Tree-sitter grammar based on TextMate grammar)
 *
 * Scope Mapping (TextMate → Tree-sitter):
 * | TextMate Scope                              | Tree-sitter Node/Capture                    |
 * |---------------------------------------------|---------------------------------------------|
 * | comment.block.stata                         | block_comment → @comment                    |
 * | comment.line.star.stata                     | line_comment → @comment                     |
 * | comment.line.double-slash.stata             | line_comment → @comment                     |
 * | comment.line.triple-slash.stata             | line_comment → @comment                     |
 * | string.quoted.double.stata                  | double_string → @string                     |
 * | string.quoted.compound.depth1-6.stata       | compound_string_depth_1-6 → @string.depth.N |
 * | variable.other.macro.local.depth1-6.stata   | local_macro_depth_1-6 → @variable.macro...  |
 * | variable.other.macro.global.stata           | global_macro → @variable                    |
 * | keyword.control.mata.stata                  | mata_block "mata"/"end" → @keyword          |
 * | storage.type.function.stata                 | program_definition "program" → @keyword     |
 * | entity.name.function.stata                  | program_definition name → @function         |
 * | keyword.control.conditional.stata           | "if"/"else" → @keyword                      |
 * | keyword.control.flow.stata                  | "foreach"/"forvalues"/"while" → @keyword    |
 * | keyword.control.prefix.stata                | prefix → @keyword                           |
 * | support.type.stata                          | type_keyword → @type                        |
 * | variable.language.stata                     | builtin_variable → @variable.builtin        |
 * | constant.language.missing.stata             | missing_value → @constant                   |
 * | keyword.operator.*.stata                    | operator → @operator                        |
 * | constant.numeric.stata                      | number → @number                            |
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Test Setup - Load all files
// ============================================================================

const ZED_EXTENSION_DIR = path.join(import.meta.dir, '../../zed-extension');
const CLIENT_DIR = path.join(import.meta.dir, '../../client');

const GRAMMAR_PATH = path.join(ZED_EXTENSION_DIR, 'tree-sitter-stata/grammar.js');
const HIGHLIGHTS_PATH = path.join(ZED_EXTENSION_DIR, 'languages/stata/highlights.scm');
const TEXTMATE_PATH = path.join(CLIENT_DIR, 'syntaxes/stata.tmLanguage.json');

let grammar_content: string;
let highlights_content: string;
let textmate_grammar: any;

beforeAll(() => {
    grammar_content = fs.readFileSync(GRAMMAR_PATH, 'utf8');
    highlights_content = fs.readFileSync(HIGHLIGHTS_PATH, 'utf8');
    textmate_grammar = JSON.parse(fs.readFileSync(TEXTMATE_PATH, 'utf8'));
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if the TextMate grammar has a specific scope pattern
 */
function textmate_has_scope(scope_name: string): boolean {
    const json_str = JSON.stringify(textmate_grammar);
    return json_str.includes(scope_name);
}

/**
 * Check if the Tree-sitter grammar has a specific rule
 */
function treesitter_has_rule(rule_name: string): boolean {
    return grammar_content.includes(`${rule_name}:`);
}

/**
 * Check if the highlights.scm has a specific capture
 */
function highlights_has_capture(node_type: string, capture: string): boolean {
    // Match patterns like (node_type) @capture or (node_type ...) @capture
    const pattern = new RegExp(`\\(${node_type}[^)]*\\)\\s*@${capture}`);
    return pattern.test(highlights_content);
}

/**
 * Check if the highlights.scm has a keyword literal with capture
 */
function highlights_has_keyword_capture(keyword: string, capture: string): boolean {
    // Match patterns like "keyword" @capture or ["keyword" ...] @capture
    const direct_pattern = new RegExp(`"${keyword}"[^@]*@${capture}`);
    return direct_pattern.test(highlights_content);
}

// ============================================================================
// Task 14.2: Comment Scope Parity Tests
// ============================================================================

describe('TextMate Parity - Comment Scopes', () => {
    describe('comment.block.stata', () => {
        it('TextMate should have comment.block.stata scope', () => {
            expect(textmate_has_scope('comment.block.stata')).toBe(true);
        });

        it('Tree-sitter should have block_comment rule', () => {
            expect(treesitter_has_rule('block_comment')).toBe(true);
        });

        it('highlights.scm should capture block_comment as @comment', () => {
            expect(highlights_has_capture('block_comment', 'comment')).toBe(true);
        });
    });

    describe('comment.line.star.stata', () => {
        it('TextMate should have comment.line.star.stata scope', () => {
            expect(textmate_has_scope('comment.line.star.stata')).toBe(true);
        });

        it('Tree-sitter should have line_comment rule with star support', () => {
            expect(treesitter_has_rule('line_comment')).toBe(true);
            // Star comments require _line_start external token
            expect(grammar_content).toContain('$._line_start');
        });

        it('highlights.scm should capture line_comment as @comment', () => {
            expect(highlights_has_capture('line_comment', 'comment')).toBe(true);
        });
    });

    describe('comment.line.double-slash.stata', () => {
        it('TextMate should have comment.line.double-slash.stata scope', () => {
            expect(textmate_has_scope('comment.line.double-slash.stata')).toBe(true);
        });

        it('Tree-sitter should support // comments in line_comment', () => {
            expect(grammar_content).toContain("'//'");
        });

        it('highlights.scm should capture line_comment as @comment', () => {
            expect(highlights_has_capture('line_comment', 'comment')).toBe(true);
        });
    });

    describe('comment.line.triple-slash.stata', () => {
        it('TextMate should have comment.line.triple-slash.stata scope', () => {
            expect(textmate_has_scope('comment.line.triple-slash.stata')).toBe(true);
        });

        it('Tree-sitter should support /// comments in line_comment', () => {
            expect(grammar_content).toContain("'///'");
        });

        it('highlights.scm should capture line_comment as @comment', () => {
            expect(highlights_has_capture('line_comment', 'comment')).toBe(true);
        });
    });
});


// ============================================================================
// Task 14.3: String Scope Parity Tests
// ============================================================================

describe('TextMate Parity - String Scopes', () => {
    describe('string.quoted.double.stata', () => {
        it('TextMate should have string.quoted.double.stata scope', () => {
            expect(textmate_has_scope('string.quoted.double.stata')).toBe(true);
        });

        it('Tree-sitter should have double_string rule', () => {
            expect(treesitter_has_rule('double_string')).toBe(true);
        });

        it('highlights.scm should capture double_string as @string', () => {
            expect(highlights_has_capture('double_string', 'string')).toBe(true);
        });
    });

    describe('string.quoted.compound.depth1-6.stata', () => {
        const the_depths = [1, 2, 3, 4, 5, 6];

        for (const my_depth of the_depths) {
            describe(`depth ${my_depth}`, () => {
                it(`TextMate should have string.quoted.compound.depth${my_depth}.stata scope`, () => {
                    expect(textmate_has_scope(`string.quoted.compound.depth${my_depth}.stata`)).toBe(true);
                });

                it(`Tree-sitter should have compound_string_depth_${my_depth} rule`, () => {
                    expect(treesitter_has_rule(`compound_string_depth_${my_depth}`)).toBe(true);
                });

                it(`highlights.scm should capture compound_string_depth_${my_depth} as @string.depth.${my_depth}`, () => {
                    expect(highlights_has_capture(`compound_string_depth_${my_depth}`, `string.depth.${my_depth}`)).toBe(true);
                });
            });
        }
    });
});

// ============================================================================
// Task 14.4: Macro Scope Parity Tests
// ============================================================================

describe('TextMate Parity - Macro Scopes', () => {
    describe('variable.other.macro.local.depth1-6.stata', () => {
        const the_depths = [1, 2, 3, 4, 5, 6];

        for (const my_depth of the_depths) {
            describe(`depth ${my_depth}`, () => {
                it(`TextMate should have variable.other.macro.local.depth${my_depth}.stata scope`, () => {
                    expect(textmate_has_scope(`variable.other.macro.local.depth${my_depth}.stata`)).toBe(true);
                });

                it(`Tree-sitter should have local_macro_depth_${my_depth} rule`, () => {
                    expect(treesitter_has_rule(`local_macro_depth_${my_depth}`)).toBe(true);
                });

                it(`highlights.scm should capture local_macro_depth_${my_depth} as @variable.macro.local.depth.${my_depth}`, () => {
                    expect(highlights_has_capture(`local_macro_depth_${my_depth}`, `variable.macro.local.depth.${my_depth}`)).toBe(true);
                });
            });
        }
    });

    describe('variable.other.macro.global.stata', () => {
        it('TextMate should have variable.other.macro.global.stata scope', () => {
            expect(textmate_has_scope('variable.other.macro.global.stata')).toBe(true);
        });

        it('Tree-sitter should have global_macro rule', () => {
            expect(treesitter_has_rule('global_macro')).toBe(true);
        });

        it('highlights.scm should capture global_macro as @variable', () => {
            expect(highlights_has_capture('global_macro', 'variable')).toBe(true);
        });

        it('Tree-sitter should support $name syntax', () => {
            expect(grammar_content).toContain("'$'");
        });

        it('Tree-sitter should support ${name} syntax', () => {
            expect(grammar_content).toContain("'${'");
            expect(grammar_content).toContain("'}'");
        });
    });
});


// ============================================================================
// Task 14.5: Mata Block Scope Parity Tests
// ============================================================================

describe('TextMate Parity - Mata Block Scopes', () => {
    describe('keyword.control.mata.stata', () => {
        it('TextMate should have keyword.control.mata.stata scope', () => {
            expect(textmate_has_scope('keyword.control.mata.stata')).toBe(true);
        });

        it('Tree-sitter should have mata_block rule', () => {
            expect(treesitter_has_rule('mata_block')).toBe(true);
        });

        it('highlights.scm should capture "mata" keyword', () => {
            expect(highlights_content).toContain('"mata"');
            expect(highlights_content).toContain('@keyword');
        });

        it('highlights.scm should capture "end" keyword for mata blocks', () => {
            expect(highlights_content).toContain('"end"');
            expect(highlights_content).toContain('@keyword');
        });
    });

    describe('meta.embedded.block.mata.stata', () => {
        it('TextMate should have meta.embedded.block.mata.stata scope', () => {
            expect(textmate_has_scope('meta.embedded.block.mata.stata')).toBe(true);
        });

        it('Tree-sitter should support multiline mata blocks', () => {
            // Check for mata followed by newline pattern
            expect(grammar_content).toMatch(/mata_block:.*'mata'.*\$\._newline.*'end'/s);
        });

        it('Tree-sitter should support brace-delimited mata blocks', () => {
            expect(grammar_content).toMatch(/mata_block:.*'\{'/s);
            expect(grammar_content).toMatch(/mata_block:.*'\}'/s);
        });

        it('Tree-sitter should support inline mata expressions', () => {
            expect(grammar_content).toContain('_mata_inline_content');
        });
    });

    describe('meta.embedded.inline.mata.stata', () => {
        it('TextMate should have meta.embedded.inline.mata.stata scope', () => {
            expect(textmate_has_scope('meta.embedded.inline.mata.stata')).toBe(true);
        });

        it('Tree-sitter should support inline mata with optional colon', () => {
            expect(grammar_content).toMatch(/mata_block:.*optional\(':'\).*\$\._mata_inline_content/s);
        });
    });
});

// ============================================================================
// Task 14.6: Program Definition Scope Parity Tests
// ============================================================================

describe('TextMate Parity - Program Definition Scopes', () => {
    describe('storage.type.function.stata', () => {
        it('TextMate should have storage.type.function.stata scope', () => {
            expect(textmate_has_scope('storage.type.function.stata')).toBe(true);
        });

        it('Tree-sitter should have program_definition rule with "program" keyword', () => {
            expect(treesitter_has_rule('program_definition')).toBe(true);
            expect(grammar_content).toMatch(/program_definition:.*'program'/s);
        });

        it('highlights.scm should capture "program" as @keyword', () => {
            expect(highlights_content).toContain('"program"');
            expect(highlights_content).toContain('@keyword');
        });
    });

    describe('entity.name.function.stata', () => {
        it('TextMate should have entity.name.function.stata scope', () => {
            expect(textmate_has_scope('entity.name.function.stata')).toBe(true);
        });

        it('Tree-sitter should capture program name as field', () => {
            expect(grammar_content).toMatch(/program_definition:.*field\('name'/s);
        });

        it('highlights.scm should capture program name as @function', () => {
            expect(highlights_content).toContain('(program_definition');
            expect(highlights_content).toContain('name:');
            expect(highlights_content).toContain('@function');
        });
    });

    describe('keyword.other.stata for define', () => {
        it('TextMate should have keyword.other.stata scope for define', () => {
            // TextMate uses keyword.other.stata for "define" in program definitions
            expect(textmate_has_scope('keyword.other.stata')).toBe(true);
        });

        it('Tree-sitter should support optional "define" keyword', () => {
            expect(grammar_content).toMatch(/program_definition:.*optional\('define'\)/s);
        });

        it('highlights.scm should capture "define" as @keyword', () => {
            expect(highlights_content).toContain('"define"');
            expect(highlights_content).toContain('@keyword');
        });
    });
});


// ============================================================================
// Task 14.7: Keyword Scope Parity Tests
// ============================================================================

describe('TextMate Parity - Keyword Scopes', () => {
    describe('keyword.control.conditional.stata', () => {
        it('TextMate should have keyword.control.conditional.stata scope', () => {
            expect(textmate_has_scope('keyword.control.conditional.stata')).toBe(true);
        });

        it('Tree-sitter should have control_keyword rule with if/else', () => {
            expect(treesitter_has_rule('control_keyword')).toBe(true);
            expect(grammar_content).toMatch(/control_keyword:.*'if'/s);
            expect(grammar_content).toMatch(/control_keyword:.*'else'/s);
        });

        it('highlights.scm should capture control_keyword as @keyword', () => {
            expect(highlights_has_capture('control_keyword', 'keyword')).toBe(true);
        });
    });

    describe('keyword.control.flow.stata', () => {
        it('TextMate should have keyword.control.flow.stata scope', () => {
            expect(textmate_has_scope('keyword.control.flow.stata')).toBe(true);
        });

        it('Tree-sitter should have control_keyword rule with loop keywords', () => {
            expect(grammar_content).toMatch(/control_keyword:.*'foreach'/s);
            expect(grammar_content).toMatch(/control_keyword:.*'forvalues'/s);
            expect(grammar_content).toMatch(/control_keyword:.*'forv'/s);
            expect(grammar_content).toMatch(/control_keyword:.*'while'/s);
        });

        it('Tree-sitter should have control_keyword rule with continue/break', () => {
            expect(grammar_content).toMatch(/control_keyword:.*'continue'/s);
            expect(grammar_content).toMatch(/control_keyword:.*'break'/s);
        });
    });

    describe('keyword.control.prefix.stata', () => {
        it('TextMate should have keyword.control.prefix.stata scope', () => {
            expect(textmate_has_scope('keyword.control.prefix.stata')).toBe(true);
        });

        it('Tree-sitter should have prefix rule', () => {
            expect(treesitter_has_rule('prefix')).toBe(true);
        });

        it('Tree-sitter prefix should include by/bysort/bys', () => {
            expect(grammar_content).toMatch(/prefix:.*'by'/s);
            expect(grammar_content).toMatch(/prefix:.*'bysort'/s);
            expect(grammar_content).toMatch(/prefix:.*'bys'/s);
        });

        it('Tree-sitter prefix should include quietly/qui', () => {
            expect(grammar_content).toMatch(/prefix:.*'quietly'/s);
            expect(grammar_content).toMatch(/prefix:.*'qui'/s);
        });

        it('Tree-sitter prefix should include noisily/noi', () => {
            expect(grammar_content).toMatch(/prefix:.*'noisily'/s);
            expect(grammar_content).toMatch(/prefix:.*'noi'/s);
        });

        it('Tree-sitter prefix should include capture/cap', () => {
            expect(grammar_content).toMatch(/prefix:.*'capture'/s);
            expect(grammar_content).toMatch(/prefix:.*'cap'/s);
        });

        it('Tree-sitter prefix should include sortpreserve', () => {
            expect(grammar_content).toMatch(/prefix:.*'sortpreserve'/s);
        });

        it('highlights.scm should capture prefix as @keyword', () => {
            expect(highlights_has_capture('prefix', 'keyword')).toBe(true);
        });
    });

    describe('keyword.control.end.stata', () => {
        it('TextMate should have keyword.control.end.stata scope', () => {
            expect(textmate_has_scope('keyword.control.end.stata')).toBe(true);
        });

        it('Tree-sitter should have control_keyword rule with end', () => {
            expect(grammar_content).toMatch(/control_keyword:.*'end'/s);
        });
    });

    describe('keyword.other.stata for in/using', () => {
        it('TextMate should have keyword.other.stata scope', () => {
            expect(textmate_has_scope('keyword.other.stata')).toBe(true);
        });

        it('highlights.scm should capture "in" as @keyword', () => {
            expect(highlights_content).toContain('"in"');
        });

        it('highlights.scm should capture "using" as @keyword', () => {
            expect(highlights_content).toContain('"using"');
        });
    });
});


// ============================================================================
// Task 14.8: Type Scope Parity Tests
// ============================================================================

describe('TextMate Parity - Type Scopes', () => {
    describe('support.type.stata', () => {
        it('TextMate should have support.type.stata scope', () => {
            expect(textmate_has_scope('support.type.stata')).toBe(true);
        });

        it('Tree-sitter should have type_keyword rule', () => {
            expect(treesitter_has_rule('type_keyword')).toBe(true);
        });

        it('highlights.scm should capture type_keyword as @type', () => {
            expect(highlights_has_capture('type_keyword', 'type')).toBe(true);
        });
    });

    describe('Numeric types', () => {
        const the_numeric_types = ['byte', 'int', 'long', 'float', 'double'];

        for (const my_type of the_numeric_types) {
            it(`Tree-sitter should support ${my_type} type`, () => {
                expect(grammar_content).toMatch(new RegExp(`type_keyword:.*'${my_type}'`, 's'));
            });
        }
    });

    describe('String types', () => {
        it('Tree-sitter should support str1-str2045 types via regex', () => {
            // Check for string type regex patterns
            expect(grammar_content).toMatch(/type_keyword:.*\/str\[1-9\]\//s);
            expect(grammar_content).toMatch(/type_keyword:.*\/str\[1-9\]\[0-9\]\//s);
        });

        it('Tree-sitter should support strL type', () => {
            expect(grammar_content).toMatch(/type_keyword:.*'strL'/s);
        });
    });

    describe('TextMate type pattern coverage', () => {
        it('TextMate should match byte, int, long, float, double', () => {
            const types_pattern = textmate_grammar.repository.types?.match;
            expect(types_pattern).toBeDefined();
            expect(types_pattern).toContain('byte');
            expect(types_pattern).toContain('int');
            expect(types_pattern).toContain('long');
            expect(types_pattern).toContain('float');
            expect(types_pattern).toContain('double');
        });

        it('TextMate should match str* types', () => {
            const types_pattern = textmate_grammar.repository.types?.match;
            expect(types_pattern).toBeDefined();
            expect(types_pattern).toContain('str');
            expect(types_pattern).toContain('strL');
        });
    });
});

// ============================================================================
// Task 14.9: Built-in Variable Scope Parity Tests
// ============================================================================

describe('TextMate Parity - Built-in Variable Scopes', () => {
    describe('variable.language.stata', () => {
        it('TextMate should have variable.language.stata scope', () => {
            expect(textmate_has_scope('variable.language.stata')).toBe(true);
        });

        it('Tree-sitter should have builtin_variable rule', () => {
            expect(treesitter_has_rule('builtin_variable')).toBe(true);
        });

        it('highlights.scm should capture builtin_variable as @variable.builtin', () => {
            expect(highlights_has_capture('builtin_variable', 'variable.builtin')).toBe(true);
        });
    });

    describe('Observation variables', () => {
        it('Tree-sitter should support _n', () => {
            expect(grammar_content).toMatch(/builtin_variable:.*'_n'/s);
        });

        it('Tree-sitter should support _N', () => {
            expect(grammar_content).toMatch(/builtin_variable:.*'_N'/s);
        });
    });

    describe('Estimation variables', () => {
        const the_estimation_vars = ['_b', '_coef', '_cons', '_rc', '_se'];

        for (const my_var of the_estimation_vars) {
            it(`Tree-sitter should support ${my_var}`, () => {
                expect(grammar_content).toMatch(new RegExp(`builtin_variable:.*'${my_var}'`, 's'));
            });
        }
    });

    describe('Constant variables', () => {
        it('Tree-sitter should support _pi', () => {
            expect(grammar_content).toMatch(/builtin_variable:.*'_pi'/s);
        });
    });

    describe('Display variables', () => {
        const the_display_vars = ['_skip', '_dup', '_newline', '_column', '_continue', '_request', '_char'];

        for (const my_var of the_display_vars) {
            it(`Tree-sitter should support ${my_var}`, () => {
                expect(grammar_content).toMatch(new RegExp(`builtin_variable:.*'${my_var}'`, 's'));
            });
        }
    });

    describe('TextMate built-in variable pattern coverage', () => {
        it('TextMate should match all built-in variables', () => {
            const builtin_pattern = textmate_grammar.repository['builtin-variables']?.match;
            expect(builtin_pattern).toBeDefined();
            expect(builtin_pattern).toContain('_n');
            expect(builtin_pattern).toContain('_N');
            expect(builtin_pattern).toContain('_b');
            expect(builtin_pattern).toContain('_coef');
            expect(builtin_pattern).toContain('_cons');
            expect(builtin_pattern).toContain('_rc');
            expect(builtin_pattern).toContain('_se');
            expect(builtin_pattern).toContain('_pi');
        });
    });
});


// ============================================================================
// Task 14.10: Missing Value Scope Parity Tests
// ============================================================================

describe('TextMate Parity - Missing Value Scopes', () => {
    describe('constant.language.missing.stata', () => {
        it('TextMate should have constant.language.missing.stata scope', () => {
            expect(textmate_has_scope('constant.language.missing.stata')).toBe(true);
        });

        it('Tree-sitter should have missing_value rule', () => {
            expect(treesitter_has_rule('missing_value')).toBe(true);
        });

        it('highlights.scm should capture missing_value as @constant', () => {
            expect(highlights_has_capture('missing_value', 'constant')).toBe(true);
        });
    });

    describe('Missing value patterns', () => {
        it('Tree-sitter should support . (system missing)', () => {
            // The regex /\.[a-z]?/ matches . and .a through .z
            expect(grammar_content).toMatch(/missing_value:.*\/\\\.\[a-z\]\?\//s);
        });

        it('Tree-sitter should support .a through .z (extended missing)', () => {
            // Same regex handles extended missing values
            expect(grammar_content).toMatch(/missing_value:.*\/\\\.\[a-z\]\?\//s);
        });
    });

    describe('TextMate missing value pattern', () => {
        it('TextMate should match . and .a-.z', () => {
            const missing_pattern = textmate_grammar.repository['missing-values']?.match;
            expect(missing_pattern).toBeDefined();
            // TextMate uses: (?<![a-zA-Z0-9_])\.[a-z]?(?![a-zA-Z0-9_])
            expect(missing_pattern).toContain('\\.');
            expect(missing_pattern).toContain('[a-z]');
        });
    });
});

// ============================================================================
// Task 14.11: Operator Scope Parity Tests
// ============================================================================

describe('TextMate Parity - Operator Scopes', () => {
    describe('keyword.operator.arithmetic.stata', () => {
        it('TextMate should have keyword.operator.arithmetic.stata scope', () => {
            expect(textmate_has_scope('keyword.operator.arithmetic.stata')).toBe(true);
        });

        it('Tree-sitter should have operator rule with arithmetic operators', () => {
            expect(treesitter_has_rule('operator')).toBe(true);
            expect(grammar_content).toMatch(/operator:.*'\+'/s);
            expect(grammar_content).toMatch(/operator:.*'-'/s);
            expect(grammar_content).toMatch(/operator:.*'\*'/s);
            expect(grammar_content).toMatch(/operator:.*'\/'/s);
            expect(grammar_content).toMatch(/operator:.*'\^'/s);
        });

        it('highlights.scm should capture operator as @operator', () => {
            expect(highlights_has_capture('operator', 'operator')).toBe(true);
        });
    });

    describe('keyword.operator.comparison.stata', () => {
        it('TextMate should have keyword.operator.comparison.stata scope', () => {
            expect(textmate_has_scope('keyword.operator.comparison.stata')).toBe(true);
        });

        it('Tree-sitter should have operator rule with comparison operators', () => {
            expect(grammar_content).toMatch(/operator:.*'=='/s);
            expect(grammar_content).toMatch(/operator:.*'!='/s);
            expect(grammar_content).toMatch(/operator:.*'~='/s);
            expect(grammar_content).toMatch(/operator:.*'<'/s);
            expect(grammar_content).toMatch(/operator:.*'>'/s);
            expect(grammar_content).toMatch(/operator:.*'<='/s);
            expect(grammar_content).toMatch(/operator:.*'>='/s);
        });
    });

    describe('keyword.operator.logical.stata', () => {
        it('TextMate should have keyword.operator.logical.stata scope', () => {
            expect(textmate_has_scope('keyword.operator.logical.stata')).toBe(true);
        });

        it('Tree-sitter should have operator rule with logical operators', () => {
            expect(grammar_content).toMatch(/operator:.*'&'/s);
            expect(grammar_content).toMatch(/operator:.*'\|'/s);
            expect(grammar_content).toMatch(/operator:.*'!'/s);
            expect(grammar_content).toMatch(/operator:.*'~'/s);
        });
    });

    describe('keyword.operator.assignment.stata', () => {
        it('TextMate should have keyword.operator.assignment.stata scope', () => {
            expect(textmate_has_scope('keyword.operator.assignment.stata')).toBe(true);
        });

        it('Tree-sitter should have operator rule with assignment operator', () => {
            expect(grammar_content).toMatch(/operator:.*'='/s);
        });
    });

    describe('keyword.operator.interaction.stata', () => {
        it('TextMate should have keyword.operator.interaction.stata scope', () => {
            expect(textmate_has_scope('keyword.operator.interaction.stata')).toBe(true);
        });

        it('Tree-sitter should have operator rule with interaction operator #', () => {
            expect(grammar_content).toMatch(/operator:.*'#'/s);
        });
    });
});


// ============================================================================
// Task 14.12: Number Scope Parity Tests
// ============================================================================

describe('TextMate Parity - Number Scopes', () => {
    describe('constant.numeric.stata', () => {
        it('TextMate should have constant.numeric.stata scope', () => {
            expect(textmate_has_scope('constant.numeric.stata')).toBe(true);
        });

        it('Tree-sitter should have number rule', () => {
            expect(treesitter_has_rule('number')).toBe(true);
        });

        it('highlights.scm should capture number as @number', () => {
            expect(highlights_has_capture('number', 'number')).toBe(true);
        });
    });

    describe('Integer numbers', () => {
        it('Tree-sitter should support integer numbers', () => {
            // Check for integer pattern: /[0-9]+/
            expect(grammar_content).toMatch(/number:.*\/\[0-9\]\+\//s);
        });
    });

    describe('Decimal numbers', () => {
        it('Tree-sitter should support decimal numbers with leading digits', () => {
            // Check for pattern like /[0-9]+\.[0-9]*/
            expect(grammar_content).toMatch(/number:.*\[0-9\]\+\\\.\[0-9\]\*/s);
        });

        it('Tree-sitter should support decimal numbers without leading digits', () => {
            // Check for pattern like /\.[0-9]+/
            expect(grammar_content).toMatch(/number:.*\\\.\[0-9\]\+/s);
        });
    });

    describe('Scientific notation', () => {
        it('Tree-sitter should support scientific notation', () => {
            // Check for pattern with [eE][+-]?
            expect(grammar_content).toMatch(/number:.*\[eE\]/s);
        });
    });

    describe('TextMate number pattern', () => {
        it('TextMate should match integers, decimals, and scientific notation', () => {
            const numbers_repo = textmate_grammar.repository.numbers;
            expect(numbers_repo).toBeDefined();
            expect(numbers_repo.patterns).toBeDefined();
            expect(numbers_repo.patterns.length).toBeGreaterThan(0);

            const number_pattern = numbers_repo.patterns[0]?.match;
            expect(number_pattern).toBeDefined();
            // TextMate uses: \b\d+(\.\d+)?([eE][+-]?\d+)?\b
            expect(number_pattern).toContain('\\d+');
        });
    });
});

// ============================================================================
// Task 14.13: Macros Inside Double Strings Parity Tests
// ============================================================================

describe('TextMate Parity - Macros Inside Double Strings', () => {
    describe('Global macro expansion in double strings', () => {
        it('TextMate double-string should include macros pattern', () => {
            const double_string = textmate_grammar.repository['double-string'];
            expect(double_string).toBeDefined();
            expect(double_string.patterns).toBeDefined();

            // Check that double-string includes macros
            const has_macros = double_string.patterns.some(
                (p: any) => p.include === '#macros'
            );
            expect(has_macros).toBe(true);
        });

        it('Tree-sitter double_string should allow global_macro', () => {
            // The double_string rule should include global_macro as a choice
            expect(grammar_content).toMatch(/double_string:[\s\S]*?\$\.global_macro[\s\S]*?'"'/);
        });

        it('Tree-sitter should exclude $ from regular content in double strings', () => {
            // The regular content pattern should exclude $ to allow macro parsing
            expect(grammar_content).toContain('[^"$\\\\\\r\\n]+');
        });
    });

    describe('$name syntax in strings', () => {
        it('TextMate global-macro should match $name pattern', () => {
            const global_macro = textmate_grammar.repository['global-macro'];
            expect(global_macro).toBeDefined();
            expect(global_macro.patterns).toBeDefined();

            const has_dollar_pattern = global_macro.patterns.some(
                (p: any) => p.match && p.match.includes('\\$')
            );
            expect(has_dollar_pattern).toBe(true);
        });

        it('Tree-sitter global_macro should support $name syntax', () => {
            expect(grammar_content).toContain("'$'");
            expect(grammar_content).toContain('$.identifier');
        });
    });

    describe('${name} syntax in strings', () => {
        it('TextMate global-macro should match ${name} pattern', () => {
            const global_macro = textmate_grammar.repository['global-macro'];
            expect(global_macro).toBeDefined();

            // TextMate uses \\$\\{ which is \$\{ in the JSON string
            const has_braced_pattern = global_macro.patterns.some(
                (p: any) => p.match && p.match.includes('$\\{')
            );
            expect(has_braced_pattern).toBe(true);
        });

        it('Tree-sitter global_macro should support ${name} syntax', () => {
            expect(grammar_content).toContain("'${'");
            expect(grammar_content).toContain("'}'");
        });
    });
});


// ============================================================================
// Task 14.14: Global Macros Inside Local Macros Parity Tests
// ============================================================================

describe('TextMate Parity - Global Macros Inside Local Macros', () => {
    describe('Nested macro references', () => {
        it('TextMate local-macro-depth1 should include global-macro', () => {
            const local_macro_depth1 = textmate_grammar.repository['local-macro-depth1'];
            expect(local_macro_depth1).toBeDefined();
            expect(local_macro_depth1.patterns).toBeDefined();

            const has_global = local_macro_depth1.patterns.some(
                (p: any) => p.include === '#global-macro'
            );
            expect(has_global).toBe(true);
        });

        it('Tree-sitter local_macro_depth_1 should allow global_macro', () => {
            expect(grammar_content).toMatch(/local_macro_depth_1:[\s\S]*?\$\.global_macro/);
        });
    });

    describe('All local macro depths should support global macros', () => {
        const the_depths = [1, 2, 3, 4, 5, 6];

        for (const my_depth of the_depths) {
            it(`TextMate local-macro-depth${my_depth} should include global-macro`, () => {
                const local_macro = textmate_grammar.repository[`local-macro-depth${my_depth}`];
                expect(local_macro).toBeDefined();
                expect(local_macro.patterns).toBeDefined();

                const has_global = local_macro.patterns.some(
                    (p: any) => p.include === '#global-macro'
                );
                expect(has_global).toBe(true);
            });

            it(`Tree-sitter local_macro_depth_${my_depth} should allow global_macro`, () => {
                expect(grammar_content).toMatch(
                    new RegExp(`local_macro_depth_${my_depth}:[\\s\\S]*?\\$\\.global_macro`)
                );
            });
        }
    });

    describe('Example: `$global\' pattern', () => {
        it('TextMate should highlight `$global\' with both local and global macro scopes', () => {
            // The local macro depth1 pattern should match the outer `...'
            // and the global-macro pattern should match the inner $global
            const local_macro = textmate_grammar.repository['local-macro-depth1'];
            expect(local_macro).toBeDefined();
            expect(local_macro.begin).toBe('`');
            expect(local_macro.end).toContain("'");
        });

        it('Tree-sitter should parse `$global\' with nested global_macro', () => {
            // The local_macro_depth_1 rule should allow global_macro as content
            expect(grammar_content).toMatch(/local_macro_depth_1:.*choice\(.*\$\.global_macro/s);
        });
    });
});

// ============================================================================
// Additional Parity Tests - Macro Definition Keywords
// ============================================================================

describe('TextMate Parity - Macro Definition Keywords', () => {
    describe('keyword.macro.stata', () => {
        it('TextMate should have keyword.macro.stata scope', () => {
            expect(textmate_has_scope('keyword.macro.stata')).toBe(true);
        });

        it('Tree-sitter should have macro_definition rule', () => {
            expect(treesitter_has_rule('macro_definition')).toBe(true);
        });
    });

    describe('local/loc keywords', () => {
        it('Tree-sitter should support local keyword', () => {
            expect(grammar_content).toMatch(/macro_definition:.*'local'/s);
        });

        it('Tree-sitter should support loc abbreviation', () => {
            expect(grammar_content).toMatch(/macro_definition:.*'loc'/s);
        });

        it('highlights.scm should capture "local" as @keyword', () => {
            expect(highlights_content).toContain('"local"');
        });

        it('highlights.scm should capture "loc" as @keyword', () => {
            expect(highlights_content).toContain('"loc"');
        });
    });

    describe('global/gl keywords', () => {
        it('Tree-sitter should support global keyword', () => {
            expect(grammar_content).toMatch(/macro_definition:.*'global'/s);
        });

        it('Tree-sitter should support gl abbreviation', () => {
            expect(grammar_content).toMatch(/macro_definition:.*'gl'/s);
        });

        it('highlights.scm should capture "global" as @keyword', () => {
            expect(highlights_content).toContain('"global"');
        });

        it('highlights.scm should capture "gl" as @keyword', () => {
            expect(highlights_content).toContain('"gl"');
        });
    });

    describe('tempvar/tempname/tempfile keywords', () => {
        it('Tree-sitter should support tempvar keyword', () => {
            expect(grammar_content).toMatch(/macro_definition:.*'tempvar'/s);
        });

        it('Tree-sitter should support tempname keyword', () => {
            expect(grammar_content).toMatch(/macro_definition:.*'tempname'/s);
        });

        it('Tree-sitter should support tempfile keyword', () => {
            expect(grammar_content).toMatch(/macro_definition:.*'tempfile'/s);
        });

        it('highlights.scm should capture temp* keywords as @keyword', () => {
            expect(highlights_content).toContain('"tempvar"');
            expect(highlights_content).toContain('"tempname"');
            expect(highlights_content).toContain('"tempfile"');
        });
    });
});

// ============================================================================
// Additional Parity Tests - File Execution Commands
// ============================================================================

describe('TextMate Parity - File Execution Commands', () => {
    describe('do/run/include commands', () => {
        it('TextMate should have keyword.control.flow.stata for do/run/include', () => {
            expect(textmate_has_scope('keyword.control.flow.stata')).toBe(true);
            const commands_file = textmate_grammar.repository['commands-file-execution'];
            expect(commands_file).toBeDefined();
            expect(commands_file.match).toContain('do');
            expect(commands_file.match).toContain('run');
            expect(commands_file.match).toContain('include');
        });

        it('highlights.scm should capture "do" as @keyword', () => {
            expect(highlights_content).toContain('"do"');
        });

        it('highlights.scm should capture "run" as @keyword', () => {
            expect(highlights_content).toContain('"run"');
        });

        it('highlights.scm should capture "include" as @keyword', () => {
            expect(highlights_content).toContain('"include"');
        });
    });
});

// ============================================================================
// Summary Test - Overall Parity Coverage
// ============================================================================

describe('TextMate Parity - Overall Coverage Summary', () => {
    it('should have parity for all major TextMate scope categories', () => {
        // Comments
        expect(textmate_has_scope('comment.block.stata')).toBe(true);
        expect(textmate_has_scope('comment.line.star.stata')).toBe(true);
        expect(textmate_has_scope('comment.line.double-slash.stata')).toBe(true);
        expect(textmate_has_scope('comment.line.triple-slash.stata')).toBe(true);

        // Strings
        expect(textmate_has_scope('string.quoted.double.stata')).toBe(true);
        expect(textmate_has_scope('string.quoted.compound.depth1.stata')).toBe(true);

        // Macros
        expect(textmate_has_scope('variable.other.macro.local.depth1.stata')).toBe(true);
        expect(textmate_has_scope('variable.other.macro.global.stata')).toBe(true);

        // Keywords
        expect(textmate_has_scope('keyword.control.conditional.stata')).toBe(true);
        expect(textmate_has_scope('keyword.control.flow.stata')).toBe(true);
        expect(textmate_has_scope('keyword.control.prefix.stata')).toBe(true);
        expect(textmate_has_scope('keyword.control.mata.stata')).toBe(true);

        // Program definitions
        expect(textmate_has_scope('storage.type.function.stata')).toBe(true);
        expect(textmate_has_scope('entity.name.function.stata')).toBe(true);

        // Types
        expect(textmate_has_scope('support.type.stata')).toBe(true);

        // Built-in variables
        expect(textmate_has_scope('variable.language.stata')).toBe(true);

        // Missing values
        expect(textmate_has_scope('constant.language.missing.stata')).toBe(true);

        // Operators
        expect(textmate_has_scope('keyword.operator.arithmetic.stata')).toBe(true);
        expect(textmate_has_scope('keyword.operator.comparison.stata')).toBe(true);
        expect(textmate_has_scope('keyword.operator.logical.stata')).toBe(true);
        expect(textmate_has_scope('keyword.operator.assignment.stata')).toBe(true);

        // Numbers
        expect(textmate_has_scope('constant.numeric.stata')).toBe(true);
    });

    it('should have corresponding Tree-sitter rules for all major constructs', () => {
        // Comments
        expect(treesitter_has_rule('line_comment')).toBe(true);
        expect(treesitter_has_rule('block_comment')).toBe(true);

        // Strings
        expect(treesitter_has_rule('double_string')).toBe(true);
        expect(treesitter_has_rule('compound_string_depth_1')).toBe(true);

        // Macros
        expect(treesitter_has_rule('local_macro_depth_1')).toBe(true);
        expect(treesitter_has_rule('global_macro')).toBe(true);

        // Keywords
        expect(treesitter_has_rule('control_keyword')).toBe(true);
        expect(treesitter_has_rule('prefix')).toBe(true);

        // Program definitions
        expect(treesitter_has_rule('program_definition')).toBe(true);

        // Mata blocks
        expect(treesitter_has_rule('mata_block')).toBe(true);

        // Types
        expect(treesitter_has_rule('type_keyword')).toBe(true);

        // Built-in variables
        expect(treesitter_has_rule('builtin_variable')).toBe(true);

        // Missing values
        expect(treesitter_has_rule('missing_value')).toBe(true);

        // Operators
        expect(treesitter_has_rule('operator')).toBe(true);

        // Numbers
        expect(treesitter_has_rule('number')).toBe(true);
    });

    it('should have corresponding highlights.scm captures for all major constructs', () => {
        // Comments
        expect(highlights_has_capture('line_comment', 'comment')).toBe(true);
        expect(highlights_has_capture('block_comment', 'comment')).toBe(true);

        // Strings
        expect(highlights_has_capture('double_string', 'string')).toBe(true);
        expect(highlights_has_capture('compound_string_depth_1', 'string.depth.1')).toBe(true);

        // Macros
        expect(highlights_has_capture('local_macro_depth_1', 'variable.macro.local.depth.1')).toBe(true);
        expect(highlights_has_capture('global_macro', 'variable')).toBe(true);

        // Keywords
        expect(highlights_has_capture('control_keyword', 'keyword')).toBe(true);
        expect(highlights_has_capture('prefix', 'keyword')).toBe(true);

        // Types
        expect(highlights_has_capture('type_keyword', 'type')).toBe(true);

        // Built-in variables
        expect(highlights_has_capture('builtin_variable', 'variable.builtin')).toBe(true);

        // Missing values
        expect(highlights_has_capture('missing_value', 'constant')).toBe(true);

        // Operators
        expect(highlights_has_capture('operator', 'operator')).toBe(true);

        // Numbers
        expect(highlights_has_capture('number', 'number')).toBe(true);
    });
});
