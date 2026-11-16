"""Extract the supplied 2026 GRE 1400 PDF without OCR or generated definitions.

Requires PyMuPDF. The bilingual fields have distinct PDF text styles; using
those styles avoids guessing where Chinese text containing English ends.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import sys
from urllib.parse import quote

try:
    import pymupdf
except ImportError:
    # Optional local tooling directory used for this extraction; not needed by
    # the website. A normal `pip install pymupdf` also works.
    helper = Path("C:/Temp/gre-pdf-export-tools")
    if helper.is_dir():
        sys.path.insert(0, str(helper))
    import pymupdf

ROOT = Path(__file__).resolve().parents[2]
TITLE = "学而思GRE急救1400词（2026版）"
FILENAME = "学而思GRE急救1400词2026版.pdf"
MARKER = re.compile(r"GRE考场已累计考过\s+(\d+)\s+次")
SENSE = re.compile(r"(?:特殊)?考法\d+")
CJK = re.compile(r"[\u3400-\u9fff]")
POS_COLOR, MEANING_COLOR, ENGLISH_COLOR = 6976130, 1054760, 3555667


def text_lines(page):
    return [
        {"text": "".join(s["text"] for s in line["spans"]).strip(),
         "spans": line["spans"]}
        for block in page.get_text("dict")["blocks"]
        for line in block.get("lines", [])
    ]


def chinese_join(parts):
    """Remove physical line breaks, retaining spaces between Latin words."""
    result = ""
    for part in parts:
        part = part.strip()
        if not part:
            continue
        separator = " " if result and re.search(r"[A-Za-z0-9]$", result) and re.match(r"[A-Za-z0-9]", part) else ""
        result += separator + part
    return result


def english_join(parts):
    return re.sub(r"\s+", " ", " ".join(part.strip() for part in parts)).strip()


def parse_definition(lines, label, word, page, notes):
    fields = {POS_COLOR: [], MEANING_COLOR: [], ENGLISH_COLOR: []}
    for line in lines:
        for color in fields:
            value = "".join(span["text"] for span in line["spans"] if span["color"] == color)
            if value.strip():
                fields[color].append(value)
        unknown = [span for span in line["spans"] if span["text"].strip() and span["color"] not in fields]
        if unknown:
            raise ValueError(f"Unexpected definition style: p{page} {word} {label}")
    raw_pos = "".join(fields[POS_COLOR]).strip()
    pos = re.sub(r"\.{2,}", ".", raw_pos)
    meaning = chinese_join(fields[MEANING_COLOR])
    english = english_join(fields[ENGLISH_COLOR])
    source_text = "\n".join(line["text"] for line in lines)
    if not CJK.search(meaning) and CJK.search(english):
        # Three literal source layout exceptions: grant's phrase and two
        # duplicate POS labels whose actual Chinese text occupies the small
        # English-text style. No replacement wording is generated.
        if word == "grant" and label == "考法3" and pos == "短语.":
            meaning, english = english, meaning
            notes.append({"word": word, "page": page, "field": label,
                          "note": "原书短语及中文释义使用通常中英释义的相反字体，按实际语言归入对应字段。"})
        elif word in {"appeal", "revise"} and label == "特殊考法1" and meaning == pos:
            meaning, english = english, ""
            notes.append({"word": word, "page": page, "field": label,
                          "note": "原书重复标注词性，实际中文含义位于小字栏；合并重复词性并保留原中文，不补英文。"})
        else:
            raise ValueError(f"Unreviewed bilingual style exception: p{page} {word} {label}")
    if not pos or not meaning or not CJK.search(meaning):
        raise ValueError(f"Missing POS/Chinese meaning: p{page} {word} {label}")
    if CJK.search(english):
        if word == "constricted" and label == "考法1" and english == "drawn together or squeezed紧":
            notes.append({"word": word, "page": page, "field": label,
                          "note": "原书英文释义末尾混入汉字“紧”，保留原文并标为待核对。"})
        else:
            raise ValueError(f"Chinese text unexpectedly in English definition: p{page} {word} {label}")
    return {"sourceLabel": label, "pos": pos, "meaning": meaning,
            "english": english, "sourceText": source_text}


def extract(source):
    document = pymupdf.open(source)
    words, page_counts, notes = [], [], []
    source_url = "../../materials/vocabulary/" + quote(FILENAME)
    for page_index, page in enumerate(document):
        page_number = page_index + 1
        lines = text_lines(page)
        starts = [i for i, line in enumerate(lines) if MARKER.fullmatch(line["text"])]
        page_counts.append(len(starts))
        if not starts:
            if page_number > 2:
                raise ValueError(f"Missing content page: {page_number}")
            continue
        if len(starts) != 5:
            raise ValueError(f"Expected five words on page {page_number}, got {len(starts)}")
        section = re.search(r"List\s+(\d+)\s*·\s*Unit\s+(\d+)", page.get_text())
        if not section:
            raise ValueError(f"Missing List/Unit on page {page_number}")
        group, unit = map(int, section.groups())
        for begin, end in zip(starts, starts[1:] + [len(lines)]):
            chunk = lines[begin:end]
            frequency = int(MARKER.fullmatch(chunk[0]["text"]).group(1))
            word = chunk[1]["text"]
            phonetic = "" if chunk[2]["text"] == "复习遍数" else chunk[2]["text"]
            if phonetic and (not phonetic.startswith("/") or not phonetic.endswith("/")):
                raise ValueError(f"Unexpected headword/phonetic: p{page_number} {word}")
            labels = [(i, line["text"]) for i, line in enumerate(chunk) if SENSE.fullmatch(line["text"])]
            memory = next(i for i, line in enumerate(chunk) if line["text"] == "助记")
            related = next((i for i, line in enumerate(chunk) if line["text"] == "相关词"), len(chunk))
            definitions = []
            for index, (start, label) in enumerate(labels):
                stop = labels[index + 1][0] if index + 1 < len(labels) else memory
                definitions.append(parse_definition(chunk[start + 1:stop], label, word, page_number, notes))
            if not definitions:
                raise ValueError(f"No definitions for {word}")
            actual_labels = [label for _, label in labels]
            if actual_labels != [f"考法{i + 1}" for i in range(len(labels))]:
                notes.append({"word": word, "page": page_number,
                              "sourceLabels": actual_labels,
                              "note": "保留原书考法编号及顺序，不补缺号、不重编号。"})
            mnemonic = chinese_join(line["text"] for line in chunk[memory + 1:related])
            related_words = "\n".join(line["text"] for line in chunk[related + 1:]).strip()
            meanings = list(dict.fromkeys(item["meaning"] for item in definitions))
            positions = list(dict.fromkeys(item["pos"] for item in definitions))
            if word == "admitedly":
                notes.append({"word": word, "page": page_number,
                              "note": "原书主词拼写为 admitedly；常见拼写为 admittedly，此处保留原文并标为待核对。"})
            words.append({
                "id": f"x1400-{len(words) + 1:04d}", "word": word,
                "pos": "/".join(positions), "meaning": "；".join(meanings),
                "page": page_number, "group": group, "unit": unit,
                "phonetic": phonetic, "sourceFrequency": frequency,
                "mnemonic": mnemonic, "relatedWords": related_words,
                "definitions": definitions, "sourceTitle": TITLE,
                "sourceUrl": source_url,
                "sourceNotes": [note["note"] for note in notes if note["word"] == word],
            })
    assert len(document) == 282, len(document)
    assert len(words) == 1400, len(words)
    assert len({word["id"] for word in words}) == 1400
    assert len({word["word"].casefold() for word in words}) == 1400
    groups = Counter(word["group"] for word in words)
    units = Counter((word["group"], word["unit"]) for word in words)
    assert dict(groups) == {i: 100 for i in range(1, 15)}, groups
    assert dict(units) == {(g, u): 10 for g in range(1, 15) for u in range(1, 11)}, units
    assert not any("\ufffd" in json.dumps(word, ensure_ascii=False) for word in words)
    plain_headwords, plain_sense_count = [], 0
    for page_index, page in enumerate(document):
        text = page.get_text()
        plain_headwords.extend((page_index + 1, match.group(1)) for match in re.finditer(
            r"GRE考场已累计考过\s+\d+\s+次\s*\n([^\n]+)", text))
        plain_sense_count += len(re.findall(r"^(?:特殊)?考法\d+$", text, re.M))
    assert plain_headwords == [(word["page"], word["word"]) for word in words]
    assert plain_sense_count == sum(len(word["definitions"]) for word in words)
    for marker in ["GRE考场已累计考过", "ETS官方合作伙伴", "只学核心母题", "复习遍数", "学而思国际GRE"]:
        assert all(marker not in word["meaning"] + word["mnemonic"] + word["relatedWords"] for word in words)
    report = {
        "source": "materials/vocabulary/" + FILENAME,
        "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "extractedAt": datetime.now(timezone.utc).isoformat(),
        "pdfPages": len(document), "contentPages": 280, "coverPages": [1, 2],
        "wordCount": len(words), "uniqueHeadwords": len({word["word"].casefold() for word in words}),
        "definitionCount": sum(len(word["definitions"]) for word in words),
        "mnemonicCount": sum(bool(word["mnemonic"]) for word in words),
        "mnemonicsMissingInSource": [{"word": word["word"], "page": word["page"]} for word in words if not word["mnemonic"]],
        "relatedWordSections": sum(bool(word["relatedWords"]) for word in words),
        "phoneticsMissingInSource": [{"word": word["word"], "page": word["page"]} for word in words if not word["phonetic"]],
        "englishDefinitionsMissingInSource": [
            {"word": word["word"], "page": word["page"], "sourceLabel": definition["sourceLabel"]}
            for word in words for definition in word["definitions"] if not definition["english"]
        ],
        "wordsPerPage": page_counts, "wordsPerList": dict(groups),
        "units": [{"list": g, "unit": u, "words": n} for (g, u), n in units.items()],
        "normalizations": [
            "词性重复句点（如 adj..）统一为 adj.；中文、英文使用原PDF字体/颜色边界拆分。",
            "仅连接排版换行；所有考法、助记、相关词原文均保留，不生成释义、例句或近义词。",
            "标题中的考场累计出现次数仅以 sourceFrequency 记录为原资料声明，不作独立核验。",
        ],
        "sourceNotes": notes,
        "validation": {"headwordOrderMatchesPlainText": True,
                       "definitionCountMatchesPlainText": True,
                       "all140ListUnitsHave10Words": True,
                       "headerFooterAndReviewMarksExcluded": True,
                       "replacementCharacters": 0},
    }
    return words, report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=ROOT / "materials/vocabulary" / FILENAME)
    args = parser.parse_args()
    words, report = extract(args.source)
    folder = ROOT / "gre800-cards/dist"
    folder.mkdir(exist_ok=True)
    serialized = json.dumps(words, ensure_ascii=False, indent=2)
    (folder / "words1400.json").write_text(serialized + "\n", encoding="utf-8")
    (folder / "words1400.js").write_text("window.GRE_WORDS_1400 = " + json.dumps(words, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    (ROOT / "gre800-cards/scripts/words1400-extraction-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: report[key] for key in ("pdfPages", "wordCount", "uniqueHeadwords", "definitionCount", "mnemonicCount", "relatedWordSections", "englishDefinitionsMissingInSource")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
