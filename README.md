# makefun-csv-reader-1121-boskong

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/aslfahim/makefun-csv-reader-1121-boskong/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/aslfahim/makefun-csv-reader-1121-boskong/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A fast, dependency-free drop-in for csv-reader 1.0.0: an indexOf-driven CSV reader that returns exactly csv-reader's {columns, rows, errors} for every case, faster. Unquoted record lines take an indexOf/split fast path; quoted fields, CRs and broken rows take a separate slow path that reproduces every quirk (BOM, stray CR, doubled quotes, CRLF/lone CR inside quotes, quote junk, unterminated quotes, short/long rows).

## Run it

```sh
node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=aslfahim&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
