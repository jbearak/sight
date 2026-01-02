import { describe, it, expect } from 'bun:test';
import {
    isConflictingExtension,
    findConflictingExtensions,
    formatConflictMessage,
    formatConflictTooltip,
    isStataFile,
    getDisplayName,
    shouldPersistDismissal,
    STATA_FILE_EXTENSIONS
} from '../../client/src/conflict-detector-core';

describe('ConflictDetectorCore', () => {
    const SIGHT_EXTENSION_ID = 'sight.stata-lsp';

    describe('isConflictingExtension', () => {
        it('should detect extension with stata language ID as conflict', () => {
            const extension = {
                id: 'other.stata-ext',
                packageJSON: {
                    contributes: {
                        languages: [{ id: 'stata' }]
                    }
                }
            };

            expect(isConflictingExtension(extension, SIGHT_EXTENSION_ID)).toBe(true);
        });

        it('should detect extension with .do file extension as conflict', () => {
            const extension = {
                id: 'other.ext',
                packageJSON: {
                    contributes: {
                        languages: [{ id: 'stata-do', extensions: ['.do'] }]
                    }
                }
            };

            expect(isConflictingExtension(extension, SIGHT_EXTENSION_ID)).toBe(true);
        });

        it('should detect extension with .ado file extension as conflict', () => {
            const extension = {
                id: 'other.ext',
                packageJSON: {
                    contributes: {
                        languages: [{ extensions: ['.ado'] }]
                    }
                }
            };

            expect(isConflictingExtension(extension, SIGHT_EXTENSION_ID)).toBe(true);
        });

        it('should detect extension with .mata file extension as conflict', () => {
            const extension = {
                id: 'other.ext',
                packageJSON: {
                    contributes: {
                        languages: [{ extensions: ['.mata'] }]
                    }
                }
            };

            expect(isConflictingExtension(extension, SIGHT_EXTENSION_ID)).toBe(true);
        });

        it('should NOT detect extension with only grammar scope as conflict (not in requirements)', () => {
            const extension = {
                id: 'other.ext',
                packageJSON: {
                    contributes: {
                        grammars: [{ scopeName: 'source.stata' }]
                    }
                }
            };

            expect(isConflictingExtension(extension, SIGHT_EXTENSION_ID)).toBe(false);
        });

        it('should NOT detect unrelated extension as conflict', () => {
            const extension = {
                id: 'other.python-ext',
                packageJSON: {
                    contributes: {
                        languages: [{ id: 'python' }]
                    }
                }
            };

            expect(isConflictingExtension(extension, SIGHT_EXTENSION_ID)).toBe(false);
        });

        it('should exclude Sight extension itself (self-exclusion)', () => {
            const extension = {
                id: SIGHT_EXTENSION_ID,
                packageJSON: {
                    contributes: {
                        languages: [{ id: 'stata' }]
                    }
                }
            };

            expect(isConflictingExtension(extension, SIGHT_EXTENSION_ID)).toBe(false);
        });
    });

    describe('findConflictingExtensions', () => {
        it('should find conflicting extensions', () => {
            const extensions = [
                {
                    id: 'stata.ext1',
                    packageJSON: { contributes: { languages: [{ id: 'stata' }] } }
                },
                {
                    id: 'python.ext',
                    packageJSON: { contributes: { languages: [{ id: 'python' }] } }
                },
                {
                    id: 'stata.ext2',
                    packageJSON: { contributes: { languages: [{ extensions: ['.do'] }] } }
                }
            ];

            const conflicts = findConflictingExtensions(extensions, SIGHT_EXTENSION_ID);
            expect(conflicts).toHaveLength(2);
            expect(conflicts[0].id).toBe('stata.ext1');
            expect(conflicts[1].id).toBe('stata.ext2');
        });
    });

    describe('getDisplayName', () => {
        it('should return packageJSON.displayName when available', () => {
            const extension = {
                id: 'ext1',
                packageJSON: { displayName: 'Stata Extension 1' }
            };
            expect(getDisplayName(extension)).toBe('Stata Extension 1');
        });

        it('should fall back to id when displayName is missing', () => {
            const extension = { id: 'ext1' };
            expect(getDisplayName(extension)).toBe('ext1');
        });

        it('should fall back to id when packageJSON is missing', () => {
            const extension = { id: 'ext1', packageJSON: undefined };
            expect(getDisplayName(extension)).toBe('ext1');
        });
    });

    describe('formatConflictMessage', () => {
        it('should format message with extension displayNames', () => {
            const conflicts = [
                { id: 'ext1', displayName: 'Stata Extension 1' },
                { id: 'ext2', displayName: 'Stata Extension 2' }
            ];

            const message = formatConflictMessage(conflicts);
            expect(message).toContain('Stata Extension 1, Stata Extension 2');
            expect(message).toContain('Conflicting Stata extensions detected');
        });

        it('should use displayName directly (never falls back to id)', () => {
            const conflicts = [{ id: 'ext1', displayName: 'My Display Name' }];

            const message = formatConflictMessage(conflicts);
            expect(message).toContain('My Display Name');
            expect(message).not.toContain('ext1');
        });

        it('should return empty string for empty list', () => {
            expect(formatConflictMessage([])).toBe('');
        });
    });

    describe('formatConflictTooltip', () => {
        it('should format tooltip with extension displayNames', () => {
            const conflicts = [
                { id: 'ext1', displayName: 'Stata Extension 1' },
                { id: 'ext2', displayName: 'Stata Extension 2' }
            ];

            const tooltip = formatConflictTooltip(conflicts);
            expect(tooltip).toContain('• Stata Extension 1');
            expect(tooltip).toContain('• Stata Extension 2');
            expect(tooltip).toContain('Conflicting extensions:');
        });

        it('should use displayName directly (never falls back to id)', () => {
            const conflicts = [{ id: 'ext1', displayName: 'My Display Name' }];

            const tooltip = formatConflictTooltip(conflicts);
            expect(tooltip).toContain('My Display Name');
            expect(tooltip).not.toContain('ext1');
        });

        it('should return empty string for empty list', () => {
            expect(formatConflictTooltip([])).toBe('');
        });
    });

    describe('isStataFile', () => {
        it('should detect .do files', () => {
            expect(isStataFile('test.do')).toBe(true);
            expect(isStataFile('TEST.DO')).toBe(true);
        });

        it('should detect .ado files', () => {
            expect(isStataFile('program.ado')).toBe(true);
            expect(isStataFile('PROGRAM.ADO')).toBe(true);
        });

        it('should detect .mata files', () => {
            expect(isStataFile('matrix.mata')).toBe(true);
            expect(isStataFile('MATRIX.MATA')).toBe(true);
        });

        it('should NOT detect .doh files (not in requirements)', () => {
            expect(isStataFile('header.doh')).toBe(false);
        });

        it('should NOT detect non-Stata files', () => {
            expect(isStataFile('script.py')).toBe(false);
            expect(isStataFile('data.csv')).toBe(false);
            expect(isStataFile('readme.txt')).toBe(false);
        });

        it('should return false for undefined', () => {
            expect(isStataFile(undefined)).toBe(false);
        });

        it('should return false for empty string', () => {
            expect(isStataFile('')).toBe(false);
        });
    });

    describe('STATA_FILE_EXTENSIONS', () => {
        it('should contain only requirements-specified extensions', () => {
            expect(STATA_FILE_EXTENSIONS).toEqual(['.do', '.ado', '.mata']);
        });
    });

    describe('shouldPersistDismissal', () => {
        it('should return true for "Dismiss" selection', () => {
            expect(shouldPersistDismissal('Dismiss')).toBe(true);
        });

        it('should return true for undefined (dialog closed)', () => {
            expect(shouldPersistDismissal(undefined)).toBe(true);
        });

        it('should return false for "Disable Other Extension(s)"', () => {
            expect(shouldPersistDismissal('Disable Other Extension(s)')).toBe(false);
        });

        it('should return false for "Uninstall Other Extension(s)"', () => {
            expect(shouldPersistDismissal('Uninstall Other Extension(s)')).toBe(false);
        });

        it('should return false for "Learn More"', () => {
            expect(shouldPersistDismissal('Learn More')).toBe(false);
        });
    });
});
