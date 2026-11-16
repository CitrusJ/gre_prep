'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const words = require('../dist/words1400.json');
const original = require('../dist/words.json');
const data = require('../dist/words1400-relations.json');
const report = require('../scripts/words1400-relations-report.json');
const pairs = require('../dist/equivalence-pairs.json');
const lexicon = require('../dist/lexicon.js').buildIndex(original);
const root = path.resolve(__dirname, '../..');
const hash = input => crypto.createHash('sha256').update(input).digest('hex');
const norm = value => String(value).normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ').replace(/’/g, "'");

test('source hashes and the full PDF audit substantiate frequency order and preserve all senses', () => {
  for (const [file, expected] of Object.entries(report.inputs)) {
    assert.equal(hash(fs.readFileSync(path.join(root, file))), expected, file);
  }
  assert.equal(words.length, 1400);
  assert.equal(words.reduce((sum, word) => sum + word.definitions.length, 0), 1892);
  assert.equal(report.definitionCountPreserved, 1892);
  assert.ok(words.every((word, i) => !i || word.sourceFrequency <= words[i - 1].sourceFrequency));
  assert.equal(report.pdfAudit.matchedHeadwordPageFrequencyMarkers, 1400);
  assert.equal(report.pdfAudit.sourceSenseLabels, 1892);
  assert.equal(report.pdfAudit.mismatchCount, 0);
  assert.equal(hash(fs.readFileSync(path.join(root, 'materials/vocabulary/学而思GRE急救1400词2026版.pdf'))), report.pdfAudit.sourceSha256);
});

test('browser payload matches JSON, keys cover all stable 1400 IDs, and source links exist', () => {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'gre800-cards/dist/words1400-relations.js'), 'utf8'), context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.window.GRE1400_RELATIONS)), data);
  assert.deepEqual(Object.keys(data.byId), words.map(word => word.id));
  assert.equal(Object.values(data.byId).filter(records => records.length).length, report.coverage.wordsWithRelations);
  const records = Object.values(data.byId).flat();
  assert.equal(records.length, report.coverage.relationRecords);
  for (const record of records) {
    assert.ok(record.words.length && record.words.every(word => typeof word === 'string' && word));
    assert.ok(record.meaning && record.sourceTitle && record.sourceLabel);
    assert.ok(fs.existsSync(path.resolve(root, 'gre800-cards/dist', decodeURI(record.sourceUrl))), record.sourceUrl);
  }
});

test('every positive record has direct eligible source evidence and never crosses source groups', () => {
  const pairById = new Map(pairs.groups.map(group => [group.id, group]));
  const docxById = new Map(report.docx.groups.map(group => [group.id, group]));
  const sourceById = new Map(original.map(word => [String(word.id), word]));
  for (const word of words) {
    for (const record of data.byId[word.id]) {
      if (record.sourceType === 'equivalence') {
        const group = pairById.get(record.sourceGroupId);
        assert.ok(group && !group.needsReview);
        const terms = group.words.map(term => term.word);
        assert.deepEqual(record.sourceWords, terms);
        const member = terms.indexOf(record.matchedSourceTerm);
        assert.ok(member >= 0);
        assert.deepEqual(record.words, terms.filter((_, i) => i !== member));
        assert.equal(norm(word.word), norm(record.matchedSourceTerm).replace(/^(?:a|an|the) /, ''));
        assert.equal(record.meaning, group.meaning);
        assert.equal(record.page, group.page);
      } else if (record.sourceType === 'docx') {
        const group = docxById.get(record.sourceGroupId);
        assert.ok(group && !group.needsReview);
        assert.deepEqual(record.sourceWords, group.words);
        assert.equal(norm(word.word), norm(record.matchedSourceTerm));
        const member = group.words.indexOf(record.matchedSourceTerm);
        assert.ok(member >= 0);
        assert.deepEqual(record.words, group.words.filter((_, i) => i !== member));
        assert.equal(record.meaning, group.meaning);
        assert.deepEqual(record.sourceParagraphs, group.paragraphs);
      } else {
        assert.equal(record.sourceType, 'gre800');
        const source = sourceById.get(record.sourceWordId);
        const sense = source.definitions[record.senseIndex];
        assert.equal(norm(word.word), norm(source.word));
        assert.equal(record.sourceHeadword, source.word);
        assert.equal(record.meaning, sense.meaning);
        assert.equal(record.english, sense.english || '');
        assert.equal(record.sourceSynonyms, sense.synonyms);
        const approved = lexicon.relations.filter(relation => relation.wordId === record.sourceWordId
          && relation.senseIndex === record.senseIndex && ['usable', 'external'].includes(relation.status));
        assert.deepEqual(record.words, approved.map(relation => relation.token));
        assert.deepEqual(record.relationKeys, approved.map(relation => relation.key));
      }
    }
  }
});

test('DOCX continuation paragraphs are retained and doubtful source rows remain in the report', () => {
  assert.equal(report.docx.groupCount, 522);
  assert.equal(report.docx.continuedMeaningCount, 10);
  for (const group of report.docx.groups) {
    const fragments = group.paragraphs.filter(p => group.meaningParagraphs.includes(p.number));
    assert.equal(group.meaning, fragments.map(p => p.text).join(''));
    assert.equal(group.words.length, 2);
  }
  const questionable = report.docx.groups.find(group => group.words.join('/') === 'pugnacious/irascibly');
  assert.ok(questionable.needsReview && questionable.reviewReasons.length);
  assert.ok(!Object.values(data.byId).flat().some(record => record.sourceType === 'docx' && record.sourceGroupId === questionable.id));
  const continued = report.docx.groups.find(group => group.words[0] === 'altruism');
  assert.equal(continued.meaningParagraphs.length, 2);
  assert.ok(continued.meaning.endsWith('⼼相对'));
});

test('a source-free headword gets no guessed derivatives or transitive synonyms', () => {
  const predictable = words.find(word => word.word === 'predictable');
  assert.ok(predictable.relatedWords.includes('predictably'));
  assert.deepEqual(data.byId[predictable.id], []);
  for (const word of words) {
    assert.ok(data.byId[word.id].every(record => record.sourceType === 'gre800'
      ? norm(record.sourceHeadword) === norm(word.word)
      : record.sourceWords.includes(record.matchedSourceTerm)));
  }
});
