#!/usr/bin/env bun

import { spawnSync } from 'node:child_process';

const my_result = spawnSync(
    'git',
    ['grep', '-z', '-I', '-Il', '\r', '--', '.'],
    { encoding: 'utf8' }
);

if (my_result.status === 1) {
    console.log('No CRLF or CR line endings detected in tracked text files.');
    process.exit(0);
}

if (my_result.status !== 0) {
    process.stderr.write(my_result.stderr);
    process.exit(my_result.status ?? 1);
}

const the_files = my_result.stdout
    .split('\0')
    .filter(Boolean);

console.error('CRLF or CR line endings detected in tracked text files:');
for (const my_file of the_files) {
    console.error(`  ${my_file}`);
}
console.error(
    '\nNormalize line endings to LF before committing these files.'
);
process.exit(1);
