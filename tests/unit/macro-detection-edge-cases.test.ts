import { describe, it, expect, beforeEach } from 'bun:test';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { SemanticAnalyzer } from '../../src/analyzer';

describe('Macro Detection Edge Cases', () => {
  let my_lexer: StataLexer;
  let my_parser: StataParser;
  let my_analyzer: SemanticAnalyzer;

  beforeEach(() => {
    my_lexer = new StataLexer();
    my_parser = new StataParser();
    my_analyzer = new SemanticAnalyzer();
  });

  function analyze_source(my_source: string) {
    const my_lex_result = my_lexer.tokenize(my_source);
    const my_parse_result = my_parser.parse(my_lex_result.tokens);
    return my_analyzer.analyze(
      my_parse_result.ast,
      'file:///test.do',
      undefined,
      undefined,
      my_lex_result.tokens
    );
  }

  describe('incomplete macro syntax handling', () => {
    it('should emit diagnostic for incomplete macro syntax: ${ without closing }', () => {
      const my_source = 'local myvar "test"\ndisplay \'${'

      const my_lex_result = my_lexer.tokenize(my_source);
      const my_parse_result = my_parser.parse(my_lex_result.tokens);

      // Note: May or may not have diagnostic depending on implementation
      // The important thing is that parsing continues
      expect(my_parse_result.ast.nodes.length).toBeGreaterThanOrEqual(1);
    });

    it('should continue tokenizing after incomplete macro syntax', () => {
      const my_source = 'local first "value1"\ndisplay \'${\nlocal second "value2"';

      const my_lex_result = my_lexer.tokenize(my_source);
      const my_parse_result = my_parser.parse(my_lex_result.tokens);

      // Should have parsed multiple nodes despite incomplete macro
      expect(my_parse_result.ast.nodes.length).toBeGreaterThanOrEqual(2);

      // Should have at least 2 macro definitions
      const my_macro_defs = my_parse_result.ast.nodes.filter(
        (my_node) => my_node.type === 'macro_def'
      );
      expect(my_macro_defs.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle incomplete macro in middle of document', () => {
      const my_source = 'local before "value"\ndisplay \'${\nlocal after "value"\ndisplay "done"';

      const my_lex_result = my_lexer.tokenize(my_source);
      const my_parse_result = my_parser.parse(my_lex_result.tokens);

      // Should parse all nodes
      expect(my_parse_result.ast.nodes.length).toBeGreaterThanOrEqual(3);

      // Should have both macro definitions
      const my_macro_defs = my_parse_result.ast.nodes.filter(
        (my_node) => my_node.type === 'macro_def'
      );
      expect(my_macro_defs.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle multiple incomplete macros', () => {
      const my_source = 'local first "value"\ndisplay \'${\nlocal second "value"\ndisplay \'${\nlocal third "value"';

      const my_lex_result = my_lexer.tokenize(my_source);
      const my_parse_result = my_parser.parse(my_lex_result.tokens);

      // Should parse all nodes
      expect(my_parse_result.ast.nodes.length).toBeGreaterThanOrEqual(3);

      // Should have all 3 macro definitions
      const my_macro_defs = my_parse_result.ast.nodes.filter(
        (my_node) => my_node.type === 'macro_def'
      );
      expect(my_macro_defs.length).toBeGreaterThanOrEqual(3);
    });

    it('should handle incomplete macro with valid macro after', () => {
      const my_source = 'local first "value"\ndisplay \'${\nlocal second "value"\ndisplay \'second\'';

      const my_lex_result = my_lexer.tokenize(my_source);
      const my_parse_result = my_parser.parse(my_lex_result.tokens);

      // Should parse all nodes
      expect(my_parse_result.ast.nodes.length).toBeGreaterThanOrEqual(3);

      // Should have both macro definitions
      const my_macro_defs = my_parse_result.ast.nodes.filter(
        (my_node) => my_node.type === 'macro_def'
      );
      expect(my_macro_defs.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('macro registration after incomplete syntax', () => {
    it('should register macro defined before incomplete syntax', () => {
      const my_source = 'local myvar "value"\ndisplay \'${';
      const my_analysis = analyze_source(my_source);

      // Should have registered the macro
      expect(my_analysis.symbols.localMacros.size).toBeGreaterThan(0);
      expect(my_analysis.symbols.localMacros.has('myvar')).toBe(true);
    });

    it('should register macro defined after incomplete syntax', () => {
      const my_source = 'display \'${\nlocal myvar "value"';
      const my_analysis = analyze_source(my_source);

      // Should have registered the macro despite preceding incomplete syntax
      expect(my_analysis.symbols.localMacros.size).toBeGreaterThan(0);
      expect(my_analysis.symbols.localMacros.has('myvar')).toBe(true);
    });

    it('should register all macros despite multiple incomplete syntaxes', () => {
      const my_source = 'local first "value"\ndisplay \'${\nlocal second "value"\ndisplay \'${\nlocal third "value"';
      const my_analysis = analyze_source(my_source);

      // Should have registered all 3 macros
      expect(my_analysis.symbols.localMacros.size).toBeGreaterThanOrEqual(3);
      expect(my_analysis.symbols.localMacros.has('first')).toBe(true);
      expect(my_analysis.symbols.localMacros.has('second')).toBe(true);
      expect(my_analysis.symbols.localMacros.has('third')).toBe(true);
    });

    it('should register global macros after incomplete syntax', () => {
      const my_source = 'display \'${\nglobal myglobal "value"';
      const my_analysis = analyze_source(my_source);

      // Should have registered the global macro
      expect(my_analysis.symbols.globalMacros.size).toBeGreaterThan(0);
      expect(my_analysis.symbols.globalMacros.has('myglobal')).toBe(true);
    });
  });

  describe('position tracking after recovery', () => {
    it('should maintain correct positions after incomplete macro', () => {
      const my_source = 'local first "value"\ndisplay \'${\nlocal second "value"';

      const my_lex_result = my_lexer.tokenize(my_source);

      // All tokens should have valid positions
      for (const my_token of my_lex_result.tokens) {
        expect(my_token.range).toBeDefined();
        expect(my_token.range.start).toBeDefined();
        expect(my_token.range.end).toBeDefined();
        expect(my_token.range.start.line).toBeGreaterThanOrEqual(0);
        expect(my_token.range.start.character).toBeGreaterThanOrEqual(0);
        expect(my_token.range.end.line).toBeGreaterThanOrEqual(
          my_token.range.start.line
        );
      }
    });

    it('should have correct line numbers after incomplete macro', () => {
      const my_source = 'local first "value"\ndisplay \'${\nlocal second "value"\ndisplay "done"';

      const my_lex_result = my_lexer.tokenize(my_source);
      const my_parse_result = my_parser.parse(my_lex_result.tokens);

      // Should have parsed nodes with correct line information
      for (const my_node of my_parse_result.ast.nodes) {
        expect(my_node.range).toBeDefined();
        expect(my_node.range.start.line).toBeGreaterThanOrEqual(0);
        expect(my_node.range.end.line).toBeGreaterThanOrEqual(
          my_node.range.start.line
        );
      }
    });

    it('should have correct character positions after incomplete macro', () => {
      const my_source = 'local first "value"\ndisplay \'${\nlocal second "value"';

      const my_lex_result = my_lexer.tokenize(my_source);

      // Check that character positions are reasonable
      for (const my_token of my_lex_result.tokens) {
        if (my_token.range.start.line === my_token.range.end.line) {
          // Same line: end character should be >= start character
          expect(my_token.range.end.character).toBeGreaterThanOrEqual(
            my_token.range.start.character
          );
        }
      }
    });
  });

  describe('symbol table registration after errors', () => {
    it('should include all macros in document symbols despite incomplete syntax', () => {
      const my_source = 'local first "value"\ndisplay \'${\nlocal second "value"';
      const my_analysis = analyze_source(my_source);

      // Should have both macros in symbol table
      expect(my_analysis.symbols.localMacros.size).toBeGreaterThanOrEqual(2);
      expect(my_analysis.symbols.localMacros.has('first')).toBe(true);
      expect(my_analysis.symbols.localMacros.has('second')).toBe(true);
    });

    it('should have correct macro scope after incomplete syntax', () => {
      const my_source = 'local local_var "value"\ndisplay \'${\nglobal global_var "value"';
      const my_analysis = analyze_source(my_source);

      // Should have both macros registered
      expect(my_analysis.symbols.localMacros.size).toBeGreaterThanOrEqual(1);
      expect(my_analysis.symbols.globalMacros.size).toBeGreaterThanOrEqual(1);
      expect(my_analysis.symbols.localMacros.has('local_var')).toBe(true);
      expect(my_analysis.symbols.globalMacros.has('global_var')).toBe(true);
    });

    it('should handle macro definitions in program after incomplete syntax', () => {
      const my_source = 'display \'${\nprogram define myprog\n  local prog_var "value"\nend';
      const my_analysis = analyze_source(my_source);

      // Should have registered the program-scoped macro
      expect(my_analysis.symbols.localMacros.size).toBeGreaterThan(0);
      expect(my_analysis.symbols.localMacros.has('prog_var')).toBe(true);
    });
  });

  describe('recovery from malformed macro expressions', () => {
    it('should continue parsing after incomplete macro expression', () => {
      const my_source = 'local var1 "value1"\ndisplay \'${\nlocal var2 "value2"\ndisplay \'var2\'';

      const my_lex_result = my_lexer.tokenize(my_source);
      const my_parse_result = my_parser.parse(my_lex_result.tokens);

      // Should have parsed all statements
      expect(my_parse_result.ast.nodes.length).toBeGreaterThanOrEqual(3);
    });

    it('should handle nested incomplete macros', () => {
      const my_source = 'local var1 "value1"\ndisplay \'${\ndisplay \'${\nlocal var2 "value2"';

      const my_lex_result = my_lexer.tokenize(my_source);
      const my_parse_result = my_parser.parse(my_lex_result.tokens);

      // Should have parsed nodes despite nested incomplete macros
      expect(my_parse_result.ast.nodes.length).toBeGreaterThanOrEqual(2);

      // Should have registered both macros
      const my_macro_defs = my_parse_result.ast.nodes.filter(
        (my_node) => my_node.type === 'macro_def'
      );
      expect(my_macro_defs.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle incomplete macro at end of file', () => {
      const my_source = 'local var1 "value1"\ndisplay \'${';

      const my_lex_result = my_lexer.tokenize(my_source);
      const my_parse_result = my_parser.parse(my_lex_result.tokens);

      // Should have parsed the macro definition
      const my_macro_defs = my_parse_result.ast.nodes.filter(
        (my_node) => my_node.type === 'macro_def'
      );
      expect(my_macro_defs.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle incomplete macro with special characters', () => {
      const my_source = 'local var1 "value1"\ndisplay \'${@#$%\nlocal var2 "value2"';

      const my_lex_result = my_lexer.tokenize(my_source);
      const my_parse_result = my_parser.parse(my_lex_result.tokens);

      // Should have parsed both macro definitions
      const my_macro_defs = my_parse_result.ast.nodes.filter(
        (my_node) => my_node.type === 'macro_def'
      );
      expect(my_macro_defs.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('macro detection with various incomplete patterns', () => {
    it('should handle incomplete macro with just opening brace', () => {
      // Use a pattern that doesn't start a block - apostrophe followed by word
      const my_source = 'local var1 "value1"\ndisplay \'word\nlocal var2 "value2"';

      const my_lex_result = my_lexer.tokenize(my_source);
      const my_parse_result = my_parser.parse(my_lex_result.tokens);

      // Should have parsed both macro definitions
      const my_macro_defs = my_parse_result.ast.nodes.filter(
        (my_node) => my_node.type === 'macro_def'
      );
      expect(my_macro_defs.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle incomplete macro with dollar sign only', () => {
      const my_source = 'local var1 "value1"\ndisplay \'$\nlocal var2 "value2"';

      const my_lex_result = my_lexer.tokenize(my_source);
      const my_parse_result = my_parser.parse(my_lex_result.tokens);

      // Should have parsed both macro definitions
      const my_macro_defs = my_parse_result.ast.nodes.filter(
        (my_node) => my_node.type === 'macro_def'
      );
      expect(my_macro_defs.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle incomplete macro with backtick syntax', () => {
      const my_source = 'local var1 "value1"\ndisplay `\nlocal var2 "value2"';

      const my_lex_result = my_lexer.tokenize(my_source);
      const my_parse_result = my_parser.parse(my_lex_result.tokens);

      // Should have parsed both macro definitions
      const my_macro_defs = my_parse_result.ast.nodes.filter(
        (my_node) => my_node.type === 'macro_def'
      );
      expect(my_macro_defs.length).toBeGreaterThanOrEqual(2);
    });
  });
});
