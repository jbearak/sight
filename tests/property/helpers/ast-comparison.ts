/**
 * AST comparison utilities for property-based testing.
 * Compares ASTs ignoring source ranges, which may differ after formatting.
 */

import { StataNode, StataAST, CommandNode, ProgramNode, MacroDefNode, ControlFlowNode, StringLiteralNode, DirectiveNode, EmbeddedLanguageBlockNode, TriviaNode } from '../../src/types';

/**
 * Compare two ASTs for equivalence, ignoring source ranges.
 * Two ASTs are equivalent if they have identical node structure, token content,
 * and trivia content.
 */
export function ast_equivalent(my_ast_a: StataAST, my_ast_b: StataAST): boolean {
  if (my_ast_a.nodes.length !== my_ast_b.nodes.length) {
    return false;
  }

  for (let my_i = 0; my_i < my_ast_a.nodes.length; my_i++) {
    if (!nodes_equal(my_ast_a.nodes[my_i], my_ast_b.nodes[my_i])) {
      return false;
    }
  }

  return true;
}

/**
 * Deep equality check ignoring ranges.
 * Recursively compares all properties except range information.
 */
export function deep_equal_ignoring_ranges(my_a: any, my_b: any): boolean {
  // Handle null/undefined
  if (my_a === null || my_a === undefined) {
    return my_b === null || my_b === undefined;
  }
  if (my_b === null || my_b === undefined) {
    return false;
  }

  // Handle primitives
  if (typeof my_a !== 'object' || typeof my_b !== 'object') {
    return my_a === my_b;
  }

  // Handle arrays
  if (Array.isArray(my_a) && Array.isArray(my_b)) {
    if (my_a.length !== my_b.length) {
      return false;
    }
    for (let my_i = 0; my_i < my_a.length; my_i++) {
      if (!deep_equal_ignoring_ranges(my_a[my_i], my_b[my_i])) {
        return false;
      }
    }
    return true;
  }

  // Handle objects
  if (Array.isArray(my_a) !== Array.isArray(my_b)) {
    return false;
  }

  const my_keys_a = Object.keys(my_a).filter(k => k !== 'range');
  const my_keys_b = Object.keys(my_b).filter(k => k !== 'range');

  if (my_keys_a.length !== my_keys_b.length) {
    return false;
  }

  for (const my_key of my_keys_a) {
    if (!my_keys_b.includes(my_key)) {
      return false;
    }
    if (!deep_equal_ignoring_ranges(my_a[my_key], my_b[my_key])) {
      return false;
    }
  }

  return true;
}

/**
 * Compare two nodes for equality, ignoring ranges.
 */
export function nodes_equal(my_node_a: StataNode, my_node_b: StataNode): boolean {
  if (my_node_a.type !== my_node_b.type) {
    return false;
  }

  switch (my_node_a.type) {
    case 'command':
      return command_nodes_equal(
        my_node_a as CommandNode,
        my_node_b as CommandNode
      );
    case 'program':
      return program_nodes_equal(
        my_node_a as ProgramNode,
        my_node_b as ProgramNode
      );
    case 'macro_def':
      return macro_def_nodes_equal(
        my_node_a as MacroDefNode,
        my_node_b as MacroDefNode
      );
    case 'if':
    case 'else':
    case 'foreach':
    case 'forvalues':
    case 'while':
      return control_flow_nodes_equal(
        my_node_a as ControlFlowNode,
        my_node_b as ControlFlowNode
      );
    case 'string':
      return string_literal_nodes_equal(
        my_node_a as StringLiteralNode,
        my_node_b as StringLiteralNode
      );
    case 'directive':
      return directive_nodes_equal(
        my_node_a as DirectiveNode,
        my_node_b as DirectiveNode
      );
    case 'embedded_block':
      return embedded_block_nodes_equal(
        my_node_a as EmbeddedLanguageBlockNode,
        my_node_b as EmbeddedLanguageBlockNode
      );
    default:
      return deep_equal_ignoring_ranges(my_node_a, my_node_b);
  }
}

