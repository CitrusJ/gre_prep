/* Collection switching acceptance; isolated browser stores and offline local files. */
'use strict';
const { chromium } = require(process.env.GRE_PLAYWRIGHT || 'C:/Temp/gre800-browser-qa/node_modules/playwright-core');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { pathToFileURL, fileURLToPath } = require('node:url');
const P = require('../dist/progress.js');
const original = require('../dist/words.json');
const vocabulary = require('../dist/words1400.json');
const root = path.resolve(__dirname, '..');
const file = pathToFileURL(path.join(root, 'dist/index.html')).href;
const out = process.env.GRE_BANK_QA_OUTPUT || 'C:/Temp/gre-word-banks-qa';
const oldKey = 'gre800-word-studio-v1', newKey = 'gre1400-word-studio-v1';
const NOW = Date.now(), results = [], errors = [], requests = [], contexts = [];
const entry = name => vocabulary.find(w => w.word === name);
const selfSession = queue => ({ queue, index: 0, answers: [], stage: 'prompt', startedAt: NOW });
const fixture = queue => P.migrateState({ version: 2, view: 'self-check', selfCheck: selfSession(queue), specialList: {}, records: {}, history: [] }, vocabulary, NOW);
const oldState = P.migrateState({ version: 2, view: 'self-check', records: { '1': P.recordAnswer(null, 'known', true, NOW - 1000) }, specialList: { '2': { active: true, updatedAt: NOW - 1000 } }, selfCheck: selfSession(['1', '2']), history: [], customMarker: 'original 800 record' }, original, NOW);
const oldRaw = JSON.stringify(oldState);
const read = (page, key = newKey) => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
const raw = (page, key) => page.evaluate(key => localStorage.getItem(key), key);
const active = state => Object.entries(state.specialList).filter(([, item]) => item.active).map(([id]) => id).sort();
const oldFiles = ['words.json', 'words.js'].map(name => [path.join(root, 'dist', name), fs.readFileSync(path.join(root, 'dist', name))]);

