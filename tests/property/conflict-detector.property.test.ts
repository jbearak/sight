import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import {
    findConflictingExtensions,
    formatConflictTooltip,
    isStataFile,
    getDisplayName,
    STATA_FILE_EXTENSIONS,
    type Extension,
    type ConflictingExtension
} from '../../client/src/conflict-detector-core';

/**
 * Property tests for ConflictDetector behavior decisions.
 * Tests Properties 5-6 from the design spec.
 * 
 * These test the pure decision logic, not VS Code integration.
 */
describe('Feature: extension-conflict-detection', () => {
    const ownId = 'jbearak.sight-client';

    const conflictingExtArb: fc.Arbitrary<Extension> = fc.record({
        id: fc.string({ minLength: 1 }).filter(id => id !== ownId),
        packageJSON: fc.constant({ displayName: 'Test Extension', contributes: { languages: [{ id: 'stata' }] } })
    });

    const stataFileArb = fc.tuple(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.constantFrom(...STATA_FILE_EXTENSIONS)
    ).map(([base, ext]) => base + ext);

    const nonStataFileArb = fc.tuple(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.constantFrom('.js', '.ts', '.py', '.r', '.sas', '.txt', '.doh')
    ).map(([base, ext]) => base + ext);

    describe('Property 5: Warning Suppression After Dismissal', () => {
        /**
         * Pure function to determine if warning should show.
         * Mirrors ConflictDetector.checkAndNotify logic.
         */
        function shouldShowWarning(
            conflicts: Extension[],
            warningDismissed: boolean
        ): boolean {
            if (conflicts.length === 0) return false;
            if (warningDismissed) return false;
            return true;
        }

        it('returns false when warning was dismissed', () => {
            fc.assert(fc.property(
                fc.array(conflictingExtArb, { minLength: 1, maxLength: 5 }),
                (extensions) => {
                    const conflicts = findConflictingExtensions(extensions, ownId);
                    expect(shouldShowWarning(conflicts, true)).toBe(false);
                }
            ), { numRuns: 100 });
        });

        it('returns true when conflicts exist and not dismissed', () => {
            fc.assert(fc.property(
                fc.array(conflictingExtArb, { minLength: 1, maxLength: 5 }),
                (extensions) => {
                    const conflicts = findConflictingExtensions(extensions, ownId);
                    if (conflicts.length > 0) {
                        expect(shouldShowWarning(conflicts, false)).toBe(true);
                    }
                }
            ), { numRuns: 100 });
        });

        it('returns false when no conflicts', () => {
            expect(shouldShowWarning([], false)).toBe(false);
            expect(shouldShowWarning([], true)).toBe(false);
        });
    });

    describe('Property 6: Status Bar Visibility Decision', () => {
        /**
         * Pure function to determine status bar visibility.
         * Mirrors ConflictDetector.updateStatusBar logic.
         */
        function shouldShowStatusBar(
            conflicts: Extension[],
            activeFileName: string | undefined
        ): boolean {
            if (!isStataFile(activeFileName)) return false;
            return conflicts.length > 0;
        }

        it('shows when conflicts exist AND Stata file active', () => {
            fc.assert(fc.property(
                fc.array(conflictingExtArb, { minLength: 1, maxLength: 5 }),
                stataFileArb,
                (extensions, fileName) => {
                    const conflicts = findConflictingExtensions(extensions, ownId);
                    expect(shouldShowStatusBar(conflicts, fileName)).toBe(true);
                }
            ), { numRuns: 100 });
        });

        it('hides when no conflicts', () => {
            fc.assert(fc.property(stataFileArb, (fileName) => {
                expect(shouldShowStatusBar([], fileName)).toBe(false);
            }), { numRuns: 100 });
        });

        it('hides when non-Stata file active (including .doh)', () => {
            fc.assert(fc.property(
                fc.array(conflictingExtArb, { minLength: 1, maxLength: 5 }),
                nonStataFileArb,
                (extensions, fileName) => {
                    const conflicts = findConflictingExtensions(extensions, ownId);
                    expect(shouldShowStatusBar(conflicts, fileName)).toBe(false);
                }
            ), { numRuns: 100 });
        });

        it('hides when no active editor (undefined)', () => {
            fc.assert(fc.property(
                fc.array(conflictingExtArb, { minLength: 1, maxLength: 5 }),
                (extensions) => {
                    const conflicts = findConflictingExtensions(extensions, ownId);
                    expect(shouldShowStatusBar(conflicts, undefined)).toBe(false);
                }
            ), { numRuns: 100 });
        });

        it('tooltip contains all conflict names when visible', () => {
            fc.assert(fc.property(
                fc.array(conflictingExtArb, { minLength: 1, maxLength: 5 }),
                stataFileArb,
                (extensions, fileName) => {
                    const conflicts = findConflictingExtensions(extensions, ownId);
                    if (shouldShowStatusBar(conflicts, fileName)) {
                        // Convert Extension[] to ConflictingExtension[] for formatting
                        const conflictingExts: ConflictingExtension[] = conflicts.map(c => ({
                            id: c.id,
                            displayName: getDisplayName(c)
                        }));
                        const tooltip = formatConflictTooltip(conflictingExts);
                        for (const c of conflictingExts) {
                            expect(tooltip).toContain(c.displayName);
                        }
                    }
                }
            ), { numRuns: 100 });
        });
    });
});
