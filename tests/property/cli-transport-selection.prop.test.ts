/**
 * Property-based tests for CLI transport selection determinism.
 * 
 * **Feature: standalone-binary-distribution, Property 1: Transport Selection Determinism**
 * **Validates: Requirements 1.1, 1.2, 1.3**
 */

import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { parse_args, serialize_options, CLIOptions, TransportType } from '../../src/cli';

describe('CLI Transport Selection Determinism', () => {
    /**
     * Property 1: Transport Selection Determinism
     * 
     * *For any* CLI argument array, the transport selection SHALL be deterministic:
     * - If `--stdio` is present, stdio transport is selected
     * - If `--node-ipc` is present, Node IPC transport is selected
     * - If neither is present, stdio transport is selected (default)
     * - The selection is consistent across repeated invocations with the same arguments
     */
    it('should deterministically select transport based on flags', () => {
        // Generate arbitrary combinations of valid flags
        const valid_flag_arb = fc.constantFrom(
            '--stdio', '-s',
            '--node-ipc', '-i',
            '--help', '-h',
            '--version', '-v',
            '--quiet', '-q'
        );

        const args_arb = fc.array(valid_flag_arb, { minLength: 0, maxLength: 5 });

        fc.assert(
            fc.property(args_arb, (args) => {
                // Parse twice to verify determinism
                const result1 = parse_args(args);
                const result2 = parse_args(args);

                // Both should have the same success status
                expect(result1.success).toBe(result2.success);

                if (result1.success && result2.success) {
                    // Transport selection should be identical
                    expect(result1.options.transport).toBe(result2.options.transport);
                    expect(result1.options.help).toBe(result2.options.help);
                    expect(result1.options.version).toBe(result2.options.version);

                    // Verify transport selection rules
                    const has_stdio = args.includes('--stdio') || args.includes('-s');
                    const has_node_ipc = args.includes('--node-ipc') || args.includes('-i');

                    if (has_stdio && has_node_ipc) {
                        // Should fail with conflicting flags
                        // But we already checked success, so this case shouldn't happen
                        // unless the parser allows it (which it shouldn't)
                    } else if (has_node_ipc) {
                        expect(result1.options.transport).toBe('node-ipc');
                    } else {
                        // Default or explicit --stdio
                        expect(result1.options.transport).toBe('stdio');
                    }
                }
            }),
            { numRuns: 100 }
        );
    });

    it('should default to stdio when no transport flag is provided', () => {
        const non_transport_flags = fc.array(
            fc.constantFrom('--help', '-h', '--version', '-v', '--quiet', '-q'),
            { minLength: 0, maxLength: 3 }
        );

        fc.assert(
            fc.property(non_transport_flags, (args) => {
                const result = parse_args(args);
                expect(result.success).toBe(true);
                if (result.success) {
                    expect(result.options.transport).toBe('stdio');
                }
            }),
            { numRuns: 100 }
        );
    });

    it('should select stdio when --stdio flag is present', () => {
        const other_flags = fc.array(
            fc.constantFrom('--help', '-h', '--version', '-v', '--quiet', '-q'),
            { minLength: 0, maxLength: 2 }
        );

        const stdio_flag = fc.constantFrom('--stdio', '-s');

        fc.assert(
            fc.property(other_flags, stdio_flag, (others, stdio) => {
                const args = [...others, stdio];
                const result = parse_args(args);
                expect(result.success).toBe(true);
                if (result.success) {
                    expect(result.options.transport).toBe('stdio');
                }
            }),
            { numRuns: 100 }
        );
    });

    it('should select node-ipc when --node-ipc flag is present', () => {
        const other_flags = fc.array(
            fc.constantFrom('--help', '-h', '--version', '-v', '--quiet', '-q'),
            { minLength: 0, maxLength: 2 }
        );

        const node_ipc_flag = fc.constantFrom('--node-ipc', '-i');

        fc.assert(
            fc.property(other_flags, node_ipc_flag, (others, ipc) => {
                const args = [...others, ipc];
                const result = parse_args(args);
                expect(result.success).toBe(true);
                if (result.success) {
                    expect(result.options.transport).toBe('node-ipc');
                }
            }),
            { numRuns: 100 }
        );
    });

    it('should reject conflicting transport flags', () => {
        const stdio_flag = fc.constantFrom('--stdio', '-s');
        const node_ipc_flag = fc.constantFrom('--node-ipc', '-i');
        const other_flags = fc.array(
            fc.constantFrom('--help', '-h', '--version', '-v', '--quiet', '-q'),
            { minLength: 0, maxLength: 2 }
        );

        fc.assert(
            fc.property(stdio_flag, node_ipc_flag, other_flags, (stdio, ipc, others) => {
                const args = [stdio, ipc, ...others];
                const result = parse_args(args);
                expect(result.success).toBe(false);
                if (!result.success) {
                    expect(result.error).toContain('Cannot specify both');
                }
            }),
            { numRuns: 100 }
        );
    });

    /**
     * Property 3: Argument Parsing Round-Trip
     * 
     * *For any* valid CLIOptions object, serializing it to an argument array
     * and parsing that array SHALL produce an equivalent CLIOptions object.
     */
    it('should round-trip CLIOptions through serialize and parse', () => {
        const transport_arb: fc.Arbitrary<TransportType> = fc.constantFrom('stdio', 'node-ipc');
        const options_arb: fc.Arbitrary<CLIOptions> = fc.record({
            transport: transport_arb,
            help: fc.boolean(),
            version: fc.boolean(),
            quiet: fc.boolean(),
        });

        fc.assert(
            fc.property(options_arb, (original_options) => {
                const args = serialize_options(original_options);
                const result = parse_args(args);

                expect(result.success).toBe(true);
                if (result.success) {
                    expect(result.options.transport).toBe(original_options.transport);
                    expect(result.options.help).toBe(original_options.help);
                    expect(result.options.version).toBe(original_options.version);
                    expect(result.options.quiet).toBe(original_options.quiet);
                }
            }),
            { numRuns: 100 }
        );
    });
});
