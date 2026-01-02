import { describe, test, expect, beforeEach } from 'bun:test';
import { StataParser } from '../../src/parser';
import { StataLexer } from '../../src/lexer';

describe('Prefix Colon and Program Context Fixes', () => {
  let parser: StataParser;
  let lexer: StataLexer;

  beforeEach(() => {
    parser = new StataParser();
    lexer = new StataLexer();
  });

  // Helper function
  function parseCode(source: string) {
    const lex_result = lexer.tokenize(source);
    return parser.parse(lex_result.tokens);
  }

  describe('prefix commands followed by statement keywords', () => {
    test('capture program drop myprogram parses without error', () => {
      const parse_result = parseCode('capture program drop myprogram');
      expect(parse_result.errors).toHaveLength(0);
    });

    test('quietly program drop myprogram parses without error', () => {
      const parse_result = parseCode('quietly program drop myprogram');
      expect(parse_result.errors).toHaveLength(0);
    });

    test('capture program define myprogram parses as prefixed command', () => {
      const parse_result = parseCode('capture program define myprogram');
      expect(parse_result.errors).toHaveLength(0);
    });
  });

  describe('prefix commands with colons', () => {
    test('quietly: display "hello" parses without error', () => {
      const parse_result = parseCode('quietly: display "hello"');
      expect(parse_result.errors).toHaveLength(0);
    });

    test('capture: gen x = 1 parses without error', () => {
      const parse_result = parseCode('capture: gen x = 1');
      expect(parse_result.errors).toHaveLength(0);
    });

    test('noisily: display "test" parses without error', () => {
      const parse_result = parseCode('noisily: display "test"');
      expect(parse_result.errors).toHaveLength(0);
    });

    test('abbreviated forms: qui:, cap:, noi:', () => {
      expect(parseCode('qui: display "test"').errors).toHaveLength(0);
      expect(parseCode('cap: gen x = 1').errors).toHaveLength(0);
      expect(parseCode('noi: display "test"').errors).toHaveLength(0);
    });

    test('chained prefixes: quietly: capture: display "test"', () => {
      const parse_result = parseCode('quietly: capture: display "test"');
      expect(parse_result.errors).toHaveLength(0);
    });
  });

  describe('statement keywords as identifiers', () => {
    test('getmata (program survey level datasig)=aww_datasigs parses without error', () => {
      const parse_result = parseCode('getmata (program survey level datasig)=aww_datasigs');
      expect(parse_result.errors).toHaveLength(0);
    });

    test('gen program = 1 parses without error', () => {
      const parse_result = parseCode('gen program = 1');
      expect(parse_result.errors).toHaveLength(0);
    });

    test('replace program = 2 parses without error', () => {
      const parse_result = parseCode('replace program = 2');
      expect(parse_result.errors).toHaveLength(0);
    });
  });
});