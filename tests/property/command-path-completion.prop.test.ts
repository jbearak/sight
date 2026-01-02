import { describe, it, expect, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { detect_completion_context } from '../../src/providers/completion';
import { DocumentState } from '../../src/document-store';
import { Position } from 'vscode-languageserver';
import { FILE_COMMANDS } from '../../src/utils/file-path-utils';

/**
 * Property tests for command path completion functionality.
 * Validates that command path contexts are correctly detected for file commands.
 */
describe('Command Path Completion Property Tests', () => {

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
   * Generator for valid file commands.
   */
  function arbitrary_file_command(): fc.Arbitrary<string> {
    return fc.constantFrom(...Array.from(FILE_COMMANDS));
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
   * Generator for non-file commands.
   */
  function arbitrary_non_file_command(): fc.Arbitrary<string> {
    return fc.constantFrom('gen', 'replace', 'drop', 'keep', 'summarize', 'regress', 'list');
  }

  /**
   * Property 8: Command Path Completion Context
   * For any cursor position after a file command (like `do `),
   * the completion provider should return command_path context.
   */
  it('should detect command path completion context for file commands', () => {
    fc.assert(
      fc.property(
        arbitrary_file_command(),
        arbitrary_partial_path(),
        (my_command, my_partial_path) => {
          const my_line = `${my_command} ${my_partial_path}`;
          const my_document = create_mock_document(my_line);
          const my_position = Position.create(0, my_line.length);

          const my_context = detect_completion_context(my_document, my_position);

          expect(my_context.type).toBe('command_path');
          if (my_context.type === 'command_path') {
            expect(my_context.command).toBe(my_command);
            expect(my_context.partial_path).toBe(my_partial_path);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Non-File Command Behavior
   * Non-file commands should not trigger command_path context.
   */
  it('should not detect command path context for non-file commands', () => {
    fc.assert(
      fc.property(
        arbitrary_non_file_command(),
        arbitrary_partial_path(),
        (my_command, my_partial_path) => {
          const my_line = `${my_command} ${my_partial_path}`;
          const my_document = create_mock_document(my_line);
          const my_position = Position.create(0, my_line.length);

          const my_context = detect_completion_context(my_document, my_position);

          expect(my_context.type).not.toBe('command_path');
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: File Command Recognition
   * All FILE_COMMANDS should be recognized as file commands.
   */
  it('should recognize all file commands', () => {
    fc.assert(
      fc.property(
        arbitrary_file_command(),
        (my_command) => {
          expect(FILE_COMMANDS.has(my_command)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Empty Path Handling
   * File commands with no path should still trigger command_path context.
   */
  it('should detect command path context with empty path', () => {
    fc.assert(
      fc.property(
        arbitrary_file_command(),
        (my_command) => {
          const my_line = `${my_command} `;
          const my_document = create_mock_document(my_line);
          const my_position = Position.create(0, my_line.length);

          const my_context = detect_completion_context(my_document, my_position);

          expect(my_context.type).toBe('command_path');
          if (my_context.type === 'command_path') {
            expect(my_context.command).toBe(my_command);
            expect(my_context.partial_path).toBe('');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Case Sensitive Command Detection
   * File commands are case-sensitive in Stata - only lowercase works.
   */
  it('should detect file commands case sensitively (lowercase only)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('do', 'run', 'include'),
        arbitrary_partial_path(),
        (my_command, my_partial_path) => {
          const my_line = `${my_command} ${my_partial_path}`;
          const my_document = create_mock_document(my_line);
          const my_position = Position.create(0, my_line.length);

          const my_context = detect_completion_context(my_document, my_position);

          expect(my_context.type).toBe('command_path');
          if (my_context.type === 'command_path') {
            expect(my_context.command).toBe(my_command);
            expect(my_context.partial_path).toBe(my_partial_path);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should NOT detect uppercase file commands', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('DO', 'RUN', 'INCLUDE', 'Do', 'Run', 'Include'),
        arbitrary_partial_path(),
        (my_command, my_partial_path) => {
          const my_line = `${my_command} ${my_partial_path}`;
          const my_document = create_mock_document(my_line);
          const my_position = Position.create(0, my_line.length);

          const my_context = detect_completion_context(my_document, my_position);

          // Uppercase commands should NOT be detected as file commands
          expect(my_context.type).not.toBe('command_path');
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Whitespace Handling
   * Command path detection should handle various whitespace patterns.
   */
  it('should handle whitespace in command path detection', () => {
    fc.assert(
      fc.property(
        arbitrary_file_command(),
        fc.stringMatching(/^ +$/), // One or more spaces
        arbitrary_partial_path(),
        (my_command, my_spaces, my_partial_path) => {
          const my_line = `${my_command}${my_spaces}${my_partial_path}`;
          const my_document = create_mock_document(my_line);
          const my_position = Position.create(0, my_line.length);

          const my_context = detect_completion_context(my_document, my_position);

          expect(my_context.type).toBe('command_path');
          if (my_context.type === 'command_path') {
            expect(my_context.command).toBe(my_command);
            expect(my_context.partial_path).toBe(my_partial_path);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
