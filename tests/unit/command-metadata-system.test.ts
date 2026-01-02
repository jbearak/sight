/**
 * Unit Tests: Command Database System
 * 
 * Tests the basic functionality of the command database with minimal types.
 */

import { CommandDatabase } from '../../src/command-database';
import type { CommandCache } from '../../src/command-database/types';

describe('Command Database Unit Tests', () => {
    
    const sample_cache: CommandCache = {
        version: 18,
        commands: {
            'regress': {
                name: 'regress',
                syntax: 'regress depvar [indepvars] [if] [in] [, options]',
                description: 'Linear regression',
                min_abbreviation: 3
            },
            'generate': {
                name: 'generate',
                syntax: 'generate [type] newvar = exp [if] [in]',
                description: 'Create new variable',
                min_abbreviation: 1
            },
            'replace': {
                name: 'replace',
                syntax: 'replace oldvar = exp [if] [in]',
                description: 'Replace values of existing variable',
                min_abbreviation: 7 // Full name required (destructive)
            }
        },
        abbreviations: {
            'reg': 'regress',
            'regr': 'regress',
            'regre': 'regress',
            'regres': 'regress',
            'regress': 'regress',
            'g': 'generate',
            'ge': 'generate',
            'gen': 'generate',
            'gene': 'generate',
            'gener': 'generate',
            'genera': 'generate',
            'generat': 'generate',
            'generate': 'generate',
            'replace': 'replace'
        }
    };
    
    describe('Command Lookup', () => {
        
        test('looks up command by full name', () => {
            const db = new CommandDatabase();
            db.load_cache(sample_cache);
            
            const result = db.lookup_command('regress');
            
            expect(result).not.toBeNull();
            expect(result?.name).toBe('regress');
            expect(result?.syntax).toBe('regress depvar [indepvars] [if] [in] [, options]');
            expect(result?.description).toBe('Linear regression');
            expect(result?.min_abbreviation).toBe(3);
        });
        
        test('looks up command by abbreviation', () => {
            const db = new CommandDatabase();
            db.load_cache(sample_cache);
            
            const result = db.lookup_command('reg');
            
            expect(result).not.toBeNull();
            expect(result?.name).toBe('regress');
        });
        
        test('returns null for unknown command', () => {
            const db = new CommandDatabase();
            db.load_cache(sample_cache);
            
            const result = db.lookup_command('unknown');
            
            expect(result).toBeNull();
        });
        
        test('lookup is case-insensitive', () => {
            const db = new CommandDatabase();
            db.load_cache(sample_cache);
            
            const result1 = db.lookup_command('REGRESS');
            const result2 = db.lookup_command('Regress');
            const result3 = db.lookup_command('regress');
            
            expect(result1?.name).toBe('regress');
            expect(result2?.name).toBe('regress');
            expect(result3?.name).toBe('regress');
        });
    });
    
    describe('Command Search', () => {
        
        test('searches commands by prefix', () => {
            const db = new CommandDatabase();
            db.load_cache(sample_cache);
            
            const results = db.search('re');
            
            expect(results.length).toBe(2); // regress and replace
            expect(results.map(r => r.name)).toContain('regress');
            expect(results.map(r => r.name)).toContain('replace');
        });
        
        test('returns empty array for no matches', () => {
            const db = new CommandDatabase();
            db.load_cache(sample_cache);
            
            const results = db.search('xyz');
            
            expect(results).toEqual([]);
        });
        
        test('search is case-insensitive', () => {
            const db = new CommandDatabase();
            db.load_cache(sample_cache);
            
            const results1 = db.search('GEN');
            const results2 = db.search('gen');
            
            expect(results1.length).toBe(results2.length);
        });
    });
    
    describe('Abbreviation Expansion', () => {
        
        test('expands valid abbreviation', () => {
            const db = new CommandDatabase();
            db.load_cache(sample_cache);
            
            const results = db.expand_abbreviation('gen');
            
            expect(results.length).toBe(1);
            expect(results[0].name).toBe('generate');
        });
        
        test('returns empty for abbreviation shorter than min_abbreviation', () => {
            const db = new CommandDatabase();
            db.load_cache(sample_cache);
            
            // 'regress' has min_abbreviation of 3, so 're' should not match
            const results = db.expand_abbreviation('re');
            
            // Should not include regress (min_abbreviation is 3)
            const regress_match = results.find(r => r.name === 'regress');
            expect(regress_match).toBeUndefined();
        });
        
        test('returns multiple matches for common prefix', () => {
            const db = new CommandDatabase();
            db.load_cache(sample_cache);
            
            // Both 'regress' and 'replace' start with 're', but have different min_abbreviation
            // regress has min_abbreviation: 3, replace has min_abbreviation: 7 (full name)
            const results = db.expand_abbreviation('reg');
            
            // Only regress should match (replace needs full name)
            expect(results.length).toBe(1);
            expect(results[0].name).toBe('regress');
        });
    });
    
    describe('Cache Management', () => {
        
        test('returns empty results before cache is loaded', () => {
            const db = new CommandDatabase();
            
            expect(db.lookup_command('regress')).toBeNull();
            expect(db.search('reg')).toEqual([]);
            expect(db.get_all_commands()).toEqual([]);
        });
        
        test('get_all_commands returns all commands', () => {
            const db = new CommandDatabase();
            db.load_cache(sample_cache);
            
            const all = db.get_all_commands();
            
            expect(all.length).toBe(3);
            expect(all.map(c => c.name)).toContain('regress');
            expect(all.map(c => c.name)).toContain('generate');
            expect(all.map(c => c.name)).toContain('replace');
        });
        
        test('size returns correct count', () => {
            const db = new CommandDatabase();
            db.load_cache(sample_cache);
            
            expect(db.size).toBe(3);
        });
        
        test('clear removes all commands', () => {
            const db = new CommandDatabase();
            db.load_cache(sample_cache);
            
            expect(db.size).toBe(3);
            
            db.clear();
            
            expect(db.size).toBe(0);
            expect(db.lookup_command('regress')).toBeNull();
        });
        
        test('has returns correct result', () => {
            const db = new CommandDatabase();
            db.load_cache(sample_cache);
            
            expect(db.has('regress')).toBe(true);
            expect(db.has('reg')).toBe(true); // Via abbreviation
            expect(db.has('unknown')).toBe(false);
        });
    });
    
    describe('Edge Cases', () => {
        
        test('handles empty cache', () => {
            const db = new CommandDatabase();
            const empty_cache: CommandCache = {
                version: 18,
                commands: {},
                abbreviations: {}
            };
            
            db.load_cache(empty_cache);
            
            expect(db.size).toBe(0);
            expect(db.lookup_command('anything')).toBeNull();
            expect(db.search('a')).toEqual([]);
        });
        
        test('handles single command', () => {
            const db = new CommandDatabase();
            const single_cache: CommandCache = {
                version: 18,
                commands: {
                    'test': {
                        name: 'test',
                        syntax: 'test',
                        description: 'Test command',
                        min_abbreviation: 1
                    }
                },
                abbreviations: {
                    't': 'test',
                    'te': 'test',
                    'tes': 'test',
                    'test': 'test'
                }
            };
            
            db.load_cache(single_cache);
            
            expect(db.size).toBe(1);
            expect(db.lookup_command('t')?.name).toBe('test');
        });
    });
});
