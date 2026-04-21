/**
 * Generator for forward-call graphs used in oracle-backed property tests
 * (see `tests/property/forward-call-out-of-scope-oracle.prop.test.ts`).
 *
 * A graph is a small collection of `.do` files connected by
 * `include`/`do`/`run` calls. File 0 is always the root — it contains the
 * reference event the oracle and property tests reason about. Non-root
 * callees can only target files with a strictly greater index, giving a
 * DAG with bounded depth (at most `file_count - 1`). The existing resolver
 * and the oracle both handle cycles, so the generator leaves that space
 * to regression fixtures rather than random inputs.
 */
import * as fc from 'fast-check';

export const MACRO_NAME_POOL = ['macro_a', 'macro_b', 'macro_c', 'macro_d'] as const;

export type MacroName = typeof MACRO_NAME_POOL[number];

export type FileEvent =
    | { kind: 'define_local'; name: MacroName }
    | { kind: 'include_call'; target: number }
    | { kind: 'do_call'; target: number }
    | { kind: 'run_call'; target: number }
    | { kind: 'reference_local'; name: MacroName };

export interface FileSpec {
    filename: string;
    events: FileEvent[];
}

export interface ForwardCallGraph {
    /** files[0] is the root; all reference_local events live here. */
    files: FileSpec[];
    /** Event index (== line index) of the reference event inside the root file. */
    reference_event_index: number;
    /** Name the reference event dereferences. */
    reference_name: MacroName;
}

interface GraphConfig {
    min_files: number;
    max_files: number;
    max_events_per_file: number;
    define_probability: number;
    include_probability: number;
    do_probability: number;
    run_probability: number;
}

const DEFAULT_CONFIG: GraphConfig = {
    min_files: 1,
    max_files: 4,
    max_events_per_file: 6,
    define_probability: 0.5,
    include_probability: 0.2,
    do_probability: 0.2,
    run_probability: 0.1,
};

/**
 * Generator entry point. The optional overrides let callers tune the
 * random distribution (e.g., biasing toward `do`-calls to stress the
 * OUT_OF_SCOPE_SYMBOL rewrite path).
 */
export function arbitrary_forward_call_graph(
    overrides: Partial<GraphConfig> = {}
): fc.Arbitrary<ForwardCallGraph> {
    const my_config: GraphConfig = { ...DEFAULT_CONFIG, ...overrides };

    return fc.integer({ min: my_config.min_files, max: my_config.max_files }).chain(file_count => {
        const file_arbs: fc.Arbitrary<FileSpec>[] = [];
        for (let i = 0; i < file_count; i++) {
            file_arbs.push(arbitrary_file_spec(i, file_count, my_config));
        }
        return fc.tuple(...file_arbs).chain(the_files => {
            return place_root_reference(the_files as FileSpec[]);
        });
    });
}

function arbitrary_file_spec(
    file_index: number,
    file_count: number,
    config: GraphConfig
): fc.Arbitrary<FileSpec> {
    const callable_targets: number[] = [];
    for (let j = file_index + 1; j < file_count; j++) {
        callable_targets.push(j);
    }

    return fc
        .integer({ min: 1, max: config.max_events_per_file })
        .chain(event_count => {
            const the_event_arbs: fc.Arbitrary<FileEvent>[] = [];
            for (let i = 0; i < event_count; i++) {
                the_event_arbs.push(arbitrary_non_reference_event(callable_targets, config));
            }
            return fc.tuple(...the_event_arbs).map(the_events => ({
                filename: `file_${file_index}.do`,
                events: the_events as FileEvent[],
            }));
        });
}

function arbitrary_non_reference_event(
    callable_targets: number[],
    config: GraphConfig
): fc.Arbitrary<FileEvent> {
    const macro_arb = fc.constantFrom(...MACRO_NAME_POOL);
    const define_arb = macro_arb.map(name => ({ kind: 'define_local' as const, name }));

    const weighted: { arbitrary: fc.Arbitrary<FileEvent>; weight: number }[] = [
        { arbitrary: define_arb, weight: Math.round(config.define_probability * 100) },
    ];
    if (callable_targets.length > 0) {
        const target_arb = fc.constantFrom(...callable_targets);
        weighted.push(
            {
                arbitrary: target_arb.map(target => ({ kind: 'include_call' as const, target })),
                weight: Math.round(config.include_probability * 100),
            },
            {
                arbitrary: target_arb.map(target => ({ kind: 'do_call' as const, target })),
                weight: Math.round(config.do_probability * 100),
            },
            {
                arbitrary: target_arb.map(target => ({ kind: 'run_call' as const, target })),
                weight: Math.round(config.run_probability * 100),
            }
        );
    }
    return fc.oneof(...weighted);
}

function place_root_reference(files: FileSpec[]): fc.Arbitrary<ForwardCallGraph> {
    const root = files[0];
    const reference_name_arb = fc.constantFrom(...MACRO_NAME_POOL);
    // Position the reference event at a random index; the reference becomes
    // part of the root's event sequence so later tests can read it by line.
    return fc
        .tuple(reference_name_arb, fc.integer({ min: 0, max: root.events.length }))
        .map(([reference_name, reference_index]) => {
            const the_events: FileEvent[] = [
                ...root.events.slice(0, reference_index),
                { kind: 'reference_local', name: reference_name },
                ...root.events.slice(reference_index),
            ];
            const the_files: FileSpec[] = [
                { filename: root.filename, events: the_events },
                ...files.slice(1),
            ];
            return {
                files: the_files,
                reference_event_index: reference_index,
                reference_name,
            };
        });
}

/**
 * Render a file's events into Stata source. Each event takes one line so
 * that `event_index` matches the 0-indexed line number where the event
 * appears — this lets the oracle and the LSP agree on line references.
 */
export function render_file(file: FileSpec): string {
    const the_lines: string[] = [];
    for (const my_event of file.events) {
        the_lines.push(render_event(my_event));
    }
    return the_lines.join('\n');
}

function render_event(event: FileEvent): string {
    switch (event.kind) {
        case 'define_local':
            return `local ${event.name} 1`;
        case 'include_call':
            return `include "file_${event.target}.do"`;
        case 'do_call':
            return `do "file_${event.target}.do"`;
        case 'run_call':
            return `run "file_${event.target}.do"`;
        case 'reference_local':
            return `di \`${event.name}'`;
    }
}
