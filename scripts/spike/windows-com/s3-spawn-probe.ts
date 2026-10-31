import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const output_dir = process.argv[2];
if (!output_dir) throw new Error('Expected output directory');
for (const detached of [false, true]) {
    const target = `${output_dir}\\s3-probe-${detached}.txt`;
    const child = spawn('powershell.exe', [
        '-NoProfile', '-Command', `Set-Content -LiteralPath '${target}' -Value 'started'`,
    ], { detached, windowsHide: true, stdio: 'ignore' });
    const status = await new Promise<string>((resolve) => {
        child.on('error', (error) => resolve(`error=${error}`));
        child.on('exit', (code, signal) => resolve(`code=${code} signal=${signal}`));
    });
    writeFileSync(`${output_dir}\\s3-probe-${detached}.status`, status);
}
