// Benchmark for line-utils O(1) claim
import { compute_line_offsets, get_line_text } from '../src/utils/line-utils';

function generateContent(lines: number): string {
    const arr = new Array(lines);
    for (let i = 0; i < lines; i++) {
        arr[i] = `line-${i}`;
    }
    return arr.join('\n');
}

function benchmarkSplit(content: string, iterations: number) {
    const start = Date.now();
    for (let i = 0; i < iterations; i++) {
        const lineNum = i % 1000; // sample line
        const line = content.split('\n')[lineNum];
        // use line to avoid optimization removal
        if (line.length === -1) throw new Error('impossible');
    }
    return Date.now() - start;
}

function benchmarkUtil(content: string, offsets: number[], iterations: number) {
    const start = Date.now();
    for (let i = 0; i < iterations; i++) {
        const lineNum = i % 1000;
        const line = get_line_text({ content, line_offsets: offsets }, lineNum);
        if (line.length === -1) throw new Error('impossible');
    }
    return Date.now() - start;
}

const lines = 100000; // 100k lines
const content = generateContent(lines);
const offsets = compute_line_offsets(content);
const iterations = 100000; // 100k lookups

console.log('Benchmarking split approach...');
const splitTime = benchmarkSplit(content, iterations);
console.log(`Split time: ${splitTime} ms`);

console.log('Benchmarking line-utils O(1) approach...');
const utilTime = benchmarkUtil(content, offsets, iterations);
console.log(`Util time: ${utilTime} ms`);

console.log('Speedup factor:', splitTime / utilTime);
