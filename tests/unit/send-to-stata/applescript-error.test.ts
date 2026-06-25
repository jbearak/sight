/// <reference types="bun-types" />
/**
 * Unit tests for friendly translation of `osascript` failures.
 *
 * The high-value case is errAEEventNotPermitted (-1743): macOS blocks
 * the editor from controlling Stata until the user grants Automation
 * permission. The raw osascript message is opaque, so we surface
 * actionable guidance instead.
 *
 * Feature: send-to-stata — AppleScript Automation permission errors
 */

import { describe, expect, it } from 'bun:test';
import {
    friendly_applescript_error,
    settle_osascript_result,
} from '../../../client/src/send-to-stata/applescript';

describe('friendly_applescript_error', () => {
    const not_permitted =
        '30:149: execution error: Not authorized to send Apple events ' +
        'to StataSE. (-1743)';

    it('translates the -1743 permission error into guidance', () => {
        const my_message = friendly_applescript_error(not_permitted, 'StataSE');
        expect(my_message).toContain('Automation permission');
        expect(my_message).toContain('Privacy & Security');
        // Names the actual variant so the user knows what to enable.
        expect(my_message).toContain('StataSE');
        // Does not leak the raw error code at the user.
        expect(my_message).not.toContain('-1743');
    });

    it('uses the provided variant name in the message', () => {
        const my_message = friendly_applescript_error(
            'Not authorized to send Apple events to StataMP. (-1743)',
            'StataMP'
        );
        expect(my_message).toContain('StataMP');
        expect(my_message).not.toContain('StataSE');
    });

    it('passes unrelated errors through unchanged', () => {
        const my_other = '0:0: execution error: Application isn’t ' +
            'running. (-600)';
        expect(friendly_applescript_error(my_other, 'StataSE')).toBe(my_other);
    });

    it('does not fire on a bare -1743 substring outside the code', () => {
        // A path or value containing "-1743" must not be mistaken
        // for the canonical "(-1743)" Apple Events permission code.
        const my_unrelated =
            '0:0: execution error: cannot read ' +
            '/Users/me/project-1743/data.dta. (-43)';
        expect(friendly_applescript_error(my_unrelated, 'StataSE'))
            .toBe(my_unrelated);
    });

    it('does not fire when (-1743) is mid-message but not the code', () => {
        // The real code is (-43); the anchored match must ignore a
        // "(-1743)" that appears earlier in the message (e.g. a path).
        const my_unrelated =
            'cannot read /Users/me/project(-1743)/data.dta. (-43)';
        expect(friendly_applescript_error(my_unrelated, 'StataSE'))
            .toBe(my_unrelated);
    });

    it('passes an empty message through unchanged', () => {
        expect(friendly_applescript_error('', 'Stata')).toBe('');
    });
});

describe('settle_osascript_result', () => {
    // Guards the wiring shared by the exec/execFile call sites: the
    // friendly translation must be applied on the reject path, so the
    // helper cannot be silently unwired without failing a test.
    it('resolves when there is no error', () => {
        let resolved = false;
        settle_osascript_result(
            null,
            'StataSE',
            () => { resolved = true; },
            () => { throw new Error('should not reject on success'); }
        );
        expect(resolved).toBe(true);
    });

    it('rejects with friendly guidance on a -1743 failure', () => {
        let my_reason: Error | undefined;
        settle_osascript_result(
            new Error('execution error: Not authorized ... (-1743)'),
            'StataMP',
            () => { throw new Error('should not resolve on failure'); },
            (reason) => { my_reason = reason; }
        );
        expect(my_reason?.message).toContain('Automation permission');
        expect(my_reason?.message).toContain('StataMP');
        expect(my_reason?.message).not.toContain('-1743');
    });

    it('rejects with the raw message on unrelated failures', () => {
        const raw_message = 'execution error: not running. (-600)';
        let my_reason: Error | undefined;
        settle_osascript_result(
            new Error(raw_message),
            'StataSE',
            () => { throw new Error('should not resolve on failure'); },
            (reason) => { my_reason = reason; }
        );
        expect(my_reason?.message).toBe(raw_message);
    });
});
