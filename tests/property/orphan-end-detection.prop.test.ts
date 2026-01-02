/**
 * Orphan End Detection Property Tests
 *
 * Tests that verify Property 1: Orphan End Detection from the design document.
 * An orphan end is an 'end' command that doesn't close any program, mata, or python block.
 */

import { describe, it } from 'bun:test';
import * as fc from 'fast-check';
import { DiagnosticsProvider } from '../../src/providers/diagnostics';
import { StataLSPConfig } from '../../src/types';
import { ContextErrorCode } from '../../src/types';
import {
  arbitrary_command_name,
  arbitrary_string_literal,
  arbitrary_variable_name,
} from './generators/primitives';
import { create_document_state } from './helpers/document-utils';

describe('Orphan End Detection Property Tests', () => {
  /**
   * Property 1: Orphan End Detection
   * For any Stata code without blocks that contains an 'end' command,
   * the context tracker should emit an error diagnostic.
   * Feature: comprehensive-property-tests, Property 1: Orphan End Detection
   * Validates: Requirement 4.4
   */
  it('should detect orphan end commands in code without blocks', async () => {
    fc.assert(
      fc.asyncProperty(
        // Generate random Stata code without blocks
        arbitrary_stata_code_without_blocks(),
        fc.integer({ min: 0, max: 10 }), // Position to insert 'end'
        async (my_base_code, my_insert_position) => {
          // Split the base code into lines
          const my_lines = my_base_code.split('\n');
          
          // Insert 'end' at the specified position (clamped to valid range)
          const my_actual_position = Math.min(my_insert_position, my_lines.length);
          my_lines.splice(my_actual_position, 0, 'end');
          
          const my_document = my_lines.join('\n');
          
          // Create document state and get diagnostics
          const my_doc_state = create_document_state(my_document);
          const my_diagnostics_provider = new DiagnosticsProvider({
            sendDiagnostics: () => {},
          } as any);
          
          const my_config: StataLSPConfig = {
            diagnostics: {
              enabled: true,
              severity: {
                styleWarnings: 'warning',
                undefinedMacro: 'warning',
                undefinedVariable: 'warning',
              },
            },
            adoPaths: [],
          } as any;
          
          const my_diagnostics = await my_diagnostics_provider.get_diagnostics(
            my_doc_state,
            my_config
          );
          
          // Should have at least one diagnostic for the orphan end
          const my_orphan_end_diagnostics = my_diagnostics.filter(
            (my_diag) => 
              my_diag.code === ContextErrorCode.UNEXPECTED_END ||
              (typeof my_diag.message === 'string' && 
               my_diag.message.includes('Unexpected "end"'))
          );
          
          return my_orphan_end_diagnostics.length > 0;
        }
      ),
      { numRuns: 100 }
    );
  });
  
  /**
   * Property 1b: No False Positives for Valid End Commands
   * For any Stata code with proper program blocks that contain 'end' commands,
   * no orphan end diagnostics should be emitted.
   * Feature: comprehensive-property-tests, Property 1b: No False Positives
   * Validates: Requirement 4.2
   */
  it('should not flag valid end commands in program blocks', async () => {
    fc.assert(
      fc.asyncProperty(
        arbitrary_stata_code_with_program_blocks(),
        async (my_document) => {
          // Create document state and get diagnostics
          const my_doc_state = create_document_state(my_document);
          const my_diagnostics_provider = new DiagnosticsProvider({
            sendDiagnostics: () => {},
          } as any);
          
          const my_config: StataLSPConfig = {
            diagnostics: {
              enabled: true,
              severity: {
                styleWarnings: 'warning',
                undefinedMacro: 'warning',
                undefinedVariable: 'warning',
              },
            },
            adoPaths: [],
          } as any;
          
          const my_diagnostics = await my_diagnostics_provider.get_diagnostics(
            my_doc_state,
            my_config
          );
          
          // Should NOT have any orphan end diagnostics
          const my_orphan_end_diagnostics = my_diagnostics.filter(
            (my_diag) => 
              my_diag.code === ContextErrorCode.UNEXPECTED_END ||
              (typeof my_diag.message === 'string' && 
               my_diag.message.includes('Unexpected "end"'))
          );
          
          return my_orphan_end_diagnostics.length === 0;
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Generate random Stata code without any blocks (no program, mata, or python blocks).
 * This ensures that any 'end' command inserted will be orphaned.
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
 * Generate random Stata code with proper program blocks.
 * This ensures that 'end' commands are properly matched.
 */
function arbitrary_stata_code_with_program_blocks(): fc.Arbitrary<string> {
  const my_program_block = fc
    .tuple(arbitrary_variable_name(), fc.array(arbitrary_command_name(), { minLength: 1, maxLength: 3 }))
    .map(([my_name, my_commands]) => {
      const my_body = my_commands.map(my_cmd => `  ${my_cmd}`).join('\n');
      return `program define ${my_name}\n${my_body}\nend`;
    });
    
  const my_simple_command = fc
    .tuple(arbitrary_command_name(), fc.option(arbitrary_variable_name()))
    .map(([my_cmd, my_var]) => my_var ? `${my_cmd} ${my_var}` : my_cmd);
    
  return fc
    .tuple(
      fc.array(my_simple_command, { maxLength: 2 }),
      fc.array(my_program_block, { minLength: 1, maxLength: 2 }),
      fc.array(my_simple_command, { maxLength: 2 })
    )
    .map(([my_before, my_programs, my_after]) => {
      const my_all_parts = [...my_before, ...my_programs, ...my_after];
      return my_all_parts.join('\n\n');
    });
}