/**
 * Property Test: Case-Sensitive Matching for Find References
 * 
 * Tests that symbols with names differing only in case are treated as distinct.
 * Tag: Feature: find-references, Property 5: Case-Sensitive Matching
 */

import * as fc from 'fast-check';
import { Range } from 'vscode-languageserver';
import { ReferencesProvider, ReferenceSearchContext } from '../../src/providers/references';
import { Token } from '../../src/types';
import { arbitrary_non_reserved_identifier } from './generators';

describe('Find References - Case-Sensitive Matching', () => {
    const provider = new ReferencesProvider();

    test('Property 5: Case-Sensitive Matching - symbols differing only in case are distinct', () => {
        fc.assert(
            fc.property(
                // Generate base symbol name (excludes reserved qualifiers like if/in)
                arbitrary_non_reserved_identifier(),
                // Generate symbol type
                fc.constantFrom('local_macro', 'global_macro', 'program', 'variable', 'scalar', 'matrix'),
                (base_name, symbol_type) => {
                    // Create case variants
                    const lower_name = base_name.toLowerCase();
                    const upper_name = base_name.toUpperCase();
                    
                    // Skip if names are identical (no case difference)
                    if (lower_name === upper_name) return true;

                    // Create tokens for both variants
                    const tokens: Token[] = [];
                    const range1: Range = { start: { line: 0, character: 0 }, end: { line: 0, character: lower_name.length } };
                    const range2: Range = { start: { line: 1, character: 0 }, end: { line: 1, character: upper_name.length } };

                    // Add tokens based on symbol type
                    if (symbol_type === 'local_macro') {
                        tokens.push({
                            type: 'MACRO_REF_LOCAL',
                            value: `\`${lower_name}'`,
                            range: range1
                        });
                        tokens.push({
                            type: 'MACRO_REF_LOCAL',
                            value: `\`${upper_name}'`,
                            range: range2
                        });
                    } else if (symbol_type === 'global_macro') {
                        tokens.push({
                            type: 'MACRO_REF_GLOBAL',
                            value: `$${lower_name}`,
                            range: range1
                        });
                        tokens.push({
                            type: 'MACRO_REF_GLOBAL',
                            value: `$${upper_name}`,
                            range: range2
                        });
                    } else {
                        tokens.push({
                            type: 'WORD',
                            value: lower_name,
                            range: range1
                        });
                        tokens.push({
                            type: 'WORD',
                            value: upper_name,
                            range: range2
                        });
                    }

                    // Search for lowercase variant
                    const search_context: ReferenceSearchContext = {
                        symbol_name: lower_name,
                        symbol_type: symbol_type,
                        include_declaration: true
                    };

                    const matches = provider.scan_tokens_for_references(tokens, 'test://file.do', search_context);

                    // Should only match the lowercase token, not the uppercase one
                    expect(matches).toHaveLength(1);
                    expect(matches[0].range).toEqual(range1);

                    // Search for uppercase variant
                    const search_context_upper: ReferenceSearchContext = {
                        symbol_name: upper_name,
                        symbol_type: symbol_type,
                        include_declaration: true
                    };

                    const matches_upper = provider.scan_tokens_for_references(tokens, 'test://file.do', search_context_upper);

                    // Should only match the uppercase token, not the lowercase one
                    expect(matches_upper).toHaveLength(1);
                    expect(matches_upper[0].range).toEqual(range2);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });
});