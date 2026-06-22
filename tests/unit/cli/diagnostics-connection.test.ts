import { describe, expect, it, mock } from 'bun:test';
import { Diagnostic } from 'vscode-languageserver';
import {
    DiagnosticsConnection,
    DiagnosticsProvider,
} from '../../../src/providers/diagnostics';

describe('DiagnosticsProvider connection surface', () => {
    it('exports a narrow diagnostics connection contract', () => {
        // Compile-time: a value exposing only sendDiagnostics satisfies the
        // interface, so the connection surface stays narrow rather than the
        // full vscode-languageserver Connection. The typecheck step enforces
        // this — the assignment fails to compile if the contract widens.
        const send = mock(
            (_params: { uri: string; diagnostics: Diagnostic[] }) => undefined
        );
        const connection: DiagnosticsConnection = { sendDiagnostics: send };

        // Runtime: the sole member is the publish callback, callable with the
        // documented params.
        expect(Object.keys(connection)).toEqual(['sendDiagnostics']);
        connection.sendDiagnostics({ uri: 'file:///a.do', diagnostics: [] });
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('accepts the narrow CLI diagnostics connection', () => {
        const connection: DiagnosticsConnection = {
            sendDiagnostics: () => undefined,
        };
        const provider = new DiagnosticsProvider(connection);

        expect(provider).toBeInstanceOf(DiagnosticsProvider);
    });
});
