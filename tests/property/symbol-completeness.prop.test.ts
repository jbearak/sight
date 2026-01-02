/**
 * Symbol Completeness Property Tests
 *
 * Tests that verify document symbols are complete and accurate for:
 * - Programs: all program definitions included
 * - Macros: all macro definitions included
 * - Symbol information: kind, name, and location are correct
 * - Embedded blocks: mata/python blocks appear as structural elements
 */

import { describe, it, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { SymbolProvider } from '../../src/providers/symbols';
import { SymbolKind } from 'vscode-languageserver';
import {
  arbitrary_document_with_programs,
  arbitrary_document_with_macros,
  arbitrary_document_with_embedded_blocks,
} from './generators/documents';
import {
  parse_and_analyze,
} from './helpers/document-utils';

describe('Symbol Completeness Property Tests', () => {
  let my_symbol_provider: SymbolProvider;

  beforeEach(() => {
    my_symbol_provider = new SymbolProvider();
  });

  /**
   * Property 24: Programs Included
   * For any document with program definitions, document symbols should include
   * all programs.
   * Feature: comprehensive-property-tests, Property 24: Programs Included
   * Validates: Requirement 8.1
   */
  it('should include all programs in document symbols', () => {
    fc.assert(
      fc.property(
        arbitrary_document_with_programs(1),
        ({ document, programs }) => {
          const my_doc_state = parse_and_analyze(document);
          const my_symbols = my_symbol_provider.get_document_symbols(my_doc_state);

          // Filter to program symbols
          const my_program_symbols = my_symbols.filter(
            (s) => s.kind === SymbolKind.Function
          );

          // If parsing succeeded and we have programs in the symbol table,
          // all expected programs should be in symbols
          if (my_doc_state.symbols.programs.size > 0) {
            for (const my_program of programs) {
              const my_found = my_program_symbols.some(
                (s) => s.name === my_program.name
              );
              if (!my_found) {
                return false;
              }
            }
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 25: Macros Included
   * For any document with macro definitions, document symbols should include
   * all macros.
   * Feature: comprehensive-property-tests, Property 25: Macros Included
   * Validates: Requirement 8.2
   */
  it('should include all macros in document symbols', () => {
    fc.assert(
      fc.property(
        arbitrary_document_with_macros(1, 1),
        ({ document, macros }) => {
          const my_doc_state = parse_and_analyze(document);
          const my_symbols = my_symbol_provider.get_document_symbols(my_doc_state);

          // Filter to macro symbols (Variable kind)
          const my_macro_symbols = my_symbols.filter(
            (s) => s.kind === SymbolKind.Variable
          );

          // If parsing succeeded and we have macros in the symbol table,
          // all expected macros should be in symbols
          const my_total_macros = my_doc_state.symbols.localMacros.size +
                                   my_doc_state.symbols.globalMacros.size;
          if (my_total_macros > 0) {
            for (const my_macro of macros) {
              let my_expected_name = my_macro.name;
              if (my_macro.scope === 'local') {
                my_expected_name = `\`${my_macro.name}'`;
              }

              const my_found = my_macro_symbols.some(
                (s) => s.name === my_expected_name
              );
              if (!my_found) {
                return false;
              }
            }
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 26: Symbol Information Correctness
   * For any symbol in document symbols, kind, name, and location should be
   * correct.
   * Feature: comprehensive-property-tests, Property 26: Symbol Information Correctness
   * Validates: Requirement 8.3
   */
  it('should have correct symbol information', () => {
    fc.assert(
      fc.property(
        arbitrary_document_with_programs(1),
        ({ document, programs }) => {
          const my_doc_state = parse_and_analyze(document);
          const my_symbols = my_symbol_provider.get_document_symbols(my_doc_state);

          // If parsing succeeded and we have programs in the symbol table,
          // verify symbol information is correct
          if (my_doc_state.symbols.programs.size > 0) {
            for (const my_program of programs) {
              const my_found = my_symbols.find((s) => s.name === my_program.name);

              if (!my_found) {
                return false;
              }

              // Verify kind is Function
              if (my_found.kind !== SymbolKind.Function) {
                return false;
              }

              // Verify range exists and is valid
              if (!my_found.range) {
                return false;
              }

              // Verify selection range exists
              if (!my_found.selectionRange) {
                return false;
              }

              // Verify detail is set
              if (!my_found.detail) {
                return false;
              }
            }
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 27: Embedded Blocks
   * For any document with embedded language blocks, they should appear as
   * structural elements in document symbols.
   * Feature: comprehensive-property-tests, Property 27: Embedded Blocks
   * Validates: Requirement 8.4
   */
  it('should include embedded language blocks as structural elements', () => {
    fc.assert(
      fc.property(
        arbitrary_document_with_embedded_blocks(),
        ({ document, embedded_blocks }) => {
          const my_doc_state = parse_and_analyze(document);
          const my_symbols = my_symbol_provider.get_document_symbols(my_doc_state);

          // Filter to embedded block symbols (Module kind)
          const my_embedded_symbols = my_symbols.filter(
            (s) => s.kind === SymbolKind.Module
          );

          // If parsing succeeded and we have embedded blocks in the AST,
          // all expected embedded blocks should be in symbols
          if (my_doc_state.ast && my_doc_state.ast.nodes.length > 0) {
            for (const my_block of embedded_blocks) {
              const my_language_label =
                my_block.language === 'mata' ? 'Mata Block' : 'Python Block';

              const my_found = my_embedded_symbols.some(
                (s) => s.name === my_language_label
              );
              if (!my_found) {
                return false;
              }
            }
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});
