import * as fc from 'fast-check';
import {
  arbitrary_identifier,
  arbitrary_macro_name,
  arbitrary_variable_name,
  arbitrary_command_name,
  arbitrary_string_literal,
  arbitrary_varlist,
  arbitrary_number,
  arbitrary_comment,
  arbitrary_trailing_comment,
} from './primitives';

/**
 * Document generators for property-based testing.
 * These generators produce valid Stata source code documents with various
 * characteristics for testing different aspects of the LSP.
 */

/**
 * Generate a valid Stata document with mixed constructs.
 * Includes commands, macro definitions, programs, and control flow.
 */
export function arbitrary_stata_document(): fc.Arbitrary<string> {
  const my_local_def = fc
    .tuple(arbitrary_macro_name(), arbitrary_string_literal())
    .map(([my_name, my_value]) => `local ${my_name} = ${my_value}`);

  const my_global_def = fc
    .tuple(arbitrary_macro_name(), arbitrary_string_literal())
    .map(([my_name, my_value]) => `global ${my_name} = ${my_value}`);

  const my_command = fc
    .tuple(arbitrary_command_name(), fc.option(arbitrary_varlist()))
    .map(([my_cmd, my_vars]) => (my_vars ? `${my_cmd} ${my_vars}` : my_cmd));

  const my_if_block = fc
    .tuple(arbitrary_number(), arbitrary_number())
    .map(([my_a, my_b]) => `if ${my_a} > ${my_b} {\n  display "yes"\n}`);

  const my_foreach_block = fc
    .tuple(arbitrary_variable_name(), arbitrary_varlist())
    .map(([my_var, my_list]) => `foreach ${my_var} of varlist ${my_list} {\n  display \`${my_var}'\n}`);

  const my_statement = fc.oneof(
    my_local_def,
    my_global_def,
    my_command,
    my_if_block,
    my_foreach_block
  );

  return fc
    .array(my_statement, { minLength: 1, maxLength: 5 })
    .map((my_statements) => my_statements.join('\n'));
}

/**
 * Generate a document with specific macro definitions.
 * Returns both the document and metadata about the macros.
 */
export function arbitrary_document_with_macros(
  num_locals: number,
  num_globals: number
): fc.Arbitrary<{ document: string; macros: Array<{ name: string; scope: 'local' | 'global' }> }> {
  const my_local_defs = fc.array(
    fc
      .tuple(arbitrary_macro_name(), arbitrary_string_literal())
      .map(([my_name, my_value]) => ({
        def: `local ${my_name} = ${my_value}`,
        name: my_name,
        scope: 'local' as const,
      })),
    { minLength: num_locals, maxLength: num_locals }
  );

  const my_global_defs = fc.array(
    fc
      .tuple(arbitrary_macro_name(), arbitrary_string_literal())
      .map(([my_name, my_value]) => ({
        def: `global ${my_name} = ${my_value}`,
        name: my_name,
        scope: 'global' as const,
      })),
    { minLength: num_globals, maxLength: num_globals }
  );

  return fc
    .tuple(my_local_defs, my_global_defs)
    .map(([my_locals, my_globals]) => {
      const my_all_defs = [...my_locals, ...my_globals];
      const my_document = my_all_defs.map((my_def) => my_def.def).join('\n');
      const my_macros = my_all_defs.map((my_def) => ({
        name: my_def.name,
        scope: my_def.scope,
      }));

      return { document: my_document, macros: my_macros };
    });
}

/**
 * Generate a document with specific program definitions.
 * Returns both the document and metadata about the programs.
 */
export function arbitrary_document_with_programs(
  num_programs: number
): fc.Arbitrary<{ document: string; programs: Array<{ name: string }> }> {
  const my_program_def = fc
    .tuple(arbitrary_identifier(), fc.array(arbitrary_command_name(), { maxLength: 2 }))
    .map(([my_name, my_commands]) => ({
      name: my_name,
      def: `program define ${my_name}\n${my_commands.map((my_cmd) => `  ${my_cmd}`).join('\n')}\nend`,
    }));

  return fc
    .array(my_program_def, { minLength: num_programs, maxLength: num_programs })
    .map((my_programs) => {
      const my_document = my_programs.map((my_prog) => my_prog.def).join('\n\n');
      const my_program_names = my_programs.map((my_prog) => ({ name: my_prog.name }));

      return { document: my_document, programs: my_program_names };
    });
}

