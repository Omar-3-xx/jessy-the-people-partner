"""
Everything Jessy knows about the law, cut out of the law itself.

    python -I tools/build-law.py <the 142-page law PDF>

Reads the merged edition of Labour Law 14/2025 and the ministerial decrees under
each article, and writes src/lib/law/law-data.json: one record per law article,
per issuing article and per slice of a decree, each with the book and chapter it
sits in.

The PDF is the only source for the decrees, and only the decrees are taken from it.
Its copy of the law itself is unsafe: compared with the law firm of Alber Onsy's
published text, which cites Official Gazette 18 (continued) of 3 May 2025, it prints
twelve hours where Article 119 says ten, drops the "لا" of Article 143, stops Article
237 after its first paragraph and reverses Articles 120 and 147. So the law and its
issuing articles come from tools/law-text.json (tools/import-law-text.mjs).
tools/law-corrections.json holds every change made to a decree's printed words, so a
repair is never silent and a corrected figure is refused outright.

The run fails rather than ship a law with a hole in it: all 298 articles must be
present, in order, and every correction must still find its text.
"""

import json
import re
import sys
from pathlib import Path

import pypdf

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'src' / 'lib' / 'law' / 'law-data.json'
CORRECTIONS = Path(__file__).resolve().parent / 'law-corrections.json'
CLEAN_TEXT = Path(__file__).resolve().parent / 'law-text.json'
PRACTICE = Path(__file__).resolve().parent / 'practice-notes.json'
TOTAL_ARTICLES = 298
DECREE_SLICE = 1800

# Words that really do end in "في". Any other word stuck to "في" with the run of
# spaces this PDF leaves after it is two words, "يدخلفي   حسابها".
ENDS_IN_FI = {
    'إضافي', 'الإضافي', 'كافي', 'الكافي', 'حرفي', 'الحرفي', 'وظيفي', 'الوظيفي', 'ثقافي', 'الثقافي',
    'مصرفي', 'المصرفي', 'نفي', 'المنفي', 'صحفي', 'الصحفي', 'جغرافي', 'الجغرافي', 'ريفي', 'الريفي',
    'خفي', 'يكفي', 'يفي', 'ينتفي', 'يختفي', 'يستوفي', 'توفي', 'المتوفي', 'المستوفي', 'عرفي', 'العرفي',
    'وفي', 'كفي', 'معرفي', 'المعرفي', 'وللموفي', 'الموفي', 'سلفي', 'تلافي', 'لتلافي', 'الطرفي', 'نصفي',
}

LAW_HEAD = re.compile(r'^\s*مادة\s*\(?\s*(\d+)\s*\)\s*$')
DECREE_START = re.compile(r'^\s*قرار\s+(?:وزير|رئيس|السيد)[^\n]*(?:رقم)\s*(\d+)\s*لسنة\s*(\d{4})')
DECREE_ARTICLE = re.compile(r'^\s*\(\s*(?:ال)?مادة\s*[^)]{1,24}\)\s*$')
HEADING = re.compile(r'^\s*(الكتاب|الباب|الفصل)\s+[^:\n]{2,24}:\s*\S')


def read_lines(pdf):
    lines = []
    for page in pypdf.PdfReader(pdf).pages:
        lines.extend((page.extract_text() or '').splitlines())
    return lines


