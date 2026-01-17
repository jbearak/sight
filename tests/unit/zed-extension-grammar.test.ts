/**
 * Unit tests for Zed extension Tree-sitter grammar
 *
 * These tests verify the grammar.js file structure and rules,
 * query files (.scm) syntax and coverage, and configuration files.
 *
 * Since we can't directly invoke the Tree-sitter parser from TypeScript
 * without native bindings, these tests focus on:
 * 1. Grammar.js file structure and rule definitions
 * 2. Query files (.scm) syntax and coverage
 * 3. Configuration files structure and version consistency
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Test Setup - Load all files
// ============================================================================

const ZED_EXTENSION_DIR = path.join(import.meta.dir, '../../zed-extension');
const GRAMMAR_PATH = path.join(ZED_EXTENSION_DIR, 'tree-sitter-stata/grammar.js');
const HIGHLIGHTS_PATH = path.join(ZED_EXTENSION_DIR, 'languages/stata/highlights.scm');
const BRACKETS_PATH = path.join(ZED_EXTENSION_DIR, 'languages/stata/brackets.scm');
const INDENTS_PATH = path.join(ZED_EXTENSION_DIR, 'languages/stata/indents.scm');
const EXTENSION_TOML_PATH = path.join(ZED_EXTENSION_DIR, 'extension.toml');
const CONFIG_TOML_PATH = path.join(ZED_EXTENSION_DIR, 'languages/stata/config.toml');
const CARGO_TOML_PATH = path.join(ZED_EXTENSION_DIR, 'Cargo.toml');
const TS_PACKAGE_JSON_PATH = path.join(ZED_EXTENSION_DIR, 'tree-sitter-stata/package.json');
const ROOT_PACKAGE_JSON_PATH = path.join(import.meta.dir, '../../package.json');

let grammar_content: string;
let highlights_content: string;
let brackets_content: string;
let indents_content: string;
let extension_toml_content: string;
let config_toml_content: string;
let cargo_toml_content: string;
let ts_package_json: any;
let root_package_json: any;

beforeAll(() => {
    grammar_content = fs.readFileSync(GRAMMAR_PATH, 'utf8');
    highlights_content = fs.readFileSync(HIGHLIGHTS_PATH, 'utf8');
    brackets_content = fs.readFileSync(BRACKETS_PATH, 'utf8');
    indents_content = fs.readFileSync(INDENTS_PATH, 'utf8');
    extension_toml_content = fs.readFileSync(EXTENSION_TOML_PATH, 'utf8');
    config_toml_content = fs.readFileSync(CONFIG_TOML_PATH, 'utf8');
    cargo_toml_content = fs.readFileSync(CARGO_TOML_PATH, 'utf8');
    ts_package_json = JSON.parse(fs.readFileSync(TS_PACKAGE_JSON_PATH, 'utf8'));
    root_package_json = JSON.parse(fs.readFileSync(ROOT_PACKAGE_JSON_PATH, 'utf8'));
});


// ============================================================================
// Task 12.2: Comment Parsing Tests
// ============================================================================

describe('Zed Extension Grammar - Comment Parsing', () => {
    describe('Line comment rules', () => {
        it('should define line_comment rule', () => {
            expect(grammar_content).toContain('line_comment:');
        });

        it('should support // line comments', () => {
            // Check for // pattern in line_comment rule
            expect(grammar_content).toMatch(/\/\//);
            expect(grammar_content).toContain("'//'");
        });

        it('should support /// continuation comments', () => {
            // Check for /// pattern in line_comment rule
            expect(grammar_content).toContain("'///'");
        });

        it('should support * star comments at line start', () => {
            // Check for star comment pattern with _line_start
            expect(grammar_content).toContain('$._line_start');
            expect(grammar_content).toMatch(/\$\._line_start.*\*/);
        });

        it('should use external scanner for line start detection', () => {
            // Check externals definition
            expect(grammar_content).toContain('externals:');
            expect(grammar_content).toContain('$._line_start');
        });
    });

    describe('Block comment rules', () => {
        it('should define block_comment rule', () => {
            expect(grammar_content).toContain('block_comment:');
        });

        it('should support /* */ block comments', () => {
            // Check for block comment delimiters
            expect(grammar_content).toContain("'/*'");
            expect(grammar_content).toMatch(/\*\//);
        });
    });

    describe('Comment rule structure', () => {
        it('should define comment as choice of line_comment and block_comment', () => {
            expect(grammar_content).toContain('comment:');
            expect(grammar_content).toContain('$.line_comment');
            expect(grammar_content).toContain('$.block_comment');
        });
    });
});


