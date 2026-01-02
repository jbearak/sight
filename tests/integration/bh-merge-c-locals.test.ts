/**
 * Integration test for bh_merge c_locals issue
 * 
 * This test validates that c_local macros defined in a program are correctly
 * registered in the caller's scope when the program is called.
 * 
 * Scenario:
 * 1. programs.do defines bh_merge with c_local statements
 * 2. loop.do runs programs.do
 * 3. survey.do has @lsp-done-by: loop.do and calls bh_merge
 * 4. survey.do uses bh_merge_bh_vars_final (created by c_local)
 * 
 * The LSP should NOT emit an "undefined local macro" warning for bh_merge_bh_vars_final
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { WorkspaceIndexer } from '../../src/indexer';
import { DocumentStore } from '../../src/document-store';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import { DiagnosticsProvider } from '../../src/providers/diagnostics';
import { DocumentDebounceManager } from '../../src/utils/debounce-manager';
import * as path from 'path';
import * as fs from 'fs';

function create_test_config() {
    return {
        diagnostics: { 
            enabled: true,
            severity: {
                undefinedMacro: 'warning',
                undefinedVariable: 'information',
                styleWarnings: 'hint',
            },
        },
        cross_file: { assume_call_site: false },
    } as any;
}

describe('bh_merge c_locals integration test', () => {
    const fixture_root = path.join(process.cwd(), 'tests/fixtures/c-locals');
    const survey_path = path.join(fixture_root, 'subdir', 'survey.do');
    const survey_uri = `file://${survey_path}`;
    
    let indexer: WorkspaceIndexer;
    let document_store: DocumentStore;
    let scope_resolver: ScopeResolver;
    let forward_scope_resolver: ForwardScopeResolver;
    
    beforeAll(async () => {
        indexer = new WorkspaceIndexer();
        document_store = new DocumentStore();
        scope_resolver = new ScopeResolver({ log: () => {}, warn: () => {} });
        forward_scope_resolver = new ForwardScopeResolver(scope_resolver, {
            max_forward_depth: 10,
        });
        scope_resolver.set_forward_scope_resolver(forward_scope_resolver);
        forward_scope_resolver.set_workspace_roots([fixture_root]);
        document_store.set_workspace_root(fixture_root);
        document_store.set_scope_resolver(scope_resolver);
        
        await indexer.initialize([fixture_root]);
        await new Promise(resolve => setTimeout(resolve, 1000));
    });
    
    it('should find bh_merge program with c_locals in workspace index', () => {
        const workspace_symbols = indexer.get_all_symbols();
        const bh_merge = workspace_symbols.programs.get('bh_merge');
        
        expect(bh_merge).toBeDefined();
        expect(bh_merge?.c_locals).toBeDefined();
        expect(bh_merge?.c_locals).toContain('bh_merge_bh_vars_final');
        expect(bh_merge?.c_locals).toContain('bh_merge_bh_vars_renamed');
    });

    
    it('should register c_local macros when document is opened with workspace symbols', async () => {
        const survey_content = fs.readFileSync(survey_path, 'utf-8');
        const workspace_symbols = indexer.get_all_symbols();
        
        document_store.close(survey_uri);
        await document_store.open(survey_uri, survey_content, 1, workspace_symbols);
        
        const doc_state = document_store.get(survey_uri);
        expect(doc_state).toBeDefined();
        
        const macro = doc_state?.symbols.localMacros.get('bh_merge_bh_vars_final');
        expect(macro).toBeDefined();
    });
    
    it('should NOT emit undefined macro warning for bh_merge_bh_vars_final', async () => {
        const survey_content = fs.readFileSync(survey_path, 'utf-8');
        const workspace_symbols = indexer.get_all_symbols();
        
        document_store.close(survey_uri);
        await document_store.open(survey_uri, survey_content, 1, workspace_symbols);
        
        const doc_state = document_store.get(survey_uri);
        expect(doc_state).toBeDefined();
        
        const undefined_macro_diags = doc_state?.diagnostics.filter(d => 
            d.message.includes('bh_merge_bh_vars_final')
        );
        
        expect(undefined_macro_diags).toHaveLength(0);
    });
    
    it('should find bh_merge in resolved scope via @lsp-done-by chain', async () => {
        const survey_content = fs.readFileSync(survey_path, 'utf-8');
        const resolved_scope = await scope_resolver.resolve(survey_uri, survey_content);
        
        const bh_merge = resolved_scope.symbols.programs.get('bh_merge');
        expect(bh_merge).toBeDefined();
        expect(bh_merge?.c_locals).toContain('bh_merge_bh_vars_final');
    });
    
    it('should NOT emit warning when using DiagnosticsProvider with workspace symbols', async () => {
        const survey_content = fs.readFileSync(survey_path, 'utf-8');
        const workspace_symbols = indexer.get_all_symbols();
        
        document_store.close(survey_uri);
        await document_store.open(survey_uri, survey_content, 2, workspace_symbols);
        
        const doc_state = document_store.get(survey_uri);
        expect(doc_state).toBeDefined();
        
        const mock_connection = { sendDiagnostics: () => {} };
        const debounce_manager = new DocumentDebounceManager();
        const diagnostics_provider = new DiagnosticsProvider(mock_connection as any, debounce_manager);
        
        const result = await diagnostics_provider.publish_diagnostics(
            doc_state!,
            create_test_config(),
            workspace_symbols,
            scope_resolver
        );
        
        const bh_merge_diags = result.diagnostics.filter(d => 
            d.message.includes('bh_merge_bh_vars_final')
        );
        
        expect(bh_merge_diags).toHaveLength(0);
    });

    
    it('should suppress warning via scope resolver even without workspace symbols', async () => {
        const survey_content = fs.readFileSync(survey_path, 'utf-8');
        
        document_store.close(survey_uri);
        await document_store.open(survey_uri, survey_content, 3, undefined);
        
        const doc_state = document_store.get(survey_uri);
        expect(doc_state).toBeDefined();
        
        // Analyzer emits warning without workspace symbols
        const analyzer_diags = doc_state?.diagnostics.filter(d => 
            d.message.includes('bh_merge_bh_vars_final')
        );
        expect(analyzer_diags?.length).toBeGreaterThan(0);
        
        // But DiagnosticsProvider should suppress it using resolved scope
        const mock_connection = { sendDiagnostics: () => {} };
        const debounce_manager = new DocumentDebounceManager();
        const diagnostics_provider = new DiagnosticsProvider(mock_connection as any, debounce_manager);
        
        const result = await diagnostics_provider.publish_diagnostics(
            doc_state!,
            create_test_config(),
            undefined,
            scope_resolver
        );
        
        const bh_merge_diags = result.diagnostics.filter(d => 
            d.message.includes('bh_merge_bh_vars_final')
        );
        
        expect(bh_merge_diags).toHaveLength(0);
    });
    
    it('should EMIT warning when bh_merge call is removed', async () => {
        const survey_content = fs.readFileSync(survey_path, 'utf-8');
        
        // Comment out the bh_merge call but keep the macro reference
        const lines = survey_content.split('\n');
        const bh_merge_call_line = lines.findIndex(l => l.trim().startsWith('bh_merge '));
        expect(bh_merge_call_line).toBeGreaterThan(0);
        
        const modified_lines = [...lines];
        modified_lines[bh_merge_call_line] = '* ' + modified_lines[bh_merge_call_line];
        const modified_content = modified_lines.join('\n');
        
        document_store.close(survey_uri);
        await document_store.open(survey_uri, modified_content, 4, undefined);
        
        const doc_state = document_store.get(survey_uri);
        expect(doc_state).toBeDefined();
        
        const mock_connection = { sendDiagnostics: () => {} };
        const debounce_manager = new DocumentDebounceManager();
        const diagnostics_provider = new DiagnosticsProvider(mock_connection as any, debounce_manager);
        
        const result = await diagnostics_provider.publish_diagnostics(
            doc_state!,
            create_test_config(),
            undefined,
            scope_resolver
        );
        
        const bh_merge_diags = result.diagnostics.filter(d => 
            d.message.includes('bh_merge_bh_vars_final')
        );
        
        // Warning should be shown when program exists but wasn't called
        expect(bh_merge_diags.length).toBeGreaterThan(0);
    });
});
