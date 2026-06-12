#!/usr/bin/env python3
"""
TurboVec sidecar runner.

Spawned by ContextChat's main process via electron/turbovec-store.ts. Uses
TurboQuant compression (Google Research / github.com/RyanCodrai/turbovec)
to store vectors at 2-bit or 4-bit, getting ~16× compression vs FP32 while
beating FAISS on search speed.

Protocol:
    add    --index PATH --dim N --bits {2,4}
           stdin: {"records": [{"id","content","source","chunkIndex","vector"}]}
    search --index PATH --dim N --bits {2,4} --top-k K
           stdin: {"query": [float, ...]}
           stdout: {"results": [{"id","content","source","chunkIndex","score"}]}
    delete --index PATH --source NAME

stderr is forwarded to the in-app log viewer.
exit 0 on success, non-zero on failure.
"""

import argparse
import json
import os
import sys
from pathlib import Path


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def load_metadata(index_path: Path) -> dict:
    """Sidecar metadata file: maps internal turbovec uint64 ids → record payloads."""
    meta_path = index_path.with_suffix(".meta.json")
    if meta_path.exists():
        return json.loads(meta_path.read_text(encoding="utf-8"))
    return {"records": {}, "next_id": 1}


def save_metadata(index_path: Path, meta: dict) -> None:
    meta_path = index_path.with_suffix(".meta.json")
    meta_path.write_text(json.dumps(meta), encoding="utf-8")


def cmd_add(args: argparse.Namespace) -> int:
    try:
        from turbovec import IdMapIndex
    except ImportError as e:
        log(f"[turbovec] import failed: {e}")
        log("[turbovec] install with: pip install turbovec")
        return 2

    import numpy as np

    payload = json.loads(sys.stdin.read())
    records = payload["records"]
    if not records:
        return 0

    index_path = Path(args.index)
    index_path.parent.mkdir(parents=True, exist_ok=True)

    meta = load_metadata(index_path)
    if index_path.exists():
        idx = IdMapIndex.load(str(index_path))
    else:
        idx = IdMapIndex(dim=args.dim, bit_width=args.bits)

    vectors = np.array([r["vector"] for r in records], dtype=np.float32)
    ids = []
    for r in records:
        nid = meta["next_id"]
        meta["next_id"] += 1
        ids.append(nid)
        meta["records"][str(nid)] = {
            "id": r["id"],
            "content": r["content"],
            "source": r["source"],
            "chunkIndex": r["chunkIndex"],
        }
    idx.add_with_ids(vectors, np.array(ids, dtype=np.uint64))

    idx.write(str(index_path))
    save_metadata(index_path, meta)
    log(f"[turbovec] added {len(records)} records")
    return 0


def cmd_search(args: argparse.Namespace) -> int:
    try:
        from turbovec import IdMapIndex
    except ImportError as e:
        log(f"[turbovec] import failed: {e}")
        return 2

    import numpy as np

    payload = json.loads(sys.stdin.read())
    query = np.array(payload["query"], dtype=np.float32)

    index_path = Path(args.index)
    if not index_path.exists():
        sys.stdout.write(json.dumps({"results": []}))
        return 0

    idx = IdMapIndex.load(str(index_path))
    meta = load_metadata(index_path)

    scores, hit_ids = idx.search(query, k=args.top_k)
    results = []
    for score, nid in zip(scores, hit_ids):
        rec = meta["records"].get(str(int(nid)))
        if not rec:
            continue
        results.append({
            "id": rec["id"],
            "content": rec["content"],
            "source": rec["source"],
            "chunkIndex": rec["chunkIndex"],
            "score": float(score),
        })

    sys.stdout.write(json.dumps({"results": results}))
    sys.stdout.flush()
    return 0


def cmd_delete(args: argparse.Namespace) -> int:
    try:
        from turbovec import IdMapIndex
    except ImportError as e:
        log(f"[turbovec] import failed: {e}")
        return 2

    index_path = Path(args.index)
    if not index_path.exists():
        return 0

    meta = load_metadata(index_path)
    idx = IdMapIndex.load(str(index_path))

    to_remove = [int(nid) for nid, rec in meta["records"].items()
                 if rec["source"] == args.source]
    for nid in to_remove:
        idx.remove(nid)
        meta["records"].pop(str(nid), None)

    idx.write(str(index_path))
    save_metadata(index_path, meta)
    log(f"[turbovec] deleted {len(to_remove)} records for source={args.source}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="TurboVec sidecar")
    sub = parser.add_subparsers(dest="cmd", required=True)

    add = sub.add_parser("add")
    add.add_argument("--index", required=True)
    add.add_argument("--dim", type=int, required=True)
    add.add_argument("--bits", type=int, default=2)

    search = sub.add_parser("search")
    search.add_argument("--index", required=True)
    search.add_argument("--dim", type=int, required=True)
    search.add_argument("--bits", type=int, default=2)
    search.add_argument("--top-k", type=int, default=5)

    delete = sub.add_parser("delete")
    delete.add_argument("--index", required=True)
    delete.add_argument("--source", required=True)

    args = parser.parse_args()

    try:
        if args.cmd == "add":
            return cmd_add(args)
        if args.cmd == "search":
            return cmd_search(args)
        if args.cmd == "delete":
            return cmd_delete(args)
    except Exception as e:  # noqa: BLE001
        log(f"[turbovec] error: {type(e).__name__}: {e}")
        return 1

    return 99


if __name__ == "__main__":
    sys.exit(main())
