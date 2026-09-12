# Source analysis consolidation benchmark

Measured on September 12, 2026, comparing baseline `620b21ce` with
`39b18657`. Both revisions produced identical diagnostics. The combined
indexing and diagnostic time fell 12.2%, and repeated document edits fell
15.2% in this workload. No measured median increased.

## Method

- Apple M4 Max, 16 logical CPUs, 128 GiB RAM, Darwin 25.6.0, arm64.
- Bun 1.4.0. Both checkouts used the same installed dependencies.
- The identical `scripts/benchmark_source_analysis.ts` ran sequentially
  against each revision. Each run discarded one warm-up subprocess and
  measured five fresh Bun subprocesses. No repository test suite ran during
  measurement.
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
  median below covers all 50 measured edits.
- Prototype instrumentation counts lexer, parser, and semantic analyzer
  calls. Filesystem instrumentation counts `fs.promises.readFile` calls.
  Instrumentation is restored after each measured phase.

## Results

Times and peak RSS are medians. Percentages compare after with before.

| Measurement | Before | After | Change |
| --- | ---: | ---: | ---: |
| Indexing plus all diagnostics | 185.06 ms | 162.51 ms | -12.2% |
| Indexing | 66.77 ms | 58.88 ms | -11.8% |
| First target diagnostics | 8.10 ms | 7.26 ms | -10.4% |
| Remaining target diagnostics | 112.75 ms | 96.22 ms | -14.7% |
| Long-document edit through diagnostics | 9.50 ms | 8.05 ms | -15.2% |
| Process peak RSS | 205,552 KiB | 193,744 KiB | -5.7% |

The combined counters below are totals within each sample, not sums of
independently summarized phases. They were identical across all five
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

| Sample | Before time | After time | Before async reads | After async reads |
| --- | ---: | ---: | ---: | ---: |
| 1 | 190.61 ms | 182.37 ms | 508 | 507 |
| 2 | 177.66 ms | 161.24 ms | 510 | 505 |
| 3 | 197.02 ms | 163.49 ms | 515 | 505 |
| 4 | 179.67 ms | 161.62 ms | 507 | 511 |
| 5 | 185.06 ms | 162.51 ms | 514 | 510 |

All ten measured subprocesses reported 60 diagnostics for 180 files and
the same normalized output digests:

```text
diagnostics sha256:
dacd562a60498785778518d2923650ebec059bc2acb587219b04227c0bb42cfa
edits sha256:
e46a7839fd619c626ff0b50c0ed971f2a4a5af47a272587d0671c626c532a450
benchmark script sha256:
02ac7eea34a1a224af6027b93035431af207f00a7448d938031d653b1c1fc017
```

## Reproduction and limits

Copy the benchmark script from `39b18657` into the baseline checkout, then
run the following command separately in each checkout, choosing a distinct
output file:

```bash
bun scripts/benchmark_source_analysis.ts --runs 5 --files 180 --edits 10 --long-lines 1200 --output /tmp/sight-benchmark.json
```

The JSON includes every measured phase, edit, digest, and script hash.
The recorded runs are `/tmp/sight-consolidation-before.json` and
`/tmp/sight-consolidation-after.json` on the measurement machine.

"Cold" means fresh Sight state; filesystem caches were not flushed.
The measurements exclude target discovery, configuration loading, output
rendering, subprocess startup, and LSP transport, debounce, watcher, and
publication work. Async read counts exclude CLI synchronous reads.
Peak RSS covers the entire sample process, including workload setup and
unmeasured warm-up work within that process. This is a small synthetic
workspace on one machine, with five samples and no confidence intervals.
The baseline ran first, so timing differences can include run-order effects.
The consistent reduction in lexer calls is stronger evidence of eliminated
work than the timing percentages. Parser and semantic analyzer counts show
that separate analysis passes remain.
