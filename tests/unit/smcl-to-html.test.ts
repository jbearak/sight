/**
 * Tests for the SMCL-to-HTML renderer.
 */
import { describe, it, expect } from 'bun:test';
import { smcl_to_html } from '../../client/src/smcl-preview/smcl-to-html';

describe('smcl_to_html', () => {
    describe('document markers', () => {
        it('strips {smcl} header', () => {
            const result = smcl_to_html('{smcl}');
            expect(result.html).toBe('');
        });

        it('renders {.-} as horizontal rule', () => {
            const result = smcl_to_html('{.-}');
            expect(result.html).toContain('<hr');
        });
    });

    describe('text formatting', () => {
        it('renders {bf:text} as strong', () => {
            const result = smcl_to_html('{bf:bold text}');
            expect(result.html).toContain('<strong>');
            expect(result.html).toContain('bold text');
            expect(result.html).toContain('</strong>');
        });

        it('renders {it:text} as em', () => {
            const result = smcl_to_html('{it:italic text}');
            expect(result.html).toContain('<em>');
            expect(result.html).toContain('italic text');
            expect(result.html).toContain('</em>');
        });

        it('renders {ul:text} as u', () => {
            const result = smcl_to_html('{ul:underlined}');
            expect(result.html).toContain('<u>');
            expect(result.html).toContain('underlined');
            expect(result.html).toContain('</u>');
        });

        it('renders {cmd:text} as code', () => {
            const result = smcl_to_html('{cmd:regress}');
            expect(result.html).toContain('class="smcl-cmd"');
            expect(result.html).toContain('regress');
        });

        it('renders {opt name} as code', () => {
            const result = smcl_to_html('{opt robust}');
            expect(result.html).toBe(
                '<code class="smcl-opt">robust</code>'
            );
        });

        it('renders {opt ab:rest} with abbreviation underlined', () => {
            const result = smcl_to_html('{opt l:evel}');
            expect(result.html).toBe(
                '<code class="smcl-opt"><u>l</u>evel</code>'
            );
        });

        it('renders {cmdab:ab:rest} with abbreviation underlined', () => {
            const result = smcl_to_html('{cmdab:gl:obal}');
            expect(result.html).toBe(
                '<code class="smcl-cmd"><u>gl</u>obal</code>'
            );
        });
    });

    describe('color styles', () => {
        it('renders {res:text} as result span (scoped)', () => {
            const result = smcl_to_html('{res:42.5}');
            expect(result.html).toContain('class="smcl-res"');
            expect(result.html).toContain('42.5');
        });

        it('renders {err:text} as error span (scoped)', () => {
            const result = smcl_to_html('{err:not found}');
            expect(result.html).toContain('class="smcl-err"');
            expect(result.html).toContain('not found');
        });

        it('renders persistent {res} as style switch', () => {
            const result = smcl_to_html('{res}42.5');
            expect(result.html).toContain('class="smcl-res"');
            expect(result.html).toContain('42.5');
        });

        it('renders persistent {txt} then {res} with transitions', () => {
            const result = smcl_to_html(
                '{txt}label {res}value'
            );
            expect(result.html).toContain('smcl-txt');
            expect(result.html).toContain('smcl-res');
            expect(result.html).toContain('label');
            expect(result.html).toContain('value');
        });

        it('renders persistent {com} for command prompts', () => {
            const result = smcl_to_html('{com}. tab x');
            expect(result.html).toContain('smcl-com');
            expect(result.html).toContain('. tab x');
        });

        it('closes trailing style span', () => {
            const result = smcl_to_html('{res}value');
            // Should not have unclosed spans
            const open_count = (result.html.match(/<span/g) || []).length;
            const close_count = (result.html.match(/<\/span>/g) || []).length;
            expect(open_count).toBe(close_count);
        });

        it('handles style switch in tabulate output', () => {
            const smcl =
                '{txt}       2015 {c |}{res}    116,887\n' +
                '{txt}       2016 {c |}{res}     11,691';
            const result = smcl_to_html(smcl);
            expect(result.html).toContain('smcl-txt');
            expect(result.html).toContain('smcl-res');
            expect(result.html).toContain('116,887');
            expect(result.html).toContain('11,691');
            expect(result.html).toContain('\u2502'); // vertical bar
        });
    });

    describe('headings', () => {
        it('renders {title:text} as h2', () => {
            const result = smcl_to_html('{title:Syntax}');
            expect(result.html).toContain('smcl-title');
            expect(result.html).toContain('Syntax');
            expect(result.html).toContain('</h2>');
        });

        it('renders {dlgtab:text} as h3', () => {
            const result = smcl_to_html('{dlgtab:Model}');
            expect(result.html).toContain('smcl-dlgtab');
            expect(result.html).toContain('Model');
            expect(result.html).toContain('</h3>');
        });
    });

    describe('paragraphs', () => {
        it('renders {pstd} as paragraph', () => {
            const result = smcl_to_html('{pstd}Some text.{p_end}');
            expect(result.html).toContain('smcl-pstd');
            expect(result.html).toContain('Some text.');
            expect(result.html).toContain('</p>');
        });

        it('renders {phang} as hanging indent paragraph', () => {
            const result = smcl_to_html('{phang}');
            expect(result.html).toContain('smcl-phang');
        });
    });

    describe('layout', () => {
        it('renders {hline} as horizontal rule', () => {
            const result = smcl_to_html('{hline}');
            expect(result.html).toContain('smcl-hline');
        });

        it('renders {hline 20} as inline line', () => {
            const result = smcl_to_html('{hline 20}');
            expect(result.html).toContain('smcl-hline-inline');
            expect(result.html).toContain('\u2500'.repeat(20));
        });

        it('renders {space 4} as non-breaking spaces', () => {
            const result = smcl_to_html('{space 4}');
            expect(result.html).toBe('&nbsp;&nbsp;&nbsp;&nbsp;');
        });

        it('renders {center:text} as centered div', () => {
            const result = smcl_to_html('{center:Hello}');
            expect(result.html).toContain('smcl-center');
            expect(result.html).toContain('Hello');
        });

        it('renders {right:text} as right-aligned div', () => {
            const result = smcl_to_html('{right:Page 1}');
            expect(result.html).toContain('smcl-right');
            expect(result.html).toContain('Page 1');
        });
    });

    describe('special characters', () => {
        it('renders {c -(} as literal open brace', () => {
            const result = smcl_to_html('{c -(}');
            expect(result.html).toBe('{');
        });

        it('renders {c )-} as literal close brace', () => {
            const result = smcl_to_html('{c )-}');
            expect(result.html).toBe('}');
        });

        it('renders {c S|} as dollar sign', () => {
            const result = smcl_to_html("{c S|}");
            expect(result.html).toBe('$');
        });

        it('renders numeric char codes', () => {
            const result = smcl_to_html('{c 169}');
            expect(result.html).toBe('\u00A9'); // copyright symbol
        });

        it('renders hex char codes', () => {
            const result = smcl_to_html('{c 0xa9}');
            expect(result.html).toBe('\u00A9');
        });

        it('renders box-drawing characters', () => {
            expect(smcl_to_html('{c -}').html).toBe('\u2500');
            expect(smcl_to_html('{c |}').html).toBe('\u2502');
            expect(smcl_to_html('{c +}').html).toBe('\u253C');
            expect(smcl_to_html('{c TLC}').html).toBe('\u250C');
            expect(smcl_to_html('{c BRC}').html).toBe('\u2518');
        });
    });

    describe('links and cross-references', () => {
        it('renders {help topic} as a link', () => {
            const result = smcl_to_html('{help regress}');
            expect(result.html).toContain('<a');
            expect(result.html).toContain('data-smcl-topic="regress"');
            expect(result.html).toContain('regress</a>');
            expect(result.cross_references).toHaveLength(1);
            expect(result.cross_references[0].topic).toBe('regress');
        });

        it('renders {help topic:display} with custom text', () => {
            const result = smcl_to_html('{help regress:regression}');
            expect(result.html).toContain('data-smcl-topic="regress"');
            expect(result.html).toContain('regression');
        });

        it('renders {helpb topic} as bold link', () => {
            const result = smcl_to_html('{helpb regress}');
            expect(result.html).toContain('<strong>');
            expect(result.html).toContain('data-smcl-topic="regress"');
        });

        it('renders {manhelp topic R} as manual reference', () => {
            const result = smcl_to_html('{manhelp regress R}');
            expect(result.html).toContain('data-smcl-topic="regress"');
            expect(result.html).toContain('[R]');
            expect(result.cross_references).toHaveLength(1);
        });

        it('renders {browse URL} as external link', () => {
            const result = smcl_to_html(
                '{browse https://stata.com}'
            );
            expect(result.html).toContain('href="https://stata.com"');
            expect(result.html).toContain('target="_blank"');
        });

        it('renders {browse URL:text} with display text', () => {
            const result = smcl_to_html(
                '{browse https://stata.com:Stata website}'
            );
            expect(result.html).toContain('href="https://stata.com"');
            expect(result.html).toContain('Stata website</a>');
        });

        it('preserves port numbers in browse URLs', () => {
            const result = smcl_to_html(
                '{browse http://localhost:8080}'
            );
            expect(result.html).toContain(
                'href="http://localhost:8080"'
            );
        });

        it('handles browse URL with port and display text', () => {
            const result = smcl_to_html(
                '{browse http://localhost:8080:Local server}'
            );
            expect(result.html).toContain(
                'href="http://localhost:8080"'
            );
            expect(result.html).toContain('Local server</a>');
        });

        it('handles mailto URLs in browse', () => {
            const result = smcl_to_html(
                '{browse mailto:user@example.com}'
            );
            expect(result.html).toContain(
                'href="mailto:user@example.com"'
            );
        });

        it('renders {marker name} as anchor', () => {
            const result = smcl_to_html('{marker syntax}');
            expect(result.html).toContain('id="syntax"');
        });

        it('renders {viewerjumpto} as in-page link', () => {
            const result = smcl_to_html(
                '{viewerjumpto "Syntax" "regress##syntax"}'
            );
            expect(result.html).toContain('href="#syntax"');
            expect(result.html).toContain('Syntax</a>');
        });
    });

    describe('nested directives', () => {
        it('handles nested {opt} inside {synopt}', () => {
            const result = smcl_to_html(
                '{synopt:{opt vce(robust)}}Robust standard errors{p_end}'
            );
            expect(result.html).toContain('smcl-opt');
            expect(result.html).toContain('vce(robust)');
            expect(result.html).toContain('Robust standard errors');
        });

        it('handles {bf} inside {help}', () => {
            const result = smcl_to_html('{help regress}');
            expect(result.cross_references).toHaveLength(1);
        });

        it('handles {cmd} inside {p2col}', () => {
            const result = smcl_to_html(
                '{p2colset 5 19 21 2}{p2col:{cmd:regress}}Linear regression{p_end}'
            );
            expect(result.html).toContain('smcl-cmd');
            expect(result.html).toContain('regress');
            expect(result.html).toContain('Linear regression');
        });
    });

    describe('synopt tables', () => {
        it('renders synopt table structure', () => {
            const result = smcl_to_html(
                '{synoptset 20 tabbed}\n' +
                '{synopthdr}\n' +
                '{synoptline}\n' +
                '{syntab:Model}\n' +
                '{synopt:{opt noconstant}}suppress constant{p_end}\n' +
                '{synoptline}'
            );
            expect(result.html).toContain('smcl-synopt-table');
            expect(result.html).toContain('smcl-synopthdr');
            expect(result.html).toContain('smcl-synoptline');
            expect(result.html).toContain('smcl-syntab');
            expect(result.html).toContain('noconstant');
            expect(result.html).toContain('suppress constant');
        });

        it('closes synopt table on {p2colreset}', () => {
            const result = smcl_to_html(
                '{synoptset 20}\n' +
                '{synopt:{opt x}}desc{p_end}\n' +
                '{synoptline}\n' +
                '{p2colreset}\n' +
                'After table'
            );
            expect(result.html).toContain('</table>');
            // Content after table should not be inside the table
            const my_table_end = result.html.lastIndexOf('</table>');
            const my_after = result.html.indexOf('After table');
            expect(my_after).toBeGreaterThan(my_table_end);
        });
    });

    describe('line continuation', () => {
        it('joins lines with {...}', () => {
            const result = smcl_to_html(
                '{synoptset 20 tabbed}{...}\n{synopthdr}'
            );
            // Should not have a newline between the two
            expect(result.html).toContain('smcl-synopt-table');
            expect(result.html).toContain('smcl-synopthdr');
        });
    });

    describe('comments', () => {
        it('strips {*:comment} directives', () => {
            const result = smcl_to_html(
                'before {*:this is a comment} after'
            );
            expect(result.html).toContain('before');
            expect(result.html).toContain('after');
            expect(result.html).not.toContain('this is a comment');
        });

        it('handles nested braces inside comments', () => {
            const result = smcl_to_html(
                'before {* see {help regress} for details} after'
            );
            expect(result.html).toContain('before');
            expect(result.html).toContain('after');
            expect(result.html).not.toContain('see');
            expect(result.html).not.toContain('regress');
        });
    });

    describe('dup', () => {
        it('repeats text N times', () => {
            const result = smcl_to_html('{dup 3:abc}');
            expect(result.html).toBe('abcabcabc');
        });
    });

    describe('variable placeholders', () => {
        it('renders {varname} as italic placeholder', () => {
            const result = smcl_to_html('{varname}');
            expect(result.html).toContain('<em');
            expect(result.html).toContain('varname');
        });

        it('renders {ifin} as bracketed qualifiers', () => {
            const result = smcl_to_html('{ifin}');
            expect(result.html).toContain('[');
            expect(result.html).toContain('if');
            expect(result.html).toContain('in');
        });
    });

    describe('XSS prevention', () => {
        it('rejects javascript: URLs in browse links', () => {
            const result = smcl_to_html(
                '{browse javascript:alert(1):click me}'
            );
            expect(result.html).not.toContain('javascript:');
            expect(result.html).not.toContain('href=');
            expect(result.html).toContain('click me');
        });

        it('allows http: and https: URLs', () => {
            const result = smcl_to_html(
                '{browse https://stata.com}'
            );
            expect(result.html).toContain('href="https://stata.com"');
        });
    });

    describe('table row closing', () => {
        it('p_end closes table row, not paragraph', () => {
            const result = smcl_to_html(
                '{synoptset 20}\n' +
                '{synopt:{opt robust}}description{p_end}'
            );
            expect(result.html).toContain('</td></tr>');
            expect(result.html).not.toContain(
                '<td class="smcl-synopt-col2">description</p>'
            );
        });
    });

    describe('HTML escaping', () => {
        it('escapes HTML characters in plain text', () => {
            const result = smcl_to_html('x < y & a > b');
            expect(result.html).toContain('&lt;');
            expect(result.html).toContain('&amp;');
            expect(result.html).toContain('&gt;');
        });

        it('escapes HTML inside directive args', () => {
            const result = smcl_to_html('{cmd:<script>}');
            expect(result.html).not.toContain('<script>');
            expect(result.html).toContain('&lt;script&gt;');
        });
    });

    describe('scroll sync data-line attributes', () => {
        it('stamps data-line on block-level directives', () => {
            const smcl = '{pstd}Hello{p_end}';
            const result = smcl_to_html(smcl);
            expect(result.html).toContain('data-line="0"');
        });

        it('stamps correct line numbers on multi-line content', () => {
            const smcl = [
                '{title:Syntax}',   // line 0
                '',                  // line 1
                '{pstd}',            // line 2
                'Some text.',        // line 3
                '{p_end}',           // line 4
            ].join('\n');
            const result = smcl_to_html(smcl);
            expect(result.html).toContain(
                '<h2 class="smcl-title" data-line="0">'
            );
            expect(result.html).toContain(
                '<p class="smcl-pstd" data-line="2">'
            );
        });

        it('stamps data-line on text nodes', () => {
            const smcl = 'line zero\nline one\nline two';
            const result = smcl_to_html(smcl);
            expect(result.html).toContain('data-line="0"');
        });

        it('stamps data-line on hline', () => {
            const result = smcl_to_html('\n{hline}');
            expect(result.html).toContain('data-line="1"');
        });

        it('stamps data-line on synopt table elements', () => {
            const smcl = [
                '{synoptset 20}',           // line 0
                '{synopt:{opt x}}desc{p_end}', // line 1
            ].join('\n');
            const result = smcl_to_html(smcl);
            expect(result.html).toContain(
                'smcl-synopt-table" data-line="0"'
            );
            expect(result.html).toContain(
                'smcl-synopt-row" data-line="1"'
            );
        });

        it('stamps data-line on p2col elements', () => {
            const smcl = [
                '{p2colset 5 19 21 2}',  // line 0
                '{p2col:{cmd:test}}desc{p_end}', // line 1
            ].join('\n');
            const result = smcl_to_html(smcl);
            expect(result.html).toContain(
                'smcl-p2col-table" data-line="0"'
            );
            expect(result.html).toContain(
                'smcl-p2col-row" data-line="1"'
            );
        });
    });

    describe('mixed real-world content', () => {
        it('handles a typical help file header', () => {
            const smcl = [
                '{smcl}',
                '{* *! version 1.0.0}',
                '{viewerjumpto "Syntax" "regress##syntax"}',
                '{viewerjumpto "Options" "regress##options"}',
                '{hline}',
                '{p2colset 5 19 21 2}',
                '{p2col:{bf:[R] regress} {hline 2}}Linear regression{p_end}',
                '{p2colreset}',
                '{hline}',
            ].join('\n');

            const result = smcl_to_html(smcl);
            expect(result.html).toContain('href="#syntax"');
            expect(result.html).toContain('href="#options"');
            expect(result.html).toContain('<hr');
            expect(result.html).toContain('<strong>');
            expect(result.html).toContain('Linear regression');
        });
    });
});
