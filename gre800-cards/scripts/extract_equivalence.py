"""Extract the supplied 2026 equivalence PDF with local Windows OCR.

Requires pymupdf, Pillow and Windows OCR en-US / zh-Hans-CN. The original PDF
contains page images, not text. Cached OCR is reusable via --cache; no API is
called and neither learning progress nor source files are modified.
"""
from __future__ import annotations

import argparse
import bisect
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import quote

try:
    import pymupdf
except ImportError:
    sys.path.insert(0, os.environ.get('GRE_PDF_PYTHONPATH', 'C:/Temp/gre-pdf-export-tools'))
    import pymupdf
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / 'gre800-cards'
TITLE = '学而思GRE高频六选二等价1000词（2026版）'
SOURCE = ROOT / 'materials/vocabulary' / (TITLE + '.pdf')

OCR_SCRIPT = r'''param([string]$ImagePath,[string]$OutputPath,[string]$Language='zh-Hans-CN')
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null=[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
$null=[Windows.Storage.Streams.IRandomAccessStream,Windows.Storage.Streams,ContentType=WindowsRuntime]
$null=[Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
$null=[Windows.Graphics.Imaging.SoftwareBitmap,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
$null=[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]
$null=[Windows.Media.Ocr.OcrResult,Windows.Foundation,ContentType=WindowsRuntime]
$null=[Windows.Globalization.Language,Windows.Globalization,ContentType=WindowsRuntime]
$taskMethod=[System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {$_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetGenericArguments().Count -eq 1} | Select-Object -First 1
function Await($operation,[Type]$resultType){$task=$taskMethod.MakeGenericMethod($resultType).Invoke($null,@($operation));$task.GetAwaiter().GetResult()}
$engine=[Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new($Language))
if(-not $engine){throw "Windows OCR language is unavailable: $Language"}
$file=Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($ImagePath)) ([Windows.Storage.StorageFile])
$stream=Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder=Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap=Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$result=Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
$lines=@($result.Lines | ForEach-Object {@{text=$_.Text;words=@($_.Words | ForEach-Object {@{text=$_.Text;x=$_.BoundingRect.X;y=$_.BoundingRect.Y;width=$_.BoundingRect.Width;height=$_.BoundingRect.Height}})}})
@{text=$result.Text;lines=$lines} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
$bitmap.Dispose();$stream.Dispose()
'''

# These are visual transcriptions of the supplied image, not inferred synonyms.
MEANING_REPAIRS = {
    (7, 8): '倾向', (10, 7): '不一致', (15, 1): '称赞', (17, 4): '取代',
    (18, 7): '让与', (18, 10): '与……一致', (23, 7): '简洁', (38, 6): '扩散',
    (45, 1): '融合', (45, 2): '复兴', (45, 3): '不一致', (45, 4): '让与',
    (47, 1): '称赞', (48, 7): '唯一的', (12, 3): '愤世嫉俗的',
    (4, 8): '以……为基础', (16, 2): '与……不相容', (39, 1): '与……相矛盾',
    (45, 9): '受……影响',
    (50, 7): '相称的，适合的', (51, 5): '排除，使无效',
}
REPEATED_PRINT = {(13, 9): ['feigned', 'false'], (27, 2): ['endemic', 'native'], (29, 9): ['allay', 'palliate']}
SOURCE_NOTES = {
    (3, 3): '原表印作 trivial，配套中文使用名词义；保留原词形，请结合原页核对。',
    (48, 10): '原表印作 foreswearing，拼写待核对；未自动替换为其他词形。',
    (41, 6): '原表中文栏印作“促进”，右侧例句使用收养幼崽的语境；保留中文栏并提示词义疑点。',
}


