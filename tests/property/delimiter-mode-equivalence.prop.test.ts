/**
 * Property test: `#delimit cr` and `#delimit ;` must parse to equivalent ASTs.
 *
 * Feature: delimiter-mode reconstruction parity (issue #306)
 *
 * The root cause of the #306 bug class is that the lexer emits WHITESPACE
 * tokens in `#delimit ;` mode that `#delimit cr` mode elides. Many parser
 * methods reconstruct string-valued AST fields (expressions, if/in qualifiers,
 * parenthesized groups, option arguments, loop specs, macro values, conditions)
 * from the token stream, and any that depend on WHITESPACE-token presence
 * diverge between the two modes for identical source.
 *
 * This property encodes the invariant the fix must uphold: for the same command
 * text, parsing it in `#delimit cr` mode and in `#delimit ;` mode must produce
 * the same AST (ignoring source ranges and the `#delimit` directive nodes that
 * bracket the semicolon-mode wrapper) and the same set of diagnostics. It is the
 * executable oracle for the whole class — a single generated counter-example
 * catches any reconstruction site that still diverges by delimiter mode.
 */

import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { StataParser } from '../../src/parser';
import { StataLexer } from '../../src/lexer';
import { StataNode } from '../../src/types';

function parse(source: string) {
  const lexer = new StataLexer();
  const parser = new StataParser();
  return parser.parse(lexer.tokenize(source).tokens);
}

// Nodes present only because of the semicolon-mode wrapper; excluded from the
// cross-mode comparison.
// The `comment` wrapper currently covers only generated `#delimit` artifacts.
// If this generator starts emitting real source comments, narrow this filter to
// directive-line ranges so genuine comment AST differences remain visible.
const WRAPPER_TYPES = new Set(['directive', 'comment']);

function content_nodes(nodes: StataNode[]): StataNode[] {
  return nodes.filter(n => !WRAPPER_TYPES.has(n.type));
}

// Canonicalize nodes for comparison: sort keys and drop every position-bearing
// field (`range`, `argument_range`, `syntaxRanges`) — those legitimately differ
// because the semicolon-mode wrapper shifts the command onto a later line. What
// must match across modes is the structural + string content, which is what
// #306 governs.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (value !== null && typeof value === 'object') {
    const the_result: Record<string, unknown> = {};
    for (const my_key of Object.keys(value as Record<string, unknown>).sort()) {
      if (
        my_key === 'range' ||
        my_key === 'argument_range' ||
        my_key === 'syntaxRanges'
      ) {
        continue;
      }
      the_result[my_key] = canonical((value as Record<string, unknown>)[my_key]);
    }
    return the_result;
  }
  return value;
}

function error_codes(result: ReturnType<StataParser['parse']>): string[] {
  return result.errors.map(e => String(e.code)).sort();
}

// Spacing variants injected between tokens: none, one, or several spaces/tabs.
// Where whitespace is optional (around operators, commas, parens) all three are
// valid; where a separator is required (between a command and its varlist) we
// use `sep` to keep at least one space.
const gap = fc.constantFrom('', ' ', '  ', '\t');
const sep = fc.constantFrom(' ', '  ', ' \t ');

const identifier = fc.constantFrom('a', 'b', 'x', 'y', 'z', 'foo', 'bar', 'v1', 'v2');
const number = fc.constantFrom('0', '1', '2', '10', '3.14');
const binop = fc.constantFrom('+', '-', '*', '/', '==', '!=', '>', '<', '>=', '&', '|');
const term = fc.oneof(identifier, number);
type RenderedFuncArg = [string, string];

function render_func_call(
  fn: string,
  args: RenderedFuncArg[],
  trailing: string
): string {
  const first = args[0];
  const rest = args.slice(1);
  const inner = first === undefined
    ? ''
    : [
        first[1],
        ...rest.map(([comma_gap, t]) => `${comma_gap},${comma_gap}${t}`),
      ].join('');
  return `${fn}(${trailing}${inner}${trailing})`;
}

