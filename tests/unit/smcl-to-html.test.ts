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

        it('closes {asis} when {smcl} resumes normal rendering', () => {
            const result = smcl_to_html(
                '{asis}raw\ntext{smcl}{title:Syntax}'
            );
            expect(result.html).toContain('<pre class="smcl-asis">');
            expect(result.html).toContain('</pre><h2 class="smcl-title"');
            expect(result.html).toContain('Syntax');
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

        it('accepts current_topic option without affecting basic rendering', () => {
            const result = smcl_to_html('{help regress}', {
                current_topic: 'generate',
            });
            expect(result.html).toContain('data-smcl-topic="regress"');
        });

        it('renders {browse URL} as external link without target="_blank"', () => {
            // The webview click handler routes browse clicks to
            // `vscode.env.openExternal`. Keeping `target="_blank"` on
            // the anchor would make VS Code also open the URL via its
            // native link interception, producing a duplicate prompt.
            const result = smcl_to_html(
                '{browse https://stata.com}'
            );
            expect(result.html).toContain('href="https://stata.com"');
            expect(result.html).not.toContain('target="_blank"');
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

        it('renders preamble {viewerjumpto} as TOC and suppresses {vieweralsosee} and {viewerdialog}', () => {
            const my_preamble =
                '{viewerjumpto "Syntax" "regress##syntax"}{...}\n' +
                '{viewerjumpto "Description" "regress##description"}{...}\n' +
                '{vieweralsosee "[D] dir" "mansection D dir"}{...}\n' +
                '{vieweralsosee "" "--"}{...}\n' +
                '{vieweralsosee "[D] cd" "help cd"}{...}\n' +
                '{viewerdialog regress "dialog regress"}{...}';
            const result = smcl_to_html(my_preamble, {
                current_topic: 'regress',
            });
            // viewerjumpto entries appear as a TOC
            expect(result.html).toContain('class="smcl-toc"');
            expect(result.html).toContain('href="#syntax"');
            expect(result.html).toContain('href="#description"');
            // vieweralsosee and viewerdialog are still suppressed
            expect(result.html).not.toContain('mansection');
            expect(result.html).not.toContain('dialog');
        });

        it('hides the preamble while preserving the title row for a real .sthlp header', () => {
            // Verbatim top of /Applications/Stata/ado/base/d/dir.sthlp
            // plus the title row; we expect the garbage above the title
            // to be gone while the title text is rendered.
            const my_header =
                '{smcl}\n' +
                '{* *! version 1.1.8  03sep2020}{...}\n' +
                '{vieweralsosee "[D] dir" "mansection D dir"}{...}\n' +
                '{vieweralsosee "" "--"}{...}\n' +
                '{vieweralsosee "[D] cd" "help cd"}{...}\n' +
                '{viewerjumpto "Syntax" "dir##syntax"}{...}\n' +
                '{viewerjumpto "Description" "dir##description"}{...}\n' +
                '{p2colset 1 12 14 2}{...}\n' +
                '{p2col:{bf:[D] dir} {hline 2}}Display filenames{p_end}\n' +
                '{p2colreset}{...}';
            const result = smcl_to_html(my_header);
            // Title row is now rendered as a heading with just the
            // entry name; the [D] manual reference is suppressed.
            expect(result.html).toContain(
                '<h1 class="smcl-help-title-heading">dir</h1>'
            );
            expect(result.html).not.toContain('[D]');
            expect(result.html).toContain('Display filenames');
            // None of the preamble directive args should leak into the
            // rendered output.
            expect(result.html).not.toContain('mansection D dir');
            expect(result.html).not.toContain('help cd');
            expect(result.html).not.toContain('dir##syntax');
            expect(result.html).not.toContain('Links to PDF documentation');
            // Literal quoted pair (from vieweralsosee "" "--") must not
            // render either.
            expect(result.html).not.toContain('"--"');
        });

        describe('anchor links', () => {
            it('renders same-page anchor as jumpto link', () => {
                const result = smcl_to_html('{help regress##syntax}', {
                    current_topic: 'regress',
                });
                expect(result.html).toContain('class="smcl-jumpto"');
                expect(result.html).toContain('href="#syntax"');
                expect(result.html).not.toContain('data-smcl-topic');
            });

            it('renders cross-page anchor with data-smcl-anchor', () => {
                const result = smcl_to_html('{help regress##syntax}', {
                    current_topic: 'generate',
                });
                expect(result.html).toContain('data-smcl-topic="regress"');
                expect(result.html).toContain('data-smcl-anchor="syntax"');
            });

            it('renders anchor-only link (no topic change) as jumpto', () => {
                const result = smcl_to_html('{help generate##description}', {
                    current_topic: 'generate',
                });
                expect(result.html).toContain('href="#description"');
                expect(result.html).toContain('class="smcl-jumpto"');
            });

            it('renders help link without anchor unchanged', () => {
                const result = smcl_to_html('{help regress}', {
                    current_topic: 'generate',
                });
                expect(result.html).toContain('data-smcl-topic="regress"');
                expect(result.html).not.toContain('data-smcl-anchor');
            });

            it('renders anchor link with display text', () => {
                const result = smcl_to_html(
                    '{help regress##syntax:click here}',
                    { current_topic: 'generate' }
                );
                expect(result.html).toContain('data-smcl-topic="regress"');
                expect(result.html).toContain('data-smcl-anchor="syntax"');
                expect(result.html).toContain('click here');
            });

            it('cross-page anchor link without current_topic uses navigate', () => {
                const result = smcl_to_html('{help regress##syntax}');
                expect(result.html).toContain('data-smcl-topic="regress"');
                expect(result.html).toContain('data-smcl-anchor="syntax"');
            });
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

        it('closes synopt table at end of document', () => {
            const result = smcl_to_html(
                '{synoptset 20}\n' +
                '{synopt:{opt x}}desc{p_end}\n' +
                '{synoptline}'
            );
            // Table should be closed even without explicit {p2colreset}
            const my_html = result.html;
            const my_open_count = (my_html.match(/<table/g) || []).length;
            const my_close_count = (my_html.match(/<\/table>/g) || []).length;
            expect(my_close_count).toBe(my_open_count);
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

        it('drops whitespace-only text between synopt rows', () => {
            // Blank lines between {synopt:...}{p_end} rows would
            // otherwise be emitted as text children of <table>, which
            // the HTML parser foster-parents out of the table and
            // stacks visually above it as blank lines.
            const result = smcl_to_html(
                '{synoptset 32}\n' +
                '{synopt:{opt a}}first{p_end}\n' +
                '\n' +
                '{synopt:{opt b}}second{p_end}\n' +
                '\n' +
                '{synopt:{opt c}}third{p_end}\n' +
                '{p2colreset}'
            );
            // No whitespace-only <span> should appear directly
            // between </tr> and the next <tr>.
            expect(result.html).not.toMatch(/<\/tr><span[^>]*>\s*<\/span><tr/);
            // Rows should be contiguous (no other node in between).
            const my_between_rows = result.html.match(
                /<\/tr>([\s\S]*?)<tr/g
            );
            expect(my_between_rows).not.toBeNull();
            for (const my_match of my_between_rows!) {
                expect(my_match).toBe('</tr><tr');
            }
        });

        it('drops whitespace-only text between p2col rows', () => {
            const result = smcl_to_html(
                '{p2colset 5 19 21 2}\n' +
                '{p2col:{cmd:a}}desc a{p_end}\n' +
                '\n' +
                '{p2col:{cmd:b}}desc b{p_end}\n' +
                '{p2colreset}'
            );
            expect(result.html).not.toMatch(/<\/tr><span[^>]*>\s*<\/span><tr/);
        });
    });

    describe('help-file title block', () => {
        it('collapses the standard title p2colset into a heading with a PDF manual link', () => {
            const my_header =
                '{smcl}\n' +
                '{p2colset 1 12 14 2}{...}\n' +
                '{p2col:{bf:[P] display} {hline 2}}Display strings and values of scalar expressions{p_end}\n' +
                '{p2col:}({mansection P display:View complete PDF manual entry}){p_end}\n' +
                '{p2colreset}{...}';
            const result = smcl_to_html(my_header);

            expect(result.html).toContain('<header class="smcl-help-title"');
            // The heading shows just the entry name; the `[P]` manual
            // reference is noise to most users and is intentionally
            // stripped.
            expect(result.html).toContain(
                '<h1 class="smcl-help-title-heading">display</h1>'
            );
            expect(result.html).not.toContain('[P]');
            expect(result.html).not.toContain('smcl-manual-ref');
            expect(result.html).toContain(
                '<p class="smcl-help-subtitle">Display strings and values of scalar expressions</p>'
            );
            // PDF manual link resolves to Stata's online manual and
            // routes through the webview's openExternal handler.
            expect(result.html).toContain(
                'href="https://www.stata.com/manuals/pdisplay.pdf"'
            );
            expect(result.html).not.toContain('target="_blank"');
            // The visible label is overridden to make it clear that
            // clicking leaves VS Code and opens a PDF in the user's
            // browser.
            expect(result.html).toContain(
                'View the complete manual entry (PDF, opens in browser)</a>'
            );
            expect(result.html).not.toContain(
                'View complete PDF manual entry</a>'
            );
            expect(result.html).not.toContain('smcl-p2col-table');
        });

        it('handles multi-word entries such as frame create', () => {
            const my_header =
                '{p2colset 1 16 18 2}{...}\n' +
                '{p2col:{bf:[D] frame create} {hline 2}}Create a new frame{p_end}\n' +
                '{p2col:}({mansection D framecreate:View complete PDF manual entry}){p_end}\n' +
                '{p2colreset}{...}';
            const result = smcl_to_html(my_header);
            expect(result.html).toContain(
                '<h1 class="smcl-help-title-heading">frame create</h1>'
            );
            expect(result.html).not.toContain('[D]');
            expect(result.html).toContain(
                'href="https://www.stata.com/manuals/dframecreate.pdf"'
            );
        });

        it('falls back to a normal p2col table when the first row is not a title', () => {
            // No `{bf:[X] name}` in the first column → render as table.
            const my_body =
                '{p2colset 5 19 21 2}\n' +
                '{p2col:{cmd:regress}}Linear regression{p_end}\n' +
                '{p2col:{cmd:logit}}Logistic regression{p_end}\n' +
                '{p2colreset}';
            const result = smcl_to_html(my_body);
            expect(result.html).toContain('smcl-p2col-table');
            expect(result.html).not.toContain('smcl-help-title');
        });

        it('renders an inline {mansection} as a link outside of the title block', () => {
            const result = smcl_to_html(
                'see {mansection P display:the Programming manual}'
            );
            expect(result.html).toContain(
                'href="https://www.stata.com/manuals/pdisplay.pdf"'
            );
            // target="_blank" would cause VS Code to race the native
            // link handler with our postMessage route — the link
            // should rely solely on the webview click handler.
            expect(result.html).not.toContain('target="_blank"');
            expect(result.html).toContain('the Programming manual</a>');
        });

        it('deep-links mansection subsection targets to the case-preserved PDF destination', () => {
            // `{mansection P displayRemarksandexamples:Remarks and examples}`
            // must resolve to `pdisplay.pdf#pdisplayRemarksandexamples`
            // (case preserved). The destination name was confirmed by
            // parsing stata.com's published PDF.
            const result = smcl_to_html(
                '{mansection P displayRemarksandexamples:Remarks and examples}'
            );
            expect(result.html).toContain(
                'href="https://www.stata.com/manuals/pdisplay.pdf#pdisplayRemarksandexamples"'
            );
            // Case-preservation is the whole point — the previous
            // lowercased form doesn't match the PDF's named
            // destination and landed on page 1.
            expect(result.html).not.toContain(
                'pdisplay.pdf#pdisplayremarksandexamples'
            );
            // And the broken `pdisplayremarksandexamples.pdf` guess
            // must not resurface.
            expect(result.html).not.toContain(
                'pdisplayremarksandexamples.pdf'
            );
            expect(result.html).toContain('Remarks and examples</a>');
        });

        it('preserves case for mansection anchors across manuals (rregress)', () => {
            const result = smcl_to_html(
                '{mansection R regressMethodsandformulas:Methods and formulas}'
            );
            expect(result.html).toContain(
                'href="https://www.stata.com/manuals/rregress.pdf#rregressMethodsandformulas"'
            );
        });

        it('resolves U-style section references to chapter PDFs with anchors', () => {
            // Destinations verified against /manuals/u12.pdf.
            const result = smcl_to_html(
                '{mansection U 12.5FormatsControllinghowdataaredisplayed:'
                + '[U] 12.5 Formats: Controlling how data are displayed}'
            );
            expect(result.html).toContain(
                'href="https://www.stata.com/manuals/u12.pdf'
                + '#u12.5FormatsControllinghowdataaredisplayed"'
            );
        });
    });

    describe('{manlink} references', () => {
        it('renders {manlink R display} as a Reference Manual PDF link', () => {
            // Matches Stata's native viewer behavior: `{manlink R display}`
            // opens the R Reference Manual PDF entry, not the display
            // sthlp help file (which would just re-reveal the page the
            // user is already viewing).
            const result = smcl_to_html('see {manlink R display} for details');
            expect(result.html).toContain(
                'href="https://www.stata.com/manuals/rdisplay.pdf"'
            );
            expect(result.html).toContain('smcl-manlink-pdf');
            // Displayed text keeps the `[R] display` shape.
            expect(result.html).toContain('>[R] display</a>');
            // PDF-routed manlinks should not emit an internal navigate.
            expect(result.html).not.toContain('data-smcl-topic');
            expect(result.html).not.toContain('target="_blank"');
        });

        it('renders {manlink U 12.5Foo} as a PDF link (browse route)', () => {
            const result = smcl_to_html(
                '{manlink U 12.5FormatsControllinghowdataaredisplayed}'
            );
            expect(result.html).toContain(
                'href="https://www.stata.com/manuals/u12.pdf'
                + '#u12.5FormatsControllinghowdataaredisplayed"'
            );
            expect(result.html).toContain('smcl-browse');
            expect(result.html).not.toContain('target="_blank"');
        });

        it('wraps {manlinki X Y} in <em> while still emitting a PDF link', () => {
            const result = smcl_to_html('{manlinki R display}');
            expect(result.html).toContain('<em>');
            expect(result.html).toContain(
                'href="https://www.stata.com/manuals/rdisplay.pdf"'
            );
            expect(result.html).not.toContain('data-smcl-topic');
        });
    });

    describe('{bf:[X] name} inline manual references', () => {
        it('makes `{bf:[R] regress}` a Reference Manual PDF link', () => {
            const result = smcl_to_html(
                'Use {bf:[R] regress} for ordinary least squares.'
            );
            expect(result.html).toContain(
                '<strong><a class="smcl-browse smcl-mansection smcl-manlink-pdf"'
            );
            expect(result.html).toContain(
                'href="https://www.stata.com/manuals/rregress.pdf"'
            );
            expect(result.html).toContain('>[R] regress</a>');
            expect(result.html).not.toContain('data-smcl-topic');
        });

        it('makes `{bf:[U] 12.5 Formats}` a PDF link', () => {
            const result = smcl_to_html('see {bf:[U] 12.5 Formats}');
            expect(result.html).toContain(
                '<strong><a class="smcl-browse smcl-mansection smcl-manlink-pdf"'
            );
            expect(result.html).toContain(
                'href="https://www.stata.com/manuals/u12.pdf#u12.5Formats"'
            );
            expect(result.html).toContain('>[U] 12.5 Formats</a>');
        });

        it('leaves unrelated `{bf:}` content as plain <strong>', () => {
            const result = smcl_to_html('{bf:some bold words}');
            // Content is wrapped in a data-line <span> for scroll
            // sync; what matters is that no manlink anchor is added.
            expect(result.html).toContain('<strong>');
            expect(result.html).toContain('some bold words');
            expect(result.html).not.toContain('smcl-manlink-topic');
            expect(result.html).not.toContain('smcl-manlink-pdf');
            expect(result.html).not.toContain('data-smcl-topic');
        });

        it('does not transform `{bf:}` content that contains nested markup', () => {
            // Nested directive inside bf: render as plain bold (no topic).
            const result = smcl_to_html('{bf:{it:[R] regress}}');
            expect(result.html).not.toContain('smcl-manlink-topic');
            expect(result.html).not.toContain('smcl-manlink-pdf');
            expect(result.html).toContain('<strong>');
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

    describe('placeholder {title:Title}', () => {
        it('strips a leading {title:Title} placeholder', () => {
            const result = smcl_to_html('{title:Title}');
            expect(result.html).not.toContain('smcl-title');
            expect(result.html).not.toContain('Title');
        });

        it('keeps meaningful title headings intact', () => {
            const result = smcl_to_html(
                '{title:Syntax}\n{title:Title}'
            );
            // First title is "Syntax" (meaningful), so the scan stops
            // there and the literal {title:Title} later in the doc is
            // left alone.
            expect(result.html).toContain('smcl-title');
            expect(result.html).toContain('Syntax');
            expect(result.html).toContain('Title');
        });

        it('strips {title:Title} even when preceded by trivia', () => {
            const result = smcl_to_html(
                '{smcl}\n{vieweralsosee "" "--"}\n{title:Title}\n{title:Remarks}'
            );
            // Only the placeholder is dropped; Remarks survives.
            expect(result.html).toContain('Remarks');
            // No literal "Title" heading remains.
            expect(result.html).not.toMatch(/<h2[^>]*>Title<\/h2>/);
        });

        it('keeps {title:Title} that appears after other titles', () => {
            const result = smcl_to_html(
                '{title:Description}\n{title:Title}'
            );
            // The first title was not the placeholder, so we leave
            // subsequent occurrences alone.
            expect(result.html).toContain('Description');
            expect(result.html).toContain('>Title<');
        });
    });

    describe('findalias substitution', () => {
        it('renders nothing when no findalias_map is provided', () => {
            const result = smcl_to_html('{findalias frexp}');
            expect(result.html).toBe('');
        });

        it('renders nothing when the alias is not in the map', () => {
            const result = smcl_to_html('{findalias unknown}', {
                findalias_map: new Map([['frexp', '{manlink U 13 Functions and expressions}']]),
            });
            expect(result.html).toBe('');
        });

        it('substitutes and renders the alias target as SMCL', () => {
            // A preceding `{marker}` prevents the findalias-driven
            // help-title transform from kicking in, so this case
            // exercises the raw inline substitution path.
            const result = smcl_to_html(
                '{marker body}\n{findalias frexp}',
                {
                    findalias_map: new Map([
                        ['frexp', '{manlink U 13 Functions and expressions}'],
                    ]),
                }
            );
            // `{manlink U 13 Functions and expressions}` renders as
            // a bolded PDF link (see render_manlink).
            expect(result.html).toContain('[U] 13 Functions and expressions');
            expect(result.html).toContain('<strong>');
            expect(result.html).toContain(
                'href="https://www.stata.com/manuals/u13.pdf'
            );
        });

        it('renders the substitution inline within surrounding SMCL', () => {
            // As above: the `{marker}` keeps the findalias from being
            // collapsed into a help-title header.
            const result = smcl_to_html(
                '{marker body}\n{pstd}\n{findalias frexp}\n{p_end}',
                {
                    findalias_map: new Map([
                        ['frexp', '{manlink U 13 Functions and expressions}'],
                    ]),
                }
            );
            expect(result.html).toContain('smcl-pstd');
            expect(result.html).toContain('[U] 13 Functions and expressions');
        });

        it('guards against recursive substitution', () => {
            // `a` expands to `{findalias b}`, `b` expands back to
            // `{findalias a}`. The renderer must short-circuit the
            // second recurrence instead of looping forever.
            const result = smcl_to_html('{findalias a}', {
                findalias_map: new Map([
                    ['a', '{findalias b}'],
                    ['b', '{findalias a}'],
                ]),
            });
            expect(result.html).toBe('');
        });
    });

    describe('findalias-driven help title', () => {
        const my_findalias_map = new Map([
            ['froperators', '{manlink U 13.2 Operators}'],
            ['frexp', '{manlink U 13 Functions and expressions}'],
        ]);

        it('renders {pstd}{findalias X} as a full help-title header', () => {
            const result = smcl_to_html(
                '{title:Title}\n\n{pstd}\n{findalias froperators}\n\n{marker syntax}',
                { findalias_map: my_findalias_map }
            );
            expect(result.html).toContain('smcl-help-title');
            expect(result.html).toContain('smcl-help-title-heading');
            // Heading strips the leading section number ("13.2 ").
            expect(result.html).toContain('>Operators<');
            // Full manual reference appears as subtitle.
            expect(result.html).toContain('[U] 13.2 Operators');
            // PDF link with the standard label.
            expect(result.html).toContain(
                'View the complete manual entry (PDF, opens in browser)'
            );
            expect(result.html).toContain(
                'href="https://www.stata.com/manuals/u13.pdf'
            );
            // The pstd paragraph itself should not survive, so we
            // don't leak the original {findalias} rendering next to
            // the header.
            expect(result.html).not.toContain('smcl-pstd');
        });

        it('strips section numbers from multi-word entries', () => {
            const result = smcl_to_html(
                '{pstd}\n{findalias frexp}\n\n{marker remarks}',
                { findalias_map: my_findalias_map }
            );
            expect(result.html).toContain('>Functions and expressions<');
            expect(result.html).toContain(
                '[U] 13 Functions and expressions'
            );
        });

        it('leaves the tree alone when the findalias_map is absent', () => {
            const result = smcl_to_html(
                '{pstd}\n{findalias froperators}\n\n{marker syntax}'
            );
            expect(result.html).not.toContain('smcl-help-title');
        });

        it('leaves the tree alone when the substitution is not a manlink', () => {
            const result = smcl_to_html(
                '{pstd}\n{findalias asfroperators}\n\n{marker syntax}',
                {
                    findalias_map: new Map([
                        ['asfroperators', '{vieweralsosee "[U] 13.2 Operators" "mansection U 13.2Operators"}'],
                    ]),
                }
            );
            expect(result.html).not.toContain('smcl-help-title');
        });

        it('leaves the tree alone when a real title precedes the findalias', () => {
            // If some other meaningful title (e.g. `Description`)
            // appears first, the file isn't using the placeholder
            // convention and we must not swallow the pstd paragraph.
            const result = smcl_to_html(
                '{title:Description}\n\n{pstd}\n{findalias froperators}\n',
                { findalias_map: my_findalias_map }
            );
            expect(result.html).not.toContain('smcl-help-title-heading');
            expect(result.html).toContain('Description');
        });
    });

    describe('viewerjumpto TOC', () => {
        it('renders viewerjumpto directives as a horizontal TOC bar', () => {
            const my_input =
                '{viewerjumpto "Syntax" "regress##syntax"}{...}\n' +
                '{viewerjumpto "Description" "regress##description"}{...}\n' +
                '{title:Title}\n' +
                '{p}Body text{p_end}';
            const result = smcl_to_html(my_input, {
                current_topic: 'regress',
            });
            expect(result.html).toContain('class="smcl-toc"');
            expect(result.html).toContain('href="#syntax"');
            expect(result.html).toContain('href="#description"');
            expect(result.html).toContain('>Syntax<');
            expect(result.html).toContain('>Description<');
        });

        it('renders TOC entries as smcl-jumpto links', () => {
            const my_input =
                '{viewerjumpto "Options" "test##options"}{...}\n' +
                '{p}Content{p_end}';
            const result = smcl_to_html(my_input, {
                current_topic: 'test',
            });
            expect(result.html).toContain('class="smcl-jumpto"');
            expect(result.html).toContain('href="#options"');
        });

        it('renders TOC with pipe separators', () => {
            const my_input =
                '{viewerjumpto "A" "x##a"}{...}\n' +
                '{viewerjumpto "B" "x##b"}{...}\n' +
                '{viewerjumpto "C" "x##c"}{...}\n';
            const result = smcl_to_html(my_input, {
                current_topic: 'x',
            });
            expect(result.html).toContain('smcl-toc-separator');
        });

        it('does not render TOC when no viewerjumpto directives', () => {
            const result = smcl_to_html('{p}Just content{p_end}');
            expect(result.html).not.toContain('smcl-toc');
        });

        it('still suppresses viewerdialog and vieweralsosee', () => {
            const my_input =
                '{vieweralsosee "[D] dir" "mansection D dir"}{...}\n' +
                '{viewerdialog regress "dialog regress"}{...}';
            const result = smcl_to_html(my_input);
            expect(result.html).not.toContain('dir');
            expect(result.html).not.toContain('dialog');
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

            const result = smcl_to_html(smcl, { current_topic: 'regress' });
            // {viewerjumpto} entries render as a TOC bar; the title row
            // is rendered as a heading block.
            expect(result.html).toContain('href="#syntax"');
            expect(result.html).toContain('href="#options"');
            expect(result.html).toContain('<hr');
            expect(result.html).toContain('smcl-help-title-heading');
            expect(result.html).toContain('Linear regression');
        });
    });

    describe('{search} and {view} directives', () => {
        it('renders {search keyword} as a help link', () => {
            const result = smcl_to_html('{search robust}');
            expect(result.html).toContain('data-smcl-topic="robust"');
            expect(result.html).toContain('class="smcl-help-link"');
        });

        it('renders {search keyword:display text} with display text', () => {
            const result = smcl_to_html('{search robust:click here}');
            expect(result.html).toContain('data-smcl-topic="robust"');
            expect(result.html).toContain('click here');
        });

        it('renders {view file.sthlp} as a help link', () => {
            const result = smcl_to_html('{view regress.sthlp}');
            expect(result.html).toContain('data-smcl-topic="regress"');
            expect(result.html).toContain('class="smcl-help-link"');
        });

        it('renders {view file.hlp} as a help link', () => {
            const result = smcl_to_html('{view myhelp.hlp}');
            expect(result.html).toContain('data-smcl-topic="myhelp"');
        });

        it('renders {view other.txt} as plain text', () => {
            const result = smcl_to_html('{view notes.txt}');
            expect(result.html).toContain('notes.txt');
            expect(result.html).not.toContain('data-smcl-topic');
        });

        it('renders {view file.sthlp:display} with display text', () => {
            const result = smcl_to_html('{view regress.sthlp:see regress}');
            expect(result.html).toContain('data-smcl-topic="regress"');
            expect(result.html).toContain('see regress');
        });

        it('keeps {dialog} as plain text', () => {
            const result = smcl_to_html('{dialog regress:the dialog box}');
            expect(result.html).toContain('the dialog box');
            expect(result.html).not.toContain('data-smcl-topic');
            expect(result.html).not.toContain('href');
        });
    });
});
