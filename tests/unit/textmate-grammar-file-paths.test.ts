/**
 * Tokenizer tests for statement-context awareness in filename arguments
 * (issue #187).
 *
 * Two highlight-only bugs were fixed:
 *   - STEM bug: the factor-variables rule tinted a filename stem that is a
 *     factor letter (`use i.dta` -> `i.` as keyword.operator.factor).
 *   - SUFFIX bug: an unanchored command rule tinted a filename extension that
 *     is a command name (`merp.do` -> `do` as a command).
 *
 * The fix adds: a global `(?<!\.)` lookbehind on command/keyword rules; single
 * token path scopes after bare file commands and after `using`; and a
 * statement-level factor-suppression region for import/export. These tests
 * pin the intended behavior AND guard against regressions — in particular that
 * legitimate factor variables in expression context stay tinted.
 *
 * Variable / filename stems deliberately use factor letters (i/c/o/b) so the
 * tests exercise the exact ambiguity that caused the bug.
 */

import { describe, it, expect } from 'bun:test';
import {
    tokenize_stata,
    find_token,
    has_scope,
    texts_with_scope,
    type ScopedToken,
} from './helpers/textmate-tokenizer';

const FACTOR = 'keyword.operator.factor.stata';
const CONTROL_FLOW = 'keyword.control.flow.stata';
const DATA_CMD = 'keyword.functions.data.stata';
const OTHER_KW = 'keyword.other.stata';

// All token texts carrying the factor-operator scope, in source order.
function factor_texts(the_tokens: ScopedToken[]): string[] {
    return texts_with_scope(the_tokens, FACTOR);
}

// Does ANY token carry one of the "command-ish" scopes the bugs produced?
const COMMAND_SCOPE_RE =
    /keyword\.control|keyword\.functions|keyword\.other\.command|support\.function/;
function any_command_scope_on(
    the_tokens: ScopedToken[],
    text_fragment: string
): boolean {
    return the_tokens.some(
        (my_token) =>
            my_token.text.includes(text_fragment) &&
            my_token.scopes.some((s) => COMMAND_SCOPE_RE.test(s))
    );
}

// Non-vacuous suffix check: is there a token whose text is EXACTLY `word`
// (the command-named extension, e.g. `do` in `merp.do`) carrying a command
// scope? On the buggy grammar the extension is split into such a token and
// scoped as a command, so this returns true; the fix makes it false.
function exact_token_has_command_scope(
    the_tokens: ScopedToken[],
    word: string
): boolean {
    return the_tokens.some(
        (my_token) =>
            my_token.text === word &&
            my_token.scopes.some((s) => COMMAND_SCOPE_RE.test(s))
    );
}

