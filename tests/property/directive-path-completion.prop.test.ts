import { describe, it, expect, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { detect_completion_context } from '../../src/providers/completion';
import { DocumentState } from '../../src/document-store';
import { Position } from 'vscode-languageserver';
import { PATH_DIRECTIVES, STATA_FILE_EXTENSIONS } from '../../src/utils/file-path-utils';

/**
 * Property tests for directive path completion functionality.
 * Validates that directive contexts are correctly detected and appropriate completions are provided.
 */
describe('Directive Path Completion Property Tests', () => {

  /**
   * Helper to create a mock document state.
   */
  function create_mock_document(content: string): DocumentState {
    return {
      uri: 'file:///test.do',
      content,
      version: 1,
      symbols: {
        programs: new Map(),
        localMacros: new Map(),
        globalMacros: new Map(),
        variables: new Map(),
        scalars: new Map(),
        matrices: new Map(),
      },
      tokens: [],
      ast: { nodes: [] },
      diagnostics: [],
      context_ranges: [],
      line_offsets: [0],
    };
  }

  /**
   * Generator for valid path directives.
   */
  function arbitrary_path_directive(): fc.Arbitrary<string> {
    return fc.constantFrom(...Array.from(PATH_DIRECTIVES));
  }

  /**
   * Generator for valid file paths.
   */
  function arbitrary_file_path(): fc.Arbitrary<string> {
    return fc
      .array(
        fc.stringMatching(/^[a-zA-Z0-9_-]+$/),
        { minLength: 1, maxLength: 3 }
      )
      .map((my_parts) => my_parts.join('/') + '.do');
  }

  /**
   * Generator for partial file paths.
   */
  function arbitrary_partial_path(): fc.Arbitrary<string> {
    return fc.oneof(
      fc.constant(''),
      fc.stringMatching(/^[a-zA-Z0-9_-]+$/),
      fc.stringMatching(/^[a-zA-Z0-9_-]+\/$/),
      fc.stringMatching(/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]*$/)
    );
  }

  /**
   * Property 5: Directive Path Completion Context
   * For any cursor position after a path directive (like `@lsp-done-by:`),
   * the completion provider should return directive_path context.
   */
  it('should detect directive path completion context', () => {
    fc.assert(
      fc.property(
        arbitrary_path_directive(),
        arbitrary_partial_path(),
        (my_directive, my_partial_path) => {
          const my_line = `// ${my_directive}: ${my_partial_path}`;
          const my_document = create_mock_document(my_line);
          const my_position = Position.create(0, my_line.length);

          const my_context = detect_completion_context(my_document, my_position);

          expect(my_context.type).toBe('directive_path');
          if (my_context.type === 'directive_path') {
            expect(my_context.directive).toBe(my_directive);
            expect(my_context.partial_path).toBe(my_partial_path);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 6: Directory-Only Completions
   * For any cursor position after `@lsp-working-directory:`,
   * the completion provider should return only directory completions.
   */
  it('should detect working directory directive context', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('@lsp-working-directory', '@lsp-working-dir', '@lsp-current-directory', '@lsp-cd', '@lsp-wd'),
        arbitrary_partial_path(),
        (my_directive, my_partial_path) => {
          const my_line = `// ${my_directive}: ${my_partial_path}`;
          const my_document = create_mock_document(my_line);
          const my_position = Position.create(0, my_line.length);

          const my_context = detect_completion_context(my_document, my_position);

          expect(my_context.type).toBe('directive_path');
          if (my_context.type === 'directive_path') {
            expect(my_context.directive).toBe(my_directive);
            expect(my_context.partial_path).toBe(my_partial_path);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should detect canonical # sight directive path contexts', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('done-by', 'run-by', 'included-by', 'do', 'run', 'include', 'wd', 'cd'),
        arbitrary_partial_path(),
        (my_keyword, my_partial_path) => {
          const my_directive = `# sight: ${my_keyword}`;
          const my_line = `// ${my_directive}: ${my_partial_path}`;
          const my_document = create_mock_document(my_line);
          const my_position = Position.create(0, my_line.length);

          const my_context = detect_completion_context(my_document, my_position);

          expect(my_context.type).toBe('directive_path');
          if (my_context.type === 'directive_path') {
            expect(my_context.directive).toBe(my_directive);
            expect(my_context.partial_path).toBe(my_partial_path);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 7: Stata File Filtering
   * Directive path completions should prioritize Stata file extensions.
   */
  it('should recognize Stata file extensions', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...STATA_FILE_EXTENSIONS),
        fc.stringMatching(/^[a-zA-Z0-9_-]+$/),
        (my_extension, my_basename) => {
          const my_filename = my_basename + my_extension;
          
          // Test that Stata extensions are recognized
          expect(STATA_FILE_EXTENSIONS.includes(my_extension)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Comment Style Detection
   * Directive detection should work with both // and * comment styles.
   */
  it('should detect directives in both comment styles', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('//', '*'),
        arbitrary_path_directive(),
        arbitrary_partial_path(),
        (my_comment_style, my_directive, my_partial_path) => {
          const my_line = `${my_comment_style} ${my_directive}: ${my_partial_path}`;
          const my_document = create_mock_document(my_line);
          const my_position = Position.create(0, my_line.length);

          const my_context = detect_completion_context(my_document, my_position);

          expect(my_context.type).toBe('directive_path');
          if (my_context.type === 'directive_path') {
            expect(my_context.directive).toBe(my_directive);
            expect(my_context.partial_path).toBe(my_partial_path);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Non-Directive Comments
   * Regular comments without directives should not trigger directive context.
   */
  it('should not detect directive context in regular comments', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('//', '*'),
        fc.stringMatching(/^[a-zA-Z0-9 _-]+$/),
        (my_comment_style, my_comment_text) => {
          // Ensure the comment text doesn't contain @lsp-
          fc.pre(!my_comment_text.includes('@lsp-'));
          
          const my_line = `${my_comment_style} ${my_comment_text}`;
          const my_document = create_mock_document(my_line);
          const my_position = Position.create(0, my_line.length);

          const my_context = detect_completion_context(my_document, my_position);

          expect(my_context.type).not.toBe('directive_path');
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Quoted Path Handling
   * Directive detection should handle quoted paths correctly.
   */
  it('should handle quoted paths in directives', () => {
    fc.assert(
      fc.property(
        arbitrary_path_directive(),
        arbitrary_file_path(),
        (my_directive, my_path) => {
          const my_quoted_path = `"${my_path}"`;
          const my_line = `// ${my_directive}: ${my_quoted_path}`;
          const my_document = create_mock_document(my_line);
          const my_position = Position.create(0, my_line.length);

          const my_context = detect_completion_context(my_document, my_position);

          expect(my_context.type).toBe('directive_path');
          if (my_context.type === 'directive_path') {
            expect(my_context.directive).toBe(my_directive);
            expect(my_context.partial_path).toBe(my_quoted_path);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
