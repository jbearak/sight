import { describe, expect, it } from 'bun:test';
import {
    PANE_ONLY_NOTE,
    TargetChooser,
    is_ask_setting,
    menu_entries,
    type MenuAction,
    type MenuEntry,
    type TargetChoice,
} from '../../../client/src/send-to-stata/target-choice-core';

interface FakeHostOptions {
    platform?: NodeJS.Platform;
    remote?: boolean;
    user_setting?: string;
    workspace_setting?: string;
    fail_save?: boolean;
}

/** Answers each menu with the next action in `answers`. */
function fake_host(answers: Array<MenuAction | undefined>, options: FakeHostOptions = {}) {
    const state = {
        user_setting: options.user_setting,
        menus: [] as MenuEntry[][],
        saves: [] as Array<TargetChoice | undefined>,
        docs_opened: 0,
        info: [] as string[],
        errors: [] as string[],
    };
    const chooser = new TargetChooser({
        platform: options.platform ?? 'darwin',
        is_remote: () => options.remote === true,
        effective_setting: () => options.workspace_setting ?? state.user_setting,
        pick: (entries) => {
            state.menus.push(entries);
            return Promise.resolve(answers.shift());
        },
        open_docs: () => {
            state.docs_opened++;
            return Promise.resolve();
        },
        save_user_setting: (value) => {
            if (options.fail_save) {
                return Promise.reject(new Error('read-only settings'));
            }
            state.saves.push(value);
            state.user_setting = value;
            return Promise.resolve();
        },
        inform: (text) => state.info.push(text),
        error: (text) => state.errors.push(text),
    });
    return { chooser, state };
}

function labels(entries: MenuEntry[]): string[] {
    return entries.map((my_entry) => my_entry.label);
}

const SESSION_APP: MenuAction = { kind: 'session', target: 'external' };
const SESSION_PANE: MenuAction = { kind: 'session', target: 'integrated' };
const ALWAYS_PANE: MenuAction = { kind: 'always', target: 'integrated' };
const ALWAYS_APP: MenuAction = { kind: 'always', target: 'external' };

describe('TargetChooser', () => {
    it('uses the pane without asking in remote sessions and on Linux', async () => {
        for (const my_options of [{ remote: true }, { platform: 'linux' as const }]) {
            const { chooser, state } = fake_host([], my_options);
            expect(await chooser.resolve()).toBe('integrated');
            expect(state.menus).toEqual([]);
        }
    });

    it('asks on local macOS and Windows', async () => {
        for (const my_platform of ['darwin', 'win32'] as const) {
            const { chooser, state } = fake_host([SESSION_PANE], { platform: my_platform });
            expect(await chooser.resolve()).toBe('integrated');
            expect(state.menus).toHaveLength(1);
        }
    });

    it('keeps a this-session choice without asking again or saving', async () => {
        const { chooser, state } = fake_host([SESSION_APP]);
        expect(await chooser.resolve()).toBe('external');
        expect(await chooser.resolve()).toBe('external');
        expect(state.menus).toHaveLength(1);
        expect(state.saves).toEqual([]);
    });

    it('cancels the send when the menu is dismissed, and asks next time', async () => {
        const { chooser, state } = fake_host([undefined, SESSION_PANE]);
        expect(await chooser.resolve()).toBeNull();
        expect(await chooser.resolve()).toBe('integrated');
        expect(state.menus).toHaveLength(2);
    });

    it('shows one menu for sends made while it is open', async () => {
        const { chooser, state } = fake_host([SESSION_APP]);
        const the_results = await Promise.all([chooser.resolve(), chooser.resolve()]);
        expect(the_results).toEqual(['external', 'external']);
        expect(state.menus).toHaveLength(1);
    });

    it('opens the docs for Read more and shows the menu again', async () => {
        const { chooser, state } = fake_host([{ kind: 'read_more' }, SESSION_PANE]);
        expect(await chooser.resolve()).toBe('integrated');
        expect(state.docs_opened).toBe(1);
        expect(state.menus).toHaveLength(2);
    });

    it('saves Always in the user settings', async () => {
        const { chooser, state } = fake_host([ALWAYS_APP]);
        expect(await chooser.resolve()).toBe('external');
        expect(state.saves).toEqual(['external']);
        expect(state.info).toEqual([]);
    });

    it('says so when a workspace setting overrides Always, and uses it this session', async () => {
        const { chooser, state } = fake_host([ALWAYS_PANE], { workspace_setting: 'ask' });
        expect(await chooser.resolve()).toBe('integrated');
        expect(state.saves).toEqual(['integrated']);
        expect(state.info).toHaveLength(1);
        expect(state.info[0]).toContain('overrides');
        expect(await chooser.resolve()).toBe('integrated');
        expect(state.menus).toHaveLength(1);
    });

    it('reports a failed save and uses the choice this session', async () => {
        const { chooser, state } = fake_host([ALWAYS_APP], { fail_save: true });
        expect(await chooser.resolve()).toBe('external');
        expect(state.errors[0]).toContain('read-only settings');
        expect(await chooser.resolve()).toBe('external');
        expect(state.menus).toHaveLength(1);
    });

    it('lets the command change a this-session choice', async () => {
        const { chooser, state } = fake_host([SESSION_APP, SESSION_PANE]);
        expect(await chooser.resolve()).toBe('external');
        await chooser.choose_from_command();
        expect(await chooser.resolve()).toBe('integrated');
        expect(state.menus).toHaveLength(2);
    });

    it('offers Always or asking again from the command once the setting chose', async () => {
        const { chooser, state } = fake_host(
            [{ kind: 'ask' }],
            { user_setting: 'external' }
        );
        await chooser.choose_from_command();
        const the_labels = labels(state.menus[0] ?? []);
        expect(the_labels).not.toContain('$(window) Stata app');
        expect(the_labels).toContain('$(question) Ask each session');
        expect(state.saves).toEqual([undefined]);
    });

    it('explains the command where only the pane works', async () => {
        const { chooser, state } = fake_host([], { platform: 'linux' });
        await chooser.choose_from_command();
        expect(state.menus).toEqual([]);
        expect(state.info).toEqual([PANE_ONLY_NOTE]);
    });
});

describe('menu_entries', () => {
    it('offers this session, every session, and Read more under ask', () => {
        expect(labels(menu_entries('darwin', true))).toEqual([
            'This session',
            '$(terminal) Stata pane',
            '$(window) Stata app',
            'Every session (saved in settings)',
            '$(terminal) Always use the Stata pane',
            '$(window) Always use the Stata app',
            '',
            '$(book) Read more…',
        ]);
    });

    it('describes the Windows pane as sight console', () => {
        const pane = menu_entries('win32', true)[1];
        expect(pane?.kind === 'item' ? pane.detail : '').toContain('sight console');
    });
});

describe('is_ask_setting', () => {
    it('treats auto and unset as ask', () => {
        expect(is_ask_setting('ask')).toBe(true);
        expect(is_ask_setting('auto')).toBe(true);
        expect(is_ask_setting(undefined)).toBe(true);
        expect(is_ask_setting('integrated')).toBe(false);
        expect(is_ask_setting('external')).toBe(false);
    });
});
