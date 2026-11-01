/* eslint-env node, mocha */
/**
 * Sight's Stata console in a Perch session, end to end: the real Perch
 * extension and binary, Sight treating the local window as remote
 * (SIGHT_TEST_PERCH_REMOTE=1, read only in extension tests), and the
 * fake Stata from tests/fixtures/console/fake-stata.ts as `stata-mp`,
 * which appends each do-file it runs to FAKE_STATA_LOG.
 *
 * ../runTest.js runs it twice with one profile: `start` (the console
 * starts in a session; closing its terminal leaves it running; a send
 * reaches it detached and after reattaching), then `adopt` (after the
 * window restarts, Perch restores the terminal, Sight adopts it, and a
 * send reaches the same session; after the session ends, the next send
 * starts a new one).
 */

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

const PHASE = process.env.SIGHT_PERCH_E2E_PHASE;
const WORK_DIR = process.env.SIGHT_PERCH_E2E_DIR;
const LOG_PATH = process.env.FAKE_STATA_LOG;
const PERCH_BIN = process.env.SIGHT_PERCH_E2E_PERCH_BIN;
const REPORT_PATH = path.join(WORK_DIR, 'report.txt');
const SESSION_ID_PATH = path.join(WORK_DIR, 'session-id');
const OWNER = 'jbearak.sight';

/** Notifications shown while the suite runs, for a failure report. */
const the_messages = [];
for (const my_kind of ['showErrorMessage', 'showWarningMessage', 'showInformationMessage']) {
    const original = vscode.window[my_kind].bind(vscode.window);
    vscode.window[my_kind] = (message, ...the_rest) => {
        the_messages.push(`${my_kind}: ${message}`);
        return original(message, ...the_rest);
    };
}

function report(line) {
    fs.appendFileSync(REPORT_PATH, `[${PHASE}] ${line}\n`);
}

function sleep(time_ms) {
    return new Promise(resolve => setTimeout(resolve, time_ms));
}

async function wait_for(predicate, what, timeout_ms = 30000) {
    const deadline_ms = Date.now() + timeout_ms;
    for (;;) {
        const value = await predicate();
        if (value) {
            return value;
        }
        if (Date.now() > deadline_ms) {
            throw new Error(`Timed out waiting for ${what}`);
        }
        await sleep(200);
    }
}

function stata_log() {
    try {
        return fs.readFileSync(LOG_PATH, 'utf8');
    } catch {
        return '';
    }
}

function perch_list() {
    return execFileSync(PERCH_BIN, ['list'], { encoding: 'utf8' }).trim();
}

/** Send a do-file with `marker` through Sight's command, as a user does. */
async function send_marker(marker) {
    const file_path = path.join(WORK_DIR, 'workspace', `${marker}.do`);
    fs.writeFileSync(file_path, `display "${marker}"\n`);
    const document = await vscode.workspace.openTextDocument(file_path);
    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand('sight.doFile');
    try {
        await wait_for(
            () => stata_log().includes(marker), `${marker} in Stata`
        );
    } catch (my_error) {
        report(`FAILED waiting for ${marker}`);
        report(`messages: ${JSON.stringify(the_messages)}`);
        report(`terminals: ${JSON.stringify(vscode.window.terminals.map(
            my_terminal => [my_terminal.name, my_terminal.creationOptions]
        ))}`);
        report(`perch list --all:\n${execFileSync(PERCH_BIN, ['list', '--all'], { encoding: 'utf8' })}`);
        throw my_error;
    }
    report(`${marker} reached Stata`);
}

async function sight_sessions(api) {
    const the_sessions = await api.listSessions({ owner: OWNER });
    return the_sessions.filter(my_session =>
        ['starting', 'running', 'unresponsive'].includes(my_session.state)
    );
}

function sight_terminals(api) {
    return api.terminals().filter(my_entry => my_entry.session.owner === OWNER);
}