async function noOverflow(page, label) {
  const sizes = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(sizes.scroll <= sizes.width, `${label}: ${JSON.stringify(sizes)}`);
}
async function switchBank(page, bank) {
  await Promise.all([page.waitForURL(url => url.searchParams.get('bank') === bank), page.locator('#word-bank').selectOption(bank)]);
  await page.waitForLoadState('load');
  await page.waitForFunction(id => window.GREWordBanks?.current.id === id && !!document.querySelector('#app .page-title'), bank);
}
async function importBackup(page, payload) {
  await page.locator('[data-nav="progress"]').click();
  await page.locator('#progress-file').setInputFiles({ name: `gre${payload.bankId}-qa.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(payload)) });
  await page.locator('#import-dialog[open]').waitFor();
  await page.locator('[data-action="confirm-import"]').click();
  await page.locator('#import-dialog').waitFor({ state: 'detached' });
}
async function downloadJSON(download) {
  const stream = await download.createReadStream(), parts = [];
  for await (const part of stream) parts.push(part);
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.GRE_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const check = async (name, action) => {
    try { await action(); results.push({ name, ok: true }); console.log('PASS', name); }
    catch (error) { results.push({ name, ok: false, error: error.stack }); console.error('FAIL', name, error.stack); }
  };
  try {
    const fresh = async ({ bank = '1400', saved, viewport = { width: 1440, height: 1000 } } = {}) => {
      const context = await browser.newContext({ viewport, acceptDownloads: true, offline: true, reducedMotion: 'reduce' });
      contexts.push(context);
      await context.addInitScript(({ oldKey, newKey, oldRaw, saved }) => {
        if (!sessionStorage.getItem('word-bank-qa-seeded')) {
          localStorage.setItem(oldKey, oldRaw);
          if (saved) localStorage.setItem(newKey, JSON.stringify(saved));
          sessionStorage.setItem('word-bank-qa-seeded', 'yes');
        }
      }, { oldKey, newKey, oldRaw, saved });
      const page = await context.newPage(); page.setDefaultTimeout(12000);
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
      await page.goto(`${file}?bank=${bank}`); await page.locator('#app .page-title').waitFor();
      return { page, context };
    };

    await check('new 1400 bank opens the table without creating a flashcard session or changing 800 storage', async () => {
      const { page, context } = await fresh(); const saved = await read(page);
      assert.equal(saved.view, 'word-table'); assert.equal(saved.selfCheck, null);
      assert.equal(saved.basic, null); assert.deepEqual(saved.tableRecognition, {});
      assert.equal(await page.locator('#word-bank').inputValue(), '1400');
      assert.equal(await raw(page, oldKey), oldRaw);
      assert.equal(await page.locator('[data-self-confidence]').count(), 0);
      assert.equal(await page.locator('[data-nav="word-table"]').isVisible(), true);
      assert.equal(await page.locator('.nav-list [data-nav="basic"]').isVisible(), false);
      await noOverflow(page, 'desktop table'); await context.close();
    });

    await check('switching banks preserves both collections, old sessions and remembered bank selection', async () => {
      const id = entry('predictable').id, seeded = fixture([id]);
      seeded.selfCheck.answers = [{id, confidence: 'unknown'}]; seeded.selfCheck.stage = 'answer';
      seeded.specialList[id] = {active: true, updatedAt: NOW};
      const { page, context } = await fresh({ saved: seeded });
      const before = await read(page);
      assert.equal(before.tableRecognition[id].status, 'unknown');
      assert.deepEqual(before.selfCheck, seeded.selfCheck);
      assert.equal(await raw(page, oldKey), oldRaw);
      await switchBank(page, '800'); const old = await read(page, oldKey);
      assert.deepEqual(old.records, oldState.records); assert.deepEqual(old.specialList, oldState.specialList);
      assert.equal(old.customMarker, oldState.customMarker); assert.deepEqual(old.selfCheck, oldState.selfCheck);
      assert.equal(await page.locator('.word-display h2').innerText(), original.find(w => String(w.id) === '1').word);
      assert.equal(await page.locator('.nav-list [data-nav="word-table"]').isVisible(), false);
      await switchBank(page, '1400');
      assert.deepEqual((await read(page)).specialList, before.specialList);
      assert.deepEqual((await read(page)).tableRecognition, before.tableRecognition);
      assert.deepEqual((await read(page)).selfCheck, before.selfCheck);
      await page.goto(file);
      assert.equal(await page.locator('#word-bank').inputValue(), '1400');
      assert.deepEqual((await read(page)).specialList, before.specialList);
      await context.close();
    });

    let exported;
    await check('1400 export preserves legacy scores, table labels and manually selected review membership', async () => {
      const id = entry('predictable').id, seeded = fixture([id]);
      seeded.records[id] = P.recordAnswer(null, 'known', true, NOW - 1000);
      seeded.tableRecognition = {[id]: {status: 'unknown', updatedAt: NOW}};
      seeded.specialList[id] = {active: true, updatedAt: NOW};
      const { page, context } = await fresh({saved: seeded});
      await page.locator('.nav-list [data-nav="progress"]').click();
      assert.equal(await page.locator('.list-card').count(), 14);
      const downloading = page.waitForEvent('download'); await page.locator('[data-action="export-progress"]').click();
      const download = await downloading; exported = await downloadJSON(download);
      assert.equal(exported.bankId, '1400'); assert.ok(download.suggestedFilename().startsWith('gre1400-progress-'));
      assert.equal(exported.format, 'gre800-progress');
      assert.deepEqual(exported.state.records, seeded.records);
      assert.deepEqual(exported.state.tableRecognition, seeded.tableRecognition);
      assert.deepEqual(exported.state.selfCheck, seeded.selfCheck);
      assert.deepEqual(active(exported.state), [id]);
      assert.equal(await raw(page, oldKey), oldRaw); await context.close();
    });

    await check('same-bank backup imports into a fresh profile and repeated import does not inflate counts', async () => {
      assert.ok(exported, 'export prerequisite'); const { page, context } = await fresh();
      await importBackup(page, exported); const once = await read(page);
      assert.deepEqual(once.records, exported.state.records);
      assert.deepEqual(once.specialList, exported.state.specialList);
      assert.deepEqual(once.tableRecognition, exported.state.tableRecognition);
      await importBackup(page, exported); const twice = await read(page);
      assert.deepEqual(twice.records, once.records); assert.deepEqual(twice.specialList, once.specialList);
      assert.deepEqual(twice.tableRecognition, once.tableRecognition);
      assert.equal(await raw(page, oldKey), oldRaw); await context.close();
    });

    await check('wrong-bank imports are refused before either collection can be changed', async () => {
      assert.ok(exported, 'export prerequisite');
      for (const [bank, payload, currentKey] of [['800', exported, oldKey], ['1400', { ...P.exportProgress(oldState, NOW), bankId: '800' }, newKey]]) {
        const { page, context } = await fresh({ bank });
        await page.locator('[data-nav="progress"]').click(); const before = await raw(page, currentKey);
        const otherKey = bank === '800' ? newKey : oldKey, otherBefore = await raw(page, otherKey);
        await page.locator('#progress-file').setInputFiles({ name: 'wrong-bank.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(payload)) });
        await page.locator('.toast').filter({ hasText: '请先切换到对应词库' }).waitFor();
        assert.equal(await page.locator('#import-dialog[open]').count(), 0);
        assert.equal(await raw(page, currentKey), before); assert.equal(await raw(page, otherKey), otherBefore);
        await context.close();
      }
    });

    await check('no uncaught browser errors, remote traffic or changes to original 800 source files', async () => {
      assert.deepEqual(errors, []); assert.deepEqual(requests, []);
      for (const [file, bytes] of oldFiles) assert.deepEqual(fs.readFileSync(file), bytes, file);
    });
  } finally {
    for (const context of contexts) await context.close(); await browser.close();
    fs.writeFileSync(path.join(out, 'word-banks-browser-report.json'), JSON.stringify({ testedAt: new Date().toISOString(), results, errors, requests }, null, 2));
    if (results.some(row => !row.ok) || errors.length || requests.length) process.exitCode = 1;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
