import * as fc from 'fast-check';
import { Range, Position } from 'vscode-languageserver-textdocument';
import {
  CommandNode,
  MacroDefNode,
  ProgramNode,
  ControlFlowNode,
  PrefixNode,
  OptionNode,
  IdentifierNode,
  StringLiteralNode,
  DirectiveNode,
  EmbeddedLanguageBlockNode,
  StataNode,
} from '../../../src/types';
import {
  arbitrary_identifier,
  arbitrary_macro_name,
  arbitrary_variable_name,
  arbitrary_command_name,
  arbitrary_option_name,
  arbitrary_string_literal,
  arbitrary_varlist,
  arbitrary_number,
} from './primitives';

/**
 * Helper to create a Range object.
 */
function make_range(
  start_line: number,
  start_char: number,
  end_line: number,
  end_char: number
): Range {
  return {
    start: { line: start_line, character: start_char },
    end: { line: end_line, character: end_char },
  };
}

/**
 * Generate valid command nodes.
 * Commands can have prefixes, varlists, and options.
 */
export function arbitrary_command_node(): fc.Arbitrary<CommandNode> {
  return fc
    .tuple(
      arbitrary_command_name(),
      fc.array(arbitrary_option_node(), { maxLength: 3 }),
      fc.option(arbitrary_varlist())
    )
    .map(([my_name, my_options, my_varlist]) => {
      const my_varlist_nodes = my_varlist
        ? my_varlist.split(' ').map((my_var, my_idx) => ({
            name: my_var,
            range: make_range(0, my_idx * 5, 0, my_idx * 5 + my_var.length),
          }))
        : undefined;

      return {
        type: 'command',
        name: my_name,
        fullName: my_name,
        options: my_options,
        varlist: my_varlist_nodes,
        range: make_range(0, 0, 0, 20),
      };
    });
}

/**
 * Generate valid option nodes.
 */
export function arbitrary_option_node(): fc.Arbitrary<OptionNode> {
  return fc
    .tuple(arbitrary_option_name(), fc.option(arbitrary_string_literal()))
    .map(([my_name, my_arg]) => ({
      type: 'option',
      name: my_name,
      fullName: my_name,
      argument: my_arg ?? undefined,
      range: make_range(0, 0, 0, 10),
    }));
}

/**
 * Generate valid macro definition nodes.
 */
