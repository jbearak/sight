// Serial: each scenario owns the otherwise empty Stata desktop session.
const cases: Array<[string, string, number]> = [
    ['zero', 'quiescent-diagnostic', 0],
    ['one', 'quiescent-diagnostic', 0],
    ['multiple', 'quiescent-diagnostic', 0],
    ['mixed', 'quiescent-diagnostic', 0],
    ['repeated', 'quiescent-diagnostic', 0],
    ['helper-exit', 'quiescent-diagnostic', 0],
    ['helper-kill', 'quiescent-diagnostic', 0],
    ['original-exit', 'quiescent-diagnostic', 0],
    ['external-race', 'quiescent-diagnostic', 0],
    ['bound', 'strict', 0],
    ['manual-race', 'quiescent-diagnostic', 1],
    ['two-new-race', 'quiescent-diagnostic', 1],
    ['zero', 'strict', 0],
    ['one', 'strict', 0],
    ['multiple', 'strict', 0],
    ['mixed', 'strict', 0],
    ['repeated', 'strict', 0],
    ['helper-exit', 'strict', 0],
    ['helper-kill', 'strict', 0],
    ['original-exit', 'strict', 0],
    ['manual-race', 'strict', 0],
    ['external-race', 'strict', 0],
    ['two-new-race', 'strict', 0],
    ['adaptive', 'quiescent-diagnostic', 0],
    ['adaptive-mixed', 'quiescent-diagnostic', 0],
    ['concurrent-manual', 'strict', 0],
    ['registration-refusal', 'strict', 0],
    ['identity-preflight', 'strict', 0],
];
const start_index = Number(process.argv[2] ?? '0');
if (!Number.isInteger(start_index) || start_index < 0 || start_index >= cases.length) {
    throw new Error('Invalid scenario resume index');
}
const selected = cases.slice(start_index).filter((entry) =>
    process.argv[3] !== 'strict' || entry[1] === 'strict');
for (const [test_case, policy, historical_exit] of selected) {
    const expected_exit = policy === 'strict' ? 3 : historical_exit;
    console.log(`Starting ${test_case}, policy=${policy}, expected_exit=${expected_exit}`);
    const child = Bun.spawn(['bun', `${import.meta.dir}/factory-host.ts`,
        `${import.meta.dir}/strategy-probe.ps1`, '-Case', test_case,
        '-Policy', policy], { stdout: 'pipe', stderr: 'pipe' });
    const [output, errors, code] = await Promise.all([
        new Response(child.stdout).text(), new Response(child.stderr).text(),
        child.exited,
    ]);
    const records = output.split(/\r?\n/).filter((line) => line.startsWith('{'));
    const interesting = records.filter((line) =>
        /"(verdict|strategy_result|fail_closed|iteration_pass|drain_complete|exact_factory_oracle|final_inventory)"/.test(line));
    console.log(interesting.join('\n'));
    const final_inventory = [...records].reverse().find((line) =>
        line.includes('"event":"final_inventory"'));
    if (code !== expected_exit || !final_inventory ||
        !final_inventory.includes('"data":[]')) {
        console.error(output, errors);
        throw new Error(`Unexpected outcome/cleanup: ${test_case}, exit=${code}`);
    }
    if (expected_exit === 1 && !output.includes('RED_FACTORY_IDENTITY')) {
        throw new Error('Negative control failed for an unexpected reason');
    }
}
