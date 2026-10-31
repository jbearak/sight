const assert = require('assert');
const runtime = require('C:\\sight-debug\\client\\console-runtime\\console.js');
assert.strictEqual(runtime.EDITOR_CONSOLE_API_VERSION, 1);
assert.strictEqual(typeof runtime.start_editor_console, 'function');
console.log('console runtime API version 1 loaded');
