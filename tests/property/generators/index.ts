/**
 * Generator infrastructure for property-based testing.
 * Re-exports all primitive, AST node, and document generators.
 */

// Primitive generators
export {
  arbitrary_identifier,
  arbitrary_macro_name,
  arbitrary_variable_name,
  arbitrary_simple_string,
  arbitrary_compound_string,
  arbitrary_number,
  arbitrary_command_name,
  arbitrary_option_name,
  arbitrary_local_macro_ref,
  arbitrary_global_macro_ref,
  arbitrary_comment,
  arbitrary_trailing_comment,
  arbitrary_continuation,
  arbitrary_string_literal,
  arbitrary_varlist,
  arbitrary_numlist,
  RESERVED_QUALIFIER_KEYWORDS,
  arbitrary_non_reserved_identifier,
} from './primitives';

// AST node generators
export {
  arbitrary_command_node,
  arbitrary_option_node,
  arbitrary_macro_def_node,
  arbitrary_program_node,
  arbitrary_if_node,
  arbitrary_foreach_node,
  arbitrary_forvalues_node,
  arbitrary_while_node,
  arbitrary_string_literal_node,
  arbitrary_directive_node,
  arbitrary_embedded_block_node,
  arbitrary_embedded_block_inline_node,
  arbitrary_stata_node,
  arbitrary_stata_ast,
} from './ast-nodes';

// Document generators
export {
  arbitrary_stata_document,
  arbitrary_document_with_macros,
  arbitrary_document_with_programs,
  arbitrary_malformed_document,
  arbitrary_document_with_delimit_switches,
  arbitrary_document_with_continuations,
  arbitrary_document_with_comments,
  arbitrary_document_with_macro_refs,
  arbitrary_document_with_embedded_blocks,
  arbitrary_document_with_abbreviations,
  arbitrary_document_with_definitions,
  arbitrary_document_with_undefined_refs,
  arbitrary_non_hoverable_position,
  arbitrary_document_with_mixed_symbols,
} from './documents';

// Section generators
export {
  arbitrary_section_name,
  arbitrary_delimiter_char,
  arbitrary_delimiter_only_string,
  arbitrary_single_line_section,
  arbitrary_banner_section,
  arbitrary_starred_inline_section,
  arbitrary_numbered_section,
  arbitrary_document_with_sections,
  arbitrary_section_list,
} from './sections';
