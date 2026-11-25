#!/usr/bin/env bash
# Sigrún independent statistics QA — one command, CI-ready.
#
#   1. version check (Python + libraries, Node)
#   2. golden datasets (regenerated deterministically; a diff fails the run)
#   3. reference engine  (qa/reference/engine.py)
#   4. Sigrún adapter    (qa/adapters/sigrun/cli.ts → esbuild → node)
#   5. comparator + report (qa/reports/latest.json, latest.html)
#
# Exit code 1 when FAIL > 0 or ERROR > 0.
set -uo pipefail
cd "$(dirname "$0")/.."
RUN=qa/_run
mkdir -p "$RUN"

echo "── 1/5 versions ───────────────────────────────────────────────"
python3 - <<'PY'
import sys
import numpy, scipy, statsmodels, pandas, patsy
print(f"python {sys.version.split()[0]}  numpy {numpy.__version__}  scipy {scipy.__version__}  "
      f"statsmodels {statsmodels.__version__}  pandas {pandas.__version__}  patsy {patsy.__version__}")
PY
node --version

echo "── 2/5 golden datasets ────────────────────────────────────────"
python3 qa/datasets/generate.py | tail -2
if [ -n "$(git status --porcelain -- 'qa/datasets/*.json' 2>/dev/null | grep -v '^?? ')" ]; then
  echo "ERROR: qa/datasets golden JSON differs from the committed files — regenerate and commit them." >&2
  git status --porcelain -- 'qa/datasets/*.json' >&2
  exit 1
fi

echo "── 3/5 request ────────────────────────────────────────────────"
python3 qa/build_request.py "$RUN/request.json"

echo "── 4/5 Sigrún adapter (shipped src/lib) ───────────────────────"
node qa/adapters/sigrun/build.mjs || exit 1
node qa/adapters/sigrun/.build/cli.mjs "$RUN/request.json" "$RUN/adapter.json" || exit 1

echo "── 5/5 reference engine + comparator ──────────────────────────"
python3 qa/reference/engine.py "$RUN/request.json" "$RUN/reference.json" || exit 1
python3 qa/compare.py "$RUN/adapter.json" "$RUN/reference.json" qa/cases qa/reports qa/datasets
