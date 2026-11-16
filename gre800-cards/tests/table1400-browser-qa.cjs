/* 1400 table acceptance using isolated, offline browser storage only. */
'use strict';
const { chromium } = require(process.env.GRE_PLAYWRIGHT || 'C:/Temp/gre800-browser-qa/node_modules/playwright-core');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const P = require('../dist/progress.js');
const vocabulary = require('../dist/words1400.json');
const words800 = require('../dist/words.json');
const root = path.resolve(__dirname, '..');
const file = pathToFileURL(path.join(root, 'dist/index.html')).href;
const out = process.env.GRE_TABLE_QA_OUTPUT || 'C:/Temp/gre-table1400-qa';
const KEY = 'gre1400-word-studio-v1', OLD_KEY = 'gre800-word-studio-v1';
const NOW = Date.now(), results = [], errors = [], requests = [], contexts = [];
const ordered = vocabulary.map((word, index) => ({ word, index })).sort((a, b) => b.word.sourceFrequency - a.word.sourceFrequency || a.index - b.index).map(row => row.word);
const first = ordered[0], second = ordered[1];
const session = (ids, overrides = {}) => ({ queue: ids, index: 0, answers: [], stage: 'prompt', startedAt: NOW - 1000, ...overrides });
const old800 = P.migrateState({ version: 2, view: 'self-check', records: { 1: P.recordAnswer(null, 'known', true, NOW - 1000) }, selfCheck: session(['1', '2']), specialList: { 2: { active: true, updatedAt: NOW - 1000 } }, customMarker: '800 original storage' }, words800, NOW);
const oldRaw = JSON.stringify(old800);
const base = overrides => P.migrateState({ version: 2, records: {}, ...overrides }, vocabulary, NOW);
const read = (page, key = KEY) => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
const raw = (page, key = KEY) => page.evaluate(key => localStorage.getItem(key), key);
const rows = page => page.locator('.table1400 tr[data-word-id]');
const row = (page, id) => page.locator(`.table1400 tr[data-word-id="${id}"]`);
const filter = (page, name) => page.locator(`[data-table1400-filter="${name}"]`);
const idsOnPage = page => rows(page).evaluateAll(elements => elements.map(element => element.dataset.wordId));
const compact = value => String(value || '').replace(/\s+/g, '');
const activeSpecial = saved => Object.entries(saved.specialList).filter(([, value]) => value.active).map(([id]) => id).sort();

