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

describe('Find References - Case-Sensitive Matching', () => {
    const provider = new ReferencesProvider();

    test('Property 5: Case-Sensitive Matching - symbols differing only in case are distinct', () => {
        fc.assert(
            fc.property(
                // Generate base symbol name
                fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)),
                // Generate symbol type
                fc.constantFrom('local_macro', 'global_macro', 'program', 'variable', 'scalar', 'matrix'),
                (baseName, symbolType) => {
                    // Create case variants
                    const lowerName = baseName.toLowerCase();
                    const upperName = baseName.toUpperCase();
                    
                    // Skip if names are identical (no case difference)
                    if (lowerName === upperName) return true;

                    // Create tokens for both variants
                    const tokens: Token[] = [];
                    const range1: Range = { start: { line: 0, character: 0 }, end: { line: 0, character: lowerName.length } };
                    const range2: Range = { start: { line: 1, character: 0 }, end: { line: 1, character: upperName.length } };

                    // Add tokens based on symbol type
                    if (symbolType === 'local_macro') {
                        tokens.push({
                            type: 'MACRO_REF_LOCAL',
                            value: `\`${lowerName}'`,
                            range: range1
                        });
                        tokens.push({
                            type: 'MACRO_REF_LOCAL',
                            value: `\`${upperName}'`,
                            range: range2
                        });
                    } else if (symbolType === 'global_macro') {
                        tokens.push({
                            type: 'MACRO_REF_GLOBAL',
                            value: `$${lowerName}`,
                            range: range1
                        });
                        tokens.push({
                            type: 'MACRO_REF_GLOBAL',
                            value: `$${upperName}`,
                            range: range2
                        });
                    } else {
                        tokens.push({
                            type: 'WORD',
                            value: lowerName,
                            range: range1
                        });
                        tokens.push({
                            type: 'WORD',
                            value: upperName,
                            range: range2
                        });
                    }

                    // Search for lowercase variant
                    const searchContext: ReferenceSearchContext = {
                        symbol_name: lowerName,
                        symbol_type: symbolType,
                        include_declaration: true
                    };

                    const matches = provider.scan_tokens_for_references(tokens, 'test://file.do', searchContext);

                    // Should only match the lowercase token, not the uppercase one
                    expect(matches).toHaveLength(1);
                    expect(matches[0].range).toEqual(range1);

                    // Search for uppercase variant
                    const searchContextUpper: ReferenceSearchContext = {
                        symbol_name: upperName,
                        symbol_type: symbolType,
                        include_declaration: true
                    };

                    const matchesUpper = provider.scan_tokens_for_references(tokens, 'test://file.do', searchContextUpper);

                    // Should only match the uppercase token, not the lowercase one
                    expect(matchesUpper).toHaveLength(1);
                    expect(matchesUpper[0].range).toEqual(range2);

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });
});