# Source analysis consolidation benchmark

Measured on September 12, 2026, comparing baseline `620b21ce` with
`39b18657`, using the updated comparison script in this PR. Both revisions
produced identical diagnostics. With alternating revision order, the
combined indexing and diagnostic time fell 3.0%, and repeated document
edits fell 11.3% in this workload.

## Method

- Apple M4 Max, 16 logical CPUs, 128 GiB RAM, Darwin 25.6.0, arm64.
- Bun 1.4.0. Both checkouts used the same installed dependencies.
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
| Indexing plus all diagnostics | 156.12 ms | 151.49 ms | -3.0% |
| Indexing | 58.15 ms | 54.58 ms | -6.1% |
| First target diagnostics | 6.98 ms | 6.67 ms | -4.4% |
| Remaining target diagnostics | 91.34 ms | 90.39 ms | -1.0% |
| Long-document edit through diagnostics | 8.59 ms | 7.62 ms | -11.3% |
| Process peak RSS | 203,112 KiB | 194,344 KiB | -4.3% |

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
| 1 | Before, after | 156.26 ms | 152.19 ms | 506 | 515 |
| 2 | After, before | 155.25 ms | 153.38 ms | 507 | 505 |
| 3 | Before, after | 156.74 ms | 150.39 ms | 510 | 510 |
| 4 | After, before | 156.66 ms | 150.56 ms | 516 | 509 |
| 5 | Before, after | 155.73 ms | 151.07 ms | 511 | 514 |
| 6 | After, before | 155.98 ms | 151.92 ms | 514 | 517 |

All twelve measured subprocesses reported 60 diagnostics for 180 files and
the same normalized output digests:

```text
diagnostics sha256:
dacd562a60498785778518d2923650ebec059bc2acb587219b04227c0bb42cfa
edits sha256:
e46a7839fd619c626ff0b50c0ed971f2a4a5af47a272587d0671c626c532a450
benchmark script sha256:
76ff718e527e8c7147a9be357fefc1fb80462edaa080b3da49dca32da2200b3b
```

## Reproduction and limits

Use a checkout of `620b21ce` at `/tmp/sight-consolidation-baseline` with the
same installed dependencies as the changed checkout. Copy the current
benchmark script into it, then run comparison mode from the changed
checkout. The script requires an even measured pair count to balance order.

```bash
cp scripts/benchmark_source_analysis.ts /tmp/sight-consolidation-baseline/scripts/benchmark_source_analysis.ts
bun scripts/benchmark_source_analysis.ts --baseline /tmp/sight-consolidation-baseline --runs 6 --files 180 --edits 10 --long-lines 1200 --output /tmp/sight-consolidation-comparison.json
```

The JSON includes every measured phase, edit, digest, script hash, and
execution order entry, including the discarded warm-up order. Both revision
summaries and raw sample arrays are retained. The recorded comparison is
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
