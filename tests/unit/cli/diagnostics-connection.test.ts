import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
    DiagnosticsConnection,
    DiagnosticsProvider,
} from '../../../src/providers/diagnostics';

const repo_root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../..'
);

describe('DiagnosticsProvider connection surface', () => {
    it('exports a narrow diagnostics connection interface', () => {
        const source = fs.readFileSync(
            path.join(repo_root, 'src/providers/diagnostics.ts'),
            'utf8'
        );

        expect(source).toContain('export interface DiagnosticsConnection');
        expect(source).toContain('connection: DiagnosticsConnection');
        expect(source).not.toContain('connection: Connection');
    });

    it('accepts the narrow CLI diagnostics connection', () => {
        const connection: DiagnosticsConnection = {
            sendDiagnostics: () => undefined,
        };
        const provider = new DiagnosticsProvider(connection);

        expect(provider).toBeInstanceOf(DiagnosticsProvider);
    });
});
