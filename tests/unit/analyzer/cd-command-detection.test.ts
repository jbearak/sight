/**
 * The analyzer records top-level literal `cd` commands (issue #252) so a
 * downstream helper can build the line-sensitive working-directory timeline.
 * Recognition is conservative: only unprefixed, static, top-level `cd` with a
 * path argument is recorded. The analyzer performs NO path resolution.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { SemanticAnalyzer } from '../../../src/analyzer/index';
import { StataLexer } from '../../../src/lexer';
import { StataParser } from '../../../src/parser';

describe('Analyzer cd_command detection (issue #252)', () => {
    let my_analyzer: SemanticAnalyzer;
    let my_lexer: StataLexer;
    let my_parser: StataParser;

    beforeEach(() => {
        my_analyzer = new SemanticAnalyzer();
        my_lexer = new StataLexer();
        my_parser = new StataParser();
    });

    function cd_paths(my_source: string): string[] {
        const my_lex = my_lexer.tokenize(my_source);
        const my_parse = my_parser.parse(my_lex.tokens);
        const my_result = my_analyzer.analyze(
            my_parse.ast,
            'file:///test.do',
            undefined,
            undefined,
            my_lex.tokens,
        );
        return my_result.cd_commands.map(c => c.raw_path);
    }

    function cd_commands(my_source: string) {
        const my_lex = my_lexer.tokenize(my_source);
        const my_parse = my_parser.parse(my_lex.tokens);
        return my_analyzer.analyze(
            my_parse.ast, 'file:///test.do', undefined, undefined, my_lex.tokens,
        ).cd_commands;
    }

    it('records quoted and unquoted top-level cd targets in order', () => {
        expect(cd_paths('cd "raw"\ncd ../analysis\n')).toEqual(['raw', '../analysis']);
    });

    it('marks macro-containing cd paths as non-static', () => {
        const the_cds = cd_commands('cd "`dir\'"\n');
        expect(the_cds).toHaveLength(1);
        expect(the_cds[0]!.is_static).toBe(false);
    });

    it('skips bare cd (no path argument)', () => {
        expect(cd_paths('cd\ndisplay 1\n')).toEqual([]);
    });

    it('skips prefixed cd (capture/quietly)', () => {
        expect(cd_paths('capture cd "x"\nquietly cd "y"\n')).toEqual([]);
    });

    it('skips cd inside a program body (out of scope)', () => {
        const src = `cd "top"\nprogram define foo\n    cd "inside"\nend\n`;
        expect(cd_paths(src)).toEqual(['top']);
    });

    it('skips cd inside a loop body (out of scope)', () => {
        const src = `cd "top"\nforeach v in a b {\n    cd "inside"\n}\n`;
        expect(cd_paths(src)).toEqual(['top']);
    });

    it('skips cd inside an if branch (out of scope)', () => {
        const src = `cd "top"\nif 1 == 1 {\n    cd "inside"\n}\n`;
        expect(cd_paths(src)).toEqual(['top']);
    });

    it('is case-sensitive: `CD` is not a cd command', () => {
        expect(cd_paths('CD "x"\n')).toEqual([]);
    });

    it('does not record cd under #delimit ; (pre-existing parser limitation)', () => {
        // KNOWN LIMITATION: under `#delimit ;` the parser does not attach the
        // path as a varlist argument (`cd "raw";` becomes a `cd` node with no
        // varlist plus a separate `"raw"` node), so cd is skipped. This affects
        // do/run/include forward-call detection identically and is out of scope
        // for #252. Pinned here so the behavior change is explicit if the parser
        // later gains #delimit ; file-command support.
        const src = `#delimit ;\ncd "raw";\ndo import;\n`;
        const the_lex = my_lexer.tokenize(src);
        const the_parse = my_parser.parse(the_lex.tokens);
        const the_result = my_analyzer.analyze(
            the_parse.ast, 'file:///test.do', undefined, undefined, the_lex.tokens,
        );
        expect(the_result.cd_commands).toEqual([]);
        // do/run/include detection is a no-op here too — consistency check.
        expect(the_result.forward_calls).toEqual([]);
    });

    it('records the command range start for ordering', () => {
        const the_cds = cd_commands('display 1\ncd "raw"\n');
        expect(the_cds).toHaveLength(1);
        expect(the_cds[0]!.range.start.line).toBe(1);
    });
});
