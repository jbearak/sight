// Serial execution is intentional: COM activation cannot select a Stata PID.
const host = `${import.meta.dir}/factory-host.ts`;
const probe = `${import.meta.dir}/factory-probe.ps1`;
const cases = [
    ['release'], ['activate'], ['factory-first'], ['availability'],
    ['exit'], ['kill'], ['multi', '2'], ['multi', '3'],
    ['activate'], ['activate'], ['activate'],
    ['client-control', '1', 'vbscript'],
    ['client-reserved', '1', 'vbscript'],
    ['client-control', '1', 'vbnet'],
    ['client-reserved', '1', 'vbnet'],
    ['concurrent', '2'], ['excess', '2'],
];
let failures = 0;
const start_index = Number(process.argv[2] ?? '0');
if (!Number.isInteger(start_index) || start_index < 0 || start_index >= cases.length) {
    throw new Error('Optional resume index must be between 0 and 16');
}
for (const [test_case, originals = '1', client = 'vbscript'] of cases.slice(start_index)) {
    console.log(`Starting ${test_case}, originals=${originals}`);
    const child = Bun.spawn(['bun', host, probe, '-Case', test_case,
        '-Originals', originals, '-Client', client],
    { stdout: 'pipe', stderr: 'inherit' });
    const output = await new Response(child.stdout).text();
    const code = await child.exited;
    console.log(output.split(/\r?\n/).filter((line) =>
        /"(verdict|availability_result|final_inventory)"/.test(line)).join('\n'));
    if (code !== 0) {
        console.error(output);
        failures++;
        // A failed cleanup or unexpected server must be inspected by the agent.
        break;
    }
}
process.exit(failures ? 1 : 0);