// `term (op term){0,2}`, e.g. `a`, `a + b`, `x*2 > y`.
const expression = fc
  .tuple(
    term,
    fc.array(fc.tuple(gap, binop, gap, term), { maxLength: 2 })
  )
  .map(([head, rest]) =>
    head + rest.map(([g1, op, g2, t]) => `${g1}${op}${g2}${t}`).join('')
  );

// A function call like `inrange(a, 1, 10)` with varied spacing.
const func_call = fc
  .tuple(
    fc.constantFrom('inrange', 'cond', 'max', 'group'),
    fc.array(fc.tuple(gap, term), { minLength: 1, maxLength: 3 }),
    gap
  )
  .map(([fn, args, trailing]) => render_func_call(fn, args, trailing));

const assignment_command = fc
  .tuple(
    fc.constantFrom('gen', 'generate', 'egen', 'replace'),
    sep,
    identifier,
    gap,
    gap,
    fc.oneof(expression, func_call)
  )
  .map(([cmd, s1, v, g1, g2, rhs]) => `${cmd}${s1}${v}${g1}=${g2}${rhs}`);

const if_command = fc
  .tuple(
    fc.constantFrom('keep', 'drop', 'list', 'summarize'),
    sep,
    fc.array(identifier, { minLength: 1, maxLength: 3 }),
    sep,
    fc.oneof(expression, func_call)
  )
  .map(([cmd, s1, vars, s2, cond]) => `${cmd}${s1}${vars.join(' ')} if${s2}${cond}`);

const option_command = fc
  .tuple(
    sep,
    fc.array(identifier, { minLength: 1, maxLength: 2 }),
    gap,
    fc.constantFrom('absorb', 'cluster', 'by'),
    gap,
    fc.array(identifier, { minLength: 1, maxLength: 3 }),
    gap
  )
  .map(([s1, vars, g1, opt, g2, args, g3]) =>
    `reg${s1}${vars.join(' ')},${g1}${opt}(${g2}${args.join(' ')}${g3})`
  );

const paren_group_command = fc
  .tuple(sep, identifier, sep, gap, number, gap, gap, number, gap)
  .map(([s1, v, s2, g1, lo, g2, g3, hi, g4]) =>
    `recode${s1}${v}${s2}(${g1}${lo}/${g2}${hi}${g3}=${g4}${hi})`
  );

const macro_command = fc
  .tuple(fc.constantFrom('local', 'global'), sep, identifier, gap, gap, expression)
  .map(([scope, s1, name, g1, g2, val]) => `${scope}${s1}${name}${g1}=${g2}${val}`);

const command_source = fc.oneof(
  assignment_command,
  if_command,
  option_command,
  paren_group_command,
  macro_command
);

type DelimiterMode = 'cr' | 'semicolon';

type Statement =
  | { kind: 'simple'; body: string }
  | { kind: 'simple_pair'; cr_body: string; semi_body: string }
  | { kind: 'brace_block'; header: string; open_gap: string; body: Statement[] }
  | {
      kind: 'if_else';
      keyword_sep: string;
      condition: string;
      open_gap: string;
      else_gap: string;
      if_body: Statement[];
      else_body: Statement[];
    }
  | { kind: 'program'; name: string; syntax: string; body: Statement[] };

interface SourcePair {
  label: string;
  cr: string;
  semi: string;
}

function terminator(mode: DelimiterMode): string {
  return mode === 'semicolon' ? ';' : '';
}

function indent(source: string): string {
  return source
    .split('\n')
    .map(line => line.length > 0 ? `  ${line}` : line)
    .join('\n');
}

function render_statement_list(
  statements: Statement[],
  mode: DelimiterMode
): string {
  return statements.map(statement => render_statement(statement, mode)).join('\n');
}

