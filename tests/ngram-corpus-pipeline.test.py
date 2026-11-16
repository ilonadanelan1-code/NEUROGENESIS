#!/usr/bin/env python3
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "prepare-corpus.py"

def main():
    with tempfile.TemporaryDirectory(prefix="ngram-corpus-test-") as temp:
        root = Path(temp)
        news = root / "news-sentences.txt"
        news_rows = [
            "1\tВчера исследователи представили новую систему обработки данных",
            "2\tНовая система обработки данных прошла независимую проверку",
            "3\tУчёные сообщили о результатах большого эксперимента",
            "4\tКоманда разработчиков улучшила качество поиска информации",
            "5\tСегодня опубликованы результаты исследования русского языка",
            "6\tНовая версия программы сохраняет результаты эксперимента",
            "7\tИсследователи проверили качество статистической модели",
            "8\tСистема анализирует слова слева и справа от пропуска",
            "9\tУчёные подготовили новый открытый набор данных",
            "10\tКоманда проверила качество предсказания на тестовой выборке",
            "11\tНовый алгоритм учитывает порядок слов в предложении",
            "12\tРезультаты эксперимента опубликованы сегодня утром",
        ]
        news.write_text("\n".join(news_rows) + "\n", encoding="utf-8")
        ruslit = root / "RusLit-main"
        ruslit.mkdir()
        for i in range(12):
            work = ruslit / "prose" / f"work-{i:02d}.txt"
            work.parent.mkdir(parents=True, exist_ok=True)
            work.write_text(
                f"Это отдельное литературное произведение номер {i} содержит достаточно длинное предложение. "
                f"Автор описывает необычное событие номер {i} в далёком городе.\n",
                encoding="utf-8",
            )
        output = root / "split"
        subprocess.run(
            [sys.executable, str(SCRIPT), "--news", str(news), "--news-inv-so", str(news_inv_so),
             "--ruslit-dir", str(ruslit), "--output-dir", str(output), "--seed", "17"],
            check=True, capture_output=True, text=True,
        )
        required = [
            "news_train.txt", "news_val.txt", "news_test.txt",
            "lit_train.txt", "lit_val.txt", "lit_test.txt",
            "mixed_train.txt", "mixed_val.txt", "mixed_test.txt",
            "mixed_balanced_train.txt", "mixed_balanced_val.txt", "mixed_balanced_test.txt",
            "manifest.json",
        ]
        for name in required:
            assert (output / name).is_file(), name
        manifest = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
        assert manifest["protocol"] == "ngram-corpus-split-v3-source-grouped-news"
        mapping = manifest["news_source_mapping"]
        assert mapping["mapping_rows"] == 13
        assert mapping["mapped_sentences"] == 12
        assert mapping["source_components"] == 5
        assert manifest["news_row_counters"]["source_unmapped_rows"] == 0
        news_splits = {
            split: set((output / f"news_{split}.txt").read_text(encoding="utf-8").splitlines())
            for split in ("train", "val", "test")
        }
        for group_sentences in [
            {" ".join(re.findall(r"[^\\W_]+", row.split("\\t", 1)[1].casefold().replace("ё", "е")))
             for row in news_rows[:2]},
            {" ".join(re.findall(r"[^\\W_]+", row.split("\\t", 1)[1].casefold().replace("ё", "е")))
             for row in news_rows[2:4]},
            {" ".join(re.findall(r"[^\\W_]+", row.split("\\t", 1)[1].casefold().replace("ё", "е")))
             for row in news_rows[4:6]},
            {" ".join(re.findall(r"[^\\W_]+", row.split("\\t", 1)[1].casefold().replace("ё", "е")))
             for row in news_rows[6:8]},
            {" ".join(re.findall(r"[^\\W_]+", row.split("\\t", 1)[1].casefold().replace("ё", "е")))
             for row in news_rows[8:10]},
            {" ".join(re.findall(r"[^\\W_]+", row.split("\\t", 1)[1].casefold().replace("ё", "е")))
             for row in news_rows[10:12]},
        ]:
            present = [split for split, rows in news_splits.items() if group_sentences & rows]
            assert len(present) == 1, (group_sentences, present)
        # Sentence 1 maps to two source IDs; both source IDs must be merged,
        # so sentence 2 from source 100 cannot leak into another split.
        assignments = manifest["work_files"]
        assert sum(assignments.values()) == 12
        assert assignments["train"] >= 1 and assignments["val"] >= 1 and assignments["test"] >= 1
        all_splits = []
        for split in ("train", "val", "test"):
            all_splits.append(set((output / f"lit_{split}.txt").read_text(encoding="utf-8").splitlines()))
        assert not (all_splits[0] & all_splits[1])
        assert not (all_splits[0] & all_splits[2])
        assert not (all_splits[1] & all_splits[2])
        news_counts = [
            manifest["counts"]["news_train"], manifest["counts"]["news_val"], manifest["counts"]["news_test"]
        ]
        assert sum(news_counts) > 0
        balanced_train = (output / "mixed_balanced_train.txt").read_text(encoding="utf-8").splitlines()
        assert len(balanced_train) == 2 * min(
            manifest["counts"]["news_train"], manifest["counts"]["lit_train"]
        )
        print("ngram corpus pipeline tests passed")

if __name__ == "__main__":
    main()
