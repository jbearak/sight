/**
 * Orphan Closing Brace Detection Property Tests
 *
 * Tests that verify Property 1: Orphan Closing Brace Detection from the spec.
 * An orphan closing brace is a '}' that doesn't close any block.
 */

import { describe, it } from 'bun:test';
import * as fc from 'fast-check';
import { ParseErrorCode } from '../../src/types';
import {
  arbitrary_command_name,
  arbitrary_string_literal,
  arbitrary_variable_name,
} from './generators/primitives';
import { create_document_state } from './helpers/document-utils';

describe('Orphan Closing Brace Detection Property Tests', () => {
  /**
   * Property 1: Orphan Closing Brace Detection
   * For any Stata code without blocks that contains a '}' at the top level,
   * the parser should emit a diagnostic with code ORPHAN_CLOSE_BRACE.
   * Feature: orphan-closing-brace-detection, Property 1: Orphan Closing Brace Detection
   * Validates: Requirements 1.1, 2.1, 2.2, 2.3
   */
  it('should detect orphan closing braces in code without blocks', async () => {
    fc.assert(
      fc.asyncProperty(
        // Generate random Stata code without blocks
        arbitrary_stata_code_without_blocks(),
        fc.integer({ min: 0, max: 10 }), // Position to insert '}'
        async (my_base_code, my_insert_position) => {
          // Split the base code into lines
          const my_lines = my_base_code.split('\n');
          
          // Insert '}' at the specified position (clamped to valid range)
          const my_actual_position = Math.min(my_insert_position, my_lines.length);
          my_lines.splice(my_actual_position, 0, '}');
          
          const my_document = my_lines.join('\n');
          
          // Create document state and get parse errors
          const my_doc_state = create_document_state(my_document);
          
          // Should have at least one diagnostic for the orphan closing brace
          const my_orphan_brace_diagnostics = my_doc_state.diagnostics.filter(
            (my_diag) => my_diag.code === ParseErrorCode.ORPHAN_CLOSE_BRACE
          );
          
          // Verify we have the diagnostic
          if (my_orphan_brace_diagnostics.length === 0) {
            console.log('Expected ORPHAN_CLOSE_BRACE diagnostic but found none');
            console.log('Document:', my_document);
            console.log('All diagnostics:', my_doc_state.diagnostics.map(d => ({ code: d.code, message: d.message })));
            return false;
          }
          
          // Verify the diagnostic has the correct message
          const my_diagnostic = my_orphan_brace_diagnostics[0];
          const my_expected_message = 'unexpected closing brace - no matching opening brace';
          if (my_diagnostic.message !== my_expected_message) {
            console.log(`Expected message "${my_expected_message}" but got "${my_diagnostic.message}"`);
            return false;
          }
          
          // Verify the diagnostic range matches the brace token position
          const my_brace_line = my_actual_position;
          if (my_diagnostic.range.start.line !== my_brace_line) {
            console.log(`Expected diagnostic on line ${my_brace_line} but got line ${my_diagnostic.range.start.line}`);
            return false;
          }
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 2: Valid Block Structure Acceptance
   * For any Stata code with valid block structures (if/else/foreach/forvalues/while/frame/prefix blocks),
   * no ORPHAN_CLOSE_BRACE diagnostic should be emitted.
   * Feature: orphan-closing-brace-detection, Property 2: Valid Block Structure Acceptance
   * Validates: Requirements 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8
   */
  it('should not flag valid closing braces in block structures', async () => {
    fc.assert(
      fc.asyncProperty(
        arbitrary_stata_code_with_valid_blocks(),
        async (my_document) => {
          // Create document state and get parse errors
          const my_doc_state = create_document_state(my_document);
          
          // Should NOT have any orphan closing brace diagnostics
          const my_orphan_brace_diagnostics = my_doc_state.diagnostics.filter(
            (my_diag) => my_diag.code === ParseErrorCode.ORPHAN_CLOSE_BRACE
          );
          
          if (my_orphan_brace_diagnostics.length > 0) {
            console.log('Unexpected ORPHAN_CLOSE_BRACE diagnostic found');
            console.log('Document:', my_document);
            console.log('Orphan brace diagnostics:', my_orphan_brace_diagnostics);
            return false;
          }
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Generate random Stata code without any blocks (no if, foreach, etc. with braces).
 * This ensures that any '}' inserted will be orphaned.
 */
function arbitrary_stata_code_without_blocks(): fc.Arbitrary<string> {
  const my_simple_command = fc
    .tuple(arbitrary_command_name(), fc.option(arbitrary_variable_name()))
    .map(([my_cmd, my_var]) => my_var ? `${my_cmd} ${my_var}` : my_cmd);
    
  const my_local_def = fc
    .tuple(arbitrary_variable_name(), arbitrary_string_literal())
    .map(([my_name, my_value]) => `local ${my_name} = ${my_value}`);
    
  const my_global_def = fc
    .tuple(arbitrary_variable_name(), arbitrary_string_literal())
    .map(([my_name, my_value]) => `global ${my_name} = ${my_value}`);
    
  const my_display_command = fc
    .tuple(arbitrary_string_literal())
    .map(([my_text]) => `display ${my_text}`);
    
  const my_statement = fc.oneof(
    my_simple_command,
    my_local_def,
    my_global_def,
    my_display_command
  );
  
  return fc
    .array(my_statement, { minLength: 1, maxLength: 5 })
    .map((my_statements) => my_statements.join('\n'));
}

/**
 * Generate random Stata code with valid block structures.
 * This ensures that all '}' characters properly close blocks.
 */
function arbitrary_stata_code_with_valid_blocks(): fc.Arbitrary<string> {
  const my_simple_command = fc
    .tuple(arbitrary_command_name(), fc.option(arbitrary_variable_name()))
    .map(([my_cmd, my_var]) => my_var ? `${my_cmd} ${my_var}` : my_cmd);
    
  const my_if_block = fc
    .tuple(arbitrary_variable_name(), arbitrary_string_literal())
    .map(([my_var, my_value]) => `if ${my_var} > 0 {\n  display ${my_value}\n}`);
    
  const my_else_block = fc
    .tuple(arbitrary_variable_name(), arbitrary_string_literal(), arbitrary_string_literal())
    .map(([my_var, my_value1, my_value2]) => 
      `if ${my_var} > 0 {\n  display ${my_value1}\n}\nelse {\n  display ${my_value2}\n}`);
    
  const my_foreach_block = fc
    .tuple(arbitrary_variable_name(), arbitrary_variable_name(), arbitrary_string_literal())
    .map(([my_loop_var, my_list_var, my_value]) => 
      `foreach ${my_loop_var} of varlist ${my_list_var} {\n  display ${my_value}\n}`);
    
  const my_forvalues_block = fc
    .tuple(arbitrary_variable_name(), arbitrary_string_literal())
    .map(([my_var, my_value]) => 
      `forvalues ${my_var} = 1/10 {\n  display ${my_value}\n}`);
    
  const my_while_block = fc
    .tuple(arbitrary_variable_name(), arbitrary_string_literal())
    .map(([my_var, my_value]) => 
      `while ${my_var} > 0 {\n  display ${my_value}\n  local ${my_var} = ${my_var} - 1\n}`);
    
  const my_frame_block = fc
    .tuple(arbitrary_variable_name(), arbitrary_string_literal())
    .map(([my_frame, my_value]) => 
      `frame ${my_frame} {\n  display ${my_value}\n}`);
    
  const my_prefix_block = fc
    .tuple(arbitrary_string_literal())
    .map(([my_value]) => 
      `quietly {\n  display ${my_value}\n}`);
    
  const my_block_statement = fc.oneof(
    my_if_block,
    my_else_block,
    my_foreach_block,
    my_forvalues_block,
    my_while_block,
    my_frame_block,
    my_prefix_block
  );
  
  const my_statement = fc.oneof(
    my_simple_command,
    my_block_statement
  );
  
  return fc
    .array(my_statement, { minLength: 1, maxLength: 3 })
    .map((my_statements) => my_statements.join('\n\n'));
}