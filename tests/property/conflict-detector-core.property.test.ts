import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import {
    isConflictingExtension,
    findConflictingExtensions,
    formatConflictMessage,
    formatConflictTooltip,
    isStataFile,
    getDisplayName,
    STATA_FILE_EXTENSIONS,
    type Extension,
    type ConflictingExtension
} from '../../client/src/conflict-detector-core';

/**
 * Property-based tests for conflict detection core functions.
 * Tests Properties 1-4 from the design spec.
 */
describe('Feature: extension-conflict-detection', () => {
    const extensionIdArb = fc.string({ minLength: 1, maxLength: 50 });
    const displayNameArb = fc.option(fc.string({ minLength: 1, maxLength: 100 }));
    const ownIdArb = fc.constant('jbearak.sight-client');

    // Extension that contributes stata language (Req 1.2)
    const stataLanguageExtArb: fc.Arbitrary<Extension> = fc.record({
        id: extensionIdArb.filter(id => id !== 'jbearak.sight-client'),
        packageJSON: fc.record({
            displayName: displayNameArb,
            contributes: fc.record({
                languages: fc.constant([{ id: 'stata' }])
            })
        })
    });

    // Extension that contributes stata file extensions (Req 1.3)
    const stataFileExtArb: fc.Arbitrary<Extension> = fc.record({
        id: extensionIdArb.filter(id => id !== 'jbearak.sight-client'),
        packageJSON: fc.record({
            displayName: displayNameArb,
            contributes: fc.record({
                languages: fc.constantFrom(
                    [{ extensions: ['.do'] }],
                    [{ extensions: ['.ado'] }],
                    [{ extensions: ['.mata'] }]
                )
            })
        })
    });

    // Non-conflicting extension (no stata language, no stata file extensions)
    const nonConflictingExtArb: fc.Arbitrary<Extension> = fc.record({
        id: extensionIdArb,
        packageJSON: fc.record({
            displayName: displayNameArb,
            contributes: fc.record({
                languages: fc.option(fc.constant([{ id: 'python' }]))
            })
        })
    });

    // Extension without contributes
    const noContributesExtArb: fc.Arbitrary<Extension> = fc.record({
        id: extensionIdArb,
        packageJSON: fc.constant({})
    });

    // Extension with only grammar scope (NOT a conflict per requirements)
    const grammarOnlyExtArb: fc.Arbitrary<Extension> = fc.record({
        id: extensionIdArb.filter(id => id !== 'jbearak.sight-client'),
        packageJSON: fc.record({
            displayName: displayNameArb,
            contributes: fc.record({
                grammars: fc.constant([{ scopeName: 'source.stata' }])
            })
        })
    });

    const conflictingExtArb = fc.oneof(stataLanguageExtArb, stataFileExtArb);

    describe('Property 1: Conflict Detection Correctness', () => {
        it('detects extensions contributing stata language (Req 1.2)', () => {
            fc.assert(fc.property(stataLanguageExtArb, ownIdArb, (ext, ownId) => {
                expect(isConflictingExtension(ext, ownId)).toBe(true);
            }), { numRuns: 100 });
        });

        it('detects extensions contributing stata file extensions (Req 1.3)', () => {
            fc.assert(fc.property(stataFileExtArb, ownIdArb, (ext, ownId) => {
                expect(isConflictingExtension(ext, ownId)).toBe(true);
            }), { numRuns: 100 });
        });

        it('does NOT detect extensions with only grammar scope (not in requirements)', () => {
            fc.assert(fc.property(grammarOnlyExtArb, ownIdArb, (ext, ownId) => {
                expect(isConflictingExtension(ext, ownId)).toBe(false);
            }), { numRuns: 100 });
        });

        it('does not detect non-conflicting extensions', () => {
            fc.assert(fc.property(nonConflictingExtArb, ownIdArb, (ext, ownId) => {
                expect(isConflictingExtension(ext, ownId)).toBe(false);
            }), { numRuns: 100 });
        });

        it('does not detect extensions without contributes', () => {
            fc.assert(fc.property(noContributesExtArb, ownIdArb, (ext, ownId) => {
                expect(isConflictingExtension(ext, ownId)).toBe(false);
            }), { numRuns: 100 });
        });
    });

    describe('Property 2: Self-Exclusion Invariant', () => {
        it('Sight never appears in conflict list even if it matches criteria', () => {
            fc.assert(fc.property(
                fc.array(conflictingExtArb, { maxLength: 10 }),
                ownIdArb,
                (extensions, ownId) => {
                    // Add Sight with conflicting criteria
                    const sightExt: Extension = {
                        id: ownId,
                        packageJSON: { displayName: 'Sight', contributes: { languages: [{ id: 'stata' }] } }
                    };
                    const allExts = [...extensions, sightExt];
                    const conflicts = findConflictingExtensions(allExts, ownId);
                    
                    expect(conflicts.every(c => c.id !== ownId)).toBe(true);
                }
            ), { numRuns: 100 });
        });

        it('isConflictingExtension returns false for own extension', () => {
            fc.assert(fc.property(ownIdArb, (ownId) => {
                const sightExt: Extension = {
                    id: ownId,
                    packageJSON: { contributes: { languages: [{ id: 'stata' }] } }
                };
                expect(isConflictingExtension(sightExt, ownId)).toBe(false);
            }), { numRuns: 100 });
        });
    });

    describe('Property 3: Output Structure Completeness', () => {
        it('conflicts have non-empty id string', () => {
            fc.assert(fc.property(
                fc.array(conflictingExtArb, { minLength: 1, maxLength: 5 }),
                ownIdArb,
                (extensions, ownId) => {
                    const conflicts = findConflictingExtensions(extensions, ownId);
                    for (const c of conflicts) {
                        expect(typeof c.id).toBe('string');
                        expect(c.id.length).toBeGreaterThan(0);
                    }
                }
            ), { numRuns: 100 });
        });

        it('getDisplayName returns packageJSON.displayName or falls back to id', () => {
            const extWithDisplayName: fc.Arbitrary<Extension> = fc.record({
                id: extensionIdArb,
                packageJSON: fc.record({
                    displayName: fc.string({ minLength: 1, maxLength: 100 })
                })
            });

            fc.assert(fc.property(extWithDisplayName, (ext) => {
                const name = getDisplayName(ext);
                expect(name).toBe(ext.packageJSON?.displayName);
            }), { numRuns: 100 });
        });

        it('getDisplayName falls back to id when displayName undefined', () => {
            const extWithoutDisplayName: fc.Arbitrary<Extension> = fc.record({
                id: extensionIdArb,
                packageJSON: fc.constant({})
            });

            fc.assert(fc.property(extWithoutDisplayName, (ext) => {
                const name = getDisplayName(ext);
                expect(name).toBe(ext.id);
            }), { numRuns: 100 });
        });
    });

    describe('Property 4: Message Formatting Completeness', () => {
        it('message contains all extension displayNames', () => {
            const conflictingExtWithDisplayName: fc.Arbitrary<ConflictingExtension> = fc.record({
                id: extensionIdArb,
                displayName: fc.string({ minLength: 1, maxLength: 100 })
            });

            fc.assert(fc.property(
                fc.array(conflictingExtWithDisplayName, { minLength: 1, maxLength: 5 }),
                (conflicts) => {
                    const msg = formatConflictMessage(conflicts);
                    for (const c of conflicts) {
                        expect(msg).toContain(c.displayName);
                    }
                }
            ), { numRuns: 100 });
        });

        it('tooltip contains all extension displayNames', () => {
            const conflictingExtWithDisplayName: fc.Arbitrary<ConflictingExtension> = fc.record({
                id: extensionIdArb,
                displayName: fc.string({ minLength: 1, maxLength: 100 })
            });

            fc.assert(fc.property(
                fc.array(conflictingExtWithDisplayName, { minLength: 1, maxLength: 5 }),
                (conflicts) => {
                    const tooltip = formatConflictTooltip(conflicts);
                    for (const c of conflicts) {
                        expect(tooltip).toContain(c.displayName);
                    }
                }
            ), { numRuns: 100 });
        });

        it('displayName is used directly without fallback logic', () => {
            // Verify the implementation uses displayName directly by checking
            // that distinct displayName values appear in output
            const conflicts: ConflictingExtension[] = [
                { id: 'some.extension.id', displayName: 'Unique Display Name XYZ' }
            ];
            const msg = formatConflictMessage(conflicts);
            const tooltip = formatConflictTooltip(conflicts);
            
            expect(msg).toContain('Unique Display Name XYZ');
            expect(msg).not.toContain('some.extension.id');
            expect(tooltip).toContain('Unique Display Name XYZ');
            expect(tooltip).not.toContain('some.extension.id');
        });

        it('empty list produces empty messages', () => {
            expect(formatConflictMessage([])).toBe('');
            expect(formatConflictTooltip([])).toBe('');
        });
    });

    describe('isStataFile', () => {
        it('identifies requirements-specified Stata file extensions (.do, .ado, .mata)', () => {
            fc.assert(fc.property(
                fc.string({ minLength: 1, maxLength: 20 }),
                fc.constantFrom(...STATA_FILE_EXTENSIONS),
                (base, ext) => {
                    expect(isStataFile(base + ext)).toBe(true);
                    expect(isStataFile(base + ext.toUpperCase())).toBe(true);
                }
            ), { numRuns: 100 });
        });

        it('rejects non-Stata files', () => {
            fc.assert(fc.property(
                fc.string({ minLength: 1, maxLength: 20 }),
                fc.constantFrom('.js', '.ts', '.py', '.r', '.sas', '.doh'),
                (base, ext) => {
                    expect(isStataFile(base + ext)).toBe(false);
                }
            ), { numRuns: 100 });
        });

        it('returns false for undefined', () => {
            expect(isStataFile(undefined)).toBe(false);
        });
    });
});
