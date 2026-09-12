# Source analysis consolidation benchmark

Measured on September 12, 2026, comparing baseline `620b21ce` with
`67d3894b`, whose production source matches `39b18657`. Both revisions
produced identical diagnostics. With alternating revision order, the
combined indexing and diagnostic time fell 4.4%, and repeated document
edits fell 12.6% in this workload.

## Method

- Apple M4 Max, 16 logical CPUs, 128 GiB RAM, Darwin 25.6.0, arm64.
- Bun 1.4.0. Both checkouts used the same installed dependencies.
- Recorded source commits were
  `620b21ce4b209f15400388b1deed614e7448db3f` before and
  `67d3894bed857fa79f87a0338bd35737c48d47fa` after. Both reported
  `source_dirty: false`. This check covers `src/`, `package.json`, and
  `bun.lock`; the independent script SHA below identifies the benchmark.
- The identical `scripts/benchmark_source_analysis.ts` first discarded one
  warm-up subprocess for each revision, baseline then changed. Six measured
  pairs followed, each sample in a fresh Bun subprocess. Odd pairs ran
  baseline then changed; even pairs reversed that order. The script checks
  exact script-byte equality and records the actual execution order. No
  subprocesses overlapped, and no repository test suite ran during measurement.
- Each subprocess generated 180 files, including execution chains, shared
  includes, inherited working directories, program-created locals, and a
  long document with 1,200 generated lines plus setup statements. That
  document also contains continuations, delimiters, and embedded Mata.
- Cold measurements cover `build_check_context`, diagnostics for the first
  report target, then diagnostics for the remaining targets through
  `collect_check_diagnostics`, using one CLI worker. The combined value is
  calculated within each sample before taking its median.
- Each subprocess then warms the long document and measures ten sequential
  `DocumentStore.update` calls through diagnostic collection. The edit
  median below covers all 60 measured edits per revision.
- Prototype instrumentation counts lexer, parser, and semantic analyzer
  calls. Filesystem instrumentation counts `fs.promises.readFile` calls.
  Instrumentation is restored after each measured phase.

## Results

Times and peak RSS are medians. Percentages compare after with before.

| Measurement | Before | After | Change |
| --- | ---: | ---: | ---: |
| Indexing plus all diagnostics | 157.92 ms | 150.92 ms | -4.4% |
| Indexing | 59.00 ms | 54.45 ms | -7.7% |
| First target diagnostics | 6.98 ms | 6.57 ms | -5.8% |
| Remaining target diagnostics | 92.08 ms | 89.66 ms | -2.6% |
| Long-document edit through diagnostics | 8.47 ms | 7.40 ms | -12.6% |
| Process peak RSS | 203,040 KiB | 191,304 KiB | -5.8% |

The combined counters below are totals within each sample, not sums of
independently summarized phases. They were identical across all six
samples of each revision.

| Work | Before | After | Change |
| --- | ---: | ---: | ---: |
| Combined lexer calls | 2,694 | 918 | -65.9% |
| Combined parser calls | 772 | 772 | 0% |
| Combined semantic analyzer calls | 772 | 772 | 0% |
| Lexer calls per edit | 6 | 3 | -50.0% |
| Parser calls per edit | 2 | 2 | 0% |
| Semantic analyzer calls per edit | 2 | 2 | 0% |

Individual combined measurements show the timing variation and async read
totals. Read-count ranges overlap, so this benchmark does not establish a
material reduction in disk reads.

| Pair | Order | Before time | After time | Before async reads | After async reads |
| --- | --- | ---: | ---: | ---: | ---: |
| 1 | Before, after | 158.05 ms | 151.69 ms | 504 | 516 |
| 2 | After, before | 157.63 ms | 151.13 ms | 513 | 519 |
| 3 | Before, after | 157.76 ms | 151.57 ms | 511 | 506 |
| 4 | After, before | 159.03 ms | 150.57 ms | 508 | 510 |
| 5 | Before, after | 158.22 ms | 150.71 ms | 511 | 508 |
| 6 | After, before | 157.79 ms | 150.32 ms | 510 | 513 |

All twelve measured subprocesses reported 60 diagnostics for 180 files and
the same normalized output digests:

```text
diagnostics sha256:
dacd562a60498785778518d2923650ebec059bc2acb587219b04227c0bb42cfa
edits sha256:
e46a7839fd619c626ff0b50c0ed971f2a4a5af47a272587d0671c626c532a450
benchmark script sha256:
25ba7b6db781265422f7b137c4714496797946da0ccd0d1b0c41deed03c0c088
```

## Reproduction and limits

Use a checkout of `620b21ce` at `/tmp/sight-consolidation-base-git` with the
same installed dependencies as the changed checkout. Copy the current
benchmark script into it, then run comparison mode from the changed
checkout. The script requires an even measured pair count to balance order.

```bash
cp scripts/benchmark_source_analysis.ts /tmp/sight-consolidation-base-git/scripts/benchmark_source_analysis.ts
bun scripts/benchmark_source_analysis.ts --baseline /tmp/sight-consolidation-base-git --runs 6 --files 180 --edits 10 --long-lines 1200 --output /tmp/sight-consolidation-comparison.json
```

The JSON includes every measured phase, edit, digest, script hash, source
revision, CPU model/count, and execution order entry, including the discarded
warm-up order. Options record workload dimensions and comparison mode without
local checkout or output paths. Both revision summaries and raw sample arrays
are retained. The recorded comparison is
`/tmp/sight-consolidation-comparison.json` on the measurement machine.

"Cold" means fresh Sight state; filesystem caches were not flushed.
The measurements exclude target discovery, configuration loading, output
rendering, subprocess startup, and LSP transport, debounce, watcher, and
publication work. Async read counts exclude CLI synchronous reads.
Peak RSS covers the entire sample process, including workload setup and
unmeasured warm-up work within that process. This is a small synthetic
workspace on one machine, with six samples per revision and no confidence
intervals. Alternating order balances which revision runs first within a
pair; it cannot eliminate ambient machine noise or all run-order effects.
The consistent reduction in lexer calls is stronger evidence of eliminated
work than the timing percentages. Parser and semantic analyzer counts show
that separate analysis passes remain.
