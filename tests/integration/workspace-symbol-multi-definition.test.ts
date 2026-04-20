import { describe, it, expect, afterEach } from 'bun:test';
import { join } from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { WorkspaceIndexer } from '../../src/indexer';
import { SymbolProvider } from '../../src/providers/symbols';

describe('workspace/symbol — multi-definition (integration)', () => {
    let temp_dir: string | null = null;

    afterEach(() => {
        if (temp_dir && fs.existsSync(temp_dir)) {
            fs.rmSync(temp_dir, { recursive: true, force: true });
        }
        temp_dir = null;
    });

    it('returns one SymbolInformation per file when the same variable is defined in many files', async () => {
        temp_dir = fs.mkdtempSync(join(os.tmpdir(), 'sight-ws-'));

        const the_files = ['nsfg.do', 'dhs.do', 'mics.do'];
        for (const my_file of the_files) {
            fs.writeFileSync(join(temp_dir, my_file), 'gen cm_birth = 1\n');
        }

        const the_indexer = new WorkspaceIndexer();
        await the_indexer.initialize([temp_dir]);

        const the_provider = new SymbolProvider();
        const the_symbols = the_provider.get_workspace_symbols('cm_birth', [], the_indexer);

        const the_variable_basenames = the_symbols
            .filter(s => s.name === 'cm_birth' && s.containerName === 'Variable')
            .map(s => s.location.uri.split('/').pop())
            .sort();

        expect(the_variable_basenames).toEqual(['dhs.do', 'mics.do', 'nsfg.do']);
    });
});
