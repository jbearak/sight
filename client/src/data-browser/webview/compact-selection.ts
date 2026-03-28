/**
 * Minimal CompactSelection implementation compatible with
 * @glideapps/glide-data-grid's CompactSelection API.
 *
 * Avoids a runtime dependency on the grid library so that
 * modules consuming this can be tested in Bun (where the
 * client-only dependency is not installed).
 */
export class CompactSelection {
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

export interface GridSelection {
    readonly columns: CompactSelection;
    readonly rows: CompactSelection;
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
