const cases = process.argv.slice(2);
for (const test_case of cases.length ? cases : ['originals', 'sequential', 'simultaneous', 'held', 'empty']) {
    const child = Bun.spawn(['bun', `${import.meta.dir}/factory-host.ts`,
        `${import.meta.dir}/proof-run.ps1`, '-Case', test_case],
    { stdout: 'pipe', stderr: 'pipe' });
    const [output, errors, code] = await Promise.all([
        new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    console.log(`CASE ${test_case} exit=${code}`);
    console.log(output.split(/\r?\n/).filter((line) =>
        /"(console_ready|console_ended|held_client_progress|verdict|final_inventory)"/.test(line)).join('\n'));
    if (code !== 0) { console.error(output, errors); process.exit(code); }
}