function render_statement(statement: Statement, mode: DelimiterMode): string {
  switch (statement.kind) {
    case 'simple':
      return `${statement.body}${terminator(mode)}`;
    case 'simple_pair': {
      const body = mode === 'semicolon' ? statement.semi_body : statement.cr_body;
      return `${body}${terminator(mode)}`;
    }
    case 'brace_block': {
      const opener = mode === 'semicolon'
        ? `${statement.header}${statement.open_gap}{;`
        : `${statement.header}${statement.open_gap}{`;
      const closer = mode === 'semicolon' ? '};' : '}';
      return [
        opener,
        indent(render_statement_list(statement.body, mode)),
        closer,
      ].join('\n');
    }
    case 'if_else': {
      const if_opener = mode === 'semicolon'
        ? `if${statement.keyword_sep}${statement.condition}${statement.open_gap}{;`
        : `if${statement.keyword_sep}${statement.condition}${statement.open_gap}{`;
      const else_opener = mode === 'semicolon'
        ? `else${statement.else_gap}{;`
        : `else${statement.else_gap}{`;
      const closer = mode === 'semicolon' ? '};' : '}';
      return [
        if_opener,
        indent(render_statement_list(statement.if_body, mode)),
        closer,
        else_opener,
        indent(render_statement_list(statement.else_body, mode)),
        closer,
      ].join('\n');
    }
    case 'program': {
      return [
        `program define ${statement.name}${terminator(mode)}`,
        indent(`${statement.syntax}${terminator(mode)}`),
        indent(render_statement_list(statement.body, mode)),
        `end${terminator(mode)}`,
      ].join('\n');
    }
  }
}

function render_source_pair(label: string, statements: Statement[]): SourcePair {
  return {
    label,
    cr: render_statement_list(statements, 'cr'),
    semi: `#delimit ;\n${render_statement_list(statements, 'semicolon')}`,
  };
}

const simple_statement_body = fc.oneof(
  command_source,
  fc
    .tuple(sep, identifier, gap, gap, gap, expression)
    .map(([s1, byvar, g1, g2, g3, rhs]) => `by${s1}${byvar}${g1}:${g2}gen x${g3}=${g3}${rhs}`),
  fc
    .tuple(sep, identifier, gap, gap, gap, expression)
    .map(([s1, byvar, g1, g2, g3, rhs]) => `bysort${s1}${byvar}${g1}:${g2}gen x${g3}=${g3}${rhs}`),
  fc
    .tuple(gap, gap, sep, gap, gap, expression)
    .map(([g1, g2, s1, g3, g4, rhs]) => `quietly${g1}:${g2}replace${s1}y${g3}=${g4}${rhs}`),
  fc.constantFrom(
    'frame create analysis',
    'frame change default',
    'gen lag_x = x[_n-1]',
    'gen s = "plain string"',
    'gen t = "value `foo\'"',
    'local quoted = "value `foo\'"',
    'local compound = `"hello `foo\'"\'',
    'local n : word count a b c',
    'local joined = a///\nb',
    'local indented = a///\n    b',
    'local spaced = a ///\nb',
    'gen continued = a///\nb',
    'gen continued_spaced = a ///\nb'
  )
);

const gratuitous_newline_statement = fc.constantFrom<Statement>(
  {
    kind: 'simple_pair',
    cr_body: 'gen z = x + y',
    semi_body: 'gen z = x\n  + y',
  },
  {
    kind: 'simple_pair',
    cr_body: 'reg y x, absorb(firm year)',
    semi_body: 'reg y\n  x, absorb(firm\nyear)',
  },
  {
    kind: 'simple_pair',
    cr_body: 'local n : word count a b c',
    semi_body: 'local n : word\n  count a\n  b c',
  },
  {
    kind: 'simple_pair',
    cr_body: 'bysort id: gen x = 1',
    semi_body: 'bysort id:\n  gen x = 1',
  },
  {
    kind: 'simple_pair',
    cr_body: 'keep if x > 0',
    semi_body: 'keep if x\n  > 0',
  }
);

const block_body_statement = fc.oneof(
  fc.constant<Statement>({ kind: 'simple', body: 'display "inside"' }),
  fc.constant<Statement>({ kind: 'simple', body: 'gen y = x[_n-1]' }),
  fc.constant<Statement>({ kind: 'simple', body: 'local n : word count a b c' }),
  fc
    .tuple(gap, gap, sep, gap, gap)
    .map(([g1, g2, s1, g3, g4]): Statement => ({
      kind: 'simple',
      body: `quietly${g1}:${g2}replace${s1}y${g3}=${g4}x + 1`,
    }))
);

