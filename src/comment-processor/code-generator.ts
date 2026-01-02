/**
 * Code Generator Module
 *
 * Generates code snippets (templates, documentation, TODO comments) using
 * the preferred comment style.
 */

/**
 * Generates a comment using the preferred style.
 *
 * @param text - The comment text
 * @param style - The preferred comment style
 * @param indent_level - The indentation level (number of spaces)
 * @returns The formatted comment
 */
export function generate_comment(
  text: string,
  style: '//' | '*' | '/* */',
  indent_level: number = 0
): string {
  const my_indent = ' '.repeat(indent_level);

  switch (style) {
    case '//':
      return `${my_indent}// ${text}`;
    case '*':
      return `${my_indent}* ${text}`;
    case '/* */':
      return `${my_indent}/* ${text} */`;
    default:
      return `${my_indent}// ${text}`;
  }
}

/**
 * Generates a multi-line comment block using the preferred style.
 *
 * @param lines - The comment lines
 * @param style - The preferred comment style
 * @param indent_level - The indentation level (number of spaces)
 * @returns The formatted comment block
 */
export function generate_comment_block(
  lines: string[],
  style: '//' | '*' | '/* */',
  indent_level: number = 0
): string {
  const my_indent = ' '.repeat(indent_level);

  if (lines.length === 0) {
    return '';
  }

  if (lines.length === 1) {
    return generate_comment(lines[0], style, indent_level);
  }

  switch (style) {
    case '//':
      // Multiple // comments
      return lines.map(line => `${my_indent}// ${line}`).join('\n');

    case '*':
      // Multiple * comments
      return lines.map(line => `${my_indent}* ${line}`).join('\n');

    case '/* */':
      // Single block comment
      const my_content = lines.join('\n');
      return `${my_indent}/* ${my_content} */`;

    default:
      return lines.map(line => `${my_indent}// ${line}`).join('\n');
  }
}

/**
 * Generates a TODO comment using the preferred style.
 *
 * @param task - The TODO task description
 * @param style - The preferred comment style
 * @param indent_level - The indentation level (number of spaces)
 * @returns The formatted TODO comment
 */
export function generate_todo_comment(
  task: string,
  style: '//' | '*' | '/* */',
  indent_level: number = 0
): string {
  return generate_comment(`TODO: ${task}`, style, indent_level);
}

/**
 * Generates a documentation comment using the preferred style.
 *
 * @param doc_lines - The documentation lines
 * @param style - The preferred comment style
 * @param indent_level - The indentation level (number of spaces)
 * @returns The formatted documentation comment
 */
export function generate_documentation_comment(
  doc_lines: string[],
  style: '//' | '*' | '/* */',
  indent_level: number = 0
): string {
  return generate_comment_block(doc_lines, style, indent_level);
}

/**
 * Generates a program template with documentation using the preferred style.
 *
 * @param program_name - The program name
 * @param description - The program description
 * @param style - The preferred comment style
 * @returns The program template
 */
export function generate_program_template(
  program_name: string,
  description: string,
  style: '//' | '*' | '/* */'
): string {
  const my_doc_comment = generate_documentation_comment(
    [description],
    style,
    0
  );

  return `${my_doc_comment}
program define ${program_name}
    // TODO: Add program implementation
end
`;
}

/**
 * Generates a function template with documentation using the preferred style.
 *
 * @param function_name - The function name
 * @param description - The function description
 * @param style - The preferred comment style
 * @returns The function template
 */
export function generate_function_template(
  function_name: string,
  description: string,
  style: '//' | '*' | '/* */'
): string {
  const my_doc_comment = generate_documentation_comment(
    [description],
    style,
    0
  );

  return `${my_doc_comment}
function ${function_name}() {
    // TODO: Add function implementation
}
`;
}

/**
 * Generates a section header comment using the preferred style.
 *
 * @param section_name - The section name
 * @param style - The preferred comment style
 * @param indent_level - The indentation level (number of spaces)
 * @returns The formatted section header
 */
export function generate_section_header(
  section_name: string,
  style: '//' | '*' | '/* */',
  indent_level: number = 0
): string {
  const my_indent = ' '.repeat(indent_level);
  const my_separator = '='.repeat(section_name.length + 4);

  switch (style) {
    case '//':
      return `${my_indent}// ${my_separator}\n${my_indent}// ${section_name}\n${my_indent}// ${my_separator}`;

    case '*':
      return `${my_indent}* ${my_separator}\n${my_indent}* ${section_name}\n${my_indent}* ${my_separator}`;

    case '/* */':
      return `${my_indent}/* ${my_separator}\n   ${section_name}\n   ${my_separator} */`;

    default:
      return `${my_indent}// ${my_separator}\n${my_indent}// ${section_name}\n${my_indent}// ${my_separator}`;
  }
}
