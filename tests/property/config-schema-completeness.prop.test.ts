import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_SETTINGS } from '../../src/server-handlers';

/**
 * Feature: user-configurable-settings, Property 1: Configuration Schema
 * Completeness
 *
 * For any setting defined in StataLSPConfig, there SHALL exist a
 * corresponding entry in package.json contributes.configuration.properties
 * with:
 * - Matching type (boolean, number, string, array)
 * - Matching default value
 * - A non-empty description string
 *
 * Validates: Requirements 1.1-1.5, 2.1-2.2, 3.1-3.6, 4.1-4.2, 5.1, 7.1
 */

// Load package.json configuration schema
const package_json_path = path.join(__dirname, '../../client/package.json');
const package_json = JSON.parse(fs.readFileSync(package_json_path, 'utf-8'));
const config_properties =
    package_json.contributes?.configuration?.properties || {};

// Define the expected configuration structure based on StataLSPConfig
// This mirrors the StataLSPConfig interface from src/types/index.ts
interface ConfigFieldSpec {
    path: string; // e.g., 'sight.diagnostics.enabled'
    type: 'boolean' | 'number' | 'string' | 'array';
    enum_values?: string[];
}

/**
 * Helper to extract a value from DEFAULT_SETTINGS using a dot-separated path
 */
function get_default_value(setting_path: string): unknown {
    const my_path_parts = setting_path.replace('sight.', '').split('.');
    let my_value: unknown = DEFAULT_SETTINGS;

    for (const my_part of my_path_parts) {
        if (my_value && typeof my_value === 'object') {
            my_value = (my_value as Record<string, unknown>)[my_part];
        } else {
            return undefined;
        }
    }
    return my_value;
}

// Build the expected fields from StataLSPConfig structure
// Default values are derived from DEFAULT_SETTINGS (source of truth)
const EXPECTED_CONFIG_FIELDS: ConfigFieldSpec[] = [
    // Diagnostics
    {
        path: 'sight.diagnostics.enabled',
        type: 'boolean',
    },
    {
        path: 'sight.diagnostics.severity.undefinedMacro',
        type: 'string',
        enum_values: ['error', 'warning', 'information', 'hint', 'off'],
    },
    {
        path: 'sight.diagnostics.severity.undefinedVariable',
        type: 'string',
        enum_values: ['error', 'warning', 'information', 'hint', 'off'],
    },
    {
        path: 'sight.diagnostics.severity.styleWarnings',
        type: 'string',
        enum_values: ['error', 'warning', 'information', 'hint', 'off'],
    },
    {
        path: 'sight.diagnostics.severity.malformedOperator',
        type: 'string',
        enum_values: ['error', 'warning', 'information', 'hint', 'off'],
    },
    {
        path: 'sight.diagnostics.severity.invalidOperatorSequence',
        type: 'string',
        enum_values: ['error', 'warning', 'information', 'hint', 'off'],
    },
    {
        path: 'sight.diagnostics.indentation',
        type: 'boolean',
    },
    // Formatting
    {
        path: 'sight.formatting.indentSize',
        type: 'number',
    },
    {
        path: 'sight.formatting.indentStyle',
        type: 'string',
        enum_values: ['spaces', 'tabs'],
    },
    {
        path: 'sight.formatting.lineWidth',
        type: 'number',
    },
    {
        path: 'sight.formatting.preferredCommentStyle',
        type: 'string',
        enum_values: ['line', '//', '*', '/* */'],
    },
    {
        path: 'sight.formatting.normalizeCommentStyle',
        type: 'boolean',
    },
    {
        path: 'sight.formatting.commentLineWidth',
        type: 'number',
    },
    {
        path: 'sight.formatting.mode',
        type: 'string',
        enum_values: ['source-preserving', 'ast'],
    },
    // Indexing
    {
        path: 'sight.indexing.maxFileSizeBytes',
        type: 'number',
    },
    // Top-level settings
    {
        path: 'sight.lineCommentStyle',
        type: 'string',
        enum_values: ['//', '*'],
    },
    {
        path: 'sight.adoPaths',
        type: 'array',
    },
    {
        path: 'sight.indexWorkspace',
        type: 'boolean',
    },
];

