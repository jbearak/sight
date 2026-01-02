/**
 * Integration test for the exact bug scenario from the design document
 * 
 * Tests the survey.do -> bh_vars.do -> bircmc.do hierarchy where:
 * - survey.do defines `local country_name`
 * - bh_vars.do uses `@lsp-included-by: survey.do`
 * - bircmc.do uses `@lsp-done-by: bh_vars.do` and references `country_name`
 * 
 * The bug was that bircmc.do showed "defined after the call site" instead of
 * "local macros are not inherited via do/run"
 */

import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { DiagnosticsProvider } from '../../src/providers/diagnostics';
import { DocumentStore } from '../../src/document-store';
import { ScopeResolver } from '../../src/scope-resolver';
import { StataLSPConfig } from '../../src/types';
import { join } from 'path';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { URI } from 'vscode-uri';
import { Connection } from 'vscode-languageserver';

describe('Out-of-Scope Diagnostic Message Bug - Exact Scenario', () => {
    const test_temp_dir = join(process.cwd(), 'temp_out_of_scope_bug_test');
    let diagnostic_provider: DiagnosticsProvider;
    let document_store: DocumentStore;
    let scope_resolver: ScopeResolver;

    beforeEach(() => {
        if (existsSync(test_temp_dir)) {
            rmSync(test_temp_dir, { recursive: true, force: true });
        }
        mkdirSync(test_temp_dir);

        const mock_connection = {
            sendDiagnostics: () => {}
        } as Connection;
        
        diagnostic_provider = new DiagnosticsProvider(mock_connection);
        document_store = new DocumentStore();
        scope_resolver = new ScopeResolver();
    });

    afterAll(() => {
        if (existsSync(test_temp_dir)) {
            rmSync(test_temp_dir, { recursive: true, force: true });
        }
    });

    it('should show correct diagnostic message for the exact bug scenario', async () => {
        // Create survey.do - defines local country_name
        const survey_path = join(test_temp_dir, 'survey.do');
        const survey_content = [
            '// Survey file',
            'local country_name "Bangladesh"',
            'include "bh_vars.do"'
        ].join('\n');
        writeFileSync(survey_path, survey_content);

        // Create bh_vars.do - included by survey.do, done by bircmc.do
        const bh_vars_path = join(test_temp_dir, 'bh_vars.do');
        const bh_vars_content = [
            '// @lsp-included-by "survey.do"',
            '// BH vars file',
            'do "bircmc.do"'
        ].join('\n');
        writeFileSync(bh_vars_path, bh_vars_content);

        // Create bircmc.do - tries to use country_name via done-by
        const bircmc_path = join(test_temp_dir, 'bircmc.do');
        const bircmc_content = [
            '// @lsp-done-by "bh_vars.do"',
            '// BIRCMC file',
            'display "Country: `country_name\'"'
        ].join('\n');
        writeFileSync(bircmc_path, bircmc_content);

        // Process bircmc.do
        const bircmc_uri = URI.file(bircmc_path);
        await document_store.open(bircmc_uri.toString(), bircmc_content, 1);
        
        const document = document_store.get(bircmc_uri.toString());
        const config: StataLSPConfig = {
            diagnostics: {
                enabled: true,
                severity: {
                    undefinedMacro: 'warning',
                    undefinedVariable: 'warning',
                    styleWarnings: 'warning'
                }
            },
            cross_file: {
                diagnostics: {
                    undefined_symbol: 'warning',
                    missing_file: 'warning',
                    out_of_scope: 'warning'
                }
            }
        };
        
        const diagnostics = await diagnostic_provider.get_diagnostics(
            document!,
            config,
            undefined,
            scope_resolver
        );

        // Should have diagnostic for country_name
        expect(diagnostics.length).toBeGreaterThan(0);
        
        const country_name_diagnostic = diagnostics.find(d => 
            d.message.includes('country_name')
        );
        
        expect(country_name_diagnostic).toBeDefined();
        expect(country_name_diagnostic!.message).toContain('local macros are not inherited via do/run');
        expect(country_name_diagnostic!.message).not.toContain('after the call site');
    });

    it('should handle multiple local macros in the hierarchy correctly', async () => {
        // Create survey.do with multiple locals
        const survey_path = join(test_temp_dir, 'survey.do');
        const survey_content = [
            '// Survey file',
            'local country_name "Bangladesh"',
            'local survey_year "2023"',
            'local data_source "DHS"',
            'include "bh_vars.do"'
        ].join('\n');
        writeFileSync(survey_path, survey_content);

        // Create bh_vars.do
        const bh_vars_path = join(test_temp_dir, 'bh_vars.do');
        const bh_vars_content = [
            '// @lsp-included-by "survey.do"',
            'global processing_date "2024-01-01"', // Use global so it's inherited via do/run
            'do "bircmc.do"'
        ].join('\n');
        writeFileSync(bh_vars_path, bh_vars_content);

        // Create bircmc.do that references multiple locals and one global
        const bircmc_path = join(test_temp_dir, 'bircmc.do');
        const bircmc_content = [
            '// @lsp-done-by "bh_vars.do"',
            'display "Country: `country_name\'"',
            'display "Year: `survey_year\'"',
            'display "Source: `data_source\'"',
            'display "Processed: $processing_date"' // Use global macro syntax
        ].join('\n');
        writeFileSync(bircmc_path, bircmc_content);

        const bircmc_uri = URI.file(bircmc_path);
        await document_store.open(bircmc_uri.toString(), bircmc_content, 1);
        
        const document = document_store.get(bircmc_uri.toString());
        const config: StataLSPConfig = {
            diagnostics: {
                enabled: true,
                severity: {
                    undefinedMacro: 'warning',
                    undefinedVariable: 'warning',
                    styleWarnings: 'warning'
                }
            },
            cross_file: {
                diagnostics: {
                    undefined_symbol: 'warning',
                    missing_file: 'warning',
                    out_of_scope: 'warning'
                }
            }
        };
        
        const diagnostics = await diagnostic_provider.get_diagnostics(
            document!,
            config,
            undefined,
            scope_resolver
        );

        // Should have diagnostics for the survey.do locals (not inherited via do/run)
        const survey_locals = ['country_name', 'survey_year', 'data_source'];
        const survey_local_diagnostics = diagnostics.filter(d => 
            survey_locals.some(local => d.message.includes(local))
        );
        
        expect(survey_local_diagnostics.length).toBe(3);
        
        for (const diagnostic of survey_local_diagnostics) {
            expect(diagnostic.message).toContain('local macros are not inherited via do/run');
            expect(diagnostic.message).not.toContain('after the call site');
        }

        // processing_date should be available (no diagnostic) since it's from bh_vars.do
        const processing_date_diagnostic = diagnostics.find(d => 
            d.message.includes('processing_date')
        );
        expect(processing_date_diagnostic).toBeUndefined();
    });
});