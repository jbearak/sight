import { describe, expect, it } from 'bun:test';
import {
    clear_ineligible_diagnostics,
    collect_diagnostic_resource_uris,
    diagnostics_for_resource,
    same_diagnostic_resource_uris,
    type DiagnosticTabResource,
} from '../../client/src/diagnostic-resources-core';

function collect(
    tabs: DiagnosticTabResource[],
    visible: string[] = []
): string[] {
    return collect_diagnostic_resource_uris(tabs, visible);
}

describe('diagnostic editor resources', () => {
    it('compares canonical snapshots for notification deduplication', () => {
        expect(same_diagnostic_resource_uris(
            ['file:///a.do', 'file:///b.do'],
            ['file:///a.do', 'file:///b.do']
        )).toBe(true);
        expect(same_diagnostic_resource_uris(
            ['file:///b.do', 'file:///a.do'],
            ['file:///a.do', 'file:///b.do']
        )).toBe(false);
        expect(same_diagnostic_resource_uris(
            undefined,
            []
        )).toBe(false);
    });

    it('includes active and inactive resource tabs deterministically', () => {
        expect(collect([
            { kind: 'resource', uri: 'file:///b.do' },
            { kind: 'resource', uri: 'file:///a.do' },
            { kind: 'resource', uri: 'file:///a.do' },
        ])).toEqual(['file:///a.do', 'file:///b.do']);
    });

    it('owns only the modified side of a diff tab', () => {
        expect(collect([{
            kind: 'diff',
            original_uri: 'file:///original.do',
            modified_uri: 'file:///modified.do',
            is_active: false,
        }])).toEqual(['file:///modified.do']);
    });

    it('unions visible peek editors', () => {
        expect(collect([], ['file:///peek.do']))
            .toEqual(['file:///peek.do']);
    });

    it('subtracts the visible original side of an active diff', () => {
        expect(collect([{
            kind: 'diff',
            original_uri: 'file:///original.do',
            modified_uri: 'file:///modified.do',
            is_active: true,
        }], [
            'file:///original.do',
            'file:///modified.do',
        ])).toEqual(['file:///modified.do']);
    });

    it('keeps a diff original that also has its own resource tab', () => {
        expect(collect([
            {
                kind: 'diff',
                original_uri: 'file:///shared.do',
                modified_uri: 'file:///modified.do',
                is_active: true,
            },
            { kind: 'resource', uri: 'file:///shared.do' },
        ], ['file:///shared.do'])).toEqual([
            'file:///modified.do',
            'file:///shared.do',
        ]);
    });

    it('keeps an independent peek matching an active diff original', () => {
        expect(collect([{
            kind: 'diff',
            original_uri: 'file:///shared.do',
            modified_uri: 'file:///modified.do',
            is_active: true,
        }], [
            'file:///shared.do',
            'file:///shared.do',
        ])).toEqual([
            'file:///modified.do',
            'file:///shared.do',
        ]);
    });

    it('consumes one occurrence for each active diff original', () => {
        expect(collect([
            {
                kind: 'diff',
                original_uri: 'file:///shared.do',
                modified_uri: 'file:///modified-a.do',
                is_active: true,
            },
            {
                kind: 'diff',
                original_uri: 'file:///shared.do',
                modified_uri: 'file:///modified-b.do',
                is_active: true,
            },
        ], [
            'file:///shared.do',
            'file:///shared.do',
            'file:///shared.do',
        ])).toEqual([
            'file:///modified-a.do',
            'file:///modified-b.do',
            'file:///shared.do',
        ]);
    });

    it('does not exclude a visible URI for an inactive diff', () => {
        expect(collect([{
            kind: 'diff',
            original_uri: 'file:///peek.do',
            modified_uri: 'file:///modified.do',
            is_active: false,
        }], ['file:///peek.do'])).toEqual([
            'file:///modified.do',
            'file:///peek.do',
        ]);
    });

    it('prunes only retained diagnostics for ineligible resources', () => {
        const deleted: string[] = [];
        const uris = [
            { toString: () => 'file:///visible.do' },
            { toString: () => 'file:///hidden.do' },
        ];
        const collection = {
            forEach: (callback: (uri: typeof uris[number]) => void) => {
                uris.forEach(callback);
            },
            delete: (uri: typeof uris[number]) => {
                deleted.push(uri.toString());
            },
        };

        clear_ineligible_diagnostics(
            collection,
            new Set(['file:///visible.do'])
        );
        expect(deleted).toEqual(['file:///hidden.do']);
    });

    it('turns a late ineligible publication into an empty clear', () => {
        const diagnostics = [{ message: 'stale' }];
        const eligible = new Set(['file:///visible.do']);

        expect(diagnostics_for_resource(
            'file:///visible.do', diagnostics, eligible
        )).toBe(diagnostics);
        expect(diagnostics_for_resource(
            'file:///hidden.do', diagnostics, eligible
        )).toEqual([]);
    });
});
