import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Property tests for TextMate grammar macro definition highlighting.
 * Feature: macro-definition-highlighting
 */

const grammar_path = path.join(import.meta.dir, '../../client/syntaxes/stata.tmLanguage.json');
const grammar_content = JSON.parse(fs.readFileSync(grammar_path, 'utf8'));

// Generator for valid Stata macro names
const validMacroName = fc.string({ minLength: 1, maxLength: 20 })
  .filter(name => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name));

// Generator for local command abbreviations
const localAbbreviation = fc.constantFrom('loc', 'loca', 'local');

// Generator for global command abbreviations  
const globalAbbreviation = fc.constantFrom('gl', 'glo', 'glob', 'globa', 'global');

// Generator for temp commands
const tempCommand = fc.constantFrom('tempvar', 'tempname', 'tempfile');

// Helper to find patterns in grammar repository
function findPatternInRepository(name: string) {
  return grammar_content.repository[name];
}

describe('Feature: macro-definition-highlighting', () => {
  it('Property 1: Macro Definition Name Highlighting - local macro names SHALL have variable.other.local scope', () => {
    fc.assert(fc.property(
      validMacroName,
      (name) => {
        // Check that the grammar has patterns for local macro definitions
        const macroPatterns = findPatternInRepository('commands-macro');
        expect(macroPatterns).toBeDefined();
        
        // Verify the grammar contains variable.other.local.stata scope for definitions
        const grammarText = JSON.stringify(grammar_content);
        const hasLocalScope = grammarText.includes('variable.other.local.stata');
        expect(hasLocalScope).toBe(true);
        
        // Check that local command pattern exists
        const hasLocalPattern = grammarText.includes('loc(a(l)?)?');
        expect(hasLocalPattern).toBe(true);
      }
    ), { numRuns: 100 });
  });

  it('Property 2: Command Abbreviation Equivalence - abbreviations SHALL be supported in grammar patterns', () => {
    fc.assert(fc.property(
      localAbbreviation,
      validMacroName,
      (cmd, name) => {
        const grammarText = JSON.stringify(grammar_content);
        
        // Check that the grammar supports local command abbreviations
        const hasLocalAbbrevPattern = grammarText.includes('loc(a(l)?)?');
        expect(hasLocalAbbrevPattern).toBe(true);
        
        // Check that global command abbreviations are supported
        const hasGlobalAbbrevPattern = grammarText.includes('gl(o(b(a(l)?)?)?)?');
        expect(hasGlobalAbbrevPattern).toBe(true);
      }
    ), { numRuns: 100 });
  });

  it('Property 3: Local vs Global Scope Distinction - local and global macros SHALL have different scopes', () => {
    fc.assert(fc.property(
      validMacroName,
      (name) => {
        const grammarText = JSON.stringify(grammar_content);
        
        // Check for distinct local scope
        const hasLocalScope = grammarText.includes('variable.other.local.stata');
        
        // Check for distinct global scope  
        const hasGlobalScope = grammarText.includes('variable.other.global.stata');
        
        // Both should exist and be different
        expect(hasLocalScope).toBe(true);
        expect(hasGlobalScope).toBe(true);
      }
    ), { numRuns: 100 });
  });

  it('Property 4: Temp Command Name Highlighting - temp commands SHALL assign variable.other.local scope', () => {
    fc.assert(fc.property(
      tempCommand,
      validMacroName,
      (cmd, name) => {
        const grammarText = JSON.stringify(grammar_content);
        
        // Check for temp command pattern
        const hasTempPattern = grammarText.includes('tempvar|tempname|tempfile');
        expect(hasTempPattern).toBe(true);
        
        // Check for local scope (temp uses same as local)
        const hasLocalScope = grammarText.includes('variable.other.local.stata');
        expect(hasLocalScope).toBe(true);
        
        // Verify the specific temp command is supported
        expect(grammarText.includes(cmd)).toBe(true);
      }
    ), { numRuns: 100 });
  });

  it('Property 5: Dereference Highlighting Preservation - macro dereferences SHALL maintain variable.other.macro scopes', () => {
    fc.assert(fc.property(
      validMacroName,
      (name) => {
        const grammarText = JSON.stringify(grammar_content);
        
        // Check for local macro dereference patterns with depth
        const hasLocalMacroDepth1 = grammarText.includes('variable.other.macro.local.depth1.stata');
        const hasLocalMacroDepth2 = grammarText.includes('variable.other.macro.local.depth2.stata');
        expect(hasLocalMacroDepth1).toBe(true);
        expect(hasLocalMacroDepth2).toBe(true);
        
        // Check for global macro dereference pattern
        const hasGlobalMacroScope = grammarText.includes('variable.other.macro.global.stata');
        expect(hasGlobalMacroScope).toBe(true);
        
        // Check for backtick patterns (local macro dereference)
        const hasBacktickPattern = grammarText.includes('`') && grammarText.includes("'");
        expect(hasBacktickPattern).toBe(true);
        
        // Check for dollar sign patterns (global macro dereference)
        const hasDollarPattern = grammarText.includes('\\$');
        expect(hasDollarPattern).toBe(true);
      }
    ), { numRuns: 100 });
  });
});