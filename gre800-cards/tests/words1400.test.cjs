'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const L = require('../dist/logic.js');
const words = require('../dist/words1400.json');
const report = require('../scripts/words1400-extraction-report.json');
const root = path.resolve(__dirname, '..');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

test('adding 1400 preserves the original 800 JSON and browser word-bank contents', () => {
  const original = {
    'words.json': '27280e1f9160919b4e3d3daf9055a9b85965a92932ee3ad8613735aa4f38a887',
    'words.js': '54ddbcfb26708210e7dde10e115e2e1e737ebe4f2503a0369c246606907a7219'
  };
  for (const [file, expected] of Object.entries(original)) {
    assert.equal(hash(fs.readFileSync(path.join(root, 'dist', file), 'utf8').replace(/\r\n/g, '\n')), expected, file);
  }
});

test('1400 source entries have stable separate IDs, 14 complete Lists and 140 complete Units', () => {
  assert.equal(words.length, 1400);
  assert.equal(new Set(words.map(w => w.id)).size, 1400);
  assert.equal(new Set(words.map(w => w.word.toLowerCase())).size, 1400);
  const groups = new Map(), units = new Map(), pages = new Map();
  words.forEach((word, i) => {
    assert.equal(word.id, `x1400-${String(i + 1).padStart(4, '0')}`);
    assert.equal(word.page, Math.floor(i / 5) + 3);
    assert.equal(word.group, Math.floor(i / 100) + 1);
    assert.equal(word.unit, Math.floor((i % 100) / 10) + 1);
    assert.ok(word.word && word.pos && /[\u3400-\u9fff]/.test(word.meaning));
    assert.ok(word.definitions.length);
    groups.set(word.group, (groups.get(word.group) || 0) + 1);
    units.set(`${word.group}:${word.unit}`, (units.get(`${word.group}:${word.unit}`) || 0) + 1);
    pages.set(word.page, (pages.get(word.page) || 0) + 1);
  });
  assert.equal(groups.size, 14); assert.ok([...groups.values()].every(n => n === 100));
  assert.equal(units.size, 140); assert.ok([...units.values()].every(n => n === 10));
  assert.equal(pages.size, 280); assert.ok([...pages.values()].every(n => n === 5));
});

test('all 1892 source senses are retained and missing source fields are not generated', () => {
  assert.equal(words.reduce((n, w) => n + w.definitions.length, 0), 1892);
  assert.equal(words.filter(w => w.mnemonic).length, 1393);
  assert.equal(words.filter(w => w.relatedWords).length, 999);
  assert.equal(words.filter(w => !w.phonetic).length, 41);
  assert.deepEqual(words.flatMap(w => w.definitions.filter(d => !d.english).map(d => [w.word, d.sourceLabel])), [
    ['appeal', '特殊考法1'], ['revise', '特殊考法1']
  ]);
  for (const word of words) for (const definition of word.definitions) {
    assert.match(definition.sourceLabel, /^(特殊)?考法\d+$/);
    assert.ok(definition.pos && definition.meaning && definition.sourceText);
    assert.ok(!JSON.stringify(definition).includes('\ufffd'));
  }
  assert.deepEqual(words.find(w => w.word === 'original').definitions.map(d => d.sourceLabel), ['考法2', '考法1']);
  assert.equal(words.find(w => w.word === 'derive').definitions[0].meaning, '（从…中）得到，获得; 常用作(be) derived');
  assert.ok(words.find(w => w.word === 'admitedly').sourceNotes.some(note => note.includes('admittedly')));
  assert.ok(words.find(w => w.word === 'constricted').sourceNotes.some(note => note.includes('紧')));
  const phrase = words.find(w => w.word === 'grant').definitions.find(d => d.sourceLabel === '考法3');
  assert.equal(phrase.meaning, '认为…是理所当然');
  assert.equal(phrase.english, 'take it for ˈgranted (that…)');
});

test('browser data equals JSON and references the supplied PDF with verified extraction provenance', () => {
  const context = { window: {} }; vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'dist/words1400.js'), 'utf8'), context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.window.GRE_WORDS_1400)), words);
  const source = path.resolve(root, '../', report.source);
  assert.equal(hash(fs.readFileSync(source)), report.sourceSha256);
  assert.equal(report.wordCount, 1400); assert.equal(report.definitionCount, 1892);
  assert.equal(report.validation.headwordOrderMatchesPlainText, true);
  assert.equal(report.validation.definitionCountMatchesPlainText, true);
  for (const word of words) assert.equal(path.resolve(root, 'dist', decodeURI(word.sourceUrl)), source);
});

test('every 1400 word supports four distinct answer options entirely within its own bank', () => {
  const ids = new Set(words.map(w => w.id));
  const normalize = value => String(value).replace(/[\s，,；;。.!！?？、（）()]/g, '').toLowerCase();
  for (const word of words) {
    const options = L.makeOptions(word, words, () => 0.417);
    assert.equal(options.length, 4, word.word);
    assert.equal(new Set(options.map(o => o.id)).size, 4, word.word);
    assert.equal(new Set(options.map(o => normalize(o.meaning))).size, 4, word.word);
    assert.equal(options.filter(o => o.id === word.id).length, 1, word.word);
    assert.ok(options.every(o => ids.has(o.id)), word.word);
  }
});