describe('TextMate Grammar - filename arguments (#187)', () => {
    describe('STEM bug: factor letter as a filename stem is inert', () => {
        it('after a bare file command (incl. use abbreviations)', async () => {
            for (const my_line of [
                'use i.dta',
                'u i.dta',
                'us i.dta',
                'do b.do',
                'use c.do',
                'save i.dta',
                'run i.do',
            ]) {
                const tokens = await tokenize_stata(my_line);
                expect(factor_texts(tokens), my_line).toEqual([]);
            }
        });

        it('after `using` (and `using` keyword is preserved)', async () => {
            for (const my_line of [
                'merge 1:1 id using i.dta',
                'import delimited using c.csv',
                'outreg2 using r.reg',
            ]) {
                const tokens = await tokenize_stata(my_line);
                expect(factor_texts(tokens), my_line).toEqual([]);
                expect(
                    has_scope(find_token(tokens, 'using'), OTHER_KW),
                    `${my_line}: using kept`
                ).toBe(true);
            }
        });

        it('throughout import/export statements', async () => {
            for (const my_line of [
                'import delimited i.csv',
                'export delimited c.csv',
                'import excel b.xlsx',
            ]) {
                const tokens = await tokenize_stata(my_line);
                expect(factor_texts(tokens), my_line).toEqual([]);
            }
        });
    });

    describe('SUFFIX bug: command-named extension is inert', () => {
        it('extension matching a command name gets no command scope', async () => {
            // [line, extension-word]. The extension word is what the bug
            // scoped as a command; assert that exact token is never command-
            // scoped (non-vacuous: it IS command-scoped on the buggy grammar).
            for (const [my_line, my_ext] of [
                ['use merp.do', 'do'],
                ['use merp.reg', 'reg'],
                ['use merp.list', 'list'],
                ['use merp.gen', 'gen'],
                ['use merp.display', 'display'],
                ['cd merp.do', 'do'],
                ['copy merp.log target', 'log'],
            ] as const) {
                const tokens = await tokenize_stata(my_line);
                expect(
                    exact_token_has_command_scope(tokens, my_ext),
                    `${my_line}: extension ".${my_ext}" should be inert`
                ).toBe(false);
            }
        });

        it('`do scratch.do`: leading do is the command, the .do extension is not', async () => {
            const tokens = await tokenize_stata('do scratch.do');
            // first token is the real `do` command
            expect(has_scope(tokens[0], CONTROL_FLOW)).toBe(true);
            // the filename (incl. its .do extension) carries no command scope
            expect(any_command_scope_on(tokens, 'scratch.do')).toBe(false);
        });
    });

    describe('boundary handling for the single-token path scope', () => {
        it('stops at a comma so trailing options still highlight', async () => {
            const tokens = await tokenize_stata('use i.dta,clear');
            expect(factor_texts(tokens)).toEqual([]);
            expect(has_scope(find_token(tokens, 'clear'), DATA_CMD)).toBe(true);
        });

        it('stops at // and /// comments', async () => {
            for (const my_line of ['use i.dta // note', 'use i.dta///x']) {
                const tokens = await tokenize_stata(my_line);
                expect(factor_texts(tokens), my_line).toEqual([]);
                expect(
                    tokens.some((t) => t.scopes.some((s) => s.startsWith('comment'))),
                    `${my_line}: comment preserved`
                ).toBe(true);
            }
        });

        it('handles tabs and multiple spaces', async () => {
            for (const my_line of ['use\ti.dta', 'use   i.dta']) {
                const tokens = await tokenize_stata(my_line);
                expect(factor_texts(tokens), my_line).toEqual([]);
            }
        });

        it('stops at a /* block comment with no leading space', async () => {
            const tokens = await tokenize_stata('use i.dta/* c */');
            expect(factor_texts(tokens)).toEqual([]);
            expect(
                tokens.some((t) => t.scopes.some((s) => s.startsWith('comment.block')))
            ).toBe(true);
        });

        it('does not swallow a following `;`-separated statement', async () => {
            // delimit-style two statements on one physical line: the factor in
            // the SECOND statement must remain tinted.
            const tokens = await tokenize_stata(
                'import delimited i.csv; regress y i.x'
            );
            expect(factor_texts(tokens)).toEqual(['i.']);
        });
    });

    describe('direct filesystem commands', () => {
        it('cd/erase/mkdir/rmdir/dir/ls/shell/type stems are inert', async () => {
            for (const my_line of [
                'cd i.dir',
                'erase i.do',
                'mkdir i.foo',
                'rmdir o.bar',
                'ls i.x',
                'dir i.x',
                'shell i.x',
                'type i.do',
            ]) {
                expect(factor_texts(await tokenize_stata(my_line)), my_line).toEqual([]);
            }
        });

        it('copy fixes the first path; the second is a documented residual', async () => {
            // copy takes TWO paths; the single-token anchor neutralizes the
            // first, so only the second stem tints (see spec §6).
            const tokens = await tokenize_stata('copy i.do c.do');
            expect(factor_texts(tokens)).toEqual(['c.']);
        });

        it('does NOT fire on extended macro functions (: type / : copy / : dir)', async () => {
            // These share a name with fs commands but are macro extended
            // functions after `:`; the anchor excludes `:` so the extended-fn
            // rule still wins (the fs command rule must NOT have fired and
            // re-scoped the keyword as a command).
            const EXT_FN = 'keyword.macro.extendedfcn.stata';
            const FS_CMD = 'keyword.other.command.stata';
            for (const my_line of [
                'local x : type price',
                'local x : copy price',
                'local x : dir',
            ]) {
                const tokens = await tokenize_stata(my_line);
                // extended-fn rule recognized it...
                expect(
                    tokens.some((t) => t.scopes.includes(EXT_FN)),
                    `${my_line}: extended fn should be recognized`
                ).toBe(true);
                // ...and it was NOT re-scoped as an fs command.
                expect(
                    tokens.some((t) => t.scopes.includes(FS_CMD)),
                    `${my_line}: must not be scoped as a command`
                ).toBe(false);
            }
        });
    });

    describe('`use varlist using file` interaction', () => {
        it('neutralizes only the filename, keeps `using`', async () => {
            const tokens = await tokenize_stata('use rep78 using i.dta');
            expect(factor_texts(tokens)).toEqual([]);
            expect(has_scope(find_token(tokens, 'using'), OTHER_KW)).toBe(true);
        });
    });

    describe('quoted / macro paths still highlight', () => {
        it('quoted path keeps string scope', async () => {
            const tokens = await tokenize_stata('use "my data.dta"');
            expect(
                tokens.some((t) => t.scopes.some((s) => s.startsWith('string')))
            ).toBe(true);
        });

        it('macro path keeps macro + string scopes', async () => {
            const tokens = await tokenize_stata('do "`path\'/setup.do"');
            expect(
                tokens.some((t) =>
                    t.scopes.some((s) => s.startsWith('variable.other.macro'))
                )
            ).toBe(true);
            expect(
                tokens.some((t) => t.scopes.some((s) => s.startsWith('string')))
            ).toBe(true);
        });

        it('bare local macro path keeps macro scope', async () => {
            const tokens = await tokenize_stata("use `mydata'");
            expect(
                tokens.some((t) =>
                    t.scopes.some((s) => s.startsWith('variable.other.macro'))
                )
            ).toBe(true);
        });
    });

    describe('NO regressions: legitimate highlighting preserved', () => {
        it('factor variables in expression context stay tinted', async () => {
            // bare estimation command
            expect(
                has_scope(
                    find_token(await tokenize_stata('regress y i.treatment'), 'i.'),
                    FACTOR
                )
            ).toBe(true);
            // factor varlist BEFORE `using` must NOT be suppressed
            expect(
                has_scope(
                    find_token(
                        await tokenize_stata('outreg2 i.treatment using results'),
                        'i.'
                    ),
                    FACTOR
                )
            ).toBe(true);
        });

        it('a command word mid-varlist/expression does NOT start a path region', async () => {
            // `u`/`run`/`import`/`use` can appear as a variable name or
            // mid-expression token. The path/io regions must be anchored to
            // statement position so they do not swallow a following factor
            // variable or operator. (Regression guard — see #187 review.)
            for (const my_line of [
                'regress y u i.treatment',
                'regress y run i.x',
                'regress y import i.treatment',
                'gen z = u + i.treatment',
            ]) {
                const tokens = await tokenize_stata(my_line);
                expect(has_scope(find_token(tokens, 'i.'), FACTOR), my_line).toBe(true);
            }
            // and the arithmetic operator is not swallowed either
            const ts = await tokenize_stata('gen z = u + i.treatment');
            expect(has_scope(find_token(ts, '+'), 'keyword.operator.arithmetic.stata')).toBe(true);
        });

        it('prefix commands (quietly/capture) still get the path fix', async () => {
            for (const my_line of ['quietly use i.dta', 'capture use i.dta', 'qui do b.do']) {
                expect(factor_texts(await tokenize_stata(my_line)), my_line).toEqual([]);
            }
        });

        it('file commands keep their own keyword scope', async () => {
            expect(
                has_scope(find_token(await tokenize_stata('do scratch'), 'do'), CONTROL_FLOW)
            ).toBe(true);
            expect(
                has_scope(find_token(await tokenize_stata('run setup.do'), 'run'), CONTROL_FLOW)
            ).toBe(true);
            expect(
                has_scope(find_token(await tokenize_stata('use mydata, clear'), 'use'), DATA_CMD)
            ).toBe(true);
        });

        it('options after a `using` path still highlight', async () => {
            const tokens = await tokenize_stata(
                'merge 1:1 id using other.dta, keep(3)'
            );
            expect(has_scope(find_token(tokens, 'keep'), DATA_CMD)).toBe(true);
        });

        it('ordinary commands unaffected', async () => {
            expect(
                has_scope(
                    find_token(await tokenize_stata('display "hi"'), 'display'),
                    'keyword.other.command.stata'
                )
            ).toBe(true);
            expect(
                has_scope(find_token(await tokenize_stata('gen x = 1'), 'gen'), DATA_CMD)
            ).toBe(true);
            expect(
                has_scope(
                    find_token(await tokenize_stata('summarize income'), 'summarize'),
                    'keyword.other.command.stata'
                )
            ).toBe(true);
        });
    });
});