const loop_statement = fc
  .tuple(
    fc.oneof(
      fc
        .tuple(sep, sep, sep, sep, sep)
        .map(([s1, s2, s3, s4, s5]) => `foreach${s1}i${s2}in${s3}a${s4}b${s5}c`),
      fc
        .tuple(sep, gap, gap, gap, gap)
        .map(([s1, g1, g2, g3, g4]) => `forvalues${s1}i${g1}=${g2}1${g3}/${g4}3`)
    ),
    sep,
    fc.array(block_body_statement, { minLength: 1, maxLength: 3 })
  )
  .map(([header, open_gap, body]): Statement => ({
    kind: 'brace_block',
    header,
    open_gap,
    body,
  }));

const while_condition = fc.oneof(
  fc.tuple(identifier, gap, binop, gap, term).map(([left, g1, op, g2, right]) =>
    `${left}${g1}${op}${g2}${right}`
  ),
  fc.constantFrom('a///\nb', 'a ///\nb')
);

const while_statement = fc
  .tuple(
    sep,
    while_condition,
    sep,
    fc.array(block_body_statement, { minLength: 1, maxLength: 2 })
  )
  .map(([s1, condition, open_gap, body]): Statement => ({
    kind: 'brace_block',
    header: `while${s1}${condition}`,
    open_gap,
    body,
  }));

const if_condition = fc.oneof(
  fc.tuple(identifier, gap, binop, gap, term).map(([left, g1, op, g2, right]) =>
    `${left}${g1}${op}${g2}${right}`
  ),
  fc.tuple(identifier, gap, gap, gap, binop, gap, term).map(([name, g1, g2, g3, op, g4, right]) =>
    `${name}[${g1}_n${g2}-${g3}1]${g4}${op}${g4}${right}`
  ),
  fc.constantFrom('a///\nb', 'a ///\nb')
);

const if_else_statement = fc
  .tuple(
    sep,
    if_condition,
    sep,
    sep,
    fc.array(block_body_statement, { minLength: 1, maxLength: 2 }),
    fc.array(block_body_statement, { minLength: 1, maxLength: 2 })
  )
  .map(([keyword_sep, condition, open_gap, else_gap, if_body, else_body]): Statement => ({
    kind: 'if_else',
    keyword_sep,
    condition,
    open_gap,
    else_gap,
    if_body,
    else_body,
  }));

const frame_block_statement = fc
  .tuple(
    sep,
    sep,
    fc.array(block_body_statement, { minLength: 1, maxLength: 3 })
  )
  .map(([s1, open_gap, body]): Statement => ({
    kind: 'brace_block',
    header: `frame${s1}analysis`,
    open_gap,
    body,
  }));

const nested_block_statement = fc
  .tuple(
    sep,
    gap,
    gap,
    gap,
    gap,
    sep,
    sep,
    if_condition
  )
  .map(([for_sep, eq_left, eq_right, slash_left, slash_right, outer_open, inner_open, condition]): Statement => ({
    kind: 'brace_block',
    header: `forvalues${for_sep}i${eq_left}=${eq_right}1${slash_left}/${slash_right}3`,
    open_gap: outer_open,
    body: [
      {
        kind: 'if_else',
        keyword_sep: ' ',
        condition,
        open_gap: inner_open,
        else_gap: ' ',
        if_body: [{ kind: 'simple', body: 'display "positive"' }],
        else_body: [{ kind: 'simple', body: 'display `"not positive"\'' }],
      },
    ],
  }));

