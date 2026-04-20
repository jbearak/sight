import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { WorkspaceIndexer } from '../../../src/indexer';
import { URI } from 'vscode-uri';

describe('WorkspaceIndexer.find_all_symbol_definitions', () => {
    let indexer: WorkspaceIndexer;
    let temp_dir: string;

    beforeEach(() => {
        indexer = new WorkspaceIndexer();
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-test-'));
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    it('returns matches from every file that defines the same variable', async () => {
        const the_file_names = ['a.do', 'b.do', 'c.do'];
        const the_expected_uris = new Set<string>();
        for (const my_file_name of the_file_names) {
            const my_file_path = path.join(temp_dir, my_file_name);
            fs.writeFileSync(my_file_path, 'gen cm_birth = 1\n');
            await indexer.index_file(my_file_path);
            the_expected_uris.add(URI.file(my_file_path).toString());
        }

        const the_matches = indexer.find_all_symbol_definitions('cm_birth');

        const the_variable_matches = the_matches.filter(
            my_match => my_match.kind === 'variable' && my_match.name === 'cm_birth'
        );
        const the_match_uris = new Set(the_variable_matches.map(my_match => my_match.uri));
        expect(the_match_uris).toEqual(the_expected_uris);
    });

    it('performs case-insensitive substring matching', async () => {
        const the_file_a = path.join(temp_dir, 'a.do');
        const the_file_b = path.join(temp_dir, 'b.do');
        fs.writeFileSync(the_file_a, 'gen cm_birth = 1\n');
        fs.writeFileSync(the_file_b, 'gen cm_birth_lag = 2\n');
        await indexer.index_file(the_file_a);
        await indexer.index_file(the_file_b);

        const the_matches = indexer.find_all_symbol_definitions('BIRTH');

        const the_variable_names = new Set(
            the_matches
                .filter(my_match => my_match.kind === 'variable')
                .map(my_match => my_match.name)
        );
        expect(the_variable_names.has('cm_birth')).toBe(true);
        expect(the_variable_names.has('cm_birth_lag')).toBe(true);
    });

    it('returns separate matches for the same name with different symbol kinds', async () => {
        const the_file_path = path.join(temp_dir, 'both.do');
        fs.writeFileSync(the_file_path, 'scalar x = 1\ngen x = 2\n');
        await indexer.index_file(the_file_path);
        const the_file_uri = URI.file(the_file_path).toString();

        const the_matches = indexer.find_all_symbol_definitions('x');

        const the_x_matches_from_file = the_matches.filter(
            my_match => my_match.name === 'x' && my_match.uri === the_file_uri
        );
        const the_kinds = new Set(the_x_matches_from_file.map(my_match => my_match.kind));
        expect(the_kinds.has('variable')).toBe(true);
        expect(the_kinds.has('scalar')).toBe(true);
    });

    it('returns an empty array when no symbol name matches', async () => {
        const the_file_path = path.join(temp_dir, 'a.do');
        fs.writeFileSync(the_file_path, 'gen cm_birth = 1\n');
        await indexer.index_file(the_file_path);

        const the_matches = indexer.find_all_symbol_definitions('zzz_no_match');

        expect(the_matches).toEqual([]);
    });

    it('includes local macros from multiple files', async () => {
        const the_file_a = path.join(temp_dir, 'a.do');
        const the_file_b = path.join(temp_dir, 'b.do');
        fs.writeFileSync(the_file_a, 'local my_local = 1\n');
        fs.writeFileSync(the_file_b, 'local my_local = 1\n');
        await indexer.index_file(the_file_a);
        await indexer.index_file(the_file_b);
        const the_expected_uris = new Set([
            URI.file(the_file_a).toString(),
            URI.file(the_file_b).toString(),
        ]);

        const the_matches = indexer.find_all_symbol_definitions('my_local');

        const the_local_matches = the_matches.filter(
            my_match => my_match.kind === 'local_macro' && my_match.name === 'my_local'
        );
        const the_match_uris = new Set(the_local_matches.map(my_match => my_match.uri));
        expect(the_local_matches.length).toBe(2);
        expect(the_match_uris).toEqual(the_expected_uris);
    });
});
