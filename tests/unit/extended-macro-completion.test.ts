import { describe, it, expect, beforeEach } from 'bun:test';
import { CompletionProvider } from '../../src/providers/completion';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { SemanticAnalyzer } from '../../src/analyzer';
import { DocumentStore } from '../../src/document-store';
import { CommandDatabase } from '../../src/command-database';

describe('Extended Macro Function Completion', () => {
  let completion_provider: CompletionProvider;
  let document_store: DocumentStore;
  let lexer: StataLexer;
  let parser: StataParser;
  let analyzer: SemanticAnalyzer;

  beforeEach(() => {
    lexer = new StataLexer();
    parser = new StataParser();
    analyzer = new SemanticAnalyzer();
    document_store = new DocumentStore(lexer, parser, analyzer);
    
    const command_db = new CommandDatabase();
    completion_provider = new CompletionProvider(command_db);
  });

  it('should provide macro completions for word functions', async () => {
    const source = `
local text "hello world"
local count : word count \``;
    
    await document_store.open('test://test.do', source, 1);
    const document = document_store.get('test://test.do')!;
    
    const completions = await completion_provider.get_completions(
      document,
      { line: 2, character: 26 }, // After the backtick
      { triggerCharacter: '`' }
    );
    
    // Should suggest the 'text' macro
    const text_completion = completions.find(c => c.label === 'text');
    expect(text_completion).toBeDefined();
    expect(text_completion?.kind).toBe(6); // CompletionItemKind.Variable (for macros)
  });

  it('should provide macro completions for string functions', async () => {
    const source = `
local original "hello world"
local result : subinstr local(\``;
    
    await document_store.open('test://test.do', source, 1);
    const document = document_store.get('test://test.do')!;
    
    const completions = await completion_provider.get_completions(
      document,
      { line: 2, character: 31 }, // After the backtick
      { triggerCharacter: '`' }
    );
    
    // Should suggest the 'original' macro
    const original_completion = completions.find(c => c.label === 'original');
    expect(original_completion).toBeDefined();
  });

  it('should provide variable completions for property functions', async () => {
    const source = `
generate price = 100
generate weight = 50
local var_type : type `;
    
    await document_store.open('test://test.do', source, 1);
    const document = document_store.get('test://test.do')!;
    
    const completions = await completion_provider.get_completions(
      document,
      { line: 3, character: 22 }, // After "type "
      {}
    );
    
    // Should provide variable completions (should include price and weight)
    expect(completions.length).toBeGreaterThan(0);
    const price_completion = completions.find(c => c.label === 'price');
    const weight_completion = completions.find(c => c.label === 'weight');
    expect(price_completion).toBeDefined();
    expect(weight_completion).toBeDefined();
  });

  it('should provide variable completions for variable label functions', async () => {
    const source = `
generate income = 1000
generate age = 25
local label : variable label `;
    
    await document_store.open('test://test.do', source, 1);
    const document = document_store.get('test://test.do')!;
    
    const completions = await completion_provider.get_completions(
      document,
      { line: 3, character: 29 }, // After "variable label "
      {}
    );
    
    // Should provide variable completions (should include income and age)
    expect(completions.length).toBeGreaterThan(0);
    const income_completion = completions.find(c => c.label === 'income');
    const age_completion = completions.find(c => c.label === 'age');
    expect(income_completion).toBeDefined();
    expect(age_completion).toBeDefined();
  });
});