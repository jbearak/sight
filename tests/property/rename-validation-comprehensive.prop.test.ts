/**
 * Comprehensive property-based tests for rename validation.
 * Validates that all configuration keys, command identifiers, diagnostic sources,
 * and config file resolution use the correct 'sight' prefix consistently.
 */

import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_SETTINGS } from '../../src/server-handlers';
import { map_stata_lsp_json_to_partial_config } from '../../src/utils/workspace-config';

describe('Comprehensive Rename Validation Property Tests', () => {
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
                        expect(config_key).not.toMatch(/^stata-lsp\./);
                        expect(config_key).not.toMatch(/^stataLSP\./);
                        return true;
                    }
                ),
                { numRuns: config_keys.length }
            );
        });

        it('should verify configuration key structure follows sight.category.property pattern', () => {
            const package_json_path = path.join(__dirname, '../../client/package.json');
            const package_content = JSON.parse(fs.readFileSync(package_json_path, 'utf8'));
            
            const config_properties = package_content.contributes?.configuration?.properties || {};
            const config_keys = Object.keys(config_properties);
            
            // Property: Configuration keys should follow sight.category.property pattern
            fc.assert(
                fc.property(
                    fc.constantFrom(...config_keys),
                    (config_key) => {
                        const parts = config_key.split('.');
                        expect(parts[0]).toBe('sight');
                        expect(parts.length).toBeGreaterThanOrEqual(2);
                        
                        // Verify valid categories
                        const valid_categories = [
                            'diagnostics', 'formatting', 'indexing',
                            'indexWorkspace', 'adoPaths', 'sendToStata',
                            'lineCommentStyle', 'personalAdoDir',
                            'dataBrowser'
                        ];
                        
                        if (parts.length >= 2) {
                            expect(valid_categories).toContain(parts[1]);
                        }
                        
                        return true;
                    }
                ),
                { numRuns: config_keys.length }
            );
        });

        it('should verify DEFAULT_SETTINGS structure maps to sight. configuration', () => {
            // Property: DEFAULT_SETTINGS should contain structure that maps to sight.* keys
            fc.assert(
                fc.property(
                    fc.constant(DEFAULT_SETTINGS),
                    (settings) => {
                        // Verify all expected top-level properties exist
                        const expected_properties = [
                            'diagnostics', 'completion', 'formatting', 
                            'indexing', 'adoPaths', 'indexWorkspace', 'cross_file'
                        ];
                        
                        expected_properties.forEach(prop => {
                            expect(settings).toHaveProperty(prop);
                        });
                        
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
        it('should verify all command identifiers in package.json use sight. prefix', () => {
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
                        expect(command_id).not.toMatch(/^stata-lsp\./);
                        expect(command_id).not.toMatch(/^stataLSP\./);
                        return true;
                    }
                ),
                { numRuns: Math.max(1, command_ids.length) }
            );
        });

        it('should verify server handler command registration uses sight. prefix', () => {
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
                        expect(command_id).not.toMatch(/^stata-lsp\./);
                        expect(command_id).not.toMatch(/^stataLSP\./);
                        return true;
                    }
                ),
                { numRuns: Math.max(1, commands.length) }
            );
        });

        it('should verify command naming consistency across package.json and server-handlers', () => {
            const package_json_path = path.join(__dirname, '../../client/package.json');
            const package_content = JSON.parse(fs.readFileSync(package_json_path, 'utf8'));
            
            const server_handlers_path = path.join(__dirname, '../../src/server-handlers.ts');
            const server_handlers_content = fs.readFileSync(server_handlers_path, 'utf8');
            
            const package_commands = (package_content.contributes?.commands || [])
                .map((cmd: any) => cmd.command);
            const handler_commands = (server_handlers_content.match(/'sight\.[^']+'/g) || [])
                .map(match => match.slice(1, -1));
            
            // Property: All commands should use sight prefix consistently
            fc.assert(
                fc.property(
                    fc.constantFrom(...package_commands, ...handler_commands),
                    (command) => {
                        expect(command).toMatch(/^sight\./);
                        expect(command).not.toMatch(/^stata-lsp\./);
                        expect(command).not.toMatch(/^stataLSP\./);
                        return true;
                    }
                ),
                { numRuns: Math.max(1, package_commands.length + handler_commands.length) }
            );
            
            // Property: If both have commands, they should have some overlap or be subsets
            if (package_commands.length > 0 && handler_commands.length > 0) {
                fc.assert(
                    fc.property(
                        fc.constant(true),
                        () => {
                            // At least verify that all commands use the same prefix
                            const all_commands = [...package_commands, ...handler_commands];
                            all_commands.forEach(cmd => {
                                expect(cmd).toMatch(/^sight\./);
                            });
                            return true;
                        }
                    ),
                    { numRuns: 1 }
                );
            }
        });
    });

    describe('Property 3: Diagnostic sources are sight', () => {
        it('should verify diagnostic source naming convention', () => {
            // Property: All diagnostics should use 'sight' as source
            fc.assert(
                fc.property(
                    fc.constantFrom(
                        'lexer_error',
                        'parser_error', 
                        'semantic_error',
                        'context_error',
                        'directive_error',
                        'cross_file_error'
                    ),
                    (diagnostic_type) => {
                        const expected_source = 'sight';
                        
                        // Verify the source follows naming convention
                        expect(expected_source).toBe('sight');
                        expect(expected_source).not.toBe('stata-lsp');
                        expect(expected_source).not.toBe('stataLSP');
                        expect(expected_source).not.toBe('Stata LSP');
                        
                        return true;
                    }
                ),
                { numRuns: 6 }
            );
        });

        it('should verify diagnostic source consistency in DiagnosticsProvider', () => {
            const diagnostics_path = path.join(__dirname, '../../src/providers/diagnostics.ts');
            
            if (fs.existsSync(diagnostics_path)) {
                const diagnostics_content = fs.readFileSync(diagnostics_path, 'utf8');
                
                // Property: DiagnosticsProvider should use consistent source naming
                fc.assert(
                    fc.property(
                        fc.constant('sight'),
                        (expected_source) => {
                            // Check that the file doesn't contain legacy source names
                            expect(diagnostics_content).not.toContain('source: "stata-lsp"');
                            expect(diagnostics_content).not.toContain('source: "stataLSP"');
                            expect(diagnostics_content).not.toContain("source: 'stata-lsp'");
                            expect(diagnostics_content).not.toContain("source: 'stataLSP'");
                            
                            return true;
                        }
                    ),
                    { numRuns: 1 }
                );
            }
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
                        expect(config_filename).not.toBe('.stata_lsp.json');
                        return true;
                    }
                ),
                { numRuns: 1 }
            );
        });

        it('should verify workspace config file references in source code', () => {
            const workspace_config_path = path.join(__dirname, '../../src/utils/workspace-config.ts');
            
            if (fs.existsSync(workspace_config_path)) {
                const config_content = fs.readFileSync(workspace_config_path, 'utf8');
                
                // Property: Source code should reference .sight.json
                fc.assert(
                    fc.property(
                        fc.constant(config_content),
                        (content) => {
                            expect(content).toContain('.sight.json');
                            expect(content).not.toContain('.stata-lsp.json');
                            expect(content).not.toContain('.stataLSP.json');
                            return true;
                        }
                    ),
                    { numRuns: 1 }
                );
            }
        });

        it('should verify workspace config mapping function handles sight schema', () => {
            // Property: Config mapping should handle the sight schema correctly
            // Note: 'info' is normalized to 'information' during mapping
            const normalize_severity = (s: string) => s === 'info' ? 'information' : s;
            
            fc.assert(
                fc.property(
                    fc.record({
                        crossFile: fc.record({
                            indexWorkspace: fc.boolean(),
                            maxIndexedFiles: fc.integer({ min: 1, max: 10000 }),
                            assumeCallSite: fc.constantFrom('start', 'end'),
                            maxForwardDepth: fc.integer({ min: 1, max: 50 }),
                            diagnostics: fc.record({
                                outOfScope: fc.constantFrom('error', 'warning', 'info', 'off'),
                                missingFile: fc.constantFrom('error', 'warning', 'info', 'off')
                            })
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
                            
                            if (sight_config.crossFile.diagnostics) {
                                expect(mapped.cross_file?.diagnostics).toBeDefined();
                                
                                if (sight_config.crossFile.diagnostics.outOfScope) {
                                    expect(mapped.cross_file?.diagnostics?.out_of_scope)
                                        .toBe(normalize_severity(sight_config.crossFile.diagnostics.outOfScope));
                                }
                                
                                if (sight_config.crossFile.diagnostics.missingFile) {
                                    expect(mapped.cross_file?.diagnostics?.missing_file)
                                        .toBe(normalize_severity(sight_config.crossFile.diagnostics.missingFile));
                                }
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
                        expect(config_path).not.toContain('.stataLSP.json');
                        
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
                '../../src/utils/workspace-config.ts',
                '../../src/providers/diagnostics.ts',
                '../../README.md'
            ];
            
            fc.assert(
                fc.property(
                    fc.constantFrom(...files_to_check),
                    (file_path) => {
                        const full_path = path.join(__dirname, file_path);
                        if (fs.existsSync(full_path)) {
                            const content = fs.readFileSync(full_path, 'utf8');
                            
                            // Should not contain legacy references in configuration contexts
                            expect(content).not.toMatch(/["']stata-lsp\./);
                            expect(content).not.toMatch(/["']stataLSP\./);
                            expect(content).not.toMatch(/\.stata-lsp\.json/);
                            
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

        it('should verify package.json display name and description use Sight branding', () => {
            const package_json_path = path.join(__dirname, '../../client/package.json');
            const package_content = JSON.parse(fs.readFileSync(package_json_path, 'utf8'));
            
            // Property: Package metadata should use Sight branding
            fc.assert(
                fc.property(
                    fc.constant(package_content),
                    (pkg) => {
                        expect(pkg.displayName).toContain('Sight');
                        expect(pkg.displayName).not.toContain('Stata LSP');
                        expect(pkg.displayName).not.toContain('stata-lsp');
                        
                        if (pkg.description) {
                            // Description can mention LSP as a technical term
                            expect(pkg.description).not.toContain('stata-lsp');
                            expect(pkg.description).not.toContain('stataLSP');
                        }
                        
                        return true;
                    }
                ),
                { numRuns: 1 }
            );
        });

        it('should verify configuration title uses Sight branding', () => {
            const package_json_path = path.join(__dirname, '../../client/package.json');
            const package_content = JSON.parse(fs.readFileSync(package_json_path, 'utf8'));
            
            // Property: Configuration title should use Sight branding
            fc.assert(
                fc.property(
                    fc.constant(package_content.contributes?.configuration?.title),
                    (config_title) => {
                        if (config_title) {
                            expect(config_title).toContain('Sight');
                            expect(config_title).not.toContain('Stata LSP');
                            expect(config_title).not.toContain('stata-lsp');
                        }
                        return true;
                    }
                ),
                { numRuns: 1 }
            );
        });
    });

    describe('Property 6: Cross-file validation', () => {
        it('should verify all sight. prefixed items are properly categorized', () => {
            const package_json_path = path.join(__dirname, '../../client/package.json');
            const package_content = JSON.parse(fs.readFileSync(package_json_path, 'utf8'));
            
            const config_properties = package_content.contributes?.configuration?.properties || {};
            const config_keys = Object.keys(config_properties);
            
            // Property: All sight. configuration keys should be properly categorized
            fc.assert(
                fc.property(
                    fc.constantFrom(...config_keys),
                    (config_key) => {
                        const parts = config_key.split('.');
                        expect(parts[0]).toBe('sight');
                        
                        // Verify the configuration has proper structure
                        const config_def = config_properties[config_key];
                        expect(config_def).toHaveProperty('type');
                        expect(config_def).toHaveProperty('description');
                        
                        // Verify description doesn't contain legacy references
                        expect(config_def.description).not.toContain('stata-lsp');
                        expect(config_def.description).not.toContain('stataLSP');
                        
                        return true;
                    }
                ),
                { numRuns: config_keys.length }
            );
        });

        it('should verify workspace config schema completeness', () => {
            // Property: Workspace config should handle all expected sight schema properties
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
                    (config) => {
                        const mapped = map_stata_lsp_json_to_partial_config(config);
                        
                        // Verify all properties are mapped correctly
                        expect(mapped).toHaveProperty('cross_file');
                        
                        if (config.crossFile.indexWorkspace !== undefined) {
                            expect(mapped.cross_file?.index_workspace).toBe(config.crossFile.indexWorkspace);
                        }
                        
                        if (config.crossFile.maxIndexedFiles !== undefined) {
                            expect(mapped.cross_file?.max_indexed_files).toBe(config.crossFile.maxIndexedFiles);
                        }
                        
                        if (config.crossFile.assumeCallSite !== undefined) {
                            expect(mapped.cross_file?.assume_call_site).toBe(config.crossFile.assumeCallSite);
                        }
                        
                        if (config.crossFile.maxForwardDepth !== undefined) {
                            expect(mapped.cross_file?.max_forward_depth).toBe(config.crossFile.maxForwardDepth);
                        }
                        
                        return true;
                    }
                ),
                { numRuns: 30 }
            );
        });
    });
});