def tidy(text, splits):
    """The PDF's word spacing put right. No word is changed here, only where one ends."""

    def split_fi(m):
        word = m.group(1) + 'في'
        # "طرفي" (the two parties) is a word, though it can arrive stuck to the one before it.
        party = re.fullmatch(r'(.*?)((?:لل|ل|و|ب)?طرفي)', word)
        if party:
            front = party.group(1)
            if front and front not in ('و', 'ب', 'ل'):
                return f'{front} {party.group(2)} '
            return word + ' '
        if word in ENDS_IN_FI or len(m.group(1)) < 2:
            return word + ' '
        splits[m.group(1)] = splits.get(m.group(1), 0) + 1
        return m.group(1) + ' في '

    text = re.sub(r'([ء-يً-ْ]+)في\s{3,}', split_fi, text)
    # The same stuck "في" after a word's tanwin, wherever the spaces after it were lost.
    text = re.sub(r'([ء-ي]ً)في(?=\s)', r'\1 في', text)
    text = re.sub(r'[ \t ]+', ' ', text)
    # "بأحكام المادة رقم121)" lost its opening bracket and its space.
    text = re.sub(r'([ء-ي])\s*(\d[\d،,]*)\s*\)', r'\1 (\2)', text)
    text = re.sub(r'([ء-ي])(\d)', r'\1 \2', text)
    text = re.sub(r'(\d)([ء-ي])', r'\1 \2', text)
    text = re.sub(r'\(\s+', '(', text)
    text = re.sub(r'\s+\)', ')', text)
    text = re.sub(r' *\n *', '\n', text)
    text = re.sub(r'\n{2,}', '\n', text)
    # A line the PDF wrapped mid-sentence is joined; a numbered item or a new sentence keeps its line.
    text = re.sub(r'(?<![.:؛])\n(?!\s*(?:\d+\s*[-–]|[أ-ي]\s*[-–]|وفى|وفي جميع))', ' ', text)
    return re.sub(r' {2,}', ' ', text).strip()


def build(pdf):
    lines = read_lines(pdf)
    records = []
    where = {'book': '', 'part': '', 'chapter': ''}
    splits = {}
    cur = None
    expected = 1
    decree = None
    started = False

    def close():
        nonlocal cur
        if cur is None:
            return
        cur['text'] = tidy('\n'.join(cur.pop('lines')), splits)
        if cur['text'] or cur['kind'] == 'law':
            records.append(cur)
        cur = None

    issuing = 0
    for line in lines:
        head = LAW_HEAD.match(line)
        if head and int(head.group(1)) == expected:
            close()
            decree = None
            started = True
            cur = {'id': str(expected), 'kind': 'law', 'n': expected, **where, 'lines': []}
            expected += 1
            continue
        heading = HEADING.match(line)
        if heading:
            close()
            decree = None
            kind = heading.group(1)
            title = re.sub(r'\s+', ' ', line).strip()
            if kind == 'الكتاب':
                where.update(book=title, part='', chapter='')
            elif kind == 'الباب':
                where.update(part=title, chapter='')
            else:
                where['chapter'] = title
            continue
        start = DECREE_START.match(line)
        if start:
            close()
            decree = {'no': int(start.group(1)), 'year': int(start.group(2)), 'slice': 0,
                      'under': expected - 1, 'about': ''}
            cur = {'id': f"d{decree['no']}-{decree['year']}-0", 'kind': 'decree', 'decree': decree['no'],
                   'year': decree['year'], 'under': decree['under'], **where, 'lines': []}
            continue
        if decree and DECREE_ARTICLE.match(line):
            size = sum(len(x) for x in cur['lines']) if cur else 0
            if cur and size >= DECREE_SLICE:
                close()
                decree['slice'] += 1
                cur = {'id': f"d{decree['no']}-{decree['year']}-{decree['slice']}", 'kind': 'decree',
                       'decree': decree['no'], 'year': decree['year'], 'under': decree['under'], **where,
                       'lines': []}
        if not started and not decree:
            m = re.match(r'^\s*\(المادة\s+([^)]+)\)\s*$', line)
            if m:
                close()
                issuing += 1
                cur = {'id': f'i{issuing}', 'kind': 'issuing', 'label': m.group(1).strip(), **where, 'lines': []}
                continue
        if cur is not None:
            cur['lines'].append(line)
    close()

    # A "في" stuck on with only one space after it: split it when the word in front of it stands
    # on its own elsewhere in the law. "مشاركتهفي" splits, "الإضافي" and "الكافي" do not.
    vocabulary = {}
    for r in records:
        for word in re.findall(r'[ء-ي]+', r['text']):
            vocabulary[word] = vocabulary.get(word, 0) + 1

    def split_stuck(m):
        word = m.group(0)
        front = word[:-2]
        if word in ENDS_IN_FI or word.endswith('طرفي') or vocabulary.get(front, 0) < 2 or len(front) < 3:
            return word
        return f'{front} في'

    for r in records:
        r['text'] = re.sub(r'[ء-ي]+في(?![ء-ي])', split_stuck, r['text'])

    missing = [n for n in range(1, TOTAL_ARTICLES + 1) if n not in {r.get('n') for r in records if r['kind'] == 'law'}]
    if missing:
        sys.exit(f'articles missing from the law: {missing}')
    empty = [r['n'] for r in records if r['kind'] == 'law' and len(r['text']) < 15]
    if empty:
        sys.exit(f'articles with no text: {empty}')
    return records, splits


