import { test, expect } from 'bun:test';
import { CommandDatabase } from '../../src/command-database/index.js';
import { CommandCache } from '../../src/command-database/types.js';

const test_cache: CommandCache = {
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
            syntax: 'generate newvar = exp [if] [in]',
            description: 'Create new variable',
            min_abbreviation: 1
        }
    },
    abbreviations: {
        'reg': 'regress',
        'regr': 'regress',
        'regre': 'regress',
        'regres': 'regress',
        'g': 'generate',
        'ge': 'generate',
        'gen': 'generate',
        'gene': 'generate',
        'gener': 'generate',
        'genera': 'generate',
        'generat': 'generate'
    }
};

test('CommandDatabase lookup_command - direct name', () => {
    const db = new CommandDatabase();
    db.load_cache(test_cache);
    
    const result = db.lookup_command('regress');
    expect(result?.name).toBe('regress');
    expect(result?.description).toBe('Linear regression');
});

test('CommandDatabase lookup_command - abbreviation', () => {
    const db = new CommandDatabase();
    db.load_cache(test_cache);
    
    const result = db.lookup_command('reg');
    expect(result?.name).toBe('regress');
});

test('CommandDatabase lookup_command - not found', () => {
    const db = new CommandDatabase();
    db.load_cache(test_cache);
    
    const result = db.lookup_command('nonexistent');
    expect(result).toBe(null);
});

test('CommandDatabase get_all_commands', () => {
    const db = new CommandDatabase();
    db.load_cache(test_cache);
    
    const commands = db.get_all_commands();
    expect(commands).toHaveLength(2);
    expect(commands.map(c => c.name)).toContain('regress');
    expect(commands.map(c => c.name)).toContain('generate');
});


test('CommandDatabase get_all returns cached array', () => {
    const db = new CommandDatabase();
    db.load_cache(test_cache);
    
    const first_call = db.get_all();
    const second_call = db.get_all();
    
    // Should return the exact same array instance (not a copy)
    expect(first_call).toBe(second_call);
});

test('CommandDatabase get_all cache invalidates on register', () => {
    const db = new CommandDatabase();
    db.load_cache(test_cache);
    
    const before_register = db.get_all();
    
    db.register({
        name: 'newcmd',
        minAbbreviation: 'new',
        options: [],
        category: 'builtin',
        isBuiltin: true
    });
    
    const after_register = db.get_all();
    
    // Should be a different array after registration
    expect(before_register).not.toBe(after_register);
    expect(after_register.length).toBe(before_register.length + 1);
});

test('CommandDatabase lookup_command prefers exact command names over longer command prefixes', () => {
    const db = new CommandDatabase();
    db.load_cache({
        version: 18,
        commands: {
            'display': {
                name: 'display',
                min_abbreviation: 2,
                options: [],
                priority: 1
            },
            'displayknots': {
                name: 'displayknots',
                min_abbreviation: 2,
                options: [],
                priority: 3
            }
        },
        abbreviations: {
            'display': 'displayknots',
            'displayk': 'displayknots'
        }
    });

    expect(db.lookup_command('display')?.name).toBe('display');
});

test('CommandDatabase lookup_command resolves overlapping abbreviations by precedence', () => {
    const db = new CommandDatabase();
    db.load_cache({
        version: 18,
        commands: {
            'dir': {
                name: 'dir',
                min_abbreviation: 1,
                options: [],
                priority: 3
            },
            'display': {
                name: 'display',
                min_abbreviation: 2,
                options: [],
                priority: 1
            }
        },
        abbreviations: {
            'di': 'dir',
            'dis': 'display'
        }
    });

    expect(db.lookup_command('di')?.name).toBe('display');
    expect(db.lookup('di')?.name).toBe('display');
});
