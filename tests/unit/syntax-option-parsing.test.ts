import { describe, it, expect, beforeEach } from 'bun:test';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { SyntaxNode } from '../../src/types';

describe('Syntax Option Parsing Edge Cases', () => {
  let my_lexer: StataLexer;
  let my_parser: StataParser;

  beforeEach(() => {
    my_lexer = new StataLexer();
    my_parser = new StataParser();
  });

  describe('duplicate option names with different required flags', () => {
    it('should preserve both required and optional versions of same option', () => {
      const my_source = `program define test_prog
syntax , *myopt myopt
end`;

      const my_lex_result = my_lexer.tokenize(my_source);
      const my_parse_result = my_parser.parse(my_lex_result.tokens);

      const my_program = my_parse_result.ast.nodes.find(
        (my_node) => my_node.type === 'program'
      );

      expect(my_program).toBeDefined();
      expect(my_program?.type).toBe('program');

      if (my_program?.type === 'program' && my_program.signature) {
        // Should have 2 options (both preserved)
        expect(my_program.signature.options.length).toBe(2);

        // First option should be required
        expect(my_program.signature.options[0].name.toLowerCase()).toBe('myopt');
        expect(my_program.signature.options[0].isRequired).toBe(true);

        // Second option should be optional
        expect(my_program.signature.options[1].name.toLowerCase()).toBe('myopt');
        expect(my_program.signature.options[1].isRequired).toBe(false);
      }
    });

    it('should preserve multiple duplicates with mixed required flags', () => {
      const my_source = `program define test_prog
syntax , *opt1 opt1 *opt1 opt2 *opt2
end`;

      const my_lex_result = my_lexer.tokenize(my_source);
      const my_parse_result = my_parser.parse(my_lex_result.tokens);

      const my_program = my_parse_result.ast.nodes.find(
        (my_node) => my_node.type === 'program'
      );

      if (my_program?.type === 'program' && my_program.signature) {
        // Should have 5 options (all preserved)
        expect(my_program.signature.options.length).toBe(5);

        // Verify order and flags
        expect(my_program.signature.options[0].name.toLowerCase()).toBe('opt1');
        expect(my_program.signature.options[0].isRequired).toBe(true);

        expect(my_program.signature.options[1].name.toLowerCase()).toBe('opt1');
        expect(my_program.signature.options[1].isRequired).toBe(false);

        expect(my_program.signature.options[2].name.toLowerCase()).toBe('opt1');
        expect(my_program.signature.options[2].isRequired).toBe(true);

        expect(my_program.signature.options[3].name.toLowerCase()).toBe('opt2');
        expect(my_program.signature.options[3].isRequired).toBe(false);

        expect(my_program.signature.options[4].name.toLowerCase()).toBe('opt2');
        expect(my_program.signature.options[4].isRequired).toBe(true);
      }
    });
  });

  describe('isRequired flag correctness', () => {
    it('should set isRequired=true for options prefixed with *', () => {
      const my_source = `program define test_prog
syntax , *required_opt
end`;

      const my_lex_result = my_lexer.tokenize(my_source);
      const my_parse_result = my_parser.parse(my_lex_result.tokens);

      const my_program = my_parse_result.ast.nodes.find(
        (my_node) => my_node.type === 'program'
      );

      if (my_program?.type === 'program' && my_program.signature) {
        expect(my_program.signature.options.length).toBeGreaterThan(0);
        const my_option = my_program.signature.options[0];
        expect(my_option.isRequired).toBe(true);
      }
    });

    it('should set isRequired=false for options without * prefix', () => {
      const my_source = `program define test_prog
syntax , optional_opt
end`;

      const my_lex_result = my_lexer.tokenize(my_source);
      const my_parse_result = my_parser.parse(my_lex_result.tokens);

      const my_program = my_parse_result.ast.nodes.find(
        (my_node) => my_node.type === 'program'
      );

      if (my_program?.type === 'program' && my_program.signature) {
        expect(my_program.signature.options.length).toBeGreaterThan(0);
        const my_option = my_program.signature.options[0];
        expect(my_option.isRequired).toBe(false);
      }
    });

    it('should correctly distinguish isRequired from isOptional', () => {
      const my_source = `program define test_prog
syntax , *required_opt [optional_bracket_opt]
end`;

      const my_lex_result = my_lexer.tokenize(my_source);
      const my_parse_result = my_parser.parse(my_lex_result.tokens);

      const my_program = my_parse_result.ast.nodes.find(
        (my_node) => my_node.type === 'program'
      );

      if (my_program?.type === 'program' && my_program.signature) {
        expect(my_program.signature.options.length).toBeGreaterThanOrEqual(2);

        // First option: required, not optional
        const my_required = my_program.signature.options[0];
        expect(my_required.isRequired).toBe(true);
        expect(my_required.isOptional).toBe(false);

        // Second option: optional (bracketed), not required
        const my_optional = my_program.signature.options[1];
        expect(my_optional.isRequired).toBe(false);
        expect(my_optional.isOptional).toBe(true);
      }
    });
  });

  describe('edge case option names', () => {
    it('should parse option name O_', () => {
      const my_source = `program define test_prog
syntax , O_
end`;

      const my_lex_result = my_lexer.tokenize(my_source);
      const my_parse_result = my_parser.parse(my_lex_result.tokens);

      const my_program = my_parse_result.ast.nodes.find(
        (my_node) => my_node.type === 'program'
      );

      if (my_program?.type === 'program' && my_program.signature) {
        expect(my_program.signature.options.length).toBeGreaterThan(0);
        const my_option = my_program.signature.options[0];
        expect(my_option.name.toLowerCase()).toBe('o_');
      }
    });

    it('should parse single-letter option names', () => {
      const my_source = `program define test_prog
syntax , a b c x y z
end`;

      const my_lex_result = my_lexer.tokenize(my_source);
      const my_parse_result = my_parser.parse(my_lex_result.tokens);

      const my_program = my_parse_result.ast.nodes.find(
        (my_node) => my_node.type === 'program'
      );

      if (my_program?.type === 'program' && my_program.signature) {
        expect(my_program.signature.options.length).toBe(6);
        const my_names = my_program.signature.options.map((my_opt) =>
          my_opt.name.toLowerCase()
        );
        expect(my_names).toEqual(['a', 'b', 'c', 'x', 'y', 'z']);
      }
    });

    it('should parse option names with underscores', () => {
      const my_source = `program define test_prog
syntax , my_opt _opt opt_name _
end`;

      const my_lex_result = my_lexer.tokenize(my_source);
      const my_parse_result = my_parser.parse(my_lex_result.tokens);

      const my_program = my_parse_result.ast.nodes.find(
        (my_node) => my_node.type === 'program'
      );

      if (my_program?.type === 'program' && my_program.signature) {
        expect(my_program.signature.options.length).toBe(4);
        const my_names = my_program.signature.options.map((my_opt) =>
          my_opt.name.toLowerCase()
        );
        expect(my_names).toEqual(['my_opt', '_opt', 'opt_name', '_']);
      }
    });

    it('should parse option names with numbers', () => {
      const my_source = `program define test_prog
syntax , opt1 opt2 opt123 1opt
end`;

      const my_lex_result = my_lexer.tokenize(my_source);
      const my_parse_result = my_parser.parse(my_lex_result.tokens);

      const my_program = my_parse_result.ast.nodes.find(
        (my_node) => my_node.type === 'program'
      );

      if (my_program?.type === 'program' && my_program.signature) {
        // Note: 1opt may not be valid, but we should handle it gracefully
        expect(my_program.signature.options.length).toBeGreaterThanOrEqual(3);
      }
    });

    it('should preserve case in option names', () => {
      const my_source = `program define test_prog
syntax , MyOpt MYOPT myopt
end`;

      const my_lex_result = my_lexer.tokenize(my_source);
      const my_parse_result = my_parser.parse(my_lex_result.tokens);

      const my_program = my_parse_result.ast.nodes.find(
        (my_node) => my_node.type === 'program'
      );

      if (my_program?.type === 'program' && my_program.signature) {
        expect(my_program.signature.options.length).toBe(3);
        // Names should preserve original case
        expect(my_program.signature.options[0].name).toBe('MyOpt');
        expect(my_program.signature.options[1].name).toBe('MYOPT');
        expect(my_program.signature.options[2].name).toBe('myopt');
      }
    });
  });

  describe('option parsing with type specifications', () => {
    it('should preserve required flag with typed options', () => {
      const my_source = `program define test_prog
syntax , *myopt(real) other(string)
end`;

      const my_lex_result = my_lexer.tokenize(my_source);
      const my_parse_result = my_parser.parse(my_lex_result.tokens);

      const my_program = my_parse_result.ast.nodes.find(
        (my_node) => my_node.type === 'program'
      );

      if (my_program?.type === 'program' && my_program.signature) {
        expect(my_program.signature.options.length).toBeGreaterThanOrEqual(2);

        // First option should be required with type
        const my_first = my_program.signature.options[0];
        expect(my_first.isRequired).toBe(true);
        expect(my_first.argumentType).toBe('real');

        // Second option should be optional with type
        const my_second = my_program.signature.options[1];
        expect(my_second.isRequired).toBe(false);
        expect(my_second.argumentType).toBe('string');
      }
    });

    it('should preserve required flag with default values', () => {
      const my_source = `program define test_prog
syntax , *myopt(real default(5)) other(string default("test"))
end`;

      const my_lex_result = my_lexer.tokenize(my_source);
      const my_parse_result = my_parser.parse(my_lex_result.tokens);

      const my_program = my_parse_result.ast.nodes.find(
        (my_node) => my_node.type === 'program'
      );

      if (my_program?.type === 'program' && my_program.signature) {
        expect(my_program.signature.options.length).toBeGreaterThanOrEqual(2);

        // First option should be required with default
        const my_first = my_program.signature.options[0];
        expect(my_first.isRequired).toBe(true);
        expect(my_first.defaultValue).toBe('5');

        // Second option should be optional with default
        const my_second = my_program.signature.options[1];
        expect(my_second.isRequired).toBe(false);
        expect(my_second.defaultValue).toBe('"test"');
      }
    });
  });

  describe('complex option scenarios', () => {
    it('should handle mixed required and optional options', () => {
      const my_source = `program define test_prog
syntax , *req1 opt1 *req2 opt2 *req3
end`;

      const my_lex_result = my_lexer.tokenize(my_source);
      const my_parse_result = my_parser.parse(my_lex_result.tokens);

      const my_program = my_parse_result.ast.nodes.find(
        (my_node) => my_node.type === 'program'
      );

      if (my_program?.type === 'program' && my_program.signature) {
        expect(my_program.signature.options.length).toBe(5);

        // Verify alternating pattern
        expect(my_program.signature.options[0].isRequired).toBe(true);
        expect(my_program.signature.options[1].isRequired).toBe(false);
        expect(my_program.signature.options[2].isRequired).toBe(true);
        expect(my_program.signature.options[3].isRequired).toBe(false);
        expect(my_program.signature.options[4].isRequired).toBe(true);
      }
    });

    it('should handle bracketed options with required marker', () => {
      const my_source = `program define test_prog
syntax , *[bracket_opt] [other_bracket]
end`;

      const my_lex_result = my_lexer.tokenize(my_source);
      const my_parse_result = my_parser.parse(my_lex_result.tokens);

      const my_program = my_parse_result.ast.nodes.find(
        (my_node) => my_node.type === 'program'
      );

      if (my_program?.type === 'program' && my_program.signature) {
        // Should parse both options
        expect(my_program.signature.options.length).toBeGreaterThanOrEqual(2);
      }
    });

    it('should handle large number of options', () => {
      const my_option_names = Array.from({ length: 20 }, (_, i) => `opt${i}`);
      const my_option_specs = my_option_names
        .map((my_name, i) => (i % 2 === 0 ? `*${my_name}` : my_name))
        .join(' ');
      const my_source = `program define test_prog
syntax , ${my_option_specs}
end`;

      const my_lex_result = my_lexer.tokenize(my_source);
      const my_parse_result = my_parser.parse(my_lex_result.tokens);

      const my_program = my_parse_result.ast.nodes.find(
        (my_node) => my_node.type === 'program'
      );

      if (my_program?.type === 'program' && my_program.signature) {
        expect(my_program.signature.options.length).toBe(20);

        // Verify alternating required/optional pattern
        for (let i = 0; i < 20; i++) {
          const my_expected_required = i % 2 === 0;
          expect(my_program.signature.options[i].isRequired).toBe(
            my_expected_required
          );
        }
      }
    });
  });
});
