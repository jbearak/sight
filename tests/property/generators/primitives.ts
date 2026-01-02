import * as fc from 'fast-check';

/**
 * Primitive value generators for Stata syntax elements.
 * These generators produce valid Stata identifiers, strings, numbers, and other
 * basic building blocks used by higher-level generators.
 */

/**
 * Generate valid Stata identifiers.
 * Rules: Must start with letter or underscore, followed by letters, digits, or underscores.
 * Max length 32 characters (Stata limit).
 */
export function arbitrary_identifier(): fc.Arbitrary<string> {
  const my_first_char = fc.oneof(
    fc.integer({ min: 65, max: 90 }), // A-Z
    fc.integer({ min: 97, max: 122 }), // a-z
    fc.constant(95) // _
  );

  const my_rest_char = fc.oneof(
    fc.integer({ min: 65, max: 90 }), // A-Z
    fc.integer({ min: 97, max: 122 }), // a-z
    fc.integer({ min: 48, max: 57 }), // 0-9
    fc.constant(95) // _
  );

  return fc
    .tuple(my_first_char, fc.array(my_rest_char, { maxLength: 31 }))
    .map(([my_first, my_rest]) => {
      const my_first_str = String.fromCharCode(my_first);
      const my_rest_str = my_rest.map((my_code) => String.fromCharCode(my_code)).join('');
      return my_first_str + my_rest_str;
    });
}

/**
 * Generate valid Stata macro names.
 * Same rules as identifiers.
 */
export function arbitrary_macro_name(): fc.Arbitrary<string> {
  return arbitrary_identifier();
}

/**
 * Generate valid Stata variable names.
 * Same rules as identifiers (case-sensitive).
 */
export function arbitrary_variable_name(): fc.Arbitrary<string> {
  return arbitrary_identifier();
}

/**
 * Generate simple quoted strings (double quotes).
 * In Stata, simple strings use double quotes: "content"
 * Content can be any character except unescaped double quotes, backticks, or $.
 * Backticks and $ start macro references which have special parsing rules.
 */
