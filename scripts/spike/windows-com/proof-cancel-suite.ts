const jobs: Array<[string, string[]]> = [
    ['proof-pty.ps1', ['-Case', 'readiness', '-Count', '2']],
    ['proof-pty.ps1', ['-Case', 'after-drain', '-Count', '1']],
    ['proof-pty.ps1', ['-Case', 'after-drain', '-Count', '2']],
    ['proof-cancel.ps1', ['-Stage', 'free', '-Count', '2']],
    ['proof-cancel.ps1', ['-Stage', 'title', '-Count', '1']],
    ['proof-cancel.ps1', ['-Stage', 'title', '-Count', '2']],
];
const start_index=Number(process.argv[2] ?? '0');
if(!Number.isInteger(start_index) || start_index<0 || start_index>=jobs.length) throw new Error('Invalid resume index');
for (const [script, args] of jobs.slice(start_index)) {
    const child = Bun.spawn(['bun', `${import.meta.dir}/factory-host.ts`,
        `${import.meta.dir}/${script}`, ...args], { stdout: 'pipe', stderr: 'pipe' });
    const [output, errors, code] = await Promise.all([
        new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    console.log(`CANCEL ${script} ${args.join(' ')} exit=${code}`);
    console.log(output.split(/\r?\n/).filter((line) =>
        /"(cancel_exit|cancellation_result|before_ctrl_c|owned_stray_cleanup|verdict|final_inventory)"/.test(line)).join('\n'));
    if (code !== 0) { console.error(output, errors); process.exit(code); }
}