describe(`Sight in a Perch session (${PHASE})`, function () {
    let api;

    before(async function () {
        const perch = vscode.extensions.getExtension('jbearak.perch');
        assert.ok(perch, 'Perch is loaded');
        const exports = await perch.activate();
        api = exports.getApi(1, 'sight-e2e');
        assert.ok(await api.available(), 'Perch is available');
        const sight = vscode.extensions.getExtension('jbearak.sight');
        assert.ok(sight, 'Sight is loaded');
        await sight.activate();
    });

    if (PHASE === 'start') {
        it('starts the console in a Perch session; it survives a closed terminal', async function () {
            assert.deepStrictEqual(await sight_sessions(api), []);
            await send_marker('marker-1');
            const the_sessions = await sight_sessions(api);
            assert.strictEqual(the_sessions.length, 1);
            const session = the_sessions[0];
            assert.strictEqual(session.kind, 'stata');
            assert.strictEqual(session.annotations['sight.console'], 'editor');
            fs.writeFileSync(SESSION_ID_PATH, session.id);
            report(`console started in Perch session ${session.id}`);
            report(`perch list:\n${perch_list()}`);
            assert.ok(fs.existsSync(path.join(session.dir, 'sight-console-ready')));

            // Close the terminal: a detach.
            const the_terminals = sight_terminals(api);
            assert.strictEqual(the_terminals.length, 1);
            const closed = new Promise(resolve => {
                const listener = vscode.window.onDidCloseTerminal(my_terminal => {
                    if (my_terminal === the_terminals[0].terminal) {
                        listener.dispose();
                        resolve();
                    }
                });
            });
            the_terminals[0].terminal.dispose();
            await closed;
            await sleep(1000);
            const after_close = await sight_sessions(api);
            assert.deepStrictEqual(after_close.map(my_session => my_session.id), [session.id]);
            assert.strictEqual(after_close[0].attached, false);
            assert.strictEqual(sight_terminals(api).length, 0);
            report(`terminal closed; session still running, detached:\n${perch_list()}`);

            // A send while detached reaches it, without a terminal.
            await send_marker('marker-2');
            assert.deepStrictEqual(
                (await sight_sessions(api)).map(my_session => my_session.id),
                [session.id]
            );
            assert.strictEqual(sight_terminals(api).length, 0);
            report('send while detached: same session, no new terminal');

            // Reattach (Perch's Sessions view does this), then send.
            await api.attach(session.id, { show: true });
            await wait_for(() => sight_terminals(api).length === 1, 'the reattached terminal');
            await sleep(500);
            await send_marker('marker-3');
            assert.deepStrictEqual(
                (await sight_sessions(api)).map(my_session => my_session.id),
                [session.id]
            );
            report('send after reattach: same session');
            // Leave it attached: the window closes next, and Perch
            // restores the terminal when it reopens.
        });
    }

    if (PHASE === 'adopt') {
        it('adopts the restored session after the window restarts; a new session after it ends', async function () {
            const session_id = fs.readFileSync(SESSION_ID_PATH, 'utf8');
            await wait_for(
                () => sight_terminals(api).some(my_entry => my_entry.session.id === session_id),
                'Perch to restore the terminal'
            );
            report(`Perch restored the terminal of ${session_id}`);
            await sleep(1000);
            await send_marker('marker-4');
            assert.deepStrictEqual(
                (await sight_sessions(api)).map(my_session => my_session.id),
                [session_id]
            );
            report('send after restart: adopted the same session');

            const ended = new Promise(resolve => {
                const listener = api.onDidEndSession(my_session => {
                    if (my_session.id === session_id) {
                        listener.dispose();
                        resolve();
                    }
                });
            });
            await api.kill(session_id);
            await ended;
            await sleep(500);
            await send_marker('marker-5');
            const the_sessions = await sight_sessions(api);
            assert.strictEqual(the_sessions.length, 1);
            assert.notStrictEqual(the_sessions[0].id, session_id);
            report(`after the session ended, a new one: ${the_sessions[0].id}`);
            await api.kill(the_sessions[0].id);
            report(`perch list at the end:\n${perch_list()}`);
        });
    }
});