describe('TextMate Grammar - import/export filename stems (#188)', () => {
    describe('a command-name stem in the filename is inert', () => {
        it('import/export <subcommand> <stem-named-as-command>', async () => {
            // [line, stem-word]. The stem matches a command name; on the
            // pre-#188 grammar it is split out and command-scoped, so this is
            // a non-vacuous check.
            for (const [my_line, my_stem] of [
                ['import delimited table.csv', 'table'],
                ['export delimited do.csv', 'do'],
                ['import excel list.xlsx', 'list'],
            ] as const) {
                const tokens = await tokenize_stata(my_line);
                expect(
                    exact_token_has_command_scope(tokens, my_stem),
                    `${my_line}: stem "${my_stem}" should be inert`
                ).toBe(false);
                expect(
                    any_command_scope_on(
                        tokens,
                        my_line.split(' ').at(-1) as string
                    ),
                    `${my_line}: whole filename should be inert`
                ).toBe(false);
            }
        });
    });

    describe('options after the filename still highlight', () => {
        it('import delimited x.csv, clear → clear kept', async () => {
            const tokens = await tokenize_stata('import delimited x.csv, clear');
            expect(has_scope(find_token(tokens, 'clear'), DATA_CMD)).toBe(true);
        });
    });

    describe('filename shapes the single-token region must consume whole', () => {
        it('no-extension command-name stem is inert', async () => {
            const tokens = await tokenize_stata('import delimited table');
            expect(
                exact_token_has_command_scope(tokens, 'table'),
                'bare "table" filename should be inert'
            ).toBe(false);
        });

        it('multi-dot filename is not split into a command stem', async () => {
            const tokens = await tokenize_stata('import delimited list.tar.gz');
            expect(
                exact_token_has_command_scope(tokens, 'list'),
                'list.tar.gz stem should be inert'
            ).toBe(false);
        });

        it('quoted path keeps string scope (region includes #strings)', async () => {
            const tokens = await tokenize_stata(
                'import delimited "my save.csv"'
            );
            expect(
                tokens.some((t) => t.scopes.some((s) => s.startsWith('string'))),
                'quoted import path should be a string'
            ).toBe(true);
        });
    });

    describe('regression guards', () => {
        it('import delimited using i.dta → i. inert, using kept', async () => {
            const tokens = await tokenize_stata('import delimited using i.dta');
            expect(factor_texts(tokens)).toEqual([]);
            expect(has_scope(find_token(tokens, 'using'), OTHER_KW)).toBe(true);
        });

        it('import delimited i.csv → i. inert (no #187 regression)', async () => {
            const tokens = await tokenize_stata('import delimited i.csv');
            expect(factor_texts(tokens)).toEqual([]);
        });

        it('import command word still carries its data-command scope', async () => {
            for (const my_line of [
                'import delimited table.csv',
                'import delimited using i.dta',
            ]) {
                const tokens = await tokenize_stata(my_line);
                expect(
                    has_scope(find_token(tokens, 'import'), DATA_CMD),
                    `${my_line}: import kept`
                ).toBe(true);
            }
        });
    });

    describe('insheet/infile/outsheet (full handling)', () => {
        it('post-using filename stem is inert, using kept', async () => {
            for (const [my_line, my_stem] of [
                ['insheet using table.csv', 'table'],
                ['outsheet using list.csv', 'list'],
            ] as const) {
                const tokens = await tokenize_stata(my_line);
                expect(
                    exact_token_has_command_scope(tokens, my_stem),
                    `${my_line}: stem "${my_stem}" should be inert`
                ).toBe(false);
                expect(
                    has_scope(find_token(tokens, 'using'), OTHER_KW),
                    `${my_line}: using kept`
                ).toBe(true);
            }
        });

        it('a varlist before using keeps the post-using filename inert', async () => {
            // Non-vacuous: `list` is a command name, so the post-`using`
            // filename stem would be command-tinted if the fall-through to
            // #path-after-using did not fire.
            const tokens = await tokenize_stata(
                'infile var1 var2 using list.csv'
            );
            expect(
                exact_token_has_command_scope(tokens, 'list'),
                'list.csv stem should be inert'
            ).toBe(false);
            expect(has_scope(find_token(tokens, 'using'), OTHER_KW)).toBe(true);
        });
    });

    describe('filenames whose stem is the literal word "using"', () => {
        // A real file can be named `using.dta`. The standalone-`using` guard
        // must fire ONLY for `using` as a separate token (`... using file`),
        // not for a path whose first component happens to be `using`. (Codex
        // adversarial review, #188.)
        // These assert OTHER_KW is absent ENTIRELY rather than probing for a
        // `using` token by exact text: a broken guard splits `using` into its
        // own keyword token, making OTHER_KW non-empty, so the check is
        // non-vacuous regardless of how the filename is tokenized.
        it('use/save using.dta → no spurious using keyword', async () => {
            for (const my_line of ['use using.dta', 'save using.dta']) {
                const tokens = await tokenize_stata(my_line);
                expect(
                    texts_with_scope(tokens, OTHER_KW),
                    `${my_line}: "using" stem must not be the using keyword`
                ).toEqual([]);
            }
        });

        it('import delimited using.csv / using/file.csv → inert path', async () => {
            for (const my_line of [
                'import delimited using.csv',
                'import delimited using/file.csv',
            ]) {
                const tokens = await tokenize_stata(my_line);
                expect(
                    texts_with_scope(tokens, OTHER_KW),
                    `${my_line}: "using" stem must not be the using keyword`
                ).toEqual([]);
            }
        });

        it('using/file.csv keeps its command-named component inert', async () => {
            // `file` is itself a command name; if the path were split on `/`
            // the `file` component would be command-tinted. (Non-vacuous.)
            const tokens = await tokenize_stata(
                'import delimited using/file.csv'
            );
            expect(exact_token_has_command_scope(tokens, 'file')).toBe(false);
        });

        it('`using` is never swallowed as the import subcommand', async () => {
            // `import using x` is not valid Stata, but the subcommand slot
            // must not consume `using` — it stays the keyword. (Finder C, #188.)
            const tokens = await tokenize_stata('import using x.csv');
            expect(has_scope(find_token(tokens, 'using'), OTHER_KW)).toBe(true);
        });

        it('standalone `using` is still highlighted (guard is precise)', async () => {
            const tokens = await tokenize_stata('import delimited using x.csv');
            expect(has_scope(find_token(tokens, 'using'), OTHER_KW)).toBe(true);
            expect(factor_texts(tokens)).toEqual([]);
        });
    });

    describe('documented residual: a comment before the filename', () => {
        it('import/export behaves identically to use/save', async () => {
            // A `/* */` comment between the command and the filename ends the
            // single-token path region early, so the filename is re-scanned by
            // the top-level rules and a factor-letter stem re-tints. This is a
            // shared limitation of ALL single-token path rules (introduced in
            // #187, not by #188). #188 makes import/export CONSISTENT with
            // use/save here rather than fixing it (the fix is a cross-cutting
            // change to every path rule, out of scope). Asserting equality —
            // not a specific scope — tracks the residual and ensures a future
            // fix flips both together. (Codex adversarial review, #188.)
            const io = await tokenize_stata('import delimited /* c */ i.csv');
            const data = await tokenize_stata('use /* c */ i.dta');
            expect(factor_texts(io)).toEqual(factor_texts(data));
        });
    });
});