async function noOverflow(page, label) {
  const size = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(size.scroll <= size.width, `${label}: ${JSON.stringify(size)}`);
}
async function importBackup(page, payload) {
  await page.locator('[data-nav="progress"]').click();
  await page.locator('#progress-file').setInputFiles({ name: 'table1400-qa.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(payload)) });
  await page.locator('#import-dialog[open]').waitFor();
  await page.locator('[data-action="confirm-import"]').click();
  await page.locator('#import-dialog').waitFor({ state: 'detached' });
}
async function downloadJSON(download) {
  const parts = [];
  for await (const chunk of await download.createReadStream()) parts.push(chunk);
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}
async function switchBank(page, bank) {
  await Promise.all([page.waitForURL(url => url.searchParams.get('bank') === bank), page.locator('#word-bank').selectOption(bank)]);
  await page.waitForLoadState('load');
  await page.waitForFunction(id => window.GREWordBanks?.current.id === id && !!document.querySelector(id === '1400' ? '.table1400' : '#app .page-title'), bank);
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.GRE_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const check = async (name, action) => {
    try { await action(); results.push({ name, ok: true }); console.log('PASS', name); }
    catch (error) { results.push({ name, ok: false, error: error.stack }); console.error('FAIL', name, error.stack); }
  };
  try {
    const fresh = async ({ saved, viewport = { width: 1440, height: 1000 } } = {}) => {
      const context = await browser.newContext({ viewport, acceptDownloads: true, offline: true, reducedMotion: 'reduce' });
      contexts.push(context);
      await context.addInitScript(({ KEY, OLD_KEY, oldRaw, saved }) => {
        if (!sessionStorage.getItem('table1400-qa-seeded')) {
          localStorage.setItem(OLD_KEY, oldRaw);
          if (saved) localStorage.setItem(KEY, JSON.stringify(saved));
          sessionStorage.setItem('table1400-qa-seeded', 'yes');
        }
      }, { KEY, OLD_KEY, oldRaw, saved });
      const page = await context.newPage(); page.setDefaultTimeout(15000);
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
      await page.goto(`${file}?bank=1400`); await page.locator('.table1400').waitFor();
      return { page, context };
    };

    await check('1400 opens the frequency-ordered table, pagination reaches every word, and all 1892 senses are readable', async () => {
      const { page, context } = await fresh();
      const saved = await read(page);
      assert.equal(saved.view, 'word-table');
      assert.equal(saved.selfCheck, null);
      assert.deepEqual(saved.tableRecognition, {});
      assert.equal(await raw(page, OLD_KEY), oldRaw);
      assert.equal(await rows(page).count(), 25);
      assert.equal(await page.locator('.table1400 [data-recognition], .table1400 input[data-special], [data-table1400-filter="status"]').count(), 0);
      assert.equal(await page.locator('[data-table1400-stat="known"], [data-table1400-stat="unknown"], [data-table1400-stat="unmarked"]').count(), 0);
      assert.equal(await page.locator('.table1400 button[data-special]').count(), 25);
      assert.deepEqual(await idsOnPage(page), ordered.slice(0, 25).map(word => word.id));
      await page.locator('[data-table1400-page="next"]').click();
      assert.deepEqual(await idsOnPage(page), ordered.slice(25, 50).map(word => word.id));
      await page.locator('[data-table1400-page="last"]').click();
      assert.deepEqual(await idsOnPage(page), ordered.slice(-25).map(word => word.id));
      await filter(page, 'pageSize').selectOption('all');
      assert.deepEqual(await idsOnPage(page), ordered.map(word => word.id));
      const rendered = await rows(page).evaluateAll(elements => elements.map(element => ({ id: element.dataset.wordId, visible: element.innerText, all: element.textContent })));
      let senses = 0;
      for (const renderedWord of rendered) {
        const word = vocabulary.find(word => word.id === renderedWord.id);
        const visible = compact(renderedWord.visible), all = compact(renderedWord.all);
        for (const definition of word.definitions) {
          assert.ok(visible.includes(compact(definition.meaning)), `${word.word}: ${definition.meaning}`);
          if (definition.english) assert.ok(visible.includes(compact(definition.english)), `${word.word}: English sense missing`);
          if (definition.sourceLabel) assert.ok(visible.includes(compact(definition.sourceLabel)), `${word.word}: source sense label missing`);
          senses++;
        }
        for (const key of ['phonetic', 'mnemonic', 'relatedWords']) if (word[key]) assert.ok(all.includes(compact(word[key])), `${word.word}: ${key} missing`);
        for (const note of word.sourceNotes || []) if (!/字体|小字栏/.test(note)) assert.ok(all.includes(compact(note)), `${word.word}: source note missing`);
      }
      assert.equal(senses, 1892);
      await filter(page, 'pageSize').selectOption('25');
      await noOverflow(page, 'desktop table');
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(out, '1400-table-desktop.png'), fullPage: false, animations: 'disabled' });
      await context.close();
    });

    await check('legacy 1400 views redirect to the table and preserve sessions, scores and manually removed special entries', async () => {
      const selfCheck = session([first.id, second.id], { index: 1, stage: 'answer', answers: [{ id: first.id, confidence: 'known' }, { id: second.id, confidence: 'unknown', autoSpecialAt: NOW - 900 }] });
      const specialReview = session([second.id], { index: 1, stage: 'done', answers: [{ id: second.id, confidence: 'unknown' }] });
      const fixture = {
        version: 2, selfCheck, specialReview,
        records: { [first.id]: P.recordAnswer(null, 'known', true, NOW - 500) },
        daily: { '2026-11-11': { attempts: 1, correct: 1, ids: [first.id] } },
        history: [{ total: 1, correct: 1, finishedAt: NOW - 500 }],
        specialList: { [first.id]: { active: true, updatedAt: NOW - 500 }, [second.id]: { active: false, updatedAt: NOW - 100 } },
      };
      for (const view of ['self-check', 'basic', 'test', 'recall', 'synonyms', 'special-study', 'special-review']) {
        const { page, context } = await fresh({ saved: { ...fixture, view } });
        const saved = await read(page);
        assert.equal(saved.view, ['special-study', 'special-review'].includes(view) ? 'special-review' : 'word-table');
        for (const key of ['selfCheck', 'specialReview', 'records', 'daily', 'history', 'specialList']) assert.deepEqual(saved[key], fixture[key], `${view}: ${key}`);
        assert.equal(saved.tableRecognition[first.id].status, 'known');
        assert.equal(saved.tableRecognition[second.id].status, 'unknown');
        if (saved.view === 'special-review') assert.deepEqual(await idsOnPage(page), [first.id]);
        assert.equal(await page.locator('[data-self-confidence]').count(), 0);
        assert.equal(await row(page, first.id).locator('button[data-special]').getAttribute('aria-pressed'), 'true');
        if (saved.view === 'word-table') assert.equal(await row(page, second.id).locator('button[data-special]').getAttribute('aria-pressed'), 'false');
        await context.close();
      }
    });

    await check('one special-review button supports click and keyboard reversal without jumping, changing old recognition or recording scores', async () => {
      const legacyRecognition = { [first.id]: { status: 'known', updatedAt: NOW - 500 }, [second.id]: { status: 'unknown', updatedAt: NOW - 400 } };
      const { page, context } = await fresh({ saved: base({ tableRecognition: legacyRecognition }) });
      const before = await read(page), pageIds = await idsOnPage(page);
      const target = row(page, first.id);
      const button = target.locator('button[data-special]');
      assert.equal(await target.locator('button').count(), 1);
      assert.equal(await button.innerText(), '加入特殊待复习');
      assert.equal(await button.getAttribute('aria-pressed'), 'false');
      await target.evaluate(element => { element.dataset.qaIdentity = 'retained'; });
      for (const [action, active] of [['click', true], ['Space', false], ['Enter', true]]) {
        if (action === 'click') await button.click();
        else { await button.focus(); await button.press(action); }
        const saved = await read(page);
        assert.deepEqual(activeSpecial(saved), active ? [first.id] : []);
        assert.equal(await button.getAttribute('aria-pressed'), String(active));
        assert.equal(await button.innerText(), active ? '已加入 · 点击移出' : '加入特殊待复习');
        for (const key of ['tableRecognition', 'records', 'daily', 'history']) assert.deepEqual(saved[key], before[key]);
        assert.deepEqual(await idsOnPage(page), pageIds);
        assert.equal(await target.getAttribute('data-qa-identity'), 'retained');
      }
      await row(page, second.id).locator('button[data-special]').click();
      const saved = await read(page);
      await page.reload(); await page.locator('.table1400').waitFor();
      const reloaded = await read(page);
      for (const key of ['tableRecognition', 'specialList', 'records', 'daily', 'history']) assert.deepEqual(reloaded[key], saved[key]);
      await page.locator('[data-nav="special-review"]').click();
      assert.deepEqual(await idsOnPage(page), [first.id, second.id]);
      const specialButton = row(page, first.id).locator('button[data-special]');
      await specialButton.click();
      assert.equal((await read(page)).specialList[first.id].active, false);
      assert.deepEqual(await idsOnPage(page), [first.id, second.id], 'removed row stays available for correction');
      await specialButton.press('Enter');
      assert.equal((await read(page)).specialList[first.id].active, true);
      await specialButton.click();
      await row(page, second.id).locator('button[data-special]').click();
      assert.equal((await read(page)).specialList[second.id].active, false);
      assert.deepEqual((await read(page)).tableRecognition, legacyRecognition);
      await page.locator('[data-nav="word-table"]').click();
      await page.locator('[data-nav="special-review"]').click();
      assert.equal(await rows(page).count(), 0);
      assert.equal(await raw(page, OLD_KEY), oldRaw);
      await context.close();
    });

    await check('old recognition filters are discarded while search, List and special-only filters retain frequency order', async () => {
      const legacyRecognition = { [first.id]: { status: 'known', updatedAt: NOW - 500 }, [second.id]: { status: 'unknown', updatedAt: NOW - 400 } };
      const { page, context } = await fresh({ saved: base({ tableRecognition: legacyRecognition, settings: { table1400: { all: { status: 'unknown', pageSize: 25, page: 1 }, special: { status: 'known', pageSize: 25, page: 1 } } } }) });
      assert.deepEqual(await idsOnPage(page), ordered.slice(0, 25).map(word => word.id), 'legacy unknown filter cannot hide words');
      assert.equal(await filter(page, 'status').count(), 0);
      const word = vocabulary.find(word => word.definitions.length > 2 && word.definitions[2].meaning.length > 5);
      const needle = word.definitions[2].meaning;
      await filter(page, 'search').fill(needle);
      await row(page, word.id).waitFor();
      const found = await row(page, word.id).innerText();
      assert.ok(compact(found).includes(compact(needle)));
      await filter(page, 'search').fill('');
      await filter(page, 'list').selectOption('14');
      await filter(page, 'pageSize').selectOption('all');
      assert.deepEqual(await idsOnPage(page), ordered.filter(word => word.group === 14).map(word => word.id));
      await filter(page, 'list').selectOption('');
      await filter(page, 'pageSize').selectOption('25');
      await row(page, second.id).locator('button[data-special]').click();
      await filter(page, 'specialOnly').check();
      assert.deepEqual(await idsOnPage(page), [second.id]);
      await row(page, second.id).locator('button[data-special]').click();
      assert.deepEqual(await idsOnPage(page), [second.id], 'current row stays available for correction');
      await row(page, second.id).locator('button[data-special]').click();
      await page.locator('[data-nav="special-review"]').click();
      assert.deepEqual(await idsOnPage(page), [second.id], 'legacy known filter cannot hide an unknown special member');
      const saved = await read(page);
      assert.deepEqual(saved.tableRecognition, legacyRecognition);
      assert.equal(Object.hasOwn(saved.settings.table1400.all, 'status'), false);
      assert.equal(Object.hasOwn(saved.settings.table1400.special, 'status'), false);
      await context.close();
    });

    let exported;
    await check('table export preserves old recognition and special tombstones while bank switching leaves 800 progress intact', async () => {
      const legacyRecognition = { [first.id]: { status: 'unknown', updatedAt: NOW - 500 }, [second.id]: { status: 'unmarked', updatedAt: NOW - 400 } };
      const { page, context } = await fresh({ saved: base({ tableRecognition: legacyRecognition }) });
      await row(page, first.id).locator('button[data-special]').click();
      await row(page, second.id).locator('button[data-special]').click();
      await row(page, second.id).locator('button[data-special]').click();
      const before = await read(page);
      await switchBank(page, '800');
      const old = await read(page, OLD_KEY);
      for (const key of ['records', 'specialList', 'selfCheck', 'customMarker']) assert.deepEqual(old[key], old800[key]);
      assert.equal(await page.locator('.table1400').count(), 0);
      assert.equal(await page.locator('[data-self-confidence]').count(), 2);
      await switchBank(page, '1400');
      await page.locator('.table1400').waitFor();
      for (const key of ['tableRecognition', 'specialList']) assert.deepEqual((await read(page))[key], before[key]);
      await page.locator('[data-nav="progress"]').click();
      const downloading = page.waitForEvent('download');
      await page.locator('[data-action="export-progress"]').click();
      const download = await downloading; exported = await downloadJSON(download);
      assert.equal(exported.bankId, '1400');
      assert.ok(download.suggestedFilename().startsWith('gre1400-progress-'));
      for (const key of ['tableRecognition', 'specialList', 'records', 'daily', 'history']) assert.deepEqual(exported.state[key], before[key]);
      assert.equal(exported.state.tableRecognition[second.id].status, 'unmarked');
      assert.equal(exported.state.specialList[second.id].active, false);
      await context.close();
    });

    await check('table imports merge membership conflicts, preserve removal tombstones and old recognition, and reject damaged imports atomically', async () => {
      assert.ok(exported, 'export prerequisite');
      const { page, context } = await fresh();
      await importBackup(page, exported);
      const once = await read(page);
      for (const key of ['tableRecognition', 'specialList']) assert.deepEqual(once[key], exported.state[key]);
      await importBackup(page, exported);
      assert.deepEqual((await read(page)).tableRecognition, once.tableRecognition);
      const newer = JSON.parse(JSON.stringify(exported));
      newer.state.specialList[first.id] = { active: false, updatedAt: once.specialList[first.id].updatedAt + 100 };
      newer.state.specialList[second.id] = { active: true, updatedAt: once.specialList[second.id].updatedAt - 100 };
      await importBackup(page, newer);
      const merged = await read(page);
      assert.deepEqual(merged.tableRecognition, once.tableRecognition);
      assert.equal(merged.specialList[first.id].active, false);
      assert.equal(merged.specialList[second.id].active, false);
      assert.deepEqual(activeSpecial(merged), []);
      for (const key of ['records', 'daily', 'history']) assert.deepEqual(merged[key], once[key]);
      const broken = JSON.parse(JSON.stringify(newer));
      broken.state.specialList[first.id].updatedAt = null;
      const beforeBroken = await raw(page);
      await page.locator('#progress-file').setInputFiles({ name: 'damaged-table1400.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(broken)) });
      await page.locator('.toast').filter({ hasText: '特殊待复习列表' }).waitFor();
      assert.equal(await page.locator('#import-dialog[open]').count(), 0);
      assert.equal(await raw(page), beforeBroken);
      assert.equal(await raw(page, OLD_KEY), oldRaw);
      await context.close();
    });

    await check('maximum valid imported timestamps remain editable and survive refresh and export validation', async () => {
      const maximumTime = 8640000000000000;
      const saved = base({
        tableRecognition: { [first.id]: { status: 'known', updatedAt: maximumTime } },
        specialList: { [first.id]: { active: true, updatedAt: maximumTime } },
      });
      const { page, context } = await fresh();
      await importBackup(page, { ...P.exportProgress(saved, NOW), bankId: '1400' });
      await page.locator('.nav-item[data-nav="word-table"]').click();
      await row(page, first.id).locator('button[data-special]').click();
      const expectedRecognition = { status: 'known', updatedAt: maximumTime };
      const expectedSpecial = { active: false, updatedAt: maximumTime };
      let edited = await read(page);
      assert.deepEqual(edited.tableRecognition[first.id], expectedRecognition);
      assert.deepEqual(edited.specialList[first.id], expectedSpecial);
      await page.reload(); await page.locator('.table1400').waitFor();
      edited = await read(page);
      assert.deepEqual(edited.tableRecognition[first.id], expectedRecognition);
      assert.deepEqual(edited.specialList[first.id], expectedSpecial);
      assert.equal(await row(page, first.id).locator('button[data-special]').getAttribute('aria-pressed'), 'false');
      await page.locator('[data-nav="progress"]').click();
      const downloading = page.waitForEvent('download');
      await page.locator('[data-action="export-progress"]').click();
      const payload = await downloadJSON(await downloading);
      const validated = P.validateImport(payload, vocabulary, NOW).state;
      assert.deepEqual(validated.tableRecognition[first.id], expectedRecognition);
      assert.deepEqual(validated.specialList[first.id], expectedSpecial);
      assert.equal(await raw(page, OLD_KEY), oldRaw);
      await context.close();
    });

    await check('synonym supplements retain source attribution and distinct related-word content', async () => {
      const { page, context } = await fresh();
      const relation = await page.evaluate(() => {
        const pairs = Object.entries(window.GRE1400_RELATIONS?.byId || {});
        return pairs.find(([, groups]) => groups.length);
      });
      assert.ok(relation, 'source-backed synonym supplements must load');
      const [id, groups] = relation, word = vocabulary.find(word => word.id === id);
      await filter(page, 'search').fill(word.word);
      const content = compact(await row(page, id).innerText());
      for (const group of groups) {
        for (const synonym of group.words) assert.ok(content.includes(compact(synonym)), `${word.word}: ${synonym}`);
        assert.ok(content.includes(compact(group.sourceTitle)), `${word.word}: source title missing`);
      }
      const sourceLinks = await row(page, id).locator('a[href]').evaluateAll(elements => elements.map(element => element.getAttribute('href')));
      assert.ok(sourceLinks.some(href => href.includes(`#page=${word.page}`)), 'original PDF page remains linked');
      for (const group of groups) if (group.sourceUrl) assert.ok(sourceLinks.some(href => href.startsWith(group.sourceUrl)), 'supplement source link remains available');
      if (word.relatedWords) assert.ok(content.includes(compact(word.relatedWords)));
      await context.close();
    });

    await check('mobile table keeps all definitions and row actions accessible without document overflow', async () => {
      const { page, context } = await fresh({ viewport: { width: 375, height: 850 } });
      await noOverflow(page, '375px table');
      const word = vocabulary.find(word => word.word === 'original');
      await filter(page, 'search').fill(word.word);
      const target = row(page, word.id), visible = compact(await target.innerText());
      for (const definition of word.definitions) assert.ok(visible.includes(compact(definition.meaning)));
      assert.deepEqual(activeSpecial(await read(page)), []);
      assert.equal(await target.locator('button').count(), 1);
      await target.locator('button[data-special]').click();
      assert.deepEqual(activeSpecial(await read(page)), [word.id]);
      assert.equal(await target.locator('button[data-special]').getAttribute('aria-pressed'), 'true');
      await noOverflow(page, '375px marked row');
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(out, '1400-table-mobile.png'), fullPage: false, animations: 'disabled' });
      await page.setViewportSize({ width: 320, height: 740 });
      await noOverflow(page, '320px table');
      await context.close();
    });

    await check('all checks used local data without uncaught JavaScript errors or remote requests', async () => {
      assert.deepEqual(errors, []); assert.deepEqual(requests, []);
    });
  } finally {
    for (const context of contexts) await context.close();
    await browser.close();
    fs.writeFileSync(path.join(out, 'table1400-browser-report.json'), JSON.stringify({ testedAt: new Date().toISOString(), results, errors, requests }, null, 2));
    if (results.some(result => !result.ok) || errors.length || requests.length) process.exitCode = 1;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