def correct(records):
    """Every repair of the printed words, each one checked to apply and to leave the figures alone."""
    if not CORRECTIONS.exists():
        return 0
    digits = lambda s: re.findall(r'\d+', s)
    by_id = {r['id']: r for r in records}
    done = 0
    for c in json.loads(CORRECTIONS.read_text(encoding='utf-8')):
        rec = by_id.get(str(c['id']))
        if rec is not None and c['find'] not in rec['text'] and c['replace'] in rec['text']:
            continue  # the spacing repair above got there first
        if rec is None or rec['text'].count(c['find']) < 1:
            sys.exit(f"correction no longer applies: {c['id']} «{c['find']}»")
        if digits(c['find']) != digits(c['replace']):
            sys.exit(f"a correction may not change a figure: {c['id']} «{c['find']}»")
        rec['text'] = rec['text'].replace(c['find'], c['replace'])
        done += 1
    return done


def with_clean_law(records):
    """The law and its issuing articles from the clean text, the decrees from the PDF."""
    clean = json.loads(CLEAN_TEXT.read_text(encoding='utf-8'))
    issuing = [c for c in clean if c['kind'] == 'issuing']
    law = {c['n']: c for c in clean if c['kind'] == 'law'}
    out = [{'id': f'i{i}', 'kind': 'issuing', 'label': c['label'], 'text': c['text']} for i, c in enumerate(issuing, 1)]
    for rec in records:
        if rec['kind'] == 'law':
            c = law[rec['n']]
            rec.update(book=c['book'], part=c['part'], chapter=c['chapter'], text=c['text'])
        if rec['kind'] != 'issuing':
            out.append(rec)
    # What people ask that the law does not hold. Kept apart by kind, and named as practice wherever it shows.
    notes = json.loads(PRACTICE.read_text(encoding='utf-8'))
    out += [{'id': f'p{i}', 'kind': 'practice', 'label': n['label'], 'text': n['text']} for i, n in enumerate(notes, 1)]
    return out


def main():
    records, splits = build(sys.argv[1])
    fixed = correct(records)
    records = with_clean_law(records)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(records, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    law = [r for r in records if r['kind'] == 'law']
    decrees = {(r['decree'], r['year']) for r in records if r['kind'] == 'decree'}
    print(f'{len(law)} articles, {sum(r["kind"] == "issuing" for r in records)} issuing articles, '
          f'{len(decrees)} decrees in {sum(r["kind"] == "decree" for r in records)} slices, {fixed} corrections')
    print(f'{OUT.stat().st_size / 1024:.0f} KB, longest record {max(len(r["text"]) for r in records)} chars')
    sys.stdout.reconfigure(encoding='utf-8')
    print('split from في:', ' '.join(f'{k}×{v}' for k, v in sorted(splits.items(), key=lambda x: -x[1])))


if __name__ == '__main__':
    main()
