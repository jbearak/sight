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
const WRAPPER_TYPES = new Set(['directive', 'comment']);

function content_nodes(nodes: StataNode[]): StataNode[] {
  return nodes.filter(n => !WRAPPER_TYPES.has(n.type));
}

// Canonicalize nodes for comparison: sort keys and drop every position-bearing
// field (`range`, `argument_range`) — those legitimately differ because the
// semicolon-mode wrapper shifts the command onto a later line. What must match
// across modes is the structural + string content, which is what #306 governs.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (value !== null && typeof value === 'object') {
    const the_result: Record<string, unknown> = {};
    for (const my_key of Object.keys(value as Record<string, unknown>).sort()) {
      if (my_key === 'range' || my_key === 'argument_range') {
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
  .map(([fn, args, trailing]) => {
    const inner = args.map(([, t]) => t).join(', ');
    return `${fn}(${trailing}${inner}${trailing})`;
  });

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

describe('delimiter-mode reconstruction parity (issue #306)', () => {
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
});