// ============================================================================
// Task 12.3: String Parsing Tests
// ============================================================================

describe('Zed Extension Grammar - String Parsing', () => {
    describe('Double string rules', () => {
        it('should define double_string rule', () => {
            expect(grammar_content).toContain('double_string:');
        });

        it('should support escaped quotes in double strings', () => {
            // Check for "" escaped quote pattern
            expect(grammar_content).toContain("'\"\"'");
        });

        it('should support escape sequences in double strings', () => {
            // Check for escape sequence pattern
            expect(grammar_content).toMatch(/\\\\./);
        });

        it('should allow global macros inside double strings', () => {
            // Check that double_string references global_macro
            expect(grammar_content).toMatch(/double_string:.*\$\.global_macro/s);
        });
    });

    describe('Compound string rules', () => {
        it('should define compound_string_depth_1 through depth_6', () => {
            for (let depth = 1; depth <= 6; depth++) {
                expect(grammar_content).toContain(`compound_string_depth_${depth}:`);
            }
        });

        it('should use correct delimiters for compound strings', () => {
            // Check for `" opening delimiter
            expect(grammar_content).toContain("'`\"'");
            // Check for "' closing delimiter
            expect(grammar_content).toContain("\"\\\"'\"");
        });

        it('should support nested compound strings with wrap-around at depth 6', () => {
            // Depth 6 should reference depth 1 for wrap-around
            expect(grammar_content).toMatch(/compound_string_depth_6:.*compound_string_depth_1/s);
        });

        it('should allow local macros inside compound strings', () => {
            // Check that compound content includes local_macro_depth_1
            expect(grammar_content).toContain('$.local_macro_depth_1');
        });

        it('should allow global macros inside compound strings', () => {
            // Check that compound content includes global_macro
            expect(grammar_content).toMatch(/_compound_content_\d:.*\$\.global_macro/s);
        });
    });

    describe('String rule structure', () => {
        it('should define string as choice of double_string and compound_string', () => {
            expect(grammar_content).toContain('string:');
            expect(grammar_content).toContain('$.double_string');
            expect(grammar_content).toContain('$.compound_string_depth_1');
        });
    });
});


// ============================================================================
// Task 12.4: Macro Parsing Tests
// ============================================================================