def prepare_images(cache: Path) -> None:
    doc = pymupdf.open(SOURCE)
    if len(doc) != 51:
        raise ValueError('Expected the original 51-page 2026 source; inspect changed material before rebuilding.')
    for page_number in range(2, 52):
        page = doc[page_number - 1]
        stream = b'\n'.join(doc.xref_stream(xref) for xref in page.get_contents())
        names = re.findall(rb'/([^\s/]+)\s+Do', stream)
        if len(names) != 1:
            raise ValueError(f'Page {page_number} does not contain one complete page image.')
        xref = next(image[0] for image in page.get_images() if image[7] == names[0].decode())
        image_path = cache / f'page-{page_number:02}.png'
        image_path.write_bytes(doc.extract_image(xref)['image'])
        image = Image.open(image_path)
        if image.size != (1588, 2246):
            raise ValueError(f'Page {page_number} has unexpected pixel dimensions {image.size}.')
        # Keep the entire height: some source pages have taller rows and no footer.
        image.crop((60, 210, 585, 2246)).save(cache / f'fullcols-{page_number:02}.png')


def ocr_page(cache: Path, page: int, language: str) -> None:
    target = cache / f'v2-{language}-{page:02}.json'
    if target.exists():
        return
    command = ['powershell', '-NoProfile', '-File', str(cache / 'ocr.ps1'),
               '-ImagePath', str(cache / f'fullcols-{page:02}.png'),
               '-OutputPath', str(target), '-Language', language]
    result = subprocess.run(command, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if result.returncode:
        raise RuntimeError(result.stderr)


def parse_page(cache: Path, page: int) -> list[dict]:
    data = {key: json.loads((cache / f'v2-{language}-{page:02}.json').read_text(encoding='utf-8-sig'))
            for key, language in [('en', 'en-US'), ('zh', 'zh-Hans-CN')]}
    anchors = sorted(word['y'] for line in data['zh']['lines'] for word in line['words']
                     if word['text'] == 'GRE' and word['x'] < 80)
    if len(anchors) != 10:
        raise ValueError(f'Page {page}: expected 10 frequency labels, found {len(anchors)}.')
    cells = [{'en': [], 'zh': []} for _ in anchors]
    for kind, recognized in data.items():
        for line in recognized['lines']:
            pieces = {}
            for word in line['words']:
                if kind == 'en' and (word['x'] >= 370 or not re.search('[A-Za-z&]', word['text'])):
                    continue
                if kind == 'zh' and word['x'] < 375:
                    continue
                center = word['y'] + word['height'] / 2
                row = bisect.bisect_right(anchors, center) - 1
                if row < 0 or center < anchors[row] + 23 or row == 9 and center > anchors[-1] + 145:
                    continue
                pieces.setdefault(row, []).append(word)
            for row, words in pieces.items():
                cells[row][kind].append(' '.join(word['text'] for word in sorted(words, key=lambda word: word['x'])))
    result = []
    for row, cell in enumerate(cells, 1):
        joined = ' '.join(cell['en'])
        words = [part.strip() for part in (joined.split('&') if '&' in joined else cell['en'])]
        meaning = ''.join(cell['zh']).replace(' ', '')
        result.append({'page': page, 'row': row, 'words': words, 'meaning': meaning})
    return result


def write_data(cache: Path) -> dict:
    groups, repairs, source_notes = [], [], []
    for page in range(2, 52):
        for raw in parse_page(cache, page):
            location = (page, raw['row'])
            words, meaning = raw['words'], raw['meaning']
            if location in MEANING_REPAIRS:
                fixed = MEANING_REPAIRS[location]
                if meaning != fixed:
                    repairs.append({'page': page, 'row': raw['row'], 'field': 'meaning', 'ocr': meaning, 'sourceReading': fixed})
                meaning = fixed
            if location in REPEATED_PRINT:
                words = REPEATED_PRINT[location]
                repairs.append({'page': page, 'row': raw['row'], 'field': 'words', 'ocr': raw['words'],
                                'sourceReading': words, 'note': '原页同一行重复排印已列出的词，保留两个不同词。'})
            if len(words) != 2 or any(not re.fullmatch(r"[A-Za-z]+(?:[ '-][A-Za-z]+)*", word) for word in words) or not meaning:
                raise ValueError(f'Unresolved OCR cell: {raw}')
            number = len(groups) + 1
            group = {'id': f'eq-{number:04}', 'page': page, 'printedPage': page - 1,
                     'row': raw['row'], 'meaning': meaning, 'words': [{'word': word} for word in words]}
            if location in SOURCE_NOTES:
                group['needsReview'] = True
                group['sourceNote'] = SOURCE_NOTES[location]
                source_notes.append({'groupId': group['id'], 'page': page, 'row': raw['row'], 'note': group['sourceNote']})
            groups.append(group)
    assert len(groups) == 500
    data = {'version': 1, 'title': TITLE, 'sourceUrl': quote('../../materials/vocabulary/' + TITLE + '.pdf', safe='/'),
            'sourcePages': 51, 'groupCount': len(groups), 'eligibleGroupCount': sum(not group.get('needsReview') for group in groups), 'wordOccurrences': sum(len(group['words']) for group in groups),
            'uniqueTerms': len({word['word'].casefold() for group in groups for word in group['words']}),
            'description': '原资料50个词表页，每页10组；保留原文词形、短语、释义及PDF页码。等价关系只按所列语境使用。',
            'groups': groups}
    encoded = json.dumps(data, ensure_ascii=False, indent=2)
    (APP / 'dist/equivalence-pairs.json').write_text(encoded + '\n', encoding='utf-8')
    (APP / 'dist/equivalence-pairs.js').write_text('window.GRE_EQUIVALENCE_DATA = ' + encoded + ';\n', encoding='utf-8')
    report = {'source': str(SOURCE.relative_to(ROOT)), 'sourceSHA256': hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
              'sourcePages': 51, 'textPages': 0, 'tablePages': 50, 'groupsPerPage': 10,
              'groups': len(groups), 'eligibleGroups': data['eligibleGroupCount'], 'wordOccurrences': data['wordOccurrences'], 'uniqueTerms': data['uniqueTerms'],
              'method': '原生页图；Windows OCR en-US英文列 + zh-Hans-CN中文列；按每行频次标签定位，非固定行高。',
              'unresolvedRows': [], 'visualTranscriptionRepairs': repairs, 'sourceNotes': source_notes,
              'visualReview': ['全部解析异常格逐一目视原图', 'PDF 32–51页共200组由两位独立审阅者逐条比对',
                               '前中后三段完整页抽样，核对长短语、跨行、底部词条和源文重复排印']}
    (APP / 'scripts/equivalence-extraction-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return {key: data[key] for key in ['groupCount', 'wordOccurrences', 'uniqueTerms']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, default=Path('C:/Temp/gre-equivalence-ocr'))
    parser.add_argument('--cached-only', action='store_true', help='Parse existing OCR; do not rerun local OCR.')
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    fingerprint = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
    stamp = args.cache / 'source-sha256.txt'
    if stamp.exists():
        if stamp.read_text(encoding='ascii').strip() != fingerprint:
            raise ValueError('The OCR cache belongs to a different PDF. Use a new --cache directory.')
    elif any(args.cache.glob('v2-*.json')):
        raise ValueError('The existing OCR cache has no source fingerprint. Use a new --cache directory.')
    else:
        stamp.write_text(fingerprint + '\n', encoding='ascii')
    if not args.cached_only:
        (args.cache / 'ocr.ps1').write_text(OCR_SCRIPT, encoding='utf-8-sig')
        prepare_images(args.cache)
        with ThreadPoolExecutor(max_workers=3) as pool:
            tasks = [pool.submit(ocr_page, args.cache, page, language) for page in range(2, 52)
                     for language in ['en-US', 'zh-Hans-CN']]
            for task in as_completed(tasks):
                task.result()
    print(json.dumps(write_data(args.cache), ensure_ascii=False))
