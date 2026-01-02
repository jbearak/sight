/**
 * Unit Tests for SMCL Pretty Printer
 * 
 * Tests the conversion of SMCL markup to plain text and Markdown formats.
 */

import { describe, it, expect } from 'bun:test';
import { SmclPrettyPrinterImpl } from '../../src/smcl-parser/pretty-printer';

describe('SmclPrettyPrinter', () => {
    const pretty_printer = new SmclPrettyPrinterImpl();

    describe('to_plain_text', () => {
        it('should handle basic text without markup', () => {
            const input = 'This is plain text';
            const result = pretty_printer.to_plain_text(input);
            expect(result).toBe('This is plain text');
        });

        it('should convert cmd directive to plain text', () => {
            const input = 'Use {cmd:regress} to run regression';
            const result = pretty_printer.to_plain_text(input);
            expect(result).toBe('Use regress to run regression');
        });

        it('should convert opt directive to plain text', () => {
            const input = 'The {opt vce(robust)} option';
            const result = pretty_printer.to_plain_text(input);
            expect(result).toBe('The vce(robust) option');
        });

        it('should convert title directive to uppercase', () => {
            const input = '{title:Syntax}';
            const result = pretty_printer.to_plain_text(input);
            expect(result).toBe('SYNTAX');
        });

        it('should handle synopt directive with indentation', () => {
            const input = '{synopt:vce(robust)}robust standard errors{p_end}';
            const result = pretty_printer.to_plain_text(input);
            // The clean_whitespace function collapses multiple spaces to single space
            expect(result).toBe(' vce(robust)robust standard errors');
        });

        it('should remove p and p_end directives', () => {
            const input = '{p}This is a paragraph{p_end}';
            const result = pretty_printer.to_plain_text(input);
            expect(result).toBe('This is a paragraph');
        });

        it('should handle multiple directives', () => {
            const input = '{title:Description}\n{p}{cmd:regress} performs {opt linear} regression{p_end}';
            const result = pretty_printer.to_plain_text(input);
            expect(result).toBe('DESCRIPTION\nregress performs linear regression');
        });

        it('should clean excessive whitespace', () => {
            const input = 'Text   with    multiple   spaces\n\n\n\nand newlines';
            const result = pretty_printer.to_plain_text(input);
            expect(result).toBe('Text with multiple spaces\n\nand newlines');
        });
    });

    describe('to_markdown', () => {
        it('should handle basic text without markup', () => {
            const input = 'This is plain text';
            const result = pretty_printer.to_markdown(input);
            expect(result).toBe('This is plain text');
        });

        it('should convert cmd directive to code', () => {
            const input = 'Use {cmd:regress} to run regression';
            const result = pretty_printer.to_markdown(input);
            expect(result).toBe('Use `regress` to run regression');
        });

        it('should convert opt directive to code', () => {
            const input = 'The {opt vce(robust)} option';
            const result = pretty_printer.to_markdown(input);
            expect(result).toBe('The `vce(robust)` option');
        });

        it('should convert it directive to italic', () => {
            const input = 'This is {it:italic} text';
            const result = pretty_printer.to_markdown(input);
            expect(result).toBe('This is *italic* text');
        });

        it('should convert bf directive to bold', () => {
            const input = 'This is {bf:bold} text';
            const result = pretty_printer.to_markdown(input);
            expect(result).toBe('This is **bold** text');
        });

        it('should convert ul directive to underline', () => {
            const input = 'This is {ul:underlined} text';
            const result = pretty_printer.to_markdown(input);
            expect(result).toBe('This is <u>underlined</u> text');
        });

        it('should convert title directive to header', () => {
            const input = '{title:Syntax}';
            const result = pretty_printer.to_markdown(input);
            expect(result).toBe('# Syntax');
        });

        it('should convert synopt directive to list item', () => {
            const input = '{synopt:vce(robust)}robust standard errors{p_end}';
            const result = pretty_printer.to_markdown(input);
            expect(result).toBe('- vce(robust)robust standard errors');
        });

        it('should convert syntab directive to subheader', () => {
            const input = '{syntab:Options}';
            const result = pretty_printer.to_markdown(input);
            expect(result).toBe('\n## Options');
        });

        it('should convert help directive to link', () => {
            const input = 'See {help regress} for details';
            const result = pretty_printer.to_markdown(input);
            expect(result).toBe('See [regress] for details');
        });

        it('should handle nested directives', () => {
            const input = '{title:Description}\n{p}The {cmd:regress} command with {opt robust} option{p_end}';
            const result = pretty_printer.to_markdown(input);
            expect(result).toBe('# Description\nThe `regress` command with `robust` option');
        });

        it('should handle complex SMCL example', () => {
            const input = `{title:Syntax}

{p 8 17 2}
{cmd:regress} {depvar} [{indepvars}] {ifin} [{cmd:,} {it:options}]

{synoptset 20 tabbed}{...}
{synopthdr}
{synoptline}
{syntab:SE/Robust}
{synopt:{opt vce(vcetype)}}variance estimator{p_end}
{synopt:{opt r:obust}}robust standard errors{p_end}
{synoptline}`;

            const result = pretty_printer.to_markdown(input);
            expect(result).toContain('# Syntax');
            expect(result).toContain('`regress`');
            expect(result).toContain('## SE/Robust');
            expect(result).toContain('- opt vce(vcetype)variance estimator');
            expect(result).toContain('- opt r:obustrobust standard errors');
        });
    });

    describe('edge cases', () => {
        it('should handle empty input', () => {
            expect(pretty_printer.to_plain_text('')).toBe('');
            expect(pretty_printer.to_markdown('')).toBe('');
        });

        it('should handle malformed directives', () => {
            const input = '{cmd:incomplete';
            const result = pretty_printer.to_plain_text(input);
            expect(result).toBe('incomplete');
        });

        it('should handle directives without content', () => {
            const input = '{cmd:}';
            const result = pretty_printer.to_plain_text(input);
            expect(result).toBe('');
        });

        it('should handle unknown directives', () => {
            const input = '{unknown:content}';
            const result = pretty_printer.to_plain_text(input);
            expect(result).toBe('content');
        });

        it('should handle nested braces', () => {
            const input = 'Text with {cmd:command {option}} more text';
            const result = pretty_printer.to_plain_text(input);
            // The tokenizer treats the first } as closing the directive
            expect(result).toBe('Text with command option more text');
        });
    });
});