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
import { friendly_applescript_error } from '../../../client/src/send-to-stata/applescript';

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

    it('passes an empty message through unchanged', () => {
        expect(friendly_applescript_error('', 'Stata')).toBe('');
    });
});
