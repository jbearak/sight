/**
 * The local a `syntax` option defines. In StataMP 18, an option with no
 * argument whose name starts with a lowercase `no` defines the rest of
 * the name: `syntax [, noCONStant]` sets `` `constant' `` (to
 * `noconstant` when given), and `` `noconstant' `` stays empty.
 * `NODetail` (uppercase) defines `nodetail`, and an option with an
 * argument keeps its whole name: `notable(string)` defines `notable`
 * and `nolog(integer 3)` defines `nolog`.
 */
import { describe, expect, it } from 'bun:test';
import { DefinitionProvider } from '../../src/providers/definition';
import { StataDiagnosticCode } from '../../src/types';
import { create_document_state } from '../property/helpers/document-utils';

/** Names of the undefined locals reported in `program p`. */
function undefined_locals(spec: string, the_names: string[]): string[] {
    const uses = the_names.map((my_name) => `\`${my_name}'`).join(' ');
    const source = `program p\n    syntax [, ${spec}]\n    di "${uses}"\nend\n`;
    return create_document_state(source).diagnostics
        .filter((my_diagnostic) =>
            my_diagnostic.code === StataDiagnosticCode.UNDEFINED_MACRO)
        .map((my_diagnostic) => my_diagnostic.message);
}

describe('syntax options that start with no', () => {
    it('defines constant, not noconstant, for noCONStant', () => {
        expect(undefined_locals('noCONStant', ['constant', 'noconstant']))
            .toEqual(["`noconstant' is not defined"]);
    });

    it('drops a lowercase no from an all-lowercase name', () => {
        expect(undefined_locals('nolog noTE', ['log', 'te'])).toEqual([]);
    });

    it('keeps an uppercase NO as part of the name', () => {
        expect(undefined_locals('NODetail NOISily', ['nodetail', 'noisily', 'detail']))
            .toEqual(["`detail' is not defined"]);
    });

    it('keeps the whole name of an option with an argument', () => {
        expect(undefined_locals('notable(string) nolog(integer 3)', [
            'notable', 'nolog', 'table', 'log',
        ])).toEqual(["`table' is not defined", "`log' is not defined"]);
    });

    it('points the definition of `constant\' at the option', async () => {
        const source = 'program p\n    syntax [, noCONStant]\n    di "`constant\'"\nend\n';
        const result = await new DefinitionProvider().get_definition(
            create_document_state(source), { line: 2, character: 9 }
        );
        const the_locations = Array.isArray(result) ? result : result ? [result] : [];
        expect(the_locations.map((my_location) =>
            'range' in my_location ? my_location.range.start.line : -1))
            .toEqual([1]);
    });
});