describe('Zed Extension Grammar - Macro Parsing', () => {
    describe('Local macro rules', () => {
        it('should define local_macro_depth_1 through depth_6', () => {
            for (let depth = 1; depth <= 6; depth++) {
                expect(grammar_content).toContain(`local_macro_depth_${depth}:`);
            }
        });

        it('should use correct delimiters for local macros', () => {
            // Check for ` opening delimiter
            expect(grammar_content).toMatch(/'`'/);
            // Check for ' closing delimiter
            expect(grammar_content).toMatch(/"'"/);
        });

        it('should support nested local macros with wrap-around at depth 6', () => {
            // Depth 6 should reference depth 1 for wrap-around
            expect(grammar_content).toMatch(/local_macro_depth_6:.*local_macro_depth_1/s);
        });

        it('should allow global macros inside local macros', () => {
            // Check that local_macro_depth rules include global_macro
            expect(grammar_content).toMatch(/local_macro_depth_\d:.*\$\.global_macro/s);
        });
    });

    describe('Global macro rules', () => {
        it('should define global_macro rule', () => {
            expect(grammar_content).toContain('global_macro:');
        });

        it('should support $name syntax', () => {
            // Check for $ prefix pattern
            expect(grammar_content).toMatch(/'\$'/);
        });

        it('should support ${name} syntax', () => {
            // Check for ${...} pattern
            expect(grammar_content).toContain("'${'");
            expect(grammar_content).toContain("'}'");
        });
    });

    describe('Positional arguments', () => {
        it('should support numeric positional args in _macro_name', () => {
            // Check that _macro_name allows digits
            expect(grammar_content).toContain('_macro_name:');
            expect(grammar_content).toMatch(/_macro_name:.*\/\[0-9\]\+\//s);
        });
    });
});


// ============================================================================
// Task 12.5: Mata Block Parsing Tests
// ============================================================================

describe('Zed Extension Grammar - Mata Block Parsing', () => {
    it('should define mata_block rule', () => {
        expect(grammar_content).toContain('mata_block:');
    });

    describe('All 5 Mata block forms', () => {
        it('should support multiline mata blocks (mata\\n...\\nend)', () => {
            // Check for mata followed by newline pattern
            expect(grammar_content).toMatch(/mata_block:.*'mata'.*\$\._newline.*'end'/s);
        });

        it('should support multiline mata blocks with colon (mata:\\n...\\nend)', () => {
            // Check for optional colon in mata block
            expect(grammar_content).toMatch(/mata_block:.*optional\(':'\)/s);
        });

        it('should support brace-delimited mata blocks (mata { ... })', () => {
            // Check for brace-delimited pattern
            expect(grammar_content).toMatch(/mata_block:.*'\{'/s);
            expect(grammar_content).toMatch(/mata_block:.*'\}'/s);
        });

        it('should support inline mata expressions (mata: expr)', () => {
            // Check for inline content pattern
            expect(grammar_content).toContain('_mata_inline_content');
        });

        it('should support inline mata without colon (mata expr)', () => {
            // The optional(':') allows both mata: expr and mata expr
            expect(grammar_content).toMatch(/mata_block:.*optional\(':'\).*\$\._mata_inline_content/s);
        });
    });

    describe('Mata block helper rules', () => {
        it('should define _mata_line for multiline content', () => {
            expect(grammar_content).toContain('_mata_line:');
        });

        it('should define _mata_inline_content for inline expressions', () => {
            expect(grammar_content).toContain('_mata_inline_content:');
        });

        it('should define _mata_brace_content for brace-delimited blocks', () => {
            expect(grammar_content).toContain('_mata_brace_content:');
        });
    });
});


// ============================================================================
// Task 12.6: Program Definition Parsing Tests
// ============================================================================

describe('Zed Extension Grammar - Program Definition Parsing', () => {
    it('should define program_definition rule', () => {
        expect(grammar_content).toContain('program_definition:');
    });

    it('should support program keyword', () => {
        expect(grammar_content).toMatch(/program_definition:.*'program'/s);
    });

    it('should support optional define keyword', () => {
        expect(grammar_content).toMatch(/program_definition:.*optional\('define'\)/s);
    });

    it('should capture program name as field', () => {
        expect(grammar_content).toMatch(/program_definition:.*field\('name'/s);
    });

    it('should support end keyword to close program', () => {
        expect(grammar_content).toMatch(/program_definition:.*'end'/s);
    });

    it('should allow statements inside program body', () => {
        expect(grammar_content).toContain('_program_line:');
        expect(grammar_content).toMatch(/program_definition:.*repeat\(\$\._program_line\)/s);
    });
});


// ============================================================================
// Task 12.7: Macro Definition Parsing Tests
// ============================================================================

describe('Zed Extension Grammar - Macro Definition Parsing', () => {
    it('should define macro_definition rule', () => {
        expect(grammar_content).toContain('macro_definition:');
    });

    describe('Local macro definitions', () => {
        it('should support local keyword', () => {
            expect(grammar_content).toMatch(/macro_definition:.*'local'/s);
        });

        it('should support loc abbreviation', () => {
            expect(grammar_content).toMatch(/macro_definition:.*'loc'/s);
        });
    });

    describe('Global macro definitions', () => {
        it('should support global keyword', () => {
            expect(grammar_content).toMatch(/macro_definition:.*'global'/s);
        });

        it('should support gl abbreviation', () => {
            expect(grammar_content).toMatch(/macro_definition:.*'gl'/s);
        });
    });

    describe('Temporary variable definitions', () => {
        it('should support tempvar keyword', () => {
            expect(grammar_content).toMatch(/macro_definition:.*'tempvar'/s);
        });

        it('should support tempname keyword', () => {
            expect(grammar_content).toMatch(/macro_definition:.*'tempname'/s);
        });

        it('should support tempfile keyword', () => {
            expect(grammar_content).toMatch(/macro_definition:.*'tempfile'/s);
        });
    });

    it('should capture macro name as field', () => {
        expect(grammar_content).toMatch(/macro_definition:.*field\('name'/s);
    });
});


// ============================================================================
// Task 12.8: Query File Coverage Tests
// ============================================================================

describe('Zed Extension Grammar - Query File Coverage', () => {
    describe('highlights.scm coverage', () => {
        it('should have comment captures', () => {
            expect(highlights_content).toContain('(line_comment) @comment');
            expect(highlights_content).toContain('(block_comment) @comment');
        });

        it('should have string captures', () => {
            expect(highlights_content).toContain('(double_string) @string');
        });

        it('should have depth-based compound string captures (1-6)', () => {
            for (let depth = 1; depth <= 6; depth++) {
                expect(highlights_content).toContain(`(compound_string_depth_${depth}) @string.depth.${depth}`);
            }
        });

        it('should have depth-based local macro captures (1-6)', () => {
            for (let depth = 1; depth <= 6; depth++) {
                expect(highlights_content).toContain(`(local_macro_depth_${depth}) @variable.macro.local.depth.${depth}`);
            }
        });

        it('should have global macro capture', () => {
            expect(highlights_content).toContain('(global_macro) @variable');
        });

        it('should have keyword captures', () => {
            expect(highlights_content).toContain('(control_keyword) @keyword');
            expect(highlights_content).toContain('"program"');
            expect(highlights_content).toContain('"define"');
            expect(highlights_content).toContain('"end"');
            expect(highlights_content).toContain('"mata"');
        });

        it('should have function captures for program names', () => {
            expect(highlights_content).toContain('(program_definition');
            expect(highlights_content).toContain('@function');
        });

        it('should have type captures', () => {
            expect(highlights_content).toContain('(type_keyword) @type');
        });

        it('should have builtin variable captures', () => {
            expect(highlights_content).toContain('(builtin_variable) @variable.builtin');
        });

        it('should have number captures', () => {
            expect(highlights_content).toContain('(number) @number');
        });

        it('should have operator captures', () => {
            expect(highlights_content).toContain('(operator) @operator');
        });

        it('should have missing value captures', () => {
            expect(highlights_content).toContain('(missing_value) @constant');
        });

        it('should have macro definition keyword captures', () => {
            expect(highlights_content).toContain('"local"');
            expect(highlights_content).toContain('"global"');
            expect(highlights_content).toContain('"tempvar"');
        });

        it('should have prefix keyword captures', () => {
            expect(highlights_content).toContain('(prefix) @keyword');
        });
    });

    describe('brackets.scm coverage', () => {
        it('should have curly brace matching', () => {
            expect(brackets_content).toContain('"{" @open');
            expect(brackets_content).toContain('"}" @close');
        });

        it('should have square bracket matching', () => {
            expect(brackets_content).toContain('"[" @open');
            expect(brackets_content).toContain('"]" @close');
        });

        it('should have parenthesis matching', () => {
            expect(brackets_content).toContain('"(" @open');
            expect(brackets_content).toContain('")" @close');
        });

        it('should have double quote matching', () => {
            expect(brackets_content).toContain('"\\"" @open');
            expect(brackets_content).toContain('"\\"" @close');
        });

        it('should have local macro delimiter matching (backtick and single quote)', () => {
            expect(brackets_content).toContain('"`" @open');
            expect(brackets_content).toContain('"\'" @close');
        });
    });

    describe('indents.scm coverage', () => {
        it('should have indent rules for program definitions', () => {
            expect(indents_content).toContain('(program_definition) @indent');
        });

        it('should have indent rules for mata blocks', () => {
            expect(indents_content).toContain('(mata_block) @indent');
        });

        it('should have indent rules for opening braces', () => {
            expect(indents_content).toContain('"{" @indent');
        });

        it('should have outdent rules for closing braces', () => {
            expect(indents_content).toContain('"}" @outdent');
        });

        it('should have outdent rules for end keyword', () => {
            expect(indents_content).toContain('"end" @outdent');
        });

        it('should have outdent rules for else keyword', () => {
            expect(indents_content).toContain('"else"');
            expect(indents_content).toContain('@outdent');
        });
    });
});


// ============================================================================
// Task 12.9: Configuration File Tests
// ============================================================================

describe('Zed Extension Grammar - Configuration Files', () => {
    describe('extension.toml structure', () => {
        it('should have required id field', () => {
            expect(extension_toml_content).toMatch(/^id\s*=\s*"sight"/m);
        });

        it('should have required name field', () => {
            expect(extension_toml_content).toMatch(/^name\s*=\s*"Sight - Stata Language Server"/m);
        });

        it('should have required description field', () => {
            expect(extension_toml_content).toMatch(/^description\s*=/m);
        });

        it('should have required version field', () => {
            expect(extension_toml_content).toMatch(/^version\s*=\s*"\d+\.\d+\.\d+"/m);
        });

        it('should have required schema_version field', () => {
            expect(extension_toml_content).toMatch(/^schema_version\s*=\s*1/m);
        });

        it('should have required authors field', () => {
            expect(extension_toml_content).toMatch(/^authors\s*=/m);
        });

        it('should have required repository field', () => {
            expect(extension_toml_content).toMatch(/^repository\s*=\s*"https:\/\/github\.com\/jbearak\/sight"/m);
        });

        it('should have grammar configuration for stata', () => {
            expect(extension_toml_content).toContain('[grammars.stata]');
        });

        it('should have language server configuration', () => {
            expect(extension_toml_content).toContain('[language_servers.sight]');
        });
    });

    describe('config.toml structure', () => {
        it('should have language name', () => {
            expect(config_toml_content).toMatch(/^name\s*=\s*"Stata"/m);
        });

        it('should have grammar reference', () => {
            expect(config_toml_content).toMatch(/^grammar\s*=\s*"stata"/m);
        });

        it('should have file extension associations', () => {
            expect(config_toml_content).toContain('path_suffixes');
            expect(config_toml_content).toContain('"do"');
            expect(config_toml_content).toContain('"ado"');
            expect(config_toml_content).toContain('"mata"');
        });

        it('should have line comment configuration', () => {
            expect(config_toml_content).toContain('line_comments');
            expect(config_toml_content).toContain('"// "');
            expect(config_toml_content).toContain('"* "');
        });

        it('should have block comment configuration', () => {
            expect(config_toml_content).toContain('block_comment');
            expect(config_toml_content).toContain('"/* "');
            expect(config_toml_content).toContain('" */"');
        });

        it('should have bracket auto-closing configuration', () => {
            expect(config_toml_content).toContain('brackets');
            expect(config_toml_content).toContain('start = "{"');
            expect(config_toml_content).toContain('end = "}"');
            expect(config_toml_content).toContain('start = "["');
            expect(config_toml_content).toContain('end = "]"');
            expect(config_toml_content).toContain('start = "("');
            expect(config_toml_content).toContain('end = ")"');
        });

        it('should have local macro quote auto-closing configuration', () => {
            expect(config_toml_content).toContain('start = "`"');
            expect(config_toml_content).toContain("end = \"'\"");
        });

        it('should have double quote auto-closing configuration', () => {
            expect(config_toml_content).toMatch(/start\s*=\s*"\\?".*end\s*=\s*"\\?"/s);
        });
    });

    describe('Version consistency', () => {
        it('should have matching versions across all files', () => {
            // Extract version from extension.toml
            const extension_version_match = extension_toml_content.match(/^version\s*=\s*"(\d+\.\d+\.\d+)"/m);
            expect(extension_version_match).not.toBeNull();
            const extension_version = extension_version_match![1];

            // Extract version from Cargo.toml
            const cargo_version_match = cargo_toml_content.match(/^version\s*=\s*"(\d+\.\d+\.\d+)"/m);
            expect(cargo_version_match).not.toBeNull();
            const cargo_version = cargo_version_match![1];

            // Get version from tree-sitter-stata/package.json
            const ts_version = ts_package_json.version;

            // Get version from root package.json
            const root_version = root_package_json.version;

            // All versions should match
            expect(extension_version).toBe(root_version);
            expect(cargo_version).toBe(root_version);
            expect(ts_version).toBe(root_version);
        });
    });
});


// ============================================================================
// Task 12.10: Macros Inside Strings Tests
// ============================================================================

describe('Zed Extension Grammar - Macros Inside Strings', () => {
    describe('Global macros in double strings', () => {
        it('should allow global_macro in double_string rule', () => {
            // The double_string rule should include global_macro as a choice
            expect(grammar_content).toMatch(/double_string:[\s\S]*?\$\.global_macro[\s\S]*?'"'/);
        });

        it('should exclude $ from regular content in double strings', () => {
            // The regular content pattern should exclude $ to allow macro parsing
            // The grammar uses /[^"$\\\r\n]+/ which excludes $ from regular content
            expect(grammar_content).toContain('[^"$\\\\\\r\\n]+');
        });
    });

    describe('Local macros in compound strings', () => {
        it('should allow local_macro_depth_1 in compound string content', () => {
            // Each compound content rule should include local_macro_depth_1
            expect(grammar_content).toMatch(/_compound_content_\d:[\s\S]*?\$\.local_macro_depth_1/);
        });

        it('should allow nested compound strings to contain local macros', () => {
            // Verify the pattern exists for multiple depth levels
            for (let depth = 1; depth <= 6; depth++) {
                expect(grammar_content).toContain(`_compound_content_${depth}:`);
            }
        });
    });

    describe('Global macros in compound strings', () => {
        it('should allow global_macro in compound string content', () => {
            // Each compound content rule should include global_macro
            expect(grammar_content).toMatch(/_compound_content_\d:[\s\S]*?\$\.global_macro/);
        });
    });

    describe('Double strings inside compound strings', () => {
        it('should allow double_string in compound string content', () => {
            // Compound strings can contain regular double strings
            expect(grammar_content).toMatch(/_compound_content_\d:[\s\S]*?\$\.double_string/);
        });
    });
});


// ============================================================================
// Task 12.11: Global Macros Inside Local Macros Tests
// ============================================================================

describe('Zed Extension Grammar - Global Macros Inside Local Macros', () => {
    describe('Nested macro references', () => {
        it('should allow global_macro inside local_macro_depth_1', () => {
            expect(grammar_content).toMatch(/local_macro_depth_1:[\s\S]*?\$\.global_macro/);
        });

        it('should allow global_macro inside local_macro_depth_2', () => {
            expect(grammar_content).toMatch(/local_macro_depth_2:[\s\S]*?\$\.global_macro/);
        });

        it('should allow global_macro inside local_macro_depth_3', () => {
            expect(grammar_content).toMatch(/local_macro_depth_3:[\s\S]*?\$\.global_macro/);
        });

        it('should allow global_macro inside local_macro_depth_4', () => {
            expect(grammar_content).toMatch(/local_macro_depth_4:[\s\S]*?\$\.global_macro/);
        });

        it('should allow global_macro inside local_macro_depth_5', () => {
            expect(grammar_content).toMatch(/local_macro_depth_5:[\s\S]*?\$\.global_macro/);
        });

        it('should allow global_macro inside local_macro_depth_6', () => {
            expect(grammar_content).toMatch(/local_macro_depth_6:[\s\S]*?\$\.global_macro/);
        });
    });

    describe('Local macro depth independence', () => {
        it('should have local macro depth based only on local macro nesting', () => {
            // Verify that local_macro_depth rules reference other local_macro_depth rules
            // but not compound_string_depth rules (depth is independent)
            expect(grammar_content).toMatch(/local_macro_depth_1:[\s\S]*?local_macro_depth_2/);
            expect(grammar_content).toMatch(/local_macro_depth_2:[\s\S]*?local_macro_depth_3/);
            expect(grammar_content).toMatch(/local_macro_depth_3:[\s\S]*?local_macro_depth_4/);
            expect(grammar_content).toMatch(/local_macro_depth_4:[\s\S]*?local_macro_depth_5/);
            expect(grammar_content).toMatch(/local_macro_depth_5:[\s\S]*?local_macro_depth_6/);
            // Depth 6 wraps to depth 1
            expect(grammar_content).toMatch(/local_macro_depth_6:[\s\S]*?local_macro_depth_1/);
        });
    });
});


// ============================================================================
// Additional Grammar Structure Tests
// ============================================================================

describe('Zed Extension Grammar - Additional Structure', () => {
    describe('Grammar metadata', () => {
        it('should have correct grammar name', () => {
            expect(grammar_content).toMatch(/name:\s*'stata'/);
        });

        it('should export grammar module', () => {
            expect(grammar_content).toContain('module.exports = grammar');
        });
    });

    describe('Control flow keywords', () => {
        it('should define control_keyword rule', () => {
            expect(grammar_content).toContain('control_keyword:');
        });

        it('should include conditional keywords', () => {
            expect(grammar_content).toMatch(/control_keyword:[\s\S]*?'if'/);
            expect(grammar_content).toMatch(/control_keyword:[\s\S]*?'else'/);
        });

        it('should include loop keywords', () => {
            expect(grammar_content).toMatch(/control_keyword:[\s\S]*?'foreach'/);
            expect(grammar_content).toMatch(/control_keyword:[\s\S]*?'forvalues'/);
            expect(grammar_content).toMatch(/control_keyword:[\s\S]*?'forv'/);
            expect(grammar_content).toMatch(/control_keyword:[\s\S]*?'while'/);
        });

        it('should include control keywords', () => {
            expect(grammar_content).toMatch(/control_keyword:[\s\S]*?'continue'/);
            expect(grammar_content).toMatch(/control_keyword:[\s\S]*?'break'/);
        });

        it('should include end keyword', () => {
            expect(grammar_content).toMatch(/control_keyword:[\s\S]*?'end'/);
        });
    });

    describe('Type keywords', () => {
        it('should define type_keyword rule', () => {
            expect(grammar_content).toContain('type_keyword:');
        });

        it('should include numeric types', () => {
            expect(grammar_content).toMatch(/type_keyword:[\s\S]*?'byte'/);
            expect(grammar_content).toMatch(/type_keyword:[\s\S]*?'int'/);
            expect(grammar_content).toMatch(/type_keyword:[\s\S]*?'long'/);
            expect(grammar_content).toMatch(/type_keyword:[\s\S]*?'float'/);
            expect(grammar_content).toMatch(/type_keyword:[\s\S]*?'double'/);
        });

        it('should include string types', () => {
            expect(grammar_content).toMatch(/type_keyword:[\s\S]*?'strL'/);
            // String types str1-str2045 use regex patterns
            expect(grammar_content).toMatch(/type_keyword:[\s\S]*?str\[1-9\]/);
        });
    });

    describe('Built-in variables', () => {
        it('should define builtin_variable rule', () => {
            expect(grammar_content).toContain('builtin_variable:');
        });

        it('should include observation variables', () => {
            expect(grammar_content).toMatch(/builtin_variable:[\s\S]*?'_n'/);
            expect(grammar_content).toMatch(/builtin_variable:[\s\S]*?'_N'/);
        });

        it('should include estimation variables', () => {
            expect(grammar_content).toMatch(/builtin_variable:[\s\S]*?'_b'/);
            expect(grammar_content).toMatch(/builtin_variable:[\s\S]*?'_coef'/);
            expect(grammar_content).toMatch(/builtin_variable:[\s\S]*?'_cons'/);
            expect(grammar_content).toMatch(/builtin_variable:[\s\S]*?'_rc'/);
            expect(grammar_content).toMatch(/builtin_variable:[\s\S]*?'_se'/);
        });

        it('should include constant variables', () => {
            expect(grammar_content).toMatch(/builtin_variable:[\s\S]*?'_pi'/);
        });

        it('should include display variables', () => {
            expect(grammar_content).toMatch(/builtin_variable:[\s\S]*?'_skip'/);
            expect(grammar_content).toMatch(/builtin_variable:[\s\S]*?'_dup'/);
            expect(grammar_content).toMatch(/builtin_variable:[\s\S]*?'_newline'/);
            expect(grammar_content).toMatch(/builtin_variable:[\s\S]*?'_column'/);
            expect(grammar_content).toMatch(/builtin_variable:[\s\S]*?'_continue'/);
            expect(grammar_content).toMatch(/builtin_variable:[\s\S]*?'_request'/);
            expect(grammar_content).toMatch(/builtin_variable:[\s\S]*?'_char'/);
        });
    });

    describe('Operators', () => {
        it('should define operator rule', () => {
            expect(grammar_content).toContain('operator:');
        });

        it('should include arithmetic operators', () => {
            expect(grammar_content).toMatch(/operator:[\s\S]*?'\+'/);
            expect(grammar_content).toMatch(/operator:[\s\S]*?'-'/);
            expect(grammar_content).toMatch(/operator:[\s\S]*?'\*'/);
            expect(grammar_content).toMatch(/operator:[\s\S]*?'\/'/);
            expect(grammar_content).toMatch(/operator:[\s\S]*?'\^'/);
        });

        it('should include comparison operators', () => {
            expect(grammar_content).toMatch(/operator:[\s\S]*?'=='/);
            expect(grammar_content).toMatch(/operator:[\s\S]*?'!='/);
            expect(grammar_content).toMatch(/operator:[\s\S]*?'<'/);
            expect(grammar_content).toMatch(/operator:[\s\S]*?'>'/);
            expect(grammar_content).toMatch(/operator:[\s\S]*?'<='/);
            expect(grammar_content).toMatch(/operator:[\s\S]*?'>='/);
        });

        it('should include logical operators', () => {
            expect(grammar_content).toMatch(/operator:[\s\S]*?'&'/);
            expect(grammar_content).toMatch(/operator:[\s\S]*?'\|'/);
            expect(grammar_content).toMatch(/operator:[\s\S]*?'!'/);
            expect(grammar_content).toMatch(/operator:[\s\S]*?'~'/);
        });

        it('should include assignment operator', () => {
            expect(grammar_content).toMatch(/operator:[\s\S]*?'='/);
        });

        it('should include interaction operator', () => {
            expect(grammar_content).toMatch(/operator:[\s\S]*?'#'/);
        });
    });

    describe('Prefix commands', () => {
        it('should define prefix rule', () => {
            expect(grammar_content).toContain('prefix:');
        });

        it('should include by/bysort prefixes', () => {
            expect(grammar_content).toMatch(/prefix:[\s\S]*?'by'/);
            expect(grammar_content).toMatch(/prefix:[\s\S]*?'bysort'/);
            expect(grammar_content).toMatch(/prefix:[\s\S]*?'bys'/);
        });

        it('should include quietly prefix', () => {
            expect(grammar_content).toMatch(/prefix:[\s\S]*?'quietly'/);
            expect(grammar_content).toMatch(/prefix:[\s\S]*?'qui'/);
        });

        it('should include noisily prefix', () => {
            expect(grammar_content).toMatch(/prefix:[\s\S]*?'noisily'/);
            expect(grammar_content).toMatch(/prefix:[\s\S]*?'noi'/);
        });

        it('should include capture prefix', () => {
            expect(grammar_content).toMatch(/prefix:[\s\S]*?'capture'/);
            expect(grammar_content).toMatch(/prefix:[\s\S]*?'cap'/);
        });

        it('should include sortpreserve prefix', () => {
            expect(grammar_content).toMatch(/prefix:[\s\S]*?'sortpreserve'/);
        });
    });

    describe('Numbers and missing values', () => {
        it('should define number rule', () => {
            expect(grammar_content).toContain('number:');
        });

        it('should support integer numbers', () => {
            expect(grammar_content).toMatch(/number:[\s\S]*?\[0-9\]\+/);
        });

        it('should support decimal numbers', () => {
            expect(grammar_content).toMatch(/number:[\s\S]*?\[0-9\]\+\\\.\[0-9\]/);
        });

        it('should support scientific notation', () => {
            expect(grammar_content).toMatch(/number:[\s\S]*?\[eE\]/);
        });

        it('should define missing_value rule', () => {
            expect(grammar_content).toContain('missing_value:');
        });

        it('should support missing value patterns', () => {
            // Missing values are . or .a through .z
            expect(grammar_content).toMatch(/missing_value:[\s\S]*?\\\.\[a-z\]\?/);
        });
    });

    describe('Identifiers', () => {
        it('should define identifier rule', () => {
            expect(grammar_content).toContain('identifier:');
        });

        it('should match valid Stata identifier pattern', () => {
            // Stata identifiers start with letter or underscore, followed by letters, digits, or underscores
            expect(grammar_content).toMatch(/identifier:[\s\S]*?\[A-Za-z_\]\[A-Za-z0-9_\]\*/);
        });
    });

    describe('Command structure', () => {
        it('should define command rule', () => {
            expect(grammar_content).toContain('command:');
        });

        it('should support optional prefix', () => {
            expect(grammar_content).toMatch(/command:[\s\S]*?optional\(\$\.prefix\)/);
        });

        it('should capture command name as field', () => {
            expect(grammar_content).toMatch(/command:[\s\S]*?field\('name'/);
        });
    });
});