const syntax_declaration = fc.oneof(
  fc
    .tuple(sep, sep, gap, gap, gap, gap, sep, gap, gap, gap)
    .map(([s1, s2, opt_open, opt_inner, default_open, default_inner, value_sep, default_close, opt_close, cluster_open]) =>
      `syntax${s1}varlist,${s2}opt${opt_open}(${opt_inner}string default${default_open}(${default_inner}a${value_sep}b${default_close})${opt_close}) cluster${cluster_open}(varname)`
    ),
  fc
    .tuple(sep, sep, gap, gap, gap, gap, gap, gap)
    .map(([s1, s2, label_open, label_inner, default_open, default_inner, default_close, label_close]) =>
      `syntax${s1},${s2}flag(integer) label${label_open}(${label_inner}string default${default_open}(${default_inner}\`"hello \`foo'"'${default_close})${label_close})`
    )
);

const program_statement = fc
  .tuple(
    fc.constantFrom('p', 'build_vars', 'summarize_sample'),
    syntax_declaration,
    fc.array(block_body_statement, { minLength: 1, maxLength: 3 })
  )
  .map(([name, syntax, body]): Statement => ({
    kind: 'program',
    name,
    syntax,
    body,
  }));

const top_level_simple_statement = simple_statement_body.map(
  (body): Statement => ({ kind: 'simple', body })
);

const structured_statement = fc.oneof(
  top_level_simple_statement,
  gratuitous_newline_statement,
  loop_statement,
  while_statement,
  if_else_statement,
  frame_block_statement,
  nested_block_statement,
  program_statement
);

const structured_source_pair = fc.oneof(
  structured_statement.map(statement =>
    render_source_pair(statement.kind, [statement])
  ),
  fc
    .array(structured_statement, { minLength: 2, maxLength: 4 })
    .map(statements => render_source_pair('statement_list', statements))
);

// Embedded Mata/Python shapes are intentionally not part of this oracle. The
// embedded lexer path preserves embedded whitespace, but newlines are still
// delimiter-sensitive tokens (`STATEMENT_TERMINATOR` in cr mode and WHITESPACE
// in semicolon mode). A cross-mode render would therefore compare Stata
// delimiter mechanics inside a non-Stata body rather than a semantically
// well-defined pair of equivalent embedded programs.

describe('delimiter-mode reconstruction parity (issue #306)', () => {
  it('function-call generator renders drawn comma gaps', () => {
    expect(render_func_call('max', [['', 'a'], ['', 'b']], '')).toBe('max(a,b)');
    expect(render_func_call('max', [['', 'a'], ['  ', 'b']], '')).toBe(
      'max(a  ,  b)'
    );
    expect(render_func_call('max', [['', 'a'], ['\t', 'b']], '')).toBe(
      'max(a\t,\tb)'
    );
  });

  it('parses identically in #delimit cr and #delimit ; modes', () => {
    fc.assert(
      fc.property(command_source, body => {
        const cr = parse(body);
        const semi = parse(`#delimit ;\n${body};\n#delimit cr`);

        // Same diagnostics (by code) regardless of delimiter mode.
        expect(error_codes(semi)).toEqual(error_codes(cr));

        // Same command AST, ignoring ranges and the #delimit wrapper nodes.
        const cr_nodes = canonical(content_nodes(cr.ast.nodes));
        const semi_nodes = canonical(content_nodes(semi.ast.nodes));
        expect(JSON.stringify(semi_nodes)).toBe(JSON.stringify(cr_nodes));
      }),
      { numRuns: 2000 }
    );
  });

  it('parses generated structured sources identically in both delimiter modes', () => {
    fc.assert(
      fc.property(structured_source_pair, pair => {
        const cr = parse(pair.cr);
        const semi = parse(pair.semi);

        // Same diagnostics (by code) regardless of delimiter mode.
        expect(error_codes(semi)).toEqual(error_codes(cr));

        // Same command AST, ignoring ranges and the #delimit wrapper node.
        const cr_nodes = canonical(content_nodes(cr.ast.nodes));
        const semi_nodes = canonical(content_nodes(semi.ast.nodes));
        expect(JSON.stringify(semi_nodes)).toBe(JSON.stringify(cr_nodes));
      }),
      { numRuns: 800 }
    );
  });
});
