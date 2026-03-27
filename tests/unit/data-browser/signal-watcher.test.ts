import { describe, it, expect } from 'bun:test';
import { parse_sidecar_json } from '../../../client/src/data-browser/signal-watcher';

describe('parse_sidecar_json', () => {
    const VALID_SIDECAR = JSON.stringify({
        version: 1,
        uuid: 'abc-123',
        name: 'mydata',
        dtapath: '/tmp/mydata.dta',
        N: 1000,
        k: 5,
        replace: false,
        subsetted: false,
    });

    it('parses valid sidecar JSON', () => {
        const my_result = parse_sidecar_json(VALID_SIDECAR);
        expect(my_result).not.toBeNull();
        expect(my_result!.uuid).toBe('abc-123');
        expect(my_result!.name).toBe('mydata');
        expect(my_result!.dtapath).toBe('/tmp/mydata.dta');
        expect(my_result!.N).toBe(1000);
        expect(my_result!.k).toBe(5);
        expect(my_result!.replace).toBe(false);
        expect(my_result!.subsetted).toBe(false);
        expect(my_result!.version).toBe(1);
    });

    it('parses expanded sidecar JSON', () => {
        const my_result = parse_sidecar_json(JSON.stringify({
            version: 1,
            uuid: 'abc-123',
            name: 'mydata',
            dtapath: '/tmp/mydata.dta',
            N: 1000,
            k: 5,
            replace: false,
            subsetted: true,
            timestamp: '2026-03-27 10:00:00',
            source: '/tmp/source.dta',
            varlist: ['make', 'price'],
            if: 'foreign == 1',
            in: '1/10',
        }));

        expect(my_result).not.toBeNull();
        expect(my_result!.timestamp).toBe('2026-03-27 10:00:00');
        expect(my_result!.source).toBe('/tmp/source.dta');
        expect(my_result!.varlist).toEqual(['make', 'price']);
        expect(my_result!.if).toBe('foreign == 1');
        expect(my_result!.in).toBe('1/10');
    });

    it('returns null for invalid JSON', () => {
        expect(parse_sidecar_json('')).toBeNull();
        expect(parse_sidecar_json('not json')).toBeNull();
        expect(parse_sidecar_json('{broken')).toBeNull();
    });

    it('returns null for missing required fields', () => {
        // Missing uuid
        expect(parse_sidecar_json(JSON.stringify({
            name: 'mydata', dtapath: '/tmp/x.dta',
            N: 10, k: 2, replace: false,
        }))).toBeNull();

        // Missing name
        expect(parse_sidecar_json(JSON.stringify({
            uuid: 'abc', dtapath: '/tmp/x.dta',
            N: 10, k: 2, replace: false,
        }))).toBeNull();

        // Missing N
        expect(parse_sidecar_json(JSON.stringify({
            uuid: 'abc', name: 'mydata', dtapath: '/tmp/x.dta',
            k: 2, replace: false,
        }))).toBeNull();

        // Missing k
        expect(parse_sidecar_json(JSON.stringify({
            uuid: 'abc', name: 'mydata', dtapath: '/tmp/x.dta',
            N: 10, replace: false,
        }))).toBeNull();

        // Missing replace
        expect(parse_sidecar_json(JSON.stringify({
            uuid: 'abc', name: 'mydata', dtapath: '/tmp/x.dta',
            N: 10, k: 2,
        }))).toBeNull();
    });

    it('returns null for wrong field types', () => {
        // uuid should be string
        expect(parse_sidecar_json(JSON.stringify({
            uuid: 123, name: 'mydata', dtapath: '/tmp/x.dta',
            N: 10, k: 2, replace: false,
        }))).toBeNull();

        // name should be string
        expect(parse_sidecar_json(JSON.stringify({
            uuid: 'abc', name: 42, dtapath: '/tmp/x.dta',
            N: 10, k: 2, replace: false,
        }))).toBeNull();

        // N should be number
        expect(parse_sidecar_json(JSON.stringify({
            uuid: 'abc', name: 'mydata', dtapath: '/tmp/x.dta',
            N: 'ten', k: 2, replace: false,
        }))).toBeNull();

        // k should be number
        expect(parse_sidecar_json(JSON.stringify({
            uuid: 'abc', name: 'mydata', dtapath: '/tmp/x.dta',
            N: 10, k: 'two', replace: false,
        }))).toBeNull();

        // replace should be boolean
        expect(parse_sidecar_json(JSON.stringify({
            uuid: 'abc', name: 'mydata', dtapath: '/tmp/x.dta',
            N: 10, k: 2, replace: 'false',
        }))).toBeNull();

        expect(parse_sidecar_json(JSON.stringify({
            uuid: 'abc', name: 'mydata', dtapath: '/tmp/x.dta',
            N: 10, k: 2, replace: false, varlist: 'make',
        }))).toBeNull();
    });
});