/**
 * Generate a malformed document with a specific error type.
 * Returns the document and expected error information.
 */
export function arbitrary_malformed_document(
  error_type: 'unbalanced_quotes' | 'unclosed_block' | 'missing_program_end' | 'brace_else_same_line' | 'brace_not_alone'
): fc.Arbitrary<{ document: string; error_type: string }> {
  switch (error_type) {
    case 'unbalanced_quotes':
      return fc
        .tuple(arbitrary_command_name(), fc.stringMatching(/^[^"]*$/))
        .map(([my_cmd, my_content]) => ({
          document: `${my_cmd} "${my_content}`,
          error_type: 'unbalanced_quotes',
        }));

    case 'unclosed_block':
      return fc
        .tuple(arbitrary_command_name(), arbitrary_varlist())
        .map(([my_cmd, my_vars]) => ({
          document: `if 1 > 0 {\n  ${my_cmd} ${my_vars}`,
          error_type: 'unclosed_block',
        }));

    case 'missing_program_end':
      return fc
        .tuple(arbitrary_identifier(), arbitrary_command_name())
        .map(([my_name, my_cmd]) => ({
          document: `program define ${my_name}\n  ${my_cmd}`,
          error_type: 'missing_program_end',
        }));

    case 'brace_else_same_line':
      return fc
        .tuple(arbitrary_command_name(), arbitrary_command_name())
        .map(([my_cmd1, my_cmd2]) => ({
          document: `if 1 > 0 {\n  ${my_cmd1}\n} else {\n  ${my_cmd2}\n}`,
          error_type: 'brace_else_same_line',
        }));

    case 'brace_not_alone':
      return fc
        .tuple(arbitrary_command_name(), arbitrary_command_name())
        .map(([my_cmd1, my_cmd2]) => ({
          document: `if 1 > 0 {\n  ${my_cmd1}\n} ${my_cmd2}`,
          error_type: 'brace_not_alone',
        }));

    default:
      return fc.constant({ document: '', error_type: 'unknown' });
  }
}

/**
 * Generate a document with delimiter directives.
 * Returns the document and expected delimiter modes at different positions.
 */
export function arbitrary_document_with_delimit_switches(): fc.Arbitrary<{
  document: string;
  expected_modes: Array<{ line: number; mode: 'cr' | 'semicolon' }>;
}> {
  return fc
    .tuple(
      fc.array(arbitrary_command_name(), { minLength: 1, maxLength: 3 }),
      fc.array(arbitrary_command_name(), { minLength: 1, maxLength: 3 })
    )
    .map(([my_cr_commands, my_semi_commands]) => {
      const my_cr_section = my_cr_commands.map((my_cmd) => `${my_cmd}`).join('\n');
      const my_semi_section = my_semi_commands.map((my_cmd) => `${my_cmd}`).join(';');

      const my_document = `#delimit cr\n${my_cr_section}\n#delimit ;\n${my_semi_section}\n#delimit cr`;

      const my_expected_modes = [
        { line: 0, mode: 'cr' as const },
        { line: 1, mode: 'cr' as const },
        { line: my_cr_commands.length + 1, mode: 'semicolon' as const },
        { line: my_cr_commands.length + my_semi_commands.length + 2, mode: 'cr' as const },
      ];

      return { document: my_document, expected_modes: my_expected_modes };
    });
}

/**
 * Generate a document with continuation lines (///).
 */
export function arbitrary_document_with_continuations(): fc.Arbitrary<string> {
  return fc
    .array(arbitrary_command_name(), { minLength: 1, maxLength: 3 })
    .map((my_commands) => {
      const my_lines = my_commands.map((my_cmd) => `${my_cmd} ///`);
      my_lines[my_lines.length - 1] = my_lines[my_lines.length - 1].replace(' ///', '');
      return my_lines.join('\n');
    });
}

/**
 * Generate a document with comments.
 * Uses trailing comments (// and block comments) which are always recognized
 * as comments regardless of context. Star comments are avoided because they
 * may be interpreted as operators after command names.
 */
export function arbitrary_document_with_comments(): fc.Arbitrary<string> {
  return fc
    .array(
      fc.tuple(arbitrary_command_name(), arbitrary_trailing_comment()),
      { minLength: 1, maxLength: 3 }
    )
    .map((my_items) => my_items.map(([my_cmd, my_comment]) => `${my_cmd}  ${my_comment}`).join('\n'));
}

/**
 * Generate a document with macro references.
 */
export function arbitrary_document_with_macro_refs(): fc.Arbitrary<{
  document: string;
  macro_refs: Array<{ name: string; position: { line: number; character: number } }>;
}> {
  return fc
    .tuple(
      fc.array(arbitrary_macro_name(), { minLength: 1, maxLength: 3 }),
      fc.array(arbitrary_command_name(), { minLength: 1, maxLength: 3 })
    )
    .map(([my_macro_names, my_commands]) => {
      const my_defs = my_macro_names
        .map((my_name) => `local ${my_name} = "value"`)
        .join('\n');

      const my_refs = my_commands
        .map((my_cmd, my_idx) => {
          const my_macro = my_macro_names[my_idx % my_macro_names.length];
          return `${my_cmd} \`${my_macro}'`;
        })
        .join('\n');

      const my_document = `${my_defs}\n${my_refs}`;

      const my_macro_refs = my_commands.map((_, my_idx) => {
        const my_macro = my_macro_names[my_idx % my_macro_names.length];
        return {
          name: my_macro,
          position: { line: my_macro_names.length + my_idx, character: 0 },
        };
      });

      return { document: my_document, macro_refs: my_macro_refs };
    });
}

/**
 * Generate a document with embedded language blocks.
 */
export function arbitrary_document_with_embedded_blocks(): fc.Arbitrary<{
  document: string;
  embedded_blocks: Array<{ language: string; range: { start: { line: number }; end: { line: number } } }>;
}> {
  return fc
    .array(
      fc.oneof(fc.constant('mata'), fc.constant('python')),
      { minLength: 1, maxLength: 2 }
    )
    .map((my_languages) => {
      let my_document = '';
      let my_line = 0;
      const my_blocks: Array<{ language: string; range: { start: { line: number }; end: { line: number } } }> = [];

      for (const my_lang of my_languages) {
        const my_start_line = my_line;
        my_document += `${my_lang}\n`;
        my_line++;

        my_document += `x = 5\n`;
        my_line++;

        const my_end_cmd = 'end'; // Both mata and python blocks end with 'end'
        my_document += `${my_end_cmd}\n`;
        my_line++;

        my_blocks.push({
          language: my_lang,
          range: { start: { line: my_start_line }, end: { line: my_line - 1 } },
        });
      }

      return { document: my_document, embedded_blocks: my_blocks };
    });
}

/**
 * Generate a document with abbreviations.
 */
export function arbitrary_document_with_abbreviations(): fc.Arbitrary<{
  document: string;
  abbreviations: string[];
}> {
  const my_abbrev_commands = [
    { full: 'display', abbrev: 'di' },
    { full: 'generate', abbrev: 'gen' },
    { full: 'replace', abbrev: 'rep' },
    { full: 'summarize', abbrev: 'sum' },
  ];

  return fc
    .array(fc.constantFrom(...my_abbrev_commands), { minLength: 1, maxLength: 3 })
    .map((my_commands) => {
      const my_document = my_commands.map((my_cmd) => `${my_cmd.abbrev} x`).join('\n');
      const my_abbreviations = my_commands.map((my_cmd) => my_cmd.abbrev);

      return { document: my_document, abbreviations: my_abbreviations };
    });
}

/**
 * Generate a document with symbol definitions and references.
 */
export function arbitrary_document_with_definitions(): fc.Arbitrary<{
  document: string;
  definitions: Array<{
    name: string;
    definition_location: { line: number; character: number };
    reference_position: { line: number; character: number };
  }>;
}> {
  return fc
    .tuple(
      fc.uniqueArray(arbitrary_macro_name(), {
        minLength: 1,
        maxLength: 2,
        comparator: (a, b) => a === b,
      }),
      fc.array(arbitrary_identifier(), { minLength: 1, maxLength: 2 })
    )
    .map(([my_macros, my_programs]) => {
      let my_document = '';
      let my_line = 0;
      const my_definitions: Array<{
        name: string;
        definition_location: { line: number; character: number };
        reference_position: { line: number; character: number };
      }> = [];

      // Define macros and record their definition lines
      const my_macro_def_lines: number[] = [];
      for (const my_macro of my_macros) {
        my_macro_def_lines.push(my_line);
        my_document += `local ${my_macro} = "value"\n`;
        my_line++;
      }

      // Define programs
      for (const my_prog of my_programs) {
        my_document += `program define ${my_prog}\n  display "hello"\nend\n`;
        my_line += 3;
      }

      // Reference macros and record their reference lines
      const my_macro_ref_start_line = my_line;
      for (let my_i = 0; my_i < my_macros.length; my_i++) {
        const my_macro = my_macros[my_i];
        my_document += `display \`${my_macro}'\n`;
        my_definitions.push({
          name: my_macro,
          definition_location: { line: my_macro_def_lines[my_i], character: 6 },
          reference_position: { line: my_macro_ref_start_line + my_i, character: 9 },
        });
        my_line++;
      }

      return { document: my_document, definitions: my_definitions };
    });
}

/**
 * Generate a document with undefined references.
 */
export function arbitrary_document_with_undefined_refs(): fc.Arbitrary<{
  document: string;
  undefined_positions: Array<{ line: number; character: number }>;
}> {
  return fc
    .array(arbitrary_macro_name(), { minLength: 1, maxLength: 3 })
    .map((my_undefined_macros) => {
      const my_document = my_undefined_macros
        .map((my_macro) => `display \`${my_macro}'`)
        .join('\n');

      const my_positions = my_undefined_macros.map((_, my_idx) => ({
        line: my_idx,
        character: 8,
      }));

      return { document: my_document, undefined_positions: my_positions };
    });
}

/**
 * Generate a document with non-hoverable positions.
 */
export function arbitrary_non_hoverable_position(): fc.Arbitrary<{
  document: string;
  position: { line: number; character: number };
}> {
  return fc
    .tuple(arbitrary_command_name(), fc.integer({ min: 0, max: 5 }))
    .map(([my_cmd, my_offset]) => ({
      document: `  ${my_cmd}  `,
      position: { line: 0, character: my_offset },
    }));
}

/**
 * Generate a document with mixed symbols (programs and macros).
 */
export function arbitrary_document_with_mixed_symbols(): fc.Arbitrary<{
  document: string;
  expected_symbols: Array<{
    name: string;
    kind: string;
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
  }>;
}> {
  return fc
    .tuple(
      fc.array(arbitrary_identifier(), { minLength: 1, maxLength: 2 }),
      fc.array(arbitrary_macro_name(), { minLength: 1, maxLength: 2 })
    )
    .map(([my_programs, my_macros]) => {
      let my_document = '';
      let my_line = 0;
      const my_symbols: Array<{
        name: string;
        kind: string;
        range: { start: { line: number; character: number }; end: { line: number; character: number } };
      }> = [];

      // Define programs
      for (const my_prog of my_programs) {
        my_document += `program define ${my_prog}\nend\n`;
        my_symbols.push({
          name: my_prog,
          kind: 'Function',
          range: {
            start: { line: my_line, character: 16 },
            end: { line: my_line, character: 16 + my_prog.length },
          },
        });
        my_line += 2;
      }

      // Define macros
      for (const my_macro of my_macros) {
        my_document += `local ${my_macro} = "value"\n`;
        my_symbols.push({
          name: my_macro,
          kind: 'Variable',
          range: {
            start: { line: my_line, character: 6 },
            end: { line: my_line, character: 6 + my_macro.length },
          },
        });
        my_line++;
      }

      return { document: my_document, expected_symbols: my_symbols };
    });
}



