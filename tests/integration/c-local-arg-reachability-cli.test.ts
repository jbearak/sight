import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { run_check_with_cwd } from '../../src/cli/check';

/**
 * `sight check` end to end: which programs a call reaches for their
 * positional `c_local` names. A call credits the caller's local only
 * when the program is defined at the call in Stata's execution order,
 * as the resolved execution scope shows it: files run, done or
 * included at any depth, `sight:` directives, resolved paths (not
 * file names), an ado named after the program, and this file's own
 * definitions and `program drop`s.
 */

const SETTER = [
    'program define setter',
    '    args dest',
    '    c_local `dest\' 1',
    'end',
    '',
].join('\n');

const USE = [
    'capture setter result',
    'display "`result\'"',
].join('\n');

interface Workspace {
    name: string;
    files: Record<string, string>;
    /** Locals reported undefined in main.do. */
    undefined: string[];
}

const WORKSPACES: Workspace[] = [
    // Programs persist after the do-file that defined them returns.
    ...(['run', 'do', 'include'] as const).map((my_command) => ({
        name: `${my_command} setup.do, which ${my_command}s library.do`,
        files: {
            'library.do': SETTER,
            'setup.do': `${my_command} library.do\n`,
            'main.do': `${my_command} setup.do\n${USE}\n`,
        },
        undefined: [],
    })),
    ...(['do', 'run', 'include'] as const).map((my_kind) => ({
        name: `// sight: ${my_kind} library.do`,
        files: {
            'library.do': SETTER,
            'main.do': `// sight: ${my_kind} library.do\n${USE}\n`,
        },
        undefined: [],
    })),
    {
        name: 'an ado named after the program, beside a .do defining it too',
        files: {
            'setter.ado': SETTER,
            'alib.do': SETTER,
            'main.do': `${USE}\n`,
        },
        undefined: [],
    },
    {
        name: 'the file actually run, beside another defining the program',
        files: {
            'zlib.do': SETTER,
            'alib.do': SETTER,
            'main.do': `run zlib.do\n${USE}\n`,
        },
        undefined: [],
    },
    {
        name: 'a call in a program body called after the load',
        files: {
            'library.do': SETTER,
            'main.do': [
                'program define caller',
                '    setter result',
                '    display "`result\'"',
                'end',
                'run library.do',
                'caller',
                '',
            ].join('\n'),
        },
        undefined: [],
    },
    {
        name: 'a load and the call on one line under #delimit ;',
        files: {
            'library.do': SETTER,
            'main.do': [
                '#delimit ;',
                'run library.do; setter result; display "`result\'";',
                '',
            ].join('\n'),
        },
        undefined: [],
    },
    {
        name: 'run with a subdirectory path',
        files: {
            'sub/library.do': SETTER,
            'main.do': `do "sub/library.do"\n${USE}\n`,
        },
        undefined: [],
    },
    {
        name: 'capture program drop, then define',
        files: {
            'main.do': `capture program drop setter\n${SETTER}${USE}\n`,
        },
        undefined: [],
    },
    // These must keep the warning.
    {
        name: 'a .do file never loaded',
        files: {
            'library.do': SETTER,
            'main.do': `${USE}\n`,
        },
        undefined: ['result'],
    },
    {
        name: 'a definition later at the top level of the same file',
        files: {
            'main.do': `${USE}\n${SETTER}`,
        },
        undefined: ['result'],
    },
    {
        name: 'a definition later in an if block of the same file',
        files: {
            'main.do': `${USE}\nif 1 {\n${SETTER}}\n`,
        },
        undefined: ['result'],
    },
    {
        name: 'a file with the same name in another directory',
        files: {
            'a/lib.do': 'display 1\n',
            'b/lib.do': SETTER,
            'main.do': `run a/lib.do\n${USE}\n`,
        },
        undefined: ['result'],
    },
    {
        name: 'a call after program drop',
        files: {
            'main.do': `${SETTER}program drop setter\n${USE}\n`,
        },
        undefined: ['result'],
    },
    {
        name: 'a load after the call',
        files: {
            'library.do': SETTER,
            'main.do': `${USE}\nrun library.do\n`,
        },
        undefined: ['result'],
    },
];

describe('sight check: which program a positional c_local call reaches', () => {
    for (const my_workspace of WORKSPACES) {
        it(my_workspace.name, async () => {
            const root = fs.realpathSync.native(fs.mkdtempSync(
                path.join(os.tmpdir(), 'sight-c-local-reach-')
            ));
            try {
                for (const [my_path, my_text] of Object.entries(my_workspace.files)) {
                    const full = path.join(root, my_path);
                    fs.mkdirSync(path.dirname(full), { recursive: true });
                    fs.writeFileSync(full, my_text);
                }
                const the_out: string[] = [];
                const the_err: string[] = [];
                await run_check_with_cwd(
                    ['--workspace', root, '--no-config', '--format', 'json', 'main.do'],
                    root,
                    {
                        stdout: (text) => the_out.push(text),
                        stderr: (text) => the_err.push(text),
                    }
                );
                expect(the_err.join('')).toBe('');
                const the_records = JSON.parse(the_out.join('')) as Array<{
                    path: string;
                    diagnostic: {
                        code?: string;
                        data?: { symbol_name?: string };
                    };
                }>;
                const the_names = the_records
                    .filter((my_record) => my_record.path === 'main.do'
                        && my_record.diagnostic.code === 'UNDEFINED_MACRO')
                    .map((my_record) =>
                        my_record.diagnostic.data?.symbol_name ?? '');
                expect(the_names).toEqual(my_workspace.undefined);
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        });
    }
});
