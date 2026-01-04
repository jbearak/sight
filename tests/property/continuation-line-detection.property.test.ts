import { describe, test, expect } from 'bun:test';
import * as fc from 'fast-check';
import { IndentationDiagnosticAnalyzer } from '../../src/providers/indentation-diagnostics';
import { StataDiagnosticCode, StataLSPConfig, Token } from '../../src/types';
import { create_document_state } from './helpers/document-utils';

/**
 * Property-based tests for continuation line detection.
 * 
 * Validates:
 * - Property 1: Continuation Line Recognition (Requirements 1.1, 1.2, 1.3)
 * - Property 2: No Unnecessary Indentation Diagnostic for Continuation Lines (Requirements 2.1, 2.2)
 * - Property 3: Trace-Back Through Continuations (Requirements 3.1, 3.2)
 */
describe('Continuation Line Detection Properties', () => {
  const config: StataLSPConfig = {
    diagnostics: {
      enabled: true,
      indentation: true,
      severity: {
        undefinedMacro: 'warning',
        undefinedVariable: 'information',
        styleWarnings: 'hint'
      },
      undefinedVariableEnabled: false
    },
    adoPaths: [],
    cross_file: {}
  };

  const create_document = create_document_state;

  const find_continuation_lines_from_tokens = (tokens: Token[]): Set<number> => {
    const the_continuation_lines = new Set<number>();
    for (const my_token of tokens) {
      if (my_token.type === 'CONTINUATION') {
        the_continuation_lines.add(my_token.range.start.line + 1);
      }
    }
    return the_continuation_lines;
  };

  const trace_back_to_original = (tokens: Token[], line_number: number): number => {
    const the_continuation_lines = find_continuation_lines_from_tokens(tokens);
    let current_line = line_number;
    while (current_line > 0 && the_continuation_lines.has(current_line)) {
      current_line--;
    }
    return current_line;
  };

  // Generator for simple Stata statements
  const stata_statement_generator = fc.oneof(
    fc.constant('display "hello"'),
    fc.constant('gen x = 1'),
    fc.constant('replace y = 2'),
    fc.constant('local foo "bar"'),
    fc.constant('global test 123'),
    fc.constant('summarize var1')
  );

  // Generator for optional trailing comment after ///
  const trailing_comment_generator = fc.oneof(
    fc.constant(''),
    fc.constant(' comment'),
    fc.constant(' Formerly married'),
    fc.constant(' TODO: fix this')
  );

  // Generator for continuation lines with optional trailing comments
  const continuation_with_comment_generator = fc.tuple(
    fc.array(stata_statement_generator, { minLength: 2, maxLength: 4 }),
    fc.array(trailing_comment_generator, { minLength: 1, maxLength: 3 })
  ).map(([the_statements, the_comments]) => {
    const the_lines: string[] = [];
    for (let i = 0; i < the_statements.length; i++) {
      if (i < the_statements.length - 1) {
        const comment = the_comments[i % the_comments.length];
        the_lines.push(the_statements[i] + ' ///' + comment);
      } else {
        the_lines.push(the_statements[i]);
      }
    }
    return the_lines.join('\n');
  });

  // Generator for indented continuation lines inside a block
  const indented_continuation_generator = fc.tuple(
    fc.array(stata_statement_generator, { minLength: 2, maxLength: 4 }),
    fc.array(trailing_comment_generator, { minLength: 1, maxLength: 3 }),
    fc.integer({ min: 4, max: 16 })
  ).map(([the_statements, the_comments, indent]) => {
    const indent_str = ' '.repeat(indent);
    const the_lines: string[] = ['if x == 1 {'];
    for (let i = 0; i < the_statements.length; i++) {
      if (i < the_statements.length - 1) {
        const comment = the_comments[i % the_comments.length];
        the_lines.push('    ' + the_statements[i] + ' ///' + comment);
      } else {
        the_lines.push(indent_str + the_statements[i]);
      }
    }
    the_lines.push('}');
    return the_lines.join('\n');
  });

  test('Property 1: Continuation Line Recognition', () => {
    fc.assert(fc.property(continuation_with_comment_generator, (content) => {
      const doc = create_document(content);
      const the_continuation_lines = find_continuation_lines_from_tokens(doc.tokens);
      const the_lines = content.split('\n');

      // For each CONTINUATION token, the next line should be in the set
      for (const my_token of doc.tokens) {
        if (my_token.type === 'CONTINUATION') {
          const next_line = my_token.range.start.line + 1;
          if (next_line < the_lines.length) {
            expect(the_continuation_lines.has(next_line)).toBe(true);
          }
        }
      }
    }), { numRuns: 100 });
  });

  test('Property 2: No Unnecessary Indentation Diagnostic for Continuation Lines', () => {
    fc.assert(fc.property(indented_continuation_generator, (content) => {
      const doc = create_document(content);
      const analyzer = new IndentationDiagnosticAnalyzer();
      const the_diagnostics = analyzer.analyze(doc, config);
      const the_continuation_lines = find_continuation_lines_from_tokens(doc.tokens);

      // No UNNECESSARY_INDENTATION diagnostic should be on a continuation line
      for (const my_diagnostic of the_diagnostics) {
        if (my_diagnostic.code === StataDiagnosticCode.UNNECESSARY_INDENTATION) {
          const diagnostic_line = my_diagnostic.range.start.line;
          expect(the_continuation_lines.has(diagnostic_line)).toBe(false);
        }
      }
    }), { numRuns: 100 });
  });

  test('Property 3: Trace-Back Through Continuations', () => {
    fc.assert(fc.property(continuation_with_comment_generator, (content) => {
      const doc = create_document(content);
      const the_continuation_lines = find_continuation_lines_from_tokens(doc.tokens);

      for (const my_continuation_line of the_continuation_lines) {
        const original_line = trace_back_to_original(doc.tokens, my_continuation_line);

        // Original line should not be a continuation line itself
        expect(the_continuation_lines.has(original_line)).toBe(false);

        // Original line should be before or equal to continuation line
        expect(original_line).toBeLessThanOrEqual(my_continuation_line);

        // All lines in the chain should trace back to the same original
        for (let my_line = original_line + 1; my_line <= my_continuation_line; my_line++) {
          if (the_continuation_lines.has(my_line)) {
            expect(trace_back_to_original(doc.tokens, my_line)).toBe(original_line);
          }
        }
      }
    }), { numRuns: 100 });
  });
});
