const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../dist/progress.js');
const words = require('../dist/words1400.json').slice(0, 6);
const words800 = require('../dist/words.json').slice(0, 6);
const NOW = 1794369600000;
const ids = words.map(word => String(word.id));
const copy = value => JSON.parse(JSON.stringify(value));
const mark = (status, updatedAt = NOW) => ({ status, updatedAt });
const answer = (id, confidence = 'known') => ({ id, confidence });
const session = (overrides = {}) => ({ queue: ids.slice(0, 3), index: 0, answers: [], stage: 'prompt', startedAt: NOW, ...overrides });
const state = (overrides = {}) => P.migrateState({ version: 2, records: {}, ...overrides }, words, NOW);

test('1400 legacy answers become stable table marks while sessions and special-list choices survive intact', () => {
  const selfCheck = session({ index: 1, stage: 'answer', answers: [answer(ids[0]), { ...answer(ids[1], 'unknown'), autoSpecialAt: NOW + 5 }] });
  const specialReview = session({ queue: [ids[1], ids[2]], index: 2, stage: 'done', startedAt: NOW + 2, answers: [answer(ids[1]), answer(ids[2], 'unknown')] });
  const original = {
    version: 2, records: {}, selfCheck, specialReview,
    specialList: { [ids[0]]: { active: false, updatedAt: NOW + 6 }, [ids[1]]: { active: true, updatedAt: NOW + 5 } },
    view: 'self-check', daily: {}, history: [],
  };
  const before = copy(original);
  const migrated = P.migrateState(original, words, NOW + 1000);
  assert.deepEqual(migrated.tableRecognition, { [ids[0]]: mark('known'), [ids[1]]: mark('known', NOW + 2), [ids[2]]: mark('unknown', NOW + 2) });
  for (const key of ['selfCheck', 'specialReview', 'specialList', 'records', 'daily', 'history']) assert.deepEqual(migrated[key], original[key]);
  assert.deepEqual(P.migrateState(migrated, words, NOW + 2000), migrated);
  assert.deepEqual(P.migrateState(original, words, NOW + 2000).tableRecognition, migrated.tableRecognition);
  assert.deepEqual(original, before);
});

test('explicit recognition including cleared tombstones always overrides old answers', () => {
  const original = state({
    selfCheck: session({ index: 3, stage: 'done', startedAt: NOW + 100, answers: ids.slice(0, 3).map(id => answer(id, 'unknown')) }),
    tableRecognition: { [ids[0]]: mark('known', 0), [ids[1]]: mark('unmarked', 1) },
  });
  assert.deepEqual(original.tableRecognition, { [ids[0]]: mark('known', 0), [ids[1]]: mark('unmarked', 1), [ids[2]]: mark('unknown', NOW + 100) });
  assert.deepEqual(P.validateImport(P.exportProgress(original, NOW), words, NOW).state, original);
});

test('legacy recognition uses answer time if present and session time otherwise, with deterministic ties', () => {
  const selfCheck = session({ stage: 'answer', answers: [{ ...answer(ids[0]), updatedAt: NOW + 10 }] });
  const specialReview = session({ stage: 'answer', startedAt: NOW + 5, answers: [answer(ids[0], 'unknown')] });
  assert.deepEqual(state({ selfCheck, specialReview }).tableRecognition[ids[0]], mark('known', NOW + 10));
  selfCheck.answers = [answer(ids[0])];
  specialReview.startedAt = NOW;
  assert.deepEqual(state({ selfCheck, specialReview }).tableRecognition[ids[0]], mark('known'));
});

test('invalid local recognition entries are discarded and foreign IDs cannot enter the bank', () => {
  const original = {
    [ids[0]]: mark('known'), [ids[1]]: mark('unmarked', 0),
    [ids[2]]: mark('unsure'), [ids[3]]: mark('unknown', null),
    [ids[4]]: mark('known', Infinity), [ids[5]]: null,
    'x1400-9999': mark('known'), '1': mark('unknown'),
  };
  assert.deepEqual(state({ tableRecognition: original }).tableRecognition, { [ids[0]]: original[ids[0]], [ids[1]]: original[ids[1]] });
  for (const malformed of [undefined, null, [], 'known']) assert.deepEqual(state({ tableRecognition: malformed }).tableRecognition, {});
  const invalidSession = session({ stage: 'answer', answers: [answer('x1400-9999')] });
  assert.deepEqual(state({ selfCheck: invalidSession }).tableRecognition, {});
});

test('recognition never creates a score, daily activity, history item or automatic special-list entry', () => {
  const scored = P.recordAnswer(null, 'known', true, NOW);
  const base = state({ records: { [ids[0]]: scored }, daily: { '2026-11-11': { attempts: 1, correct: 1, ids: [ids[0]] } }, history: [{ total: 1, correct: 1, finishedAt: NOW }] });
  for (const status of ['known', 'unknown', 'unmarked']) {
    const changed = P.migrateState({ ...base, tableRecognition: { [ids[1]]: mark(status) } }, words, NOW + 1);
    for (const key of ['records', 'daily', 'history', 'specialList']) assert.deepEqual(changed[key], base[key]);
    assert.deepEqual(P.getStats(changed.records, words, NOW), P.getStats(base.records, words, NOW));
  }
  assert.deepEqual(state({ selfCheck: session({ stage: 'answer', answers: [answer(ids[0], 'unknown')] }) }).specialList, {});
});

