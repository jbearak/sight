import { describe, test, expect, beforeEach } from 'bun:test';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { CodeFormatter } from '../../src/providers/formatter';
import { DocumentState } from '../../src/document-store';
import { FormattingOptions } from 'vscode-languageserver';
import * as fs from 'fs';

describe('Debug - lval alignment', () => {
  let lexer: StataLexer;
  let parser: StataParser;
  let formatter: CodeFormatter;

  beforeEach(() => {
    lexer = new StataLexer();
    parser = new StataParser();
    formatter = new CodeFormatter();
  });

  function create_document(source: string): DocumentState {
    const lex_result = lexer.tokenize(source);
    const parse_result = parser.parse(lex_result.tokens);

    return {
      uri: 'file:///test.do',
      content: source,
      version: 1,
      ast: parse_result.ast,
      tokens: lex_result.tokens,
      line_offsets: lex_result.line_offsets,
      symbols: new Map(),
      diagnostics: [],
    };
  }

  test('should preserve lval continuation alignment', () => {
    const content = fs.readFileSync('/tmp/lval_test.do', 'utf-8');

    console.log('Original lines:');
    content.split('\n').forEach((line, i) => {
      const slashIdx = line.indexOf('///');
      console.log(`${i}: len=${line.length}, ///at=${slashIdx >= 0 ? slashIdx : 'N/A'}`);
    });

    const doc = create_document(content);
    
    // Check tokens
    console.log('\nContinuation tokens:');
    doc.tokens?.filter(t => t.type === 'CONTINUATION').forEach(t => {
      console.log(`  line ${t.range.start.line}, col ${t.range.start.character}`);
    });

    const options: FormattingOptions = { tabSize: 4, insertSpaces: false };
    const edits = formatter.format(doc, options);
    
    const formatted = edits.length > 0 ? edits[0].newText : content;

    console.log('\nFormatted lines:');
    formatted.split('\n').forEach((line, i) => {
      const slashIdx = line.indexOf('///');
      console.log(`${i}: len=${line.length}, ///at=${slashIdx >= 0 ? slashIdx : 'N/A'}`);
    });

    // Check if /// positions changed
    const origLines = content.split('\n');
    const formattedLines = formatted.split('\n');
    
    let changed = false;
    for (let i = 0; i < Math.min(origLines.length, formattedLines.length); i++) {
      const origSlash = origLines[i].indexOf('///');
      const formSlash = formattedLines[i].indexOf('///');
      if (origSlash !== formSlash && origSlash >= 0) {
        console.log(`\nLine ${i} changed: /// moved from ${origSlash} to ${formSlash}`);
        changed = true;
      }
    }
    
    if (!changed) {
      console.log('\n/// positions unchanged');
    }
  });
});
