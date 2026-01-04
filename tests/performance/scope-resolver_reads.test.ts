
import { ScopeResolver } from '../../src/scope-resolver';
import { ContentProvider } from '../../src/types';
import { describe, it, expect, beforeEach } from 'bun:test';
import { URI } from 'vscode-uri';

describe('ScopeResolver Performance', () => {
    let resolver: ScopeResolver;
    let read_counts: Map<string, number>;
    let stat_counts: Map<string, number>;

    beforeEach(() => {
        read_counts = new Map();
        stat_counts = new Map();

        const content_provider: ContentProvider = {
            read_file: async (uri: string) => {
                const current = read_counts.get(uri) || 0;
                read_counts.set(uri, current + 1);

                // Chain: main -> A -> B -> C
                if (uri.endsWith('main.do')) return '* @lsp-done-by: "A.do"';
                if (uri.endsWith('A.do')) return '* @lsp-done-by: "B.do"';
                if (uri.endsWith('B.do')) return '* @lsp-done-by: "C.do"';
                if (uri.endsWith('C.do')) return '* define macro';
                return '';
            },
            exists: async (uri: string) => true,
            stat: async (uri: string) => {
                const current = stat_counts.get(uri) || 0;
                stat_counts.set(uri, current + 1);

                // Chain: main -> A -> B -> C
                let content = '';
                if (uri.endsWith('main.do')) content = '* @lsp-done-by: "A.do"';
                else if (uri.endsWith('A.do')) content = '* @lsp-done-by: "B.do"';
                else if (uri.endsWith('B.do')) content = '* @lsp-done-by: "C.do"';
                else if (uri.endsWith('C.do')) content = '* define macro';

                return { mtimeMs: 1000, size: Buffer.byteLength(content, 'utf8') };
            }
        };

        resolver = new ScopeResolver(undefined, content_provider);
    });

    it('measures redundant reads in a deep chain', async () => {
        const uri = URI.file('/test/main.do').toString();
        await resolver.resolve(uri, '* @lsp-done-by: "A.do"');

        // Calculate total reads excluding the main file (which is passed directly)
        let total_reads = 0;
        for (const [file, count] of read_counts) {
            if (!file.endsWith('main.do')) {
                total_reads += count;
            }
        }

        console.log('Read counts:', Object.fromEntries(read_counts));

        // In the unoptimized implementation:
        // Resolve main -> follows A
        //   Indentifying A's WD -> reads A
        //   Parsing A -> reads A
        //   Resolving A -> follows B
        //     Identifying B's WD -> reads B
        //     Parsing B -> reads B
        //     Resolving B -> follows C
        //       Identifying C's WD -> reads C
        //       Parsing C -> reads C
        //
        // But wait, discover_working_directory is recursive.
        // For A: discovers WD for A (reads A) -> recurses to B (reads B) -> recurses to C (reads C)
        // Then parses A (reads A).
        // Then follows B:
        //   For B: discovers WD for B (reads B) -> recurses to C (reads C)
        //   Then parses B (reads B)
        //
        // So expected reads:
        // A: 1 (discovery top) + 1 (parse) = 2
        // B: 1 (discovery from A) + 1 (discovery top) + 1 (parse) = 3
        // C: 1 (discovery from A) + 1 (discovery from B) + 1 (discovery top) + 1 (parse) = 4

        // We expect O(N^2) behavior or at least > N
        // A, B, C = 3 files. optimized should be 3 reads total.
        // Current implementation is likely much higher.

        expect(total_reads).toBe(3);
    });

    it('skips read_file if mtime matches', async () => {
        const uri = URI.file('/test/main.do').toString();

        // Initial resolution - populates cache
        await resolver.resolve(uri, '* @lsp-done-by: "A.do"');
        const initial_reads = new Map(read_counts);
        const initial_stats = new Map(stat_counts);

        // Second resolution - slightly different content to bypass scope_cache
        // but A.do should still be in file_cache.
        await resolver.resolve(uri, '* @lsp-done-by: "A.do" ');

        console.log('Final read counts:', Object.fromEntries(read_counts));
        console.log('Final stat counts:', Object.fromEntries(stat_counts));

        // Verify that stat was called again but read_file was NOT
        for (const [file, count] of read_counts) {
            const initial_count = initial_reads.get(file) || 0;
            if (!file.endsWith('main.do')) {
                expect(count).toBe(initial_count);
            }
        }

        for (const [file, count] of stat_counts) {
            const initial_count = initial_stats.get(file) || 0;
            if (!file.endsWith('main.do')) {
                expect(count).toBeGreaterThan(initial_count);
            }
        }
    });
});
