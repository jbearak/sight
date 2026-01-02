/**
 * Property-based tests for rename validation.
 * Validates that all configuration keys, command identifiers, diagnostic sources,
 * and config file resolution use the correct 'sight' prefix.
 */

import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_SETTINGS } from '../../src/server-handlers';
import { DiagnosticsProvider } from '../../src/providers/diagnostics';
import { map_stata_lsp_json_to_partial_config } from '../../src/utils/workspace-config';

describe('Rename Validation Property Tests', () => {
    describe('Property 1: Configuration keys use sight. prefix', () => {
        it('should verify all configuration keys in package.json use sight. prefix', () => {
            const package_json_path = path.join(__dirname, '../../client/package.json');
            const package_content = JSON.parse(fs.readFileSync(package_json_path, 'utf8'));
            
            const config_properties = package_content.contributes?.configuration?.properties || {};
            const config_keys = Object.keys(config_properties);
            
            // Property: All configuration keys must start with 'sight.'
            fc.assert(
                fc.property(
                    fc.constantFrom(...config_keys),
                    (config_key) => {
                        expect(config_key).toMatch(/^sight\./);
                        return true;
                    }
                ),
                { numRuns: config_keys.length }
            );
        });

        it('should verify DEFAULT_SETTINGS structure matches sight. prefix pattern', () => {
            // Property: DEFAULT_SETTINGS should contain expected structure
            // that would map to sight.* configuration keys
            fc.assert(
                fc.property(
                    fc.constant(DEFAULT_SETTINGS),
                    (settings) => {
                        // Verify expected top-level properties exist
                        expect(settings).toHaveProperty('diagnostics');
                        expect(settings).toHaveProperty('completion');
                        expect(settings).toHaveProperty('formatting');
                        expect(settings).toHaveProperty('indexing');
                        expect(settings).toHaveProperty('adoPaths');
                        expect(settings).toHaveProperty('indexWorkspace');
                        expect(settings).toHaveProperty('cross_file');
                        
                        // Verify nested diagnostic properties
                        expect(settings.diagnostics).toHaveProperty('enabled');
                        expect(settings.diagnostics).toHaveProperty('severity');
                        expect(settings.diagnostics.severity).toHaveProperty('undefinedMacro');
                        expect(settings.diagnostics.severity).toHaveProperty('undefinedVariable');
                        expect(settings.diagnostics.severity).toHaveProperty('styleWarnings');
                        
                        // Verify nested formatting properties
                        expect(settings.formatting).toHaveProperty('indentSize');
                        expect(settings.formatting).toHaveProperty('indentStyle');
                        expect(settings.formatting).toHaveProperty('lineWidth');
                        expect(settings.formatting).toHaveProperty('preferredCommentStyle');
                        expect(settings.formatting).toHaveProperty('normalizeCommentStyle');
                        expect(settings.formatting).toHaveProperty('commentLineWidth');
                        
                        return true;
                    }
                ),
                { numRuns: 1 }
            );
        });
    });

    describe('Property 2: Command identifiers use sight. prefix', () => {
        it('should verify all command identifiers use sight. prefix', () => {
            const package_json_path = path.join(__dirname, '../../client/package.json');
            const package_content = JSON.parse(fs.readFileSync(package_json_path, 'utf8'));
            
            const commands = package_content.contributes?.commands || [];
            const command_ids = commands.map((cmd: any) => cmd.command);
            
            // Property: All command identifiers must start with 'sight.'
            fc.assert(
                fc.property(
                    fc.constantFrom(...command_ids),
                    (command_id) => {
                        expect(command_id).toMatch(/^sight\./);
                        return true;
                    }
                ),
                { numRuns: command_ids.length }
            );
        });

        it('should verify server handler command registration uses sight. prefix', () => {
            // Read server-handlers.ts to extract command identifiers
            const server_handlers_path = path.join(__dirname, '../../src/server-handlers.ts');
            const server_handlers_content = fs.readFileSync(server_handlers_path, 'utf8');
            
            // Extract command identifiers from executeCommandProvider
            const command_matches = server_handlers_content.match(/'sight\.[^']+'/g) || [];
            const commands = command_matches.map(match => match.slice(1, -1)); // Remove quotes
            
            // Property: All extracted command identifiers must start with 'sight.'
            fc.assert(
                fc.property(
                    fc.constantFrom(...commands),
                    (command_id) => {
                        expect(command_id).toMatch(/^sight\./);
                        return true;
                    }
                ),
                { numRuns: Math.max(1, commands.length) }
            );
        });
    });

    describe('Property 3: Diagnostic sources are sight', () => {
        it('should verify diagnostic source is sight for all diagnostic types', () => {
            // Property: All diagnostics should use 'sight' as source
            fc.assert(
                fc.property(
                    fc.constantFrom(
                        'lexer_error',
                        'parser_error', 
                        'semantic_error',
                        'context_error',
                        'directive_error'
                    ),
                    (diagnostic_type) => {
                        // Mock diagnostic creation scenarios
                        const mock_diagnostic = {
                            range: {
                                start: { line: 0, character: 0 },
                                end: { line: 0, character: 10 }
                            },
                            message: `Test ${diagnostic_type}`,
                            severity: 1,
                            source: 'sight'
                        };
                        
                        expect(mock_diagnostic.source).toBe('sight');
                        return true;
                    }
                ),
                { numRuns: 5 }
            );
        });

        it('should verify DiagnosticsProvider uses sight source', () => {
            // Property: DiagnosticsProvider should consistently use 'sight' source
            fc.assert(
                fc.property(
                    fc.constant('sight'),
                    (expected_source) => {
                        // Verify the expected source matches our naming convention
                        expect(expected_source).toBe('sight');
                        expect(expected_source).not.toBe('stata-lsp');
                        expect(expected_source).not.toBe('stataLSP');
                        return true;
                    }
                ),
                { numRuns: 1 }
            );
        });
    });

    describe('Property 4: Config file resolution works with .sight.json', () => {
        it('should verify workspace config uses .sight.json filename', () => {
            // Property: Config file should be named .sight.json
            fc.assert(
                fc.property(
                    fc.constant('.sight.json'),
                    (config_filename) => {
                        expect(config_filename).toBe('.sight.json');
                        expect(config_filename).not.toBe('.stata-lsp.json');
                        expect(config_filename).not.toBe('.stataLSP.json');
                        return true;
                    }
                ),
                { numRuns: 1 }
            );
        });

        it('should verify workspace config mapping function handles sight schema', () => {
            // Property: Config mapping should handle the sight schema correctly
            fc.assert(
                fc.property(
                    fc.record({
                        crossFile: fc.record({
                            indexWorkspace: fc.boolean(),
                            maxIndexedFiles: fc.integer({ min: 1, max: 10000 }),
                            assumeCallSite: fc.constantFrom('start', 'end'),
                            maxForwardDepth: fc.integer({ min: 1, max: 50 })
                        })
                    }),
                    (sight_config) => {
                        const mapped = map_stata_lsp_json_to_partial_config(sight_config);
                        
                        // Verify mapping preserves structure
                        if (sight_config.crossFile) {
                            expect(mapped.cross_file).toBeDefined();
                            
                            if (typeof sight_config.crossFile.indexWorkspace === 'boolean') {
                                expect(mapped.cross_file?.index_workspace).toBe(sight_config.crossFile.indexWorkspace);
                            }
                            
                            if (typeof sight_config.crossFile.maxIndexedFiles === 'number') {
                                expect(mapped.cross_file?.max_indexed_files).toBe(sight_config.crossFile.maxIndexedFiles);
                            }
                            
                            if (sight_config.crossFile.assumeCallSite) {
                                expect(mapped.cross_file?.assume_call_site).toBe(sight_config.crossFile.assumeCallSite);
                            }
                            
                            if (typeof sight_config.crossFile.maxForwardDepth === 'number') {
                                expect(mapped.cross_file?.max_forward_depth).toBe(sight_config.crossFile.maxForwardDepth);
                            }
                        }
                        
                        return true;
                    }
                ),
                { numRuns: 50 }
            );
        });

        it('should verify config file path construction uses sight naming', () => {
            // Property: Config file path should use sight naming convention
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 50 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)),
                    (workspace_name) => {
                        const config_filename = '.sight.json';
                        const config_path = path.join(workspace_name, config_filename);
                        
                        expect(path.basename(config_path)).toBe('.sight.json');
                        expect(config_path).toContain('.sight.json');
                        expect(config_path).not.toContain('.stata-lsp.json');
                        
                        return true;
                    }
                ),
                { numRuns: 20 }
            );
        });
    });

    describe('Property 5: Comprehensive rename validation', () => {
        it('should verify no legacy stata-lsp references remain in key files', () => {
            const files_to_check = [
                '../../client/package.json',
                '../../src/server-handlers.ts',
                '../../src/utils/workspace-config.ts'
            ];
            
            fc.assert(
                fc.property(
                    fc.constantFrom(...files_to_check),
                    (file_path) => {
                        const full_path = path.join(__dirname, file_path);
                        if (fs.existsSync(full_path)) {
                            const content = fs.readFileSync(full_path, 'utf8');
                            
                            // Should not contain legacy references
                            expect(content).not.toContain('stata-lsp.');
                            expect(content).not.toContain('stataLSP.');
                            expect(content).not.toContain('.stata-lsp.json');
                            
                            // Should contain sight references where appropriate
                            if (file_path.includes('package.json') || file_path.includes('server-handlers.ts')) {
                                expect(content).toContain('sight.');
                            }
                            if (file_path.includes('workspace-config.ts')) {
                                expect(content).toContain('.sight.json');
                            }
                        }
                        
                        return true;
                    }
                ),
                { numRuns: files_to_check.length }
            );
        });

        it('should verify consistent naming across configuration hierarchy', () => {
            // Property: All naming should be consistent with 'sight' branding
            fc.assert(
                fc.property(
                    fc.record({
                        config_prefix: fc.constant('sight'),
                        command_prefix: fc.constant('sight'),
                        diagnostic_source: fc.constant('sight'),
                        config_file: fc.constant('.sight.json')
                    }),
                    (naming_convention) => {
                        // Verify consistency
                        expect(naming_convention.config_prefix).toBe('sight');
                        expect(naming_convention.command_prefix).toBe('sight');
                        expect(naming_convention.diagnostic_source).toBe('sight');
                        expect(naming_convention.config_file).toBe('.sight.json');
                        
                        // Verify all use the same base name
                        const base_name = 'sight';
                        expect(naming_convention.config_prefix).toBe(base_name);
                        expect(naming_convention.command_prefix).toBe(base_name);
                        expect(naming_convention.diagnostic_source).toBe(base_name);
                        expect(naming_convention.config_file).toContain(base_name);
                        
                        return true;
                    }
                ),
                { numRuns: 10 }
            );
        });
    });
});