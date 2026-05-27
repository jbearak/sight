import { describe, expect, it } from 'bun:test';
import { schema_hash } from '../../../client/src/data-browser/schema-hash';

const cols = (a: [string, string][]) =>
    a.map(([name, type]) => ({ name, type }));

describe('data-browser schema_hash', () => {
    it('is stable for identical schemas', () => {
        const a = schema_hash(cols([['x', 'float'], ['y', 'str8']]));
        const b = schema_hash(cols([['x', 'float'], ['y', 'str8']]));
        expect(a).toBe(b);
        expect(a).toMatch(/^[0-9a-f]{8}$/);
    });

    it('differs when a name or type changes', () => {
        const base = schema_hash(cols([['x', 'float']]));
        expect(schema_hash(cols([['x', 'double']]))).not.toBe(base);
        expect(schema_hash(cols([['z', 'float']]))).not.toBe(base);
    });

    it('is order sensitive', () => {
        const ab = schema_hash(cols([['a', 'int'], ['b', 'int']]));
        const ba = schema_hash(cols([['b', 'int'], ['a', 'int']]));
        expect(ab).not.toBe(ba);
    });

    it('handles the empty schema', () => {
        expect(schema_hash([])).toMatch(/^[0-9a-f]{8}$/);
    });
});
