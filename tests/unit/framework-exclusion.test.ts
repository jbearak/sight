import { describe, it, expect } from 'bun:test';
import { CommandDatabase } from '../../src/command-database/index.js';

describe('Framework Exclusion', () => {
    it('should not include framework as a command', () => {
        const db = new CommandDatabase();
        
        // framework should not be in the commands
        expect(db.get_command('framework')).toBeUndefined();
        
        // framework abbreviations should not resolve to framework
        expect(db.get_command('fra')).not.toBeDefined();
        expect(db.get_command('fram')).not.toBeDefined();
        expect(db.get_command('frame')).not.toBeDefined();
        expect(db.get_command('framew')).not.toBeDefined();
        expect(db.get_command('framewo')).not.toBeDefined();
        expect(db.get_command('framewor')).not.toBeDefined();
    });
});