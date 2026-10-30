/**
 * Unit tests for the console's pure text processing: prompt detection,
 * input highlighting, and output colorizing.
 */

import { describe, expect, it } from 'bun:test';
import * as fc from 'fast-check';
import { classify_prompt, strip_ansi } from '../../../src/console/prompt-detector';
import { highlight_stata, SGR } from '../../../src/console/highlighter';
import { OutputColorizer } from '../../../src/console/output-colorizer';
import { apply_line_controls } from '../../../src/console/session';

describe('classify_prompt', () => {
    it('recognizes each prompt exactly', () => {
        expect(classify_prompt('. ')).toBe('stata');
        expect(classify_prompt('  1. ')).toBe('block');
        expect(classify_prompt(' 12. ')).toBe('block');
        expect(classify_prompt(': ')).toBe('mata');
        expect(classify_prompt('>>> ')).toBe('python');
        expect(classify_prompt('... ')).toBe('python');
        expect(classify_prompt('> ')).toBe('continuation');
        expect(classify_prompt('-> ')).toBe('pause');
        expect(classify_prompt('--more--')).toBe('more');
    });

    it('rejects near misses and ordinary output', () => {
        for (const my_text of ['.', '. x', ' . ', '1. ', 'Enter a name: ', '--More--', 'working', '']) {
            expect(classify_prompt(my_text)).toBeNull();
        }
    });

    it('ignores color codes around a prompt', () => {
        expect(classify_prompt('\x1b[1m. \x1b[0m')).toBe('stata');
        expect(strip_ansi('\x1b[31mred\x1b[0m')).toBe('red');
    });
});

describe('highlight_stata', () => {
    it('keeps the visible text unchanged', () => {
        fc.assert(fc.property(fc.string({ maxLength: 60 }), (text) => {
            const single_line = text.replace(/\n/g, ' ');
            expect(strip_ansi(highlight_stata(single_line))).toBe(single_line);
        }));
    });

    it('colors the command word, strings, numbers, macros and comments', () => {
        const output = highlight_stata('display "hi" 3 `x\' $y // note');
        expect(output).toContain(`${SGR.bold_blue}display${SGR.reset}`);
        expect(output).toContain(`${SGR.green}"hi"${SGR.reset}`);
        expect(output).toContain(`${SGR.cyan}3${SGR.reset}`);
        expect(output).toContain(`${SGR.magenta}\`x'${SGR.reset}`);
        expect(output).toContain(`${SGR.magenta}$y${SGR.reset}`);
        expect(output).toContain(`${SGR.dim}// note${SGR.reset}`);
    });

    it('finds the command after prefixes and by-lists', () => {
        const output = highlight_stata('quietly by foo: regress y x if z');
        expect(output).toContain(`${SGR.blue}quietly${SGR.reset}`);
        expect(output).toContain(`${SGR.blue}by${SGR.reset} foo:`);
        expect(output).toContain(`${SGR.bold_blue}regress${SGR.reset}`);
        expect(output).toContain(`${SGR.blue}if${SGR.reset}`);
    });

    it('matches prefixes with exact case (Stata is case-sensitive)', () => {
        // `Quietly` is not a prefix, so it is taken as the command word
        // and `summarize` is an ordinary argument.
        const output = highlight_stata('Quietly summarize x');
        expect(output).toContain(`${SGR.bold_blue}Quietly${SGR.reset}`);
        expect(output).not.toContain(`${SGR.bold_blue}summarize`);
    });
});

describe('OutputColorizer', () => {
    const error_text = 'command foo is unrecognized\r\nr(199);\r\n\r\n. ';

    it('colors an error message and its return code red', () => {
        const colorizer = new OutputColorizer('streams');
        const output = colorizer.push(error_text) + colorizer.flush();
        expect(output).toBe(
            `${SGR.red}command foo is unrecognized${SGR.reset}\r\n`
            + `${SGR.red}r(199);${SGR.reset}\r\n\r\n. `);
    });

    it('gives the same result however the output is split', () => {
        const whole = new OutputColorizer('streams');
        const expected = whole.push(error_text) + whole.flush();
        fc.assert(fc.property(
            fc.array(fc.nat(error_text.length), { maxLength: 5 }),
            (cuts) => {
                const points = [...new Set(cuts)].sort((a, b) => a - b);
                const colorizer = new OutputColorizer('streams');
                const parts: string[] = [];
                let start = 0;
                for (const my_point of [...points, error_text.length]) {
                    parts.push(colorizer.push(error_text.slice(start, my_point)));
                    start = my_point;
                }
                parts.push(colorizer.flush());
                expect(parts.join('')).toBe(expected);
            }));
    });

    it('reports errors through the callback, also with colors off', () => {
        for (const my_mode of ['streams', 'off'] as const) {
            let errors = 0;
            const colorizer = new OutputColorizer(my_mode, () => errors++);
            colorizer.push('bad\r\nr(1');
            colorizer.push('98);\r\n');
            expect(errors).toBe(1);
        }
    });

    it('passes output through unchanged when off', () => {
        const colorizer = new OutputColorizer('off');
        expect(colorizer.push(error_text)).toBe(error_text);
        expect(colorizer.flush()).toBe('');
    });

    it('colors notes, breaks, and echoed do-file commands', () => {
        const colorizer = new OutputColorizer('streams');
        const output = colorizer.push(
            'note: x dropped\n--Break--\n. display 1\n  2. gen y = 1\n     1. | 3 4 |\n')
            + colorizer.flush();
        expect(output).toContain(`${SGR.yellow}note: x dropped${SGR.reset}`);
        expect(output).toContain(`${SGR.red}--Break--${SGR.reset}`);
        expect(output).toContain(`. ${SGR.bold_blue}display${SGR.reset}`);
        expect(output).toContain(`  2. ${SGR.bold_blue}gen${SGR.reset}`);
        // `list` output rows are not code.
        expect(output).toContain('     1. | 3 4 |\n');
    });

    it('leaves lines that already have colors alone', () => {
        const colorizer = new OutputColorizer('streams');
        const text = '\x1b[32mgreen\x1b[0m\nr(1);\n';
        const output = colorizer.push(text);
        expect(output.startsWith('\x1b[32mgreen\x1b[0m\n')).toBe(true);
    });

    it('never half-colors a line whose start was flushed raw', () => {
        const colorizer = new OutputColorizer('streams');
        expect(colorizer.flush()).toBe('');
        colorizer.push('note: par');
        expect(colorizer.flush()).toBe('note: par');
        expect(colorizer.push('tial\n')).toBe('tial\n');
    });

    it('starts a fresh line after end_line()', () => {
        const colorizer = new OutputColorizer('streams');
        colorizer.push('. ');
        colorizer.flush();
        colorizer.end_line();
        const output = colorizer.push('oops\nr(198);\n');
        expect(output).toContain(`${SGR.red}oops${SGR.reset}`);
    });
});

describe('apply_line_controls', () => {
    it('applies carriage returns and backspaces', () => {
        expect(apply_line_controls('--more--\r        \r. ')).toBe('. ');
        expect(apply_line_controls('ab\b\bxy')).toBe('xy');
        expect(apply_line_controls('. ')).toBe('. ');
    });
});
