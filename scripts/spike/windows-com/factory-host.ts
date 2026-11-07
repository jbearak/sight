// Run a PowerShell file in the Parallels desktop user's session.
// EncodedCommand avoids prlctl's additional command-line quote parsing.
import { resolve } from 'node:path';

const [file, ...args] = process.argv.slice(2);
if (!file) throw new Error('Usage: bun factory-host.ts file.ps1 [arguments]');
const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
const local_path = resolve(file);
if (!local_path.startsWith('/Users/jmb/')) throw new Error('Expected Home share');
const windows_path = '\\\\Mac\\Home\\' + local_path.slice(11).replaceAll('/', '\\');
const command = '& ' + quote(windows_path) + ' ' + args.map((arg) =>
    /^-[A-Za-z]+$/.test(arg) ? arg : quote(arg)).join(' ')
    + '; exit $LASTEXITCODE';
const encoded = Buffer.from(command, 'utf16le').toString('base64');
const child = Bun.spawn(['prlctl', 'exec', 'Windows 11', '--current-user',
    'powershell.exe', '-Sta', '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', encoded], { stdout: 'inherit', stderr: 'inherit' });
process.exit(await child.exited);