function command_nodes_equal(my_a: CommandNode, my_b: CommandNode): boolean {
  if (my_a.name !== my_b.name || my_a.fullName !== my_b.fullName) {
    return false;
  }

  // Compare prefixes
  if ((my_a.prefix?.length ?? 0) !== (my_b.prefix?.length ?? 0)) {
    return false;
  }
  if (my_a.prefix && my_b.prefix) {
    for (let my_i = 0; my_i < my_a.prefix.length; my_i++) {
      if (
        my_a.prefix[my_i].name !== my_b.prefix[my_i].name ||
        my_a.prefix[my_i].fullName !== my_b.prefix[my_i].fullName
      ) {
        return false;
      }
    }
  }

  // Compare varlists
  if ((my_a.varlist?.length ?? 0) !== (my_b.varlist?.length ?? 0)) {
    return false;
  }
  if (my_a.varlist && my_b.varlist) {
    for (let my_i = 0; my_i < my_a.varlist.length; my_i++) {
      if (my_a.varlist[my_i].name !== my_b.varlist[my_i].name) {
        return false;
      }
    }
  }

  // Compare options
  if ((my_a.options?.length ?? 0) !== (my_b.options?.length ?? 0)) {
    return false;
  }
  if (my_a.options && my_b.options) {
    for (let my_i = 0; my_i < my_a.options.length; my_i++) {
      if (
        my_a.options[my_i].name !== my_b.options[my_i].name ||
        my_a.options[my_i].argument !== my_b.options[my_i].argument
      ) {
        return false;
      }
    }
  }

  // Compare trivia
  return trivia_equal(my_a.leadingTrivia, my_b.leadingTrivia) &&
    trivia_equal(my_a.blockEndingTrivia, my_b.blockEndingTrivia) &&
    trivia_equal(my_a.trailingTrivia, my_b.trailingTrivia);
}

function program_nodes_equal(my_a: ProgramNode, my_b: ProgramNode): boolean {
  if (my_a.name !== my_b.name) {
    return false;
  }

  if (my_a.body.length !== my_b.body.length) {
    return false;
  }

  for (let my_i = 0; my_i < my_a.body.length; my_i++) {
    if (!nodes_equal(my_a.body[my_i], my_b.body[my_i])) {
      return false;
    }
  }

  return trivia_equal(my_a.leadingTrivia, my_b.leadingTrivia) &&
    trivia_equal(my_a.blockEndingTrivia, my_b.blockEndingTrivia) &&
    trivia_equal(my_a.trailingTrivia, my_b.trailingTrivia);
}

function macro_def_nodes_equal(my_a: MacroDefNode, my_b: MacroDefNode): boolean {
  return (
    my_a.scope === my_b.scope &&
    my_a.name === my_b.name &&
    my_a.value === my_b.value &&
    trivia_equal(my_a.leadingTrivia, my_b.leadingTrivia) &&
    trivia_equal(my_a.trailingTrivia, my_b.trailingTrivia)
  );
}

function control_flow_nodes_equal(my_a: ControlFlowNode, my_b: ControlFlowNode): boolean {
  if (
    my_a.type !== my_b.type ||
    my_a.condition !== my_b.condition ||
    my_a.loopVar !== my_b.loopVar ||
    my_a.loopSpec !== my_b.loopSpec
  ) {
    return false;
  }

  if (my_a.body.length !== my_b.body.length) {
    return false;
  }

  for (let my_i = 0; my_i < my_a.body.length; my_i++) {
    if (!nodes_equal(my_a.body[my_i], my_b.body[my_i])) {
      return false;
    }
  }

  return trivia_equal(my_a.leadingTrivia, my_b.leadingTrivia) &&
    trivia_equal(my_a.blockEndingTrivia, my_b.blockEndingTrivia) &&
    trivia_equal(my_a.trailingTrivia, my_b.trailingTrivia);
}

function string_literal_nodes_equal(my_a: StringLiteralNode, my_b: StringLiteralNode): boolean {
  return (
    my_a.quoteStyle === my_b.quoteStyle &&
    my_a.value === my_b.value
  );
}

function directive_nodes_equal(my_a: DirectiveNode, my_b: DirectiveNode): boolean {
  return (
    my_a.directive === my_b.directive &&
    my_a.mode === my_b.mode &&
    trivia_equal(my_a.leadingTrivia, my_b.leadingTrivia) &&
    trivia_equal(my_a.trailingTrivia, my_b.trailingTrivia)
  );
}

function embedded_block_nodes_equal(my_a: EmbeddedLanguageBlockNode, my_b: EmbeddedLanguageBlockNode): boolean {
  return (
    my_a.language === my_b.language &&
    my_a.start_command === my_b.start_command &&
    my_a.end_command === my_b.end_command &&
    my_a.content === my_b.content &&
    my_a.is_single_line === my_b.is_single_line &&
    trivia_equal(my_a.leadingTrivia, my_b.leadingTrivia) &&
    trivia_equal(my_a.trailingTrivia, my_b.trailingTrivia)
  );
}

function trivia_equal(my_a: TriviaNode[] | undefined, my_b: TriviaNode[] | undefined): boolean {
  if ((my_a?.length ?? 0) !== (my_b?.length ?? 0)) {
    return false;
  }

  if (!my_a || !my_b) {
    return true;
  }

  for (let my_i = 0; my_i < my_a.length; my_i++) {
    if (
      my_a[my_i].type !== my_b[my_i].type ||
      my_a[my_i].style !== my_b[my_i].style ||
      my_a[my_i].content !== my_b[my_i].content
    ) {
      return false;
    }
  }

  return true;
}
