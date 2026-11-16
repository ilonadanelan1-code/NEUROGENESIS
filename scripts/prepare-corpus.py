#!/usr/bin/env python3
"""Build deterministic, leakage-aware train/validation/test files for NEUROGENESIS N-gram experiments."""
from __future__ import annotations
import argparse
import hashlib
import json
import re
from pathlib import Path

TOKEN_RE = re.compile(r"[^\W_]+", re.UNICODE)
SPLITS = ("train", "val", "test")

def digest(seed: int, value: str) -> str:
    return hashlib.sha256((str(seed) + ":" + value).encode("utf-8")).hexdigest()

def normalize_sentence(raw: str):
    words = TOKEN_RE.findall(raw.casefold().replace("ё", "е"))
    if not 5 <= len(words) <= 40:
        return None
    cyrillic = sum(bool(re.search(r"[а-я]", word)) for word in words)
    if cyrillic / len(words) < 0.8:
        return None
    return " ".join(words)

def news_split(sentence: str, seed: int) -> str:
    value = int(digest(seed, "news:" + sentence)[:8], 16) / 0xFFFFFFFF
    return "train" if value < 0.70 else ("val" if value < 0.85 else "test")

def assign_work_splits(work_paths, root: Path, seed: int):
    ordered = sorted(work_paths, key=lambda p: digest(seed, "work:" + p.relative_to(root).as_posix()))
    count = len(ordered)
    if count < 3:
        raise ValueError(f"RusLit must contain at least 3 separate .txt work files; found {count}")
    n_test = max(1, round(count * 0.15))
    n_val = max(1, round(count * 0.15))
    while n_test + n_val >= count:
        if n_test >= n_val and n_test > 1:
            n_test -= 1
        elif n_val > 1:
            n_val -= 1
        else:
            break
    split_map = {}
    for path in ordered[:n_test]:
        split_map[path] = "test"
    for path in ordered[n_test:n_test + n_val]:
        split_map[path] = "val"
    for path in ordered[n_test + n_val:]:
        split_map[path] = "train"
    return split_map

def read_news(path: Path, seed: int):
    result = {name: [] for name in SPLITS}
    seen = set()
    with path.open("r", encoding="utf-8-sig", errors="replace") as stream:
        for line in stream:
            _sentence_id, sep, raw = line.rstrip("\r\n").partition("\t")
            if not sep:
                continue
            sentence = normalize_sentence(raw)
            if not sentence or sentence in seen:
                continue
            seen.add(sentence)
            result[news_split(sentence, seed)].append(sentence)
    return result

def read_literature(root: Path, seed: int):
    files = sorted(p for p in root.rglob("*.txt") if p.is_file() and p.name.lower() != "info.txt")
    if not files:
        raise ValueError(f"No .txt works found under {root}")
    assignments = assign_work_splits(files, root, seed)
    result = {name: [] for name in SPLITS}
    for path in files:
        split = assignments[path]
        raw = path.read_text(encoding="utf-8", errors="replace")
        for fragment in re.split(r"(?<=[.!?…])\s+|\n+", raw):
            sentence = normalize_sentence(fragment)
            if sentence:
                result[split].append(sentence)
    return result, assignments

def deduplicate_across_splits(news, lit, seed):
    """Exact duplicates are assigned once; training wins over validation, then test."""
    seen = set()
    cleaned = {"news": {name: [] for name in SPLITS}, "lit": {name: [] for name in SPLITS}}
    for split in SPLITS:
        for domain, source in (("news", news), ("lit", lit)):
            rows = sorted(set(source[split]), key=lambda s: digest(seed, "row:" + s))
            for sentence in rows:
                if sentence in seen:
                    continue
                seen.add(sentence)
                cleaned[domain][split].append(sentence)
    return cleaned

def balanced_rows(left, right, seed):
    limit = min(len(left), len(right))
    a = sorted(left, key=lambda s: digest(seed, "balanced-news:" + s))[:limit]
    b = sorted(right, key=lambda s: digest(seed, "balanced-lit:" + s))[:limit]
    return sorted(a + b, key=lambda s: digest(seed, "balanced-mix:" + s))

def write_lines(path: Path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(row + "\n" for row in rows), encoding="utf-8")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--news", required=True, type=Path, help="Leipzig *-sentences.txt file")
    parser.add_argument("--ruslit-dir", required=True, type=Path, help="Extracted RusLit root directory")
    parser.add_argument("--output-dir", default=Path("split"), type=Path)
    parser.add_argument("--seed", default=20261116, type=int)
    args = parser.parse_args()
    if not args.news.is_file():
        parser.error(f"News file not found: {args.news}")
    if not args.ruslit_dir.is_dir():
        parser.error(f"RusLit directory not found: {args.ruslit_dir}")

    news = read_news(args.news, args.seed)
    lit, work_splits = read_literature(args.ruslit_dir, args.seed)
    clean = deduplicate_across_splits(news, lit, args.seed)
    out = args.output_dir
    out.mkdir(parents=True, exist_ok=True)

    manifest = {
        "protocol": "ngram-corpus-split-v2",
        "seed": args.seed,
        "news_source": str(args.news),
        "ruslit_root": str(args.ruslit_dir),
        "literature_split_unit": "one .txt file per work; works are never split across subsets",
        "sentence_deduplication": "global exact normalized sentence deduplication; train has priority over val, val over test",
        "ratios": {"news": {"train": 0.70, "val": 0.15, "test": 0.15},
                   "literature": {"unit": "work files", "approx_train": 0.70, "approx_val": 0.15, "approx_test": 0.15}},
        "work_files": {name: sum(1 for value in work_splits.values() if value == name) for name in SPLITS},
        "counts": {}
    }
    for domain in ("news", "lit"):
        for split in SPLITS:
            rows = sorted(clean[domain][split], key=lambda s: digest(args.seed, domain + ":" + s))
            clean[domain][split] = rows
            write_lines(out / f"{domain}_{split}.txt", rows)
            manifest["counts"][f"{domain}_{split}"] = len(rows)
    for split in SPLITS:
        mixed = sorted(clean["news"][split] + clean["lit"][split],
                       key=lambda s: digest(args.seed, "mixed:" + split + ":" + s))
        write_lines(out / f"mixed_{split}.txt", mixed)
        balanced = balanced_rows(clean["news"][split], clean["lit"][split], args.seed)
        write_lines(out / f"mixed_balanced_{split}.txt", balanced)
        manifest["counts"][f"mixed_{split}"] = len(mixed)
        manifest["counts"][f"mixed_balanced_{split}"] = len(balanced)
    manifest["counts"]["literature_work_files"] = len(work_splits)
    manifest["counts"]["literature_work_assignments"] = manifest["work_files"]
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
