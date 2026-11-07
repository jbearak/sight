// Additional client and race controls, serialized against all other probes.
const cases = [
    ['client-control', '1', 'vbscript'],
    ['client-reserved', '1', 'vbscript'],
    ['client-reserved', '1', 'vbnet'],
    ['concurrent', '2', 'vbscript'], ['excess', '2', 'vbscript'],
];
for (const [test_case, originals, client] of cases) {
    console.log(`Starting ${test_case}, originals=${originals}, client=${client}`);
    const child = Bun.spawn(['bun', `${import.meta.dir}/factory-host.ts`,
        `${import.meta.dir}/factory-probe.ps1`, '-Case', test_case,
        '-Originals', originals, '-Client', client],
    { stdout: 'pipe', stderr: 'inherit' });
    const output = await new Response(child.stdout).text();
    const code = await child.exited;
    console.log(output.split(/\r?\n/).filter((line) =>
        /"(verdict|external_client_result|concurrent_result|excess_factory_server|excess_server_after_factory_release|final_inventory)"/.test(line)).join('\n'));
    if (code !== 0) { console.error(output); process.exit(code); }
}
