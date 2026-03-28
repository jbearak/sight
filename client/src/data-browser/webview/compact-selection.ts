/**
 * Minimal CompactSelection compatible with the subset of
 * @glideapps/glide-data-grid's CompactSelection API that
 * selection-model.ts actually uses.
 *
 * This local module exists so that selection-model.ts (and
 * its tests) can run without the grid library installed.
 * The full library is still imported directly by app.tsx
 * for the DataEditor component.
 *
 * GridSelection is defined with a structural interface so
 * that objects created with either this class or the real
 * library class are assignable to it.
 */

/** Structural interface matching the CompactSelection API
 *  surface used by this codebase. Both the local class and
 *  the library class satisfy this interface. */
export interface CompactSelectionLike {
    readonly length: number;
    toArray(): number[];
    hasIndex(index: number): boolean;
}

export interface GridSelection {
    readonly columns: CompactSelectionLike;
    readonly rows: CompactSelectionLike;
    readonly current?: {
        readonly cell: readonly [number, number];
        readonly range: {
            readonly x: number;
            readonly y: number;
            readonly width: number;
            readonly height: number;
        };
        readonly rangeStack: readonly {
            readonly x: number;
            readonly y: number;
            readonly width: number;
            readonly height: number;
        }[];
    };
}

export class CompactSelection implements CompactSelectionLike {
    private readonly ranges: readonly [number, number][];

    private constructor(
        ranges: readonly [number, number][]
    ) {
        this.ranges = ranges;
    }

    static empty(): CompactSelection {
        return new CompactSelection([]);
    }

    static fromSingleSelection(
        index: number
    ): CompactSelection {
        return new CompactSelection([[index, index + 1]]);
    }

    get length(): number {
        let my_count = 0;
        for (const [my_start, my_end] of this.ranges) {
            my_count += my_end - my_start;
        }
        return my_count;
    }

    toArray(): number[] {
        const the_result: number[] = [];
        for (const [my_start, my_end] of this.ranges) {
            for (let i = my_start; i < my_end; i++) {
                the_result.push(i);
            }
        }
        return the_result;
    }

    hasIndex(index: number): boolean {
        for (const [my_start, my_end] of this.ranges) {
            if (index >= my_start && index < my_end) {
                return true;
            }
        }
        return false;
    }
}