test('import rejects malformed recognition containers, IDs, statuses and timestamps', () => {
  const badEntries = [
    null, [], {}, { status: 'known' }, { updatedAt: NOW },
    ...[null, '', 'unsure', 'KNOWN', true, 1, {}, []].map(status => mark(status)),
    ...[null, undefined, -1, NaN, Infinity, '0', true, {}, [], 8640000000000001].map(updatedAt => ({ status: 'known', updatedAt })),
  ];
  for (const tableRecognition of [null, [], 'known', ...badEntries.map(entry => ({ [ids[0]]: entry })), { '1': mark('known') }, { 'x1400-9999': mark('unmarked') }]) {
    const incoming = { version: 2, records: {}, tableRecognition };
    assert.throws(() => P.validateImport(incoming, words, NOW), /表格认识标记/, JSON.stringify(incoming));
  }
  assert.throws(() => P.validateImport('{"version":2,"records":{},"tableRecognition":{"__proto__":{"status":"known","updatedAt":0}}}', words, NOW), /不安全/);
});

test('all valid statuses and timestamp boundaries round-trip through export and import', () => {
  const original = state({ tableRecognition: { [ids[0]]: mark('known', 0), [ids[1]]: mark('unknown', NOW), [ids[2]]: mark('unmarked', 8640000000000000) } });
  assert.deepEqual(P.validateImport(JSON.stringify(P.exportProgress(original, NOW)), words, NOW).state, original);
});

test('recognition merge selects newer word choices, current wins ties, and clear marks survive stale backups', () => {
  const current = state({ tableRecognition: { [ids[0]]: mark('unmarked', NOW + 2), [ids[1]]: mark('known'), [ids[2]]: mark('unknown') } });
  const incoming = state({ tableRecognition: { [ids[0]]: mark('known'), [ids[1]]: mark('unknown', NOW + 1), [ids[2]]: mark('known'), [ids[3]]: mark('known') } });
  const beforeA = copy(current), beforeB = copy(incoming);
  const merged = P.mergeProgress(current, incoming, words, NOW);
  assert.deepEqual(merged.tableRecognition, { [ids[0]]: current.tableRecognition[ids[0]], [ids[1]]: incoming.tableRecognition[ids[1]], [ids[2]]: current.tableRecognition[ids[2]], [ids[3]]: incoming.tableRecognition[ids[3]] });
  assert.deepEqual(P.mergeProgress(merged, incoming, words, NOW + 1), merged);
  assert.deepEqual(P.validateImport(P.exportProgress(merged, NOW), words, NOW).state, merged);
  assert.deepEqual(current, beforeA);
  assert.deepEqual(incoming, beforeB);
});

test('importing old 1400 sessions preserves tombstones and independently merges special-list choices', () => {
  const current = state({ tableRecognition: { [ids[0]]: mark('unmarked', NOW + 10) }, specialList: { [ids[0]]: { active: false, updatedAt: NOW + 10 } } });
  const legacy = { version: 2, records: {}, selfCheck: session({ stage: 'answer', answers: [{ ...answer(ids[0], 'unknown'), autoSpecialAt: NOW + 1 }] }), specialList: { [ids[0]]: { active: true, updatedAt: NOW + 1 } } };
  const merged = P.mergeProgress(current, legacy, words, NOW + 20);
  assert.deepEqual(merged.tableRecognition[ids[0]], mark('unmarked', NOW + 10));
  assert.deepEqual(merged.specialList, current.specialList);
  assert.deepEqual(merged.selfCheck, legacy.selfCheck);
  assert.deepEqual(P.migrateState(merged, words, NOW + 30), merged);
});

test('800 self-check and scoring remain unchanged and cannot acquire 1400 recognition marks', () => {
  const queue = words800.slice(0, 2).map(word => String(word.id));
  const legacy = {
    version: 2, records: { [queue[0]]: P.recordAnswer(null, 'unknown', false, NOW) },
    selfCheck: { queue, index: 2, stage: 'done', startedAt: NOW, answers: [answer(queue[0], 'unknown'), answer(queue[1])] },
    specialList: { [queue[0]]: { active: true, updatedAt: NOW } },
    daily: { '2026-11-11': { attempts: 1, correct: 0, ids: [queue[0]] } }, history: [],
  };
  const migrated = P.migrateState(legacy, words800, NOW);
  assert.deepEqual(migrated.tableRecognition, {});
  for (const key of ['selfCheck', 'specialList', 'records', 'daily', 'history']) assert.deepEqual(migrated[key], legacy[key]);
  assert.deepEqual(P.validateImport(P.exportProgress(migrated, NOW), words800, NOW).state, migrated);
  assert.deepEqual(P.mergeProgress(migrated, migrated, words800, NOW), migrated);
  assert.deepEqual(P.migrateState({ ...legacy, tableRecognition: { [ids[0]]: mark('known') } }, words800, NOW).tableRecognition, {});
});
