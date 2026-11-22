#!/usr/bin/env python3
"""Collect every qa/cases/*.json case into the single request both engines read."""
import glob
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def main() -> None:
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "_run", "request.json")
    cases = []
    for path in sorted(glob.glob(os.path.join(HERE, "cases", "*.json"))):
        with open(path, encoding="utf-8") as fh:
            payload = json.load(fh)
        for case in payload["cases"]:
            item = {k: case[k] for k in ("id", "op", "dataset", "args") if k in case}
            if case.get("adapterOnly"):
                item["adapterOnly"] = True
            cases.append(item)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as fh:
        json.dump({"datasetsDir": "qa/datasets", "cases": cases}, fh, ensure_ascii=False, indent=1)
    print(f"request: {len(cases)} cases → {out}")


if __name__ == "__main__":
    main()
