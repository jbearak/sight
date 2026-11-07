/** Only registry operations use the privileged session; COM tests stay in 1. */
const hive = process.argv[2];
if (hive !== 'HKLM' && hive !== 'HKCU') throw new Error('Expected HKLM or HKCU');
const host = `${import.meta.dir}/factory-host.ts`;
const script = `${import.meta.dir}/proof-registration.ps1`;
async function desktop(action: string, directory?: string): Promise<void> {
    const args = ['bun', host, script, '-Action', action, '-Hive', hive];
    if (directory) args.push('-Directory', directory);
    const child = Bun.spawn(args, { stdout: 'inherit', stderr: 'inherit' });
    if (await child.exited !== 0) throw new Error(`Desktop ${action} failed`);
}
async function registry(action: string, directory: string): Promise<void> {
    const quote = (s: string) => "'" + s.replaceAll("'", "''") + "'";
    const invocation = `& 'C:/sight-target-proof/scripts/spike/windows-com/proof-registry.ps1' -Action ${quote(action)} -Hive ${quote(hive)} -Directory ${quote(directory)}`;
    const command = "$ErrorActionPreference='Stop'; try { " + invocation
        + '; if ($LASTEXITCODE) { exit $LASTEXITCODE }; exit 0'
        + ' } catch { [Console]::Error.WriteLine($_.Exception.ToString() + [Environment]::NewLine + $_.ScriptStackTrace); exit 1 }';
    const args = ['prlctl', 'exec', 'Windows 11'];
    if (hive === 'HKCU') args.push('--current-user');
    args.push('powershell.exe', '-Sta', '-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64'));
    const child = Bun.spawn(args, { stdout: 'inherit', stderr: 'inherit' });
    if (await child.exited !== 0) throw new Error(`Registry ${action} failed`);
}
if (!['resume', 'restore'].includes(process.argv[3] ?? '')) await desktop('setup');
const context: unknown = await Bun.file(`${import.meta.dir}/results/production-proof/registration-${hive}-context.json`).json();
if (typeof context !== 'object' || context === null || !('directory' in context) || typeof context.directory !== 'string') throw new Error('Bad context');
const directory = context.directory;
if (process.argv[3] === 'restore') {
    await desktop('sync', directory);
    await registry('restore', directory);
    await desktop('cleanup', directory);
} else {
    try {
        await registry('backup-mutate', directory);
        await desktop('exercise', directory);
    } finally {
        await registry('restore', directory);
        await desktop('cleanup', directory);
    }
}
