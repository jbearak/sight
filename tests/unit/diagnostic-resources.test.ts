import { describe, expect, it } from 'bun:test';
import {
    diagnostic_uri_set_changes,
    diagnostic_uris_from_initialization_options,
    diagnostic_uris_from_notification,
    parse_diagnostic_uri_set,
    same_diagnostic_uri_set,
    settings_initialization_options,
} from '../../src/diagnostic-resources';

describe('diagnostic resource protocol metadata', () => {
    it('diffs explicit policies without involving unrelated URIs', () => {
        expect(diagnostic_uri_set_changes(
            new Set(['file:///kept.do', 'file:///removed.do']),
            new Set(['file:///kept.do', 'file:///added.do'])
        )).toEqual({
            added: ['file:///added.do'],
            removed: ['file:///removed.do'],
        });
    });

    it('deduplicates only identical explicit policy sets', () => {
        expect(same_diagnostic_uri_set(
            new Set(['file:///a.do', 'file:///b.do']),
            new Set(['file:///b.do', 'file:///a.do'])
        )).toBe(true);
        expect(same_diagnostic_uri_set(
            new Set(['file:///a.do']),
            new Set(['file:///b.do'])
        )).toBe(false);
        expect(same_diagnostic_uri_set(undefined, new Set())).toBe(false);
    });

    it('preserves fallback behavior when the URI array is absent', () => {
        expect(diagnostic_uris_from_initialization_options(undefined))
            .toBeUndefined();
        expect(diagnostic_uris_from_initialization_options({ sight: {} }))
            .toBeUndefined();
        expect(diagnostic_uris_from_notification({}))
            .toBeUndefined();
    });

    it('distinguishes an explicit empty set from fallback behavior', () => {
        expect(diagnostic_uris_from_initialization_options({
            diagnosticUris: [],
        })).toEqual(new Set());
        expect(diagnostic_uris_from_notification({
            diagnosticUris: [],
        })).toEqual(new Set());
    });

    it('normalizes valid URI strings and filters malformed entries', () => {
        expect(parse_diagnostic_uri_set([
            'file:///workspace/a.do',
            'file:///workspace/a.do',
            'https://example.test/b.do',
            'not-a-uri',
            42,
            null,
        ])).toEqual(new Set([
            'file:///workspace/a.do',
            'https://example.test/b.do',
        ]));
    });

    it('ignores malformed notification fields instead of clearing policy', () => {
        expect(diagnostic_uris_from_notification({
            diagnosticUris: 'file:///workspace/a.do',
        })).toBeUndefined();
    });

    it('strips feature metadata from bare initialization settings', () => {
        expect(settings_initialization_options({
            diagnosticUris: ['file:///workspace/a.do'],
            diagnostics: { enabled: false },
        })).toEqual({ diagnostics: { enabled: false } });
    });

    it('keeps a sight wrapper for the existing settings unwrap path', () => {
        const options = {
            sight: { diagnostics: { enabled: false } },
            diagnosticUris: ['file:///workspace/a.do'],
        };
        expect(settings_initialization_options(options)).toBe(options);
    });
});