export function arbitrary_macro_def_node(): fc.Arbitrary<MacroDefNode> {
  return fc
    .tuple(
      fc.oneof(fc.constant('local'), fc.constant('global')),
      arbitrary_macro_name(),
      fc.stringMatching(/^[^`]*$/) // Content without backticks
    )
    .map(([my_scope, my_name, my_value]) => ({
      type: 'macro_def',
      scope: my_scope as 'local' | 'global',
      name: my_name,
      value: my_value,
      range: make_range(0, 0, 0, 30),
    }));
}

/**
 * Generate valid program definition nodes.
 */
export function arbitrary_program_node(): fc.Arbitrary<ProgramNode> {
  return fc
    .tuple(
      arbitrary_identifier(),
      fc.array(arbitrary_command_node(), { maxLength: 3 })
    )
    .map(([my_name, my_body]) => ({
      type: 'program',
      name: my_name,
      body: my_body,
      range: make_range(0, 0, 5, 0),
    }));
}

/**
 * Generate valid if/else control flow nodes.
 */
export function arbitrary_if_node(): fc.Arbitrary<ControlFlowNode> {
  return fc
    .tuple(
      fc.stringMatching(/^[a-zA-Z0-9_\s<>=!&|()]*$/), // Simple condition
      fc.array(arbitrary_command_node(), { maxLength: 2 })
    )
    .map(([my_condition, my_body]) => ({
      type: 'if',
      condition: my_condition,
      body: my_body,
      range: make_range(0, 0, 3, 0),
    }));
}

/**
 * Generate valid foreach control flow nodes.
 */
export function arbitrary_foreach_node(): fc.Arbitrary<ControlFlowNode> {
  return fc
    .tuple(
      arbitrary_variable_name(),
      arbitrary_varlist(),
      fc.array(arbitrary_command_node(), { maxLength: 2 })
    )
    .map(([my_loop_var, my_spec, my_body]) => ({
      type: 'foreach',
      loopVar: my_loop_var,
      loopSpec: my_spec,
      body: my_body,
      range: make_range(0, 0, 3, 0),
    }));
}

/**
 * Generate valid forvalues control flow nodes.
 */
export function arbitrary_forvalues_node(): fc.Arbitrary<ControlFlowNode> {
  return fc
    .tuple(
      arbitrary_variable_name(),
      fc.tuple(arbitrary_number(), arbitrary_number()),
      fc.array(arbitrary_command_node(), { maxLength: 2 })
    )
    .map(([my_loop_var, [my_start, my_end], my_body]) => ({
      type: 'forvalues',
      loopVar: my_loop_var,
      loopSpec: `${my_start}/${my_end}`,
      body: my_body,
      range: make_range(0, 0, 3, 0),
    }));
}

/**
 * Generate valid while control flow nodes.
 */
export function arbitrary_while_node(): fc.Arbitrary<ControlFlowNode> {
  return fc
    .tuple(
      fc.stringMatching(/^[a-zA-Z0-9_\s<>=!&|()]*$/), // Simple condition
      fc.array(arbitrary_command_node(), { maxLength: 2 })
    )
    .map(([my_condition, my_body]) => ({
      type: 'while',
      condition: my_condition,
      body: my_body,
      range: make_range(0, 0, 3, 0),
    }));
}

/**
 * Generate valid string literal nodes.
 */
export function arbitrary_string_literal_node(): fc.Arbitrary<StringLiteralNode> {
  return fc
    .tuple(
      fc.oneof(fc.constant('simple'), fc.constant('compound')),
      fc.stringMatching(/^[^"']*$/)
    )
    .map(([my_style, my_value]) => ({
      type: 'string',
      quoteStyle: my_style as 'simple' | 'compound',
      value: my_value,
      range: make_range(0, 0, 0, my_value.length + 2),
    }));
}

/**
 * Generate valid directive nodes (e.g., #delimit).
 */
export function arbitrary_directive_node(): fc.Arbitrary<DirectiveNode> {
  return fc
    .oneof(fc.constant('cr'), fc.constant('semicolon'))
    .map((my_mode) => ({
      type: 'directive',
      directive: 'delimit',
      mode: my_mode as 'cr' | 'semicolon',
      range: make_range(0, 0, 0, 15),
    }));
}

/**
 * Generate valid embedded language block nodes.
 */
export function arbitrary_embedded_block_node(): fc.Arbitrary<EmbeddedLanguageBlockNode> {
  return fc
    .tuple(
      fc.oneof(fc.constant('mata'), fc.constant('python')),
      fc.stringMatching(/^[^]*$/) // Any content
    )
    .map(([my_language, my_content]) => {
      const my_start_cmd = my_language;
      const my_end_cmd = my_language === 'mata' ? 'end' : 'end python';

      return {
        type: 'embedded_block',
        language: my_language as 'mata' | 'python',
        start_command: my_start_cmd,
        end_command: my_end_cmd,
        content: my_content,
        content_range: make_range(1, 0, 2, 0),
        is_single_line: false,
        range: make_range(0, 0, 3, 0),
      };
    });
}

/**
 * Generate valid single-line embedded language block nodes.
 */
export function arbitrary_embedded_block_inline_node(): fc.Arbitrary<EmbeddedLanguageBlockNode> {
  return fc
    .tuple(
      fc.oneof(fc.constant('mata:'), fc.constant('python:')),
      fc.stringMatching(/^[^]*$/)
    )
    .map(([my_start_cmd, my_content]) => {
      const my_language = my_start_cmd.includes('mata') ? 'mata' : 'python';

      return {
        type: 'embedded_block',
        language: my_language,
        start_command: my_start_cmd,
        end_command: undefined,
        content: my_content,
        content_range: make_range(0, my_start_cmd.length, 0, my_start_cmd.length + my_content.length),
        is_single_line: true,
        range: make_range(0, 0, 0, my_start_cmd.length + my_content.length),
      };
    });
}

/**
 * Generate any valid Stata AST node.
 */
export function arbitrary_stata_node(): fc.Arbitrary<StataNode> {
  return fc.oneof(
    arbitrary_command_node(),
    arbitrary_macro_def_node(),
    arbitrary_program_node(),
    arbitrary_if_node(),
    arbitrary_foreach_node(),
    arbitrary_forvalues_node(),
    arbitrary_while_node(),
    arbitrary_string_literal_node(),
    arbitrary_directive_node(),
    arbitrary_embedded_block_node()
  );
}

/**
 * Generate a valid Stata AST (collection of nodes).
 */
export function arbitrary_stata_ast(): fc.Arbitrary<StataNode[]> {
  return fc.array(arbitrary_stata_node(), { maxLength: 5 });
}
