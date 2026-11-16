"""Build source-attributed, direct synonym records without changing either word bank.

Python's standard library reads the DOCX. Node reuses the existing GRE800 lexical
annotations; no dictionary lookup, API call, stemming, or transitive expansion is
performed. --audit-pdf additionally checks the 1400 source with PyMuPDF.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import unicodedata
from urllib.parse import quote
import xml.etree.ElementTree as ET
import zipfile

APP = Path(__file__).resolve().parents[1]
ROOT = APP.parent
DIST = APP / "dist"
MATERIALS = ROOT / "materials" / "vocabulary"
DOCX = MATERIALS / "GRE同义近义词.docx"
PDF1400 = MATERIALS / "学而思GRE急救1400词2026版.pdf"
REPORT = APP / "scripts" / "words1400-relations-report.json"

# These records remain verbatim in the report, but are not presented as reliable
# synonym evidence. No replacement word or meaning is invented for them.
DOCX_REVIEW = {
    frozenset(("comprehensive", "generic")): "原表把 comprehensive/generic 合并为普遍或全面，适用义项待核对。",
    frozenset(("contemptuous", "polemical")): "原表以“挑战的”连接两词，近义关系及中文义项待核对。",
    frozenset(("deflate", "soothe")): "原表以“使缩小”连接两词，词义对应待核对。",
    frozenset(("deviate", "mislead")): "原表以“偏离”连接两词，词义及用法对应待核对。",
    frozenset(("dichotomous", "contradictory")): "原表以“自相矛盾的”连接两词，词义范围待核对。",
    frozenset(("enamored", "favored")): "原表以“受喜爱的”连接两词，主动与被动含义待核对。",
    frozenset(("fixated on", "bothered by")): "原表以“被关注”连接两短语，含义对应待核对。",
    frozenset(("hypocrite", "sycophant")): "原表以“奉承者”连接两词，含义对应待核对。",
    frozenset(("inscrutable", "uninformative")): "原表以“神秘的”连接两词，含义对应待核对。",
    frozenset(("insular", "private")): "原表以“隐蔽的”连接两词，含义对应待核对。",
    frozenset(("overlook", "vilify")): "原表以“轻视”连接两词，含义对应待核对。",
    frozenset(("paucity", "vacuousness")): "原表以“空虚”连接两词，含义对应待核对。",
    frozenset(("pugnacious", "irascibly")): "原表形容词组中混有副词 irascibly；保留原文待核对，不改写词形。",
    frozenset(("susceptibility", "characteristic")): "原表以“状况；特征”连接两词，含义对应待核对。",
    frozenset(("unique", "clear-cut")): "原表以“明确的”连接两词，含义对应待核对。",
    frozenset(("universality", "persistence")): "原表以“普遍性”连接两词，含义对应待核对。",
    frozenset(("vilified", "overlooked")): "原表以“忽略的”连接两词，含义对应待核对。",
}


def load(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def norm(value):
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", str(value))).strip().lower().replace("’", "'")


def source_url(filename):
    return "../../materials/vocabulary/" + quote(filename)


def positions(value):
    return set("v" if p in ("vi", "vt") else p for p in re.findall(r"\b(adj|adv|conj|vi|vt|n|v)\b", value.lower()))


def read_docx(path):
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    with zipfile.ZipFile(path) as archive:
        document = ET.fromstring(archive.read("word/document.xml"))
    paragraphs = ["".join(t.text or "" for t in p.findall(".//w:t", ns)).strip()
                  for p in document.findall(".//w:p", ns)]
    groups, pending, current_list, current_unit = [], [], None, None
    for paragraph, value in enumerate(paragraphs, 1):
        if not value:
            continue
        heading = re.fullmatch(r"(List|Unit)\s*(\d+)", value)
        if heading:
            assert not pending, (paragraph, pending)
            if heading[1] == "List":
                current_list = int(heading[2])
            else:
                current_unit = int(heading[2])
            continue
        if value.startswith("GRE "):
            assert paragraph == 1
            continue
        if re.search(r"[\u3400-\u9fff]", value):
            if pending:
                assert len(pending) == 2, (paragraph, pending, value)
                groups.append({"id": f"docx-{len(groups) + 1:04d}",
                               "words": [p["text"] for p in pending],
                               "meaning": value, "list": current_list, "unit": current_unit,
                               "paragraphs": pending + [{"number": paragraph, "text": value}],
                               "meaningParagraphs": [paragraph]})
                pending = []
            else:
                assert groups, (paragraph, value)
                groups[-1]["meaning"] += value
                groups[-1]["meaningParagraphs"].append(paragraph)
                groups[-1]["paragraphs"].append({"number": paragraph, "text": value})
        else:
            assert re.fullmatch(r"[A-Za-z][A-Za-z '\-’]*", value), (paragraph, value)
            pending.append({"number": paragraph, "text": value})
    assert not pending
    return paragraphs, groups


def read_lexicon():
    script = """const fs = require('node:fs');
