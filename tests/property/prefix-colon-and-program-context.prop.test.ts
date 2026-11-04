import { describe, it, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { StataParser } from '../../src/parser';
import { StataLexer } from '../../src/lexer';

describe('Prefix Colon and Program Context Property Tests', () => {
  let my_parser: StataParser;
  let my_lexer: StataLexer;

  beforeEach(() => {
    my_parser = new StataParser();
    my_lexer = new StataLexer();
  });

  function parseCode(source: string) {
    const lex_result = my_lexer.tokenize(source);
    return my_parser.parse(lex_result.tokens);
  }

  /**
   * Property 1: Prefix commands with colons parse without errors
   * Feature: prefix-colon-and-program-context, Property 1
   * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5
   */
  it('should parse prefix commands with colons without errors', () => {
    const prefixGen = fc.constantFrom('quietly', 'capture', 'noisily', 'qui', 'cap', 'noi');
    const commandGen = fc.constantFrom('summarize', 'regress', 'generate', 'replace', 'drop');
    
    fc.assert(fc.property(prefixGen, commandGen, (prefix, command) => {
      const source = `${prefix}: ${command} var1`;
      const result = parseCode(source);
      
      return result.errors.length === 0 && 
             result.ast.nodes.length > 0 &&
             result.ast.nodes[0].type === 'command';
    }), { numRuns: 100 });
  });

  /**
   * Property 2: Statement keywords after command names are treated as identifiers
   * Feature: prefix-colon-and-program-context, Property 2
   */
  it('should treat statement keywords after commands as identifiers', () => {
    const commandGen = fc.constantFrom('summarize', 'regress', 'generate', 'replace');
    // Exclude 'if' and 'in' since these are legitimate qualifiers after commands
    const keywordGen = fc.constantFrom('program', 'local', 'global', 'foreach', 'forvalues', 'while');
    
    fc.assert(fc.property(commandGen, keywordGen, (command, keyword) => {
      const source = `${command} ${keyword}`;
      const result = parseCode(source);
      
      return result.errors.length === 0 && 
             result.ast.nodes.length === 1 &&
             result.ast.nodes[0].type === 'command';
    }), { numRuns: 100 });
  });

  /**
   * Property 3: Prefix commands followed by statement keywords parse
   * without errors. `program` stays a command; `local` and `global`
   * become macro definitions that keep the prefix, because
   * `capture local x 1` defines `x`.
   * Feature: prefix-colon-and-program-context, Property 3
   * Validates: Requirements 3.3, 3.5
   */
  it('should parse prefix commands followed by statement keywords without errors', () => {
    const prefixGen = fc.constantFrom('quietly', 'capture', 'noisily', 'qui', 'cap', 'noi');
    const keywordGen = fc.constantFrom('program', 'local', 'global');
    const colonGen = fc.constantFrom('', ':');

    fc.assert(fc.property(prefixGen, keywordGen, colonGen, (prefix, keyword, colon) => {
      const source = `${prefix}${colon} ${keyword} arg1`;
      const result = parseCode(source);
      if (result.errors.length !== 0 || result.ast.nodes.length !== 1) {
        return false;
      }
      const node = result.ast.nodes[0];
      if (keyword === 'program') {
        return node.type === 'command' && node.name === 'program';
      }
      return node.type === 'macro_def' &&
             node.scope === keyword &&
             node.name === 'arg1' &&
             node.prefix?.[0]?.name === prefix;
    }), { numRuns: 100 });
  });
});