export function arbitrary_simple_string(): fc.Arbitrary<string> {
  // Generate content that doesn't contain unescaped double quotes, backticks, or $
  const my_content = fc.stringMatching(/^[^"`$]*$/);
  return my_content.map((my_str) => `"${my_str}"`);
}

/**
 * Generate compound quoted strings (backtick-double-quote to open, double-quote-apostrophe to close).
 * In Stata, compound strings use: `"content"'
 * Content can be any character except the closing sequence "', backticks, or $.
 * Backticks and $ start macro references which have special parsing rules.
 */
export function arbitrary_compound_string(): fc.Arbitrary<string> {
  // Generate content that doesn't contain the closing sequence, backticks, or $
  const my_content = fc.stringMatching(/^[^"`$]*$/);
  return my_content.map((my_str) => `\`"${my_str}"'`);
}

/**
 * Generate numeric literals.
 * Supports integers and decimals.
 */
export function arbitrary_number(): fc.Arbitrary<string> {
  return fc.oneof(
    // Integers
    fc.integer({ min: -999999, max: 999999 }).map((my_n) => my_n.toString()),
    // Decimals
    fc
      .tuple(
        fc.integer({ min: -999, max: 999 }),
        fc.integer({ min: 0, max: 999999 })
      )
      .map(([my_int, my_frac]) => `${my_int}.${my_frac}`)
  );
}

/**
 * Generate valid Stata command names.
 * Built-in commands and user-defined commands.
 * Excludes 'local' and 'global' since they require arguments and are
 * handled separately in document generators.
 */
export function arbitrary_command_name(): fc.Arbitrary<string> {
  const my_builtin_commands = [
    'display',
    'gen',
    'replace',
    'drop',
    'keep',
    'sort',
    'list',
    'summarize',
    'regress',
  ];

  return fc.oneof(
    fc.constantFrom(...my_builtin_commands),
    arbitrary_identifier()
  );
}

/**
 * Generate valid Stata option names.
 * Options typically start with a letter and contain letters, digits, underscores.
 */
export function arbitrary_option_name(): fc.Arbitrary<string> {
  return arbitrary_identifier();
}

/**
 * Generate local macro references: `name` or `{name}`
 */
export function arbitrary_local_macro_ref(): fc.Arbitrary<string> {
  return arbitrary_macro_name().map((my_name) =>
    fc.sample(fc.boolean(), 1)[0]
      ? `\`${my_name}'`
      : `\`${my_name}'`
  );
}

/**
 * Generate global macro references: $name or ${name}
 */
export function arbitrary_global_macro_ref(): fc.Arbitrary<string> {
  return arbitrary_macro_name().map((my_name) =>
    fc.sample(fc.boolean(), 1)[0]
      ? `$${my_name}`
      : `\${${my_name}}`
  );
}

/**
 * Generate valid Stata comments.
 * Supports line comments (//, *) and block comments (slash-star slash).
 */
export function arbitrary_comment(): fc.Arbitrary<string> {
  const my_comment_text = fc.stringMatching(/^[^\n]*$/);

  return fc.oneof(
    // Line comment with //
    my_comment_text.map((my_text) => `// ${my_text}`),
    // Line comment with *
    my_comment_text.map((my_text) => `* ${my_text}`),
    // Block comment
    my_comment_text.map((my_text) => `/* ${my_text} */`)
  );
}

/**
 * Generate valid Stata trailing comments (comments that appear after code on a line).
 * Uses // and block comments which are always recognized as comments in any context.
 * Star comments (*) are not used because they may be interpreted as operators
 * when following certain tokens like command names.
 */
export function arbitrary_trailing_comment(): fc.Arbitrary<string> {
  // Use a safer character set that won't create ambiguous sequences
  const my_comment_text = fc.stringMatching(/^[a-zA-Z0-9 _-]*$/);

  return fc.oneof(
    // Line comment with // (always recognized as comment)
    my_comment_text.map((my_text) => `// ${my_text}`),
    // Block comment (always recognized as comment)
    my_comment_text.map((my_text) => `/* ${my_text} */`)
  );
}

/**
 * Generate valid Stata continuation lines (///).
 */
export function arbitrary_continuation(): fc.Arbitrary<string> {
  return fc.constant('///');
}

/**
 * Generate valid Stata string literals (simple or compound).
 */
export function arbitrary_string_literal(): fc.Arbitrary<string> {
  return fc.oneof(
    arbitrary_simple_string(),
    arbitrary_compound_string()
  );
}

/**
 * Generate valid Stata varlist (space-separated variable names).
 */
export function arbitrary_varlist(): fc.Arbitrary<string> {
  return fc
    .array(arbitrary_variable_name(), { minLength: 1, maxLength: 5 })
    .map((my_vars) => my_vars.join(' '));
}

/**
 * Generate valid Stata numlist (space-separated numbers or ranges).
 */
export function arbitrary_numlist(): fc.Arbitrary<string> {
  const my_single_num = arbitrary_number();
  const my_range = fc
    .tuple(arbitrary_number(), arbitrary_number())
    .map(([my_a, my_b]) => `${my_a}/${my_b}`);

  return fc
    .array(fc.oneof(my_single_num, my_range), { minLength: 1, maxLength: 5 })
    .map((my_items) => my_items.join(' '));
}

/**
 * Reserved qualifier keywords that cannot appear as the first identifier
 * after a command. The parser treats these as qualifiers (e.g., `gen in 1/10`
 * parses 'in' as an in-qualifier, not a variable name).
 */
export const RESERVED_QUALIFIER_KEYWORDS = ['if', 'in'];

/**
 * Generate valid Stata identifiers that exclude reserved qualifier keywords.
 * Use this for variable names that appear immediately after a command.
 */
export function arbitrary_non_reserved_identifier(): fc.Arbitrary<string> {
  return arbitrary_identifier().filter(
    (id) => !RESERVED_QUALIFIER_KEYWORDS.includes(id)
  );
}