describe('Configuration Schema Completeness Property Tests', () => {
    /**
     * Property 1: Configuration Schema Completeness
     *
     * For any setting defined in StataLSPConfig, there SHALL exist a
     * corresponding entry in package.json contributes.configuration.properties
     *
     * Feature: user-configurable-settings, Property 1: Configuration Schema
     * Completeness
     * Validates: Requirements 1.1-1.5, 2.1-2.2, 3.1-3.6, 4.1-4.2, 5.1, 7.1
     */
    it('should have package.json entry for every StataLSPConfig field', () => {
        // Generate arbitrary field from the expected config fields
        const field_arb = fc.constantFrom(...EXPECTED_CONFIG_FIELDS);

        fc.assert(
            fc.property(field_arb, (my_field) => {
                const my_pkg_entry = config_properties[my_field.path];
                const my_expected_default = get_default_value(my_field.path);

                // Entry must exist
                expect(my_pkg_entry).toBeDefined();

                // Type must match
                expect(my_pkg_entry.type).toBe(my_field.type);

                // Default value must match DEFAULT_SETTINGS
                if (my_field.type === 'array') {
                    expect(my_pkg_entry.default).toEqual(my_expected_default);
                } else {
                    expect(my_pkg_entry.default).toBe(my_expected_default);
                }

                // Description must be non-empty
                expect(my_pkg_entry.description).toBeDefined();
                expect(typeof my_pkg_entry.description).toBe('string');
                expect(my_pkg_entry.description.length).toBeGreaterThan(0);

                // If enum values are expected, verify they match
                if (my_field.enum_values) {
                    expect(my_pkg_entry.enum).toBeDefined();
                    expect(my_pkg_entry.enum).toEqual(my_field.enum_values);
                }
            }),
            { numRuns: 100 }
        );
    });

    /**
     * Property: Default values in package.json match DEFAULT_SETTINGS
     *
     * For any setting in package.json, the default value should match
     * the corresponding value in DEFAULT_SETTINGS from server-handlers.ts
     *
     * Feature: user-configurable-settings, Property 1: Configuration Schema
     * Completeness
     * Validates: Requirements 1.1-1.5, 2.1-2.2, 3.1-3.6, 4.1-4.2, 5.1, 7.1
     */
    it('should have package.json defaults matching DEFAULT_SETTINGS', () => {
        const field_arb = fc.constantFrom(...EXPECTED_CONFIG_FIELDS);

        fc.assert(
            fc.property(field_arb, (my_field) => {
                const my_default_value = get_default_value(my_field.path);

                // Package.json default should match DEFAULT_SETTINGS
                const my_pkg_entry = config_properties[my_field.path];
                if (my_field.type === 'array') {
                    expect(my_pkg_entry.default).toEqual(my_default_value);
                } else {
                    expect(my_pkg_entry.default).toBe(my_default_value);
                }
            }),
            { numRuns: 100 }
        );
    });

    /**
     * Property: All package.json settings have valid structure
     *
     * For any setting in package.json configuration, it should have
     * required fields: type, default, description
     *
     * Feature: user-configurable-settings, Property 1: Configuration Schema
     * Completeness
     * Validates: Requirements 7.1, 7.2, 7.3
     */
    it('should have valid structure for all package.json settings', () => {
        const the_setting_keys = Object.keys(config_properties);
        const setting_arb = fc.constantFrom(...the_setting_keys);

        fc.assert(
            fc.property(setting_arb, (my_setting_key) => {
                const my_setting = config_properties[my_setting_key];

                // Must have type
                expect(my_setting.type).toBeDefined();
                expect(['boolean', 'number', 'string', 'array']).toContain(
                    my_setting.type
                );

                // Must have default
                expect(my_setting.default).toBeDefined();

                // Must have description
                expect(my_setting.description).toBeDefined();
                expect(typeof my_setting.description).toBe('string');
                expect(my_setting.description.length).toBeGreaterThan(0);

                // If enum type, must have enum values
                if (my_setting.enum) {
                    expect(Array.isArray(my_setting.enum)).toBe(true);
                    expect(my_setting.enum.length).toBeGreaterThan(0);
                }

                // If array type, must have items definition
                if (my_setting.type === 'array') {
                    expect(my_setting.items).toBeDefined();
                }
            }),
            { numRuns: 100 }
        );
    });

    /**
     * Property: No extra settings in package.json beyond StataLSPConfig
     *
     * For any setting in package.json, it should correspond to a field
     * in StataLSPConfig (no orphaned settings)
     *
     * Feature: user-configurable-settings, Property 1: Configuration Schema
     * Completeness
     * Validates: Requirements 1.1-1.5, 2.1-2.2, 3.1-3.6, 4.1-4.2, 5.1, 7.1
     */
    it('should not have orphaned settings in package.json', () => {
        const the_expected_paths = new Set(
            EXPECTED_CONFIG_FIELDS.map((f) => f.path)
        );
        // Filter out client-only settings (sendToStata is handled by VS Code extension, not LSP server)
        const the_setting_keys = Object.keys(config_properties).filter(
            (key) => !key.startsWith('sight.sendToStata.')
        );
        const setting_arb = fc.constantFrom(...the_setting_keys);

        fc.assert(
            fc.property(setting_arb, (my_setting_key) => {
                // Every package.json setting should be in expected fields
                expect(the_expected_paths.has(my_setting_key)).toBe(true);
            }),
            { numRuns: 100 }
        );
    });

    /**
     * Property: Numeric settings have appropriate constraints
     *
     * For any numeric setting in package.json, it should have minimum
     * constraints where appropriate
     *
     * Feature: user-configurable-settings, Property 1: Configuration Schema
     * Completeness
     * Validates: Requirements 3.1, 3.3, 3.6, 4.1
     */
    it('should have appropriate constraints for numeric settings', () => {
        const the_numeric_fields = EXPECTED_CONFIG_FIELDS.filter(
            (f) => f.type === 'number'
        );
        const numeric_arb = fc.constantFrom(...the_numeric_fields);

        fc.assert(
            fc.property(numeric_arb, (my_field) => {
                const my_pkg_entry = config_properties[my_field.path];

                // Numeric settings should have minimum constraint
                // (except maxFileSizeBytes which can be any positive number)
                if (
                    my_field.path === 'sight.formatting.indentSize' ||
                    my_field.path === 'sight.formatting.lineWidth' ||
                    my_field.path === 'sight.formatting.commentLineWidth'
                ) {
                    expect(my_pkg_entry.minimum).toBeDefined();
                    expect(my_pkg_entry.minimum).toBeGreaterThan(0);
                }
            }),
            { numRuns: 100 }
        );
    });
});
