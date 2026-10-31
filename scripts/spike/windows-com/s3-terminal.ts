// Run from a real terminal host after starting a marked throwaway Stata.
// Usage: bun s3-terminal.ts <Stata PID> <marker> <evidence path>
import { spawn } from 'node:child_process';
import { openSync, appendFileSync } from 'node:fs';

const [stata_pid, marker, evidence] = process.argv.slice(2);
if (!stata_pid || !marker || !evidence) {
    throw new Error('Expected Stata PID, marker, and evidence path');
}
const error_log = openSync(`${evidence}.stderr`, 'a');
const helper = spawn('powershell.exe', [
    '-Sta', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    process.env.SIGHT_SPIKE_HELPER ?? 'Y:\\sight\\scripts\\spike\\windows-com\\s3-keeper.ps1',
    '-StataPid', stata_pid, '-Marker', marker, '-Evidence', evidence,
], { detached: true, windowsHide: true, stdio: ['ignore', error_log, error_log] });
helper.on('error', (error) => appendFileSync(`${evidence}.events`, `error=${error}\n`));
helper.on('exit', (code, signal) => appendFileSync(`${evidence}.events`, `exit=${code} signal=${signal} args=${helper.spawnargs.join('|')}\n`));
helper.unref();
console.log(`Bun PID ${process.pid}; helper PID ${helper.pid}`);
console.log(`Check ${evidence} for the marker, then close this terminal window.`);
setInterval(() => {}, 1000);
