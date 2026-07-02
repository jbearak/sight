/**
 * Property tests for bare-expression command detection in
 * LITERAL_MACRO_ADJACENCY (issue #268 item 3).
 *
 * `assert` in command position (with any prefix-command chain) always
 * flags a leading literal-macro pair; `assert` as a callee or subscript
 * target never does.
 */

import { describe, it, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { LiteralMacroAdjacencyAnalyzer } from '../../src/providers/literal-macro-adjacency-diagnostics';
import { StataDiagnosticCode, StataLSPConfig } from '../../src/types';
import { DEFAULT_SETTINGS } from '../../src/server-handlers';
import { create_document_state } from './helpers/document-utils';
import { arbitrary_non_reserved_identifier } from './generators';

describe('Command-position property tests', () => {
    let analyzer: LiteralMacroAdjacencyAnalyzer;
    let default_config: StataLSPConfig;

    beforeEach(() => {
        analyzer = new LiteralMacroAdjacencyAnalyzer();
        default_config = {
            ...DEFAULT_SETTINGS,
            diagnostics: {
                ...DEFAULT_SETTINGS.diagnostics,
                severity: {
                    ...DEFAULT_SETTINGS.diagnostics.severity,
                },
            },
        };
    });

    const found = (source: string) =>
        analyzer
            .analyze(create_document_state(source), default_config)
            .filter(
                (d) => d.code === StataDiagnosticCode.LITERAL_MACRO_ADJACENCY
            );

    const arbitrary_prefix_chain = () =>
        fc.array(
            fc.constantFrom(
                'capture', 'cap', 'quietly', 'qui', 'noisily', 'noi'
            ),
            { minLength: 0, maxLength: 2 }
        ).chain((the_prefixes) =>
            fc.boolean().map((use_colon) => {
                if (the_prefixes.length === 0) {
                    return '';
                }
                return the_prefixes.join(' ') + (use_colon ? ': ' : ' ');
            })
        );

    it('always flags a leading literal-macro pair after (prefixed) assert', async () => {
        await fc.assert(
            fc.asyncProperty(
                arbitrary_prefix_chain(),
                arbitrary_non_reserved_identifier(),
                fc.integer({ min: 0, max: 99 }),
                async (prefix_chain, macro_name, literal_value) => {
                    const content =
                        `${prefix_chain}assert ${literal_value}\`${macro_name}'`;
                    return found(content).length === 1;
                }
            ),
            { numRuns: 100 }
        );
    });

    it('never flags assert used as a callee or subscript target', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.constantFrom(
                    "display assert(1`MACRO')",
                    "gen y = assert[1`MACRO']",
                    "list assert 1`MACRO'"
                ),
                arbitrary_non_reserved_identifier(),
                async (template, macro_name) => {
                    const content = template.replace('MACRO', macro_name);
                    return found(content).length === 0;
                }
            ),
            { numRuns: 100 }
        );
    });
});
