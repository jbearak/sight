const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vscode = require('vscode');

const LOG_PATH = path.resolve(
    __dirname,
    'extension-smoke.log'
);

function log(message) {
    fs.appendFileSync(
        LOG_PATH,
        `[${new Date().toISOString()}] ${message}\n`
    );
}

function sleep(timeout_ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, timeout_ms);
    });
}

async function wait_for(
    predicate,
    timeout_ms,
    interval_ms = 50
) {
    const start_ms = Date.now();
    while (Date.now() - start_ms < timeout_ms) {
        const result = await predicate();
        if (result) {
            return result;
        }
        await sleep(interval_ms);
    }
    throw new Error('Timed out waiting for condition');
}

async function close_all_editors() {
    await vscode.commands.executeCommand(
        'workbench.action.closeAllEditors'
    );
    await sleep(150);
}

async function run() {
    fs.writeFileSync(LOG_PATH, '');
    log('Starting extension smoke test');

    const my_extension = vscode.extensions.getExtension(
        'jbearak.sight'
    );
    assert.ok(my_extension, 'Sight extension should exist');
    log(`Found extension at ${my_extension.extensionPath}`);
    await my_extension.activate();
    log('Extension activated');

    const the_created_panels = [];
    const my_original_create_webview_panel =
        vscode.window.createWebviewPanel.bind(
            vscode.window
        );
    vscode.window.createWebviewPanel = function (
        ...args
    ) {
        the_created_panels.push({
            view_type: args[0],
            title: args[1],
        });
        log(
            `createWebviewPanel(${args[0]}, ${args[1]})`
        );
        return my_original_create_webview_panel(...args);
    };

    const my_browse_dir = path.join(
        os.homedir(),
        '.sight',
        'browse'
    );
    fs.mkdirSync(my_browse_dir, { recursive: true });

    const my_fixture_path = path.resolve(
        my_extension.extensionPath,
        '..',
        'tests',
        'fixtures',
        'dta',
        'auto_v118.dta'
    );
    assert.ok(
        fs.existsSync(my_fixture_path),
        `Fixture not found: ${my_fixture_path}`
    );
    log(`Using fixture ${my_fixture_path}`);

    const my_uuid =
        `_extsmoke_${Date.now()}_${process.pid}`;
    const my_name = `vview-smoke-${Date.now()}`;
    const my_signal_path = path.join(
        my_browse_dir,
        `signal_${my_uuid}`
    );
    const my_json_path = path.join(
        my_browse_dir,
        `${my_uuid}.json`
    );
    const my_browse_dta_path = path.join(
        my_browse_dir,
        `${my_uuid}.dta`
    );

    const my_sidecar = {
        version: 1,
        uuid: my_uuid,
        timestamp: new Date().toISOString(),
        source: '/Applications/Stata/ado/base/a/auto.dta',
        name: my_name,
        dtapath: `~/.sight/browse/${my_uuid}.dta`,
        varlist: ['make', 'price'],
        if: 'foreign == 1',
        in: '1/10',
        N: 74,
        k: 12,
        replace: false,
        subsetted: true,
    };

    try {
        await close_all_editors();
        log('Closed editors');

        fs.copyFileSync(
            my_fixture_path,
            my_browse_dta_path
        );
        log(`Copied ${my_browse_dta_path}`);
        fs.writeFileSync(
            my_json_path,
            JSON.stringify(my_sidecar)
        );
        log(`Wrote ${my_json_path}`);
        fs.writeFileSync(my_signal_path, my_uuid);
        log(`Wrote ${my_signal_path}`);

        const my_panel_title = await wait_for(
            async () => {
                return the_created_panels.find(
                    (my_panel) =>
                        my_panel.title
                        === `Data: ${my_name}`
                );
            },
            5000
        );
        log(`Observed panel ${my_panel_title.title}`);

        assert.strictEqual(
            my_panel_title.title,
            `Data: ${my_name}`,
            `Expected data browser panel. Panels: ${JSON.stringify(the_created_panels)}`
        );
    } finally {
        vscode.window.createWebviewPanel =
            my_original_create_webview_panel;
        try {
            fs.unlinkSync(my_signal_path);
        } catch {}
        try {
            fs.unlinkSync(my_json_path);
        } catch {}
        try {
            fs.unlinkSync(my_browse_dta_path);
        } catch {}
        await close_all_editors();
        log('Finished smoke test cleanup');
    }
}

module.exports = {
    run,
};
