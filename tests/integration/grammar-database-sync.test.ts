/**
 * Integration Tests for TextMate Grammar and Command Database Sync
 *
 * Validates that the TextMate grammar's command patterns are in sync with
 * the command database. This catches drift when the cache is regenerated
 * but the grammar sync script isn't run.
 * 
 * Note: The grammar uses categorized command patterns (commands-data, commands-output, etc.)
 * rather than a single massive regex. This test validates that common commands are matched.
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

interface TextMatePattern {
    match?: string;
    name?: string;
    patterns?: TextMatePattern[];
}

interface TextMateGrammar {
    repository: Record<string, { patterns?: TextMatePattern[]; match?: string }>;
}

describe('TextMate Grammar and Command Database Sync', () => {
    let grammar_patterns: RegExp[];

    beforeAll(() => {
        // Load grammar and extract command patterns from all command-related repositories
        const grammar_path = join(__dirname, '../../client/syntaxes/stata.tmLanguage.json');
        const grammar: TextMateGrammar = JSON.parse(readFileSync(grammar_path, 'utf-8'));
        
        grammar_patterns = [];
        for (const [key, value] of Object.entries(grammar.repository)) {
            if (key.startsWith('commands') || key === 'keywords') {
                if (value.patterns) {
                    for (const p of value.patterns) {
                        if (p.match) {
                            grammar_patterns.push(new RegExp(p.match));
                        }
                    }
                }
                if (value.match) {
                    grammar_patterns.push(new RegExp(value.match));
                }
            }
        }
    });

    it('should have grammar patterns that match essential commands', () => {
        // Test essential commands that must be highlighted
        const essential_commands = [
            'do', 'run', 'include',  // file execution
            'generate', 'gen', 'egen', 'replace', 'drop', 'keep',  // data manipulation
            'use', 'save', 'merge', 'append',  // data I/O
            'display', 'list', 'describe', 'summarize',  // output
            'tabulate', 'tab', 'tab1', 'tab2',  // tabulation
            'local', 'global', 'tempvar', 'tempname', 'tempfile',  // macros
            'regress', 'logit', 'probit',  // estimation
            'if', 'else', 'foreach', 'forvalues', 'while',  // control flow
            'reghdfe', 'estout', 'esttab',  // add-ons
        ];

        const the_missing_commands: string[] = [];

        for (const my_command of essential_commands) {
            const is_matched = grammar_patterns.some(regex => regex.test(my_command));
            if (!is_matched) {
                the_missing_commands.push(my_command);
            }
        }

        expect(the_missing_commands).toEqual([]);
    });

    it('should have categorized command patterns', () => {
        const grammar_path = join(__dirname, '../../client/syntaxes/stata.tmLanguage.json');
        const grammar: TextMateGrammar = JSON.parse(readFileSync(grammar_path, 'utf-8'));
        
        // Verify expected command categories exist
        expect(grammar.repository['commands-file-execution']).toBeDefined();
        expect(grammar.repository['commands-data']).toBeDefined();
        expect(grammar.repository['commands-output']).toBeDefined();
        expect(grammar.repository['commands-macro']).toBeDefined();
        expect(grammar.repository['commands-addon']).toBeDefined();
        expect(grammar.repository['commands-general']).toBeDefined();
    });
});
