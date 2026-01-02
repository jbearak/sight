/**
 * Micro-benchmark for CompletionProvider merged symbol cache.
 * Measures completion latency with and without cache.
 */

import { CompletionProvider } from '../../src/providers/completion';
import { CommandDatabase } from '../../src/command-database';
import { DocumentState } from '../../src/document-store';
import { SymbolTable } from '../../src/types';
import { Position } from 'vscode-languageserver';

// Create large symbol tables to simulate real workspace
function create_large_workspace_symbols(size: number): SymbolTable {
    const symbols: SymbolTable = {
        programs: new Map(),
        localMacros: new Map(),
        globalMacros: new Map(),
        variables: new Map(),
        scalars: new Map(),
        matrices: new Map(),
    };

    // Add many global macros
    for (let i = 0; i < size; i++) {
        symbols.globalMacros.set(`global_${i}`, {
            name: `global_${i}`,
            value: `value_${i}`,
            sourceUri: `file:///workspace_${i % 10}.do`
        });
    }

    // Add many variables
    for (let i = 0; i < size; i++) {
        symbols.variables.set(`var_${i}`, {
            name: `var_${i}`,
            type: 'double',
            sourceUri: `file:///data_${i % 5}.do`,
            source: 'generate'
        });
    }

    return symbols;
}

function create_mock_document(): DocumentState {
    return {
        uri: 'file:///test.do',
        content: 'local test = 1\nglobal result = 2',
        version: 1,
        symbols: {
            programs: new Map(),
            localMacros: new Map([
                ['test', { name: 'test', value: '1', sourceUri: 'file:///test.do' }]
            ]),
            globalMacros: new Map([
                ['result', { name: 'result', value: '2', sourceUri: 'file:///test.do' }]
            ]),
            variables: new Map(),
            scalars: new Map(),
            matrices: new Map(),
        },
        tokens: [],
        ast: null,
        diagnostics: [],
        line_offsets: [0, 15, 32],
    } as DocumentState;
}

async function benchmark_completion_cache() {
    console.log('🚀 CompletionProvider Cache Benchmark');
    console.log('=====================================');

    const command_db = new CommandDatabase();
    const provider = new CompletionProvider(command_db);
    const document = create_mock_document();
    const position = Position.create(1, 10);
    const workspace_version = 1;

    // Test with different workspace sizes
    const sizes = [100, 500, 1000, 2000];

    for (const size of sizes) {
        console.log(`\n📊 Testing with ${size} workspace symbols:`);
        
        const workspace_symbols = create_large_workspace_symbols(size);

        // Measure first call (cache miss)
        const start_cold = performance.now();
        await provider.get_completions(
            document,
            position,
            undefined,
            undefined,
            workspace_symbols,
            undefined,
            undefined,
            workspace_version
        );
        const cold_time = performance.now() - start_cold;

        // Measure subsequent calls (cache hits)
        const iterations = 10;
        const start_warm = performance.now();
        
        for (let i = 0; i < iterations; i++) {
            await provider.get_completions(
                document,
                position,
                undefined,
                undefined,
                workspace_symbols,
                undefined,
                undefined,
                workspace_version
            );
        }
        
        const warm_total = performance.now() - start_warm;
        const warm_avg = warm_total / iterations;

        const speedup = cold_time / warm_avg;
        
        console.log(`  Cold (cache miss):  ${cold_time.toFixed(2)}ms`);
        console.log(`  Warm (cache hit):   ${warm_avg.toFixed(2)}ms`);
        console.log(`  Speedup:           ${speedup.toFixed(1)}x`);
        console.log(`  Cache efficiency:  ${((1 - warm_avg/cold_time) * 100).toFixed(1)}%`);
    }

    // Test cache invalidation overhead
    console.log(`\n🔄 Testing cache invalidation:`);
    const workspace_symbols = create_large_workspace_symbols(1000);
    
    const invalidation_iterations = 100;
    const start_invalidation = performance.now();
    
    for (let i = 0; i < invalidation_iterations; i++) {
        provider.invalidate_symbol_cache(i);
    }
    
    const invalidation_time = performance.now() - start_invalidation;
    const avg_invalidation = invalidation_time / invalidation_iterations;
    
    console.log(`  Average invalidation time: ${avg_invalidation.toFixed(3)}ms`);

    console.log('\n✅ Benchmark complete!');
}

// Run benchmark if this file is executed directly
if (import.meta.main) {
    benchmark_completion_cache().catch(console.error);
}

export { benchmark_completion_cache };
