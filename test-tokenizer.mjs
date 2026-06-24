import { tokenize_stata, find_token, has_scope } from './tests/unit/helpers/textmate-tokenizer.ts';

const testCases = [
  // (1) Test basic command matching order - should still work before statement-content
  'display * expr',
  'gen x = y * z',
  
  // (2) Test factor variables still work after moving them before path rules
  'regress y i.treatment',
  'use i.dta',
  
  // (3) Test path rules work correctly
  'use mydata.dta',
  'do setup.do',
  
  // (4) Test statement-content patterns still work from inside the new group
  'local x 5',
  'gen z = 1',
];

async function runTests() {
  for (const test of testCases) {
    try {
      const tokens = await tokenize_stata(test);
      console.log(`\nTest: "${test}"`);
      tokens.forEach(t => {
        console.log(`  [${t.text}] scopes: ${t.scopes.join(' > ')}`);
      });
    } catch (e) {
      console.error(`Error in "${test}":`, e.message);
    }
  }
}

runTests().catch(console.error);