const words = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
const index = require(process.argv[2]).buildIndex(words);
process.stdout.write(JSON.stringify({relations:index.relations,flags:index.flags,stats:index.stats}));"""
    result = subprocess.run(["node", "-e", script, str(DIST / "words.json"), str(DIST / "lexicon.js")],
                            check=True, capture_output=True, encoding="utf-8")
    return json.loads(result.stdout)


def pdf_audit(words, module_path=None):
    if module_path:
        sys.path.insert(0, module_path)
    import pymupdf
    markers, sense_count = [], 0
    with pymupdf.open(PDF1400) as document:
        for page_index, page in enumerate(document):
            text = page.get_text()
            for match in re.finditer(r"GRE考场已累计考过\s*(\d+)\s*次\s*\n([^\n]+)", text):
                markers.append((page_index + 1, match[2].strip(), int(match[1])))
            sense_count += len(re.findall(r"考法\s*\d+", text))
    expected = [(w["page"], w["word"], w["sourceFrequency"]) for w in words]
    assert markers == expected, "PDF headword/page/frequency markers differ from the 1400 data"
    assert sense_count == sum(len(w["definitions"]) for w in words)
    return {"sourceSha256": hashlib.sha256(PDF1400.read_bytes()).hexdigest(),
            "matchedHeadwordPageFrequencyMarkers": len(markers), "sourceSenseLabels": sense_count,
            "mismatchCount": 0, "method": "PyMuPDF 原 PDF 全页词头、页码、考频标记逐条比对；考法标记计数"}


def build(audit=False, module_path=None):
    words = load(DIST / "words1400.json")
    original = load(DIST / "words.json")
    equivalence = load(DIST / "equivalence-pairs.json")
    lexicon = read_lexicon()
    names = {norm(word["word"]): word for word in words}
    original_ids = {str(word["id"]): word for word in original}
    known_pos = {}
    for word in original + words:
        key = norm(word["word"])
        known_pos.setdefault(key, set()).update(positions(" ".join(d.get("pos", "") for d in word["definitions"])))
    by_id = {word["id"]: [] for word in words}
    counts = {}

    def append(headword, record, allow_article=False):
        key = norm(headword)
        if allow_article:
            key = re.sub(r"^(?:a|an|the) ", "", key)
        target = names.get(key)
        if not target:
            return
        assert record["words"] and record["meaning"] and record["sourceUrl"]
        record["matchedSourceTerm"] = headword
        if key != norm(headword):
            record["matchNormalization"] = "仅移除来源词项开头的 a/an/the；展示保留来源原文"
        by_id[target["id"]].append(record)
        counts[record["sourceType"]] = counts.get(record["sourceType"], 0) + 1

    # Each PDF row explicitly pairs two terms. Article removal is limited to
    # matching an exact headword; no plural/suffix/derivative normalization.
    for group in equivalence["groups"]:
        if group.get("needsReview"):
            continue
        terms = [term["word"] for term in group["words"]]
        for i, term in enumerate(terms):
            append(term, {"id": "equivalence:" + group["id"], "sourceType": "equivalence",
                          "words": terms[:i] + terms[i + 1:], "meaning": group["meaning"],
                          "sourceTitle": equivalence["title"], "sourceUrl": equivalence["sourceUrl"],
                          "page": group["page"], "printedPage": group.get("printedPage"),
                          "sourceLabel": f"PDF 第 {group['page']} 页 · 第 {group['row']} 组",
                          "sourceGroupId": group["id"], "sourceWords": terms}, allow_article=True)

    # Original800 definitions assert headword -> listed synonyms. Preserve this
    # direction; do not invent links between two listed synonyms or reverse links.
    source_senses = {}
    for relation in lexicon["relations"]:
        if relation["status"] not in ("usable", "external"):
            continue
        source_senses.setdefault((relation["wordId"], relation["senseIndex"]), []).append(relation)
    for (word_id, sense_index), relations in source_senses.items():
        word = original_ids[word_id]
        definition = word["definitions"][sense_index]
        append(word["word"], {"id": f"gre800:{word_id}:{sense_index}", "sourceType": "gre800",
                              "words": [r["token"] for r in relations], "meaning": definition["meaning"],
                              "pos": definition.get("pos", ""), "english": definition.get("english", ""),
                              "sourceTitle": "GRE800词", "sourceUrl": source_url("《GRE800词 》.pdf"),
                              "page": word["page"], "sourceLabel": f"{word['word']} · 考法 {sense_index + 1} · PDF 第 {word['page']} 页",
                              "sourceWordId": word_id, "sourceHeadword": word["word"], "senseIndex": sense_index,
                              "sourceSynonyms": definition["synonyms"], "relationKeys": [r["key"] for r in relations]})

    paragraphs, docx_groups = read_docx(DOCX)
    for group in docx_groups:
        reasons = []
        annotation = DOCX_REVIEW.get(frozenset(norm(w) for w in group["words"]))
        if annotation:
            reasons.append(annotation)
        source_pos = positions(group["meaning"].split(".", 1)[0])
        if source_pos:
            for word in group["words"]:
                available = known_pos.get(norm(word), set())
                if available and not source_pos.intersection(available):
                    reasons.append(f"原组词性 {','.join(sorted(source_pos))} 与现有词库 {word} 的已收录词性 {','.join(sorted(available))} 不符；不推测未收录义项。")
        group["needsReview"] = bool(reasons)
        if reasons:
            group["reviewReasons"] = reasons
            continue
        first, last = group["paragraphs"][0]["number"], group["paragraphs"][-1]["number"]
        for i, term in enumerate(group["words"]):
            append(term, {"id": "docx:" + group["id"], "sourceType": "docx",
                          "words": group["words"][:i] + group["words"][i + 1:], "meaning": group["meaning"],
                          "sourceTitle": "GRE 填空同义、近义词汇总（GRE同义近义词.docx）",
                          "sourceUrl": source_url(DOCX.name),
                          "sourceLabel": f"List {group['list']} · Unit {group['unit']} · 段落 {first}–{last}",
                          "sourceGroupId": group["id"], "sourceWords": group["words"],
                          "paragraphStart": first, "paragraphEnd": last,
                          "sourceParagraphs": group["paragraphs"]})

    frequency = [word["sourceFrequency"] for word in words]
    ordering = {"order": "原书考频降序；同频保留原书顺序", "nonIncreasing": all(a >= b for a, b in zip(frequency, frequency[1:])),
                "maximum": max(frequency), "minimum": min(frequency), "ties": sum(a == b for a, b in zip(frequency, frequency[1:])),
                "frequencyMeaning": "原资料标注的累计出现次数，未作为独立考试统计核验"}
    assert ordering["nonIncreasing"]
    report = {
        "version": 1,
        "inputs": {str(path.relative_to(ROOT)).replace('\\', '/'): hashlib.sha256(path.read_bytes()).hexdigest()
                   for path in (DIST / "words1400.json", DIST / "words.json", DIST / "lexicon.js", DIST / "equivalence-pairs.json", DOCX)},
        "wordCount": len(words), "definitionCountPreserved": sum(len(w["definitions"]) for w in words),
        "ordering": ordering,
        "coverage": {"wordsWithRelations": sum(bool(items) for items in by_id.values()),
                     "relationRecords": sum(len(items) for items in by_id.values()), "recordsBySource": counts,
                     "wordsBySource": {source: sum(any(r["sourceType"] == source for r in records) for records in by_id.values()) for source in counts}},
        "equivalence": {"totalGroups": len(equivalence["groups"]),
                        "excludedGroups": [g for g in equivalence["groups"] if g.get("needsReview")]},
        "gre800": {"lexiconStats": lexicon["stats"], "excludedRelations": [r for r in lexicon["relations"] if r["status"] == "excluded"]},
        "docx": {"paragraphCount": len(paragraphs), "groupCount": len(docx_groups),
                 "eligibleGroupCount": sum(not g["needsReview"] for g in docx_groups),
                 "continuedMeaningCount": sum(len(g["meaningParagraphs"]) > 1 for g in docx_groups),
                 "groups": docx_groups},
        "policy": ["仅关联有直接来源的近义词；不推断传递关系，不从 relatedWords、形近词或派生词生成同义词。",
                   "GRE800 只保留原主词到原近义词栏的方向；词库内禁用注释同样适用，库外词按原文展示。",
                   "等价 PDF 及 DOCX 的两词原组可分别关联其成员；不同组不合并，不推断组内词与其他近义词等价。",
                   "关系释义归属该来源的原组/原考法，不覆盖或删减 1400 原书释义。",
                   "除等价 PDF 的开头 a/an/the 外，只匹配大小写、空白、弯引号归一后的完整词形；不做词形还原。",
                   "DOCX 原有重复字、部首字形及跨段释义保留；待核验组原文完整保存在本报告。"],
        "contentRisks": ["保留全部 1400 个词条、1892 个原考法；独立关系文件不改写原词库。",
                         "1400 原书未提供的英文释义、音标或助记保持缺失，详见 words1400-extraction-report.json。",
                         "sourceText、sourceLabel、sourceNotes 是原考法核查依据；显示表格时须遍历全部 definitions，不使用仅首义或省略号截断。",
                         "1400 原书 relatedWords 同时包含派生词/相关词，不能直接当作同义词。",
                         "词义有语境范围，来源近义组不代表所有考法可互换。"]
    }
    if audit:
        report["pdfAudit"] = pdf_audit(words, module_path)
    elif REPORT.exists():
        previous = load(REPORT).get("pdfAudit")
        if previous and previous["sourceSha256"] == hashlib.sha256(PDF1400.read_bytes()).hexdigest():
            report["pdfAudit"] = previous
    payload = {"version": 1, "title": "GRE1400 有来源的近义词与等价词", "byId": by_id,
               "stats": report["coverage"], "policy": report["policy"]}
    (DIST / "words1400-relations.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (DIST / "words1400-relations.js").write_text("window.GRE1400_RELATIONS = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"coverage": report["coverage"], "docxGroups": len(docx_groups),
                      "docxEligible": report["docx"]["eligibleGroupCount"], "ordering": ordering,
                      "pdfAudit": report.get("pdfAudit")}, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audit-pdf", action="store_true")
    parser.add_argument("--pdf-module-path", help="Optional directory containing PyMuPDF for the source audit")
    args = parser.parse_args()
    build(args.audit_pdf, args.pdf_module_path)
