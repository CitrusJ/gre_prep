/* Full-source, frequency-ordered vocabulary table. Persistence belongs to app.js. */
(() => {
  'use strict';

  const mounted = new WeakMap();
  const remembered = new Map();
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const hasContent = value => value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0);
  const normalize = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
  const textOf = value => {
    if (!hasContent(value)) return '';
    if (Array.isArray(value)) return value.map(textOf).join(' ');
    if (typeof value === 'object') return Object.values(value).map(textOf).join(' ');
    return String(value);
  };
  const notesOf = value => (Array.isArray(value) ? value : hasContent(value) ? [value] : []).filter(note => !/字体|小字栏/.test(textOf(note)));
  const fieldNames = { word: '词', meaning: '释义', english: '英文', chinese: '中文', translation: '译文', pos: '词性', example: '例句', text: '原文', sourceLabel: '考法', phonetic: '音标' };

  function valueHTML(value) {
    if (!hasContent(value)) return '';
    if (Array.isArray(value)) return `<ul class="table1400-value-list">${value.map(item => `<li>${valueHTML(item)}</li>`).join('')}</ul>`;
    if (typeof value === 'object') return Object.entries(value).filter(([, item]) => hasContent(item)).map(([key, item]) => `<div><span class="table1400-field-label">${escapeHTML(fieldNames[key] || key)}：</span>${valueHTML(item)}</div>`).join('');
    return `<span class="table1400-source-text">${escapeHTML(value)}</span>`;
  }

  function fieldHTML(label, value, extraClass = '') {
    return hasContent(value) ? `<div class="table1400-learning-field ${extraClass}"><span class="table1400-field-label">${escapeHTML(label)}</span>${valueHTML(value)}</div>` : '';
  }

  function sourceLink(url, page, label) {
    if (!url) return escapeHTML(label);
    try {
      const parsed = new URL(String(url), document.baseURI);
      if (!['http:', 'https:', 'file:'].includes(parsed.protocol)) return escapeHTML(label);
      const href = String(url).replace(/#.*$/, '') + (Number(page) > 0 ? `#page=${Number(page)}` : '');
      return `<a href="${escapeHTML(href)}" target="_blank" rel="noopener noreferrer">${escapeHTML(label)}</a>`;
    } catch { return escapeHTML(label); }
  }

  function extraDefinitionHTML(definition) {
    return fieldHTML('例句', definition.example) + fieldHTML('例句', definition.examples)
      + fieldHTML('近义词', definition.synonyms)
      + fieldHTML('派生词', definition.derivatives)
      + fieldHTML('助记', definition.mnemonic)
      + fieldHTML('相关词', definition.relatedWords)
      + fieldHTML('原书备注', notesOf(definition.sourceNotes), 'table1400-note');
  }

  function definitionsHTML(word) {
    const definitions = Array.isArray(word.definitions) ? word.definitions : [];
    if (!definitions.length) return `<div class="table1400-sense">${hasContent(word.sourceLabel) ? `<span class="table1400-sense-label">${escapeHTML(word.sourceLabel)}</span>` : ''}<p>${word.pos ? `<span class="table1400-pos">${escapeHTML(word.pos)}</span> ` : ''}${valueHTML(word.meaning)}</p>${word.english ? `<div class="table1400-english">${valueHTML(word.english)}</div>` : ''}</div>`;
    const main = definitions.map(definition => `<div class="table1400-sense">${hasContent(definition.sourceLabel) ? `<span class="table1400-sense-label">${escapeHTML(definition.sourceLabel)}</span>` : ''}<div>${definition.pos ? `<span class="table1400-pos">${escapeHTML(definition.pos)}</span> ` : ''}${valueHTML(definition.meaning)}</div>${hasContent(definition.english) ? `<div class="table1400-english">${valueHTML(definition.english)}</div>` : ''}${extraDefinitionHTML(definition)}</div>`).join('');
    const original = definitions.filter(definition => hasContent(definition.sourceText)).map(definition => `<div class="table1400-original-sense">${definition.sourceLabel ? `<span class="table1400-field-label">${escapeHTML(definition.sourceLabel)} </span>` : ''}${valueHTML(definition.sourceText)}</div>`).join('');
    const summary = fieldHTML('词条释义汇总', word.meaning) + fieldHTML('词条英文释义', word.english) + fieldHTML('原书词条标记', word.sourceLabel);
    return main + (original || summary ? `<details class="table1400-original"><summary>词条汇总与原书释义原文</summary>${summary}${original}</details>` : '');
  }

  function relationsHTML(word, relations) {
    const groups = Array.isArray(relations) ? relations : [];
    const linked = groups.length ? `<div class="table1400-learning-field"><span class="table1400-field-label">近义／等价</span><ul class="table1400-relation-list">${groups.map(group => `<li><div class="table1400-relation-words">${valueHTML(group.words)}</div>${hasContent(group.meaning) ? `<div>${group.pos ? `<span class="table1400-pos">${escapeHTML(group.pos)}</span> ` : ''}${valueHTML(group.meaning)}</div>` : ''}${hasContent(group.english) ? `<div class="table1400-english">${valueHTML(group.english)}</div>` : ''}<div class="table1400-relation-source">${sourceLink(group.sourceUrl, group.page, group.sourceTitle || '原书来源')}${hasContent(group.sourceLabel) ? ` · ${escapeHTML(group.sourceLabel)}` : ''}${hasContent(group.sourceHeadword) ? ` · 来源词条 ${escapeHTML(group.sourceHeadword)}` : ''}${Number(group.page) > 0 ? ` · 原文件第 ${escapeHTML(group.page)} 页` : ''}</div>${fieldHTML('来源备注', notesOf(group.sourceNotes), 'table1400-note')}</li>`).join('')}</ul></div>` : '';
    return linked + fieldHTML('原书近义词', word.synonyms)
      + fieldHTML('原书相关词', word.relatedWords)
      + fieldHTML('派生词', word.derivatives)
      + fieldHTML('助记', word.mnemonic)
      + fieldHTML('例句', word.example) + fieldHTML('例句', word.examples)
      + fieldHTML('原书备注', notesOf(word.sourceNotes), 'table1400-note')
      || '<span class="table1400-muted">原书未列出相关内容</span>';
  }

  function mount(options) {
    if (!options || !options.root) throw new Error('GRETable1400.mount needs a root element.');
    const root = options.root;
    mounted.get(root)?.destroy();
    const scope = options.scope === 'special' ? 'special' : 'all';
    const getState = typeof options.getState === 'function' ? options.getState : () => ({});
    const relations = options.relations?.byId || options.relations || {};
    const entries = (Array.isArray(options.words) ? options.words : []).map((word, index) => {
      const suffix = String(word.id || '').match(/(\d+)$/);
      const order = suffix ? Number(suffix[1]) : index + 1;
      const frequency = hasContent(word.sourceFrequency) && Number.isFinite(Number(word.sourceFrequency)) ? Number(word.sourceFrequency) : -1;
      return { word, order, frequency, index, search: normalize([word.word, word.phonetic, word.pos, word.meaning, word.english, word.sourceLabel, word.definitions, word.relatedWords, word.mnemonic, word.synonyms, word.derivatives, word.example, word.examples, notesOf(word.sourceNotes), relations[word.id]].map(textOf).join(' ')) };
    }).sort((a, b) => b.frequency - a.frequency || a.order - b.order || a.index - b.index);
    const entryById = new Map(entries.map(entry => [String(entry.word.id), entry]));
    const defaults = { search: '', list: '', specialOnly: false, pageSize: 25, page: 1 };
    let prefs = { ...defaults };
    let matched = [];
    let pageCount = 1;
    let destroyed = false;
    let pendingCount = 0;
    let snapshotChanged = false;

    function readPreferences() {
      let saved;
      try { saved = options.getPreferences?.(scope); } catch { /* Reading preferences must not prevent study. */ }
      const previous = saved || remembered.get(scope) || {};
      // Recognition filters belonged to the old UI; never retain an invisible filter.
      prefs = Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, previous[key] ?? value]));
      prefs.search = String(prefs.search || '');
      prefs.list = String(prefs.list || '');
      if (!entries.some(entry => String(entry.word.group) === prefs.list)) prefs.list = '';
      prefs.specialOnly = scope === 'special' || prefs.specialOnly === true;
      prefs.pageSize = prefs.pageSize === 'all' ? 'all' : [25, 50, 100].includes(Number(prefs.pageSize)) ? Number(prefs.pageSize) : 25;
      prefs.page = Math.max(1, Math.floor(Number(prefs.page)) || 1);
    }

    function savePreferences() {
      remembered.set(scope, { ...prefs });
      try { options.savePreferences?.(scope, { ...prefs }); } catch { /* View preferences are optional. */ }
    }

    function stateNow() { return getState() || {}; }
    function isSpecial(id, state = stateNow()) { return state.specialList?.[id]?.active === true; }

    function actionsHTML(word, state) {
      const active = isSpecial(word.id, state);
      return `<button type="button" class="table1400-special" data-special aria-pressed="${active}" aria-label="${escapeHTML(word.word)}：${active ? '移出' : '加入'}特殊待复习">${active ? '已加入 · 点击移出' : '加入特殊待复习'}</button>`;
    }

    function rowHTML(entry, state) {
      const { word, order, frequency } = entry;
      return `<tr data-word-id="${escapeHTML(word.id)}" role="row"><td class="table1400-source" data-label="原书顺序" role="cell"><strong>第 ${order} 词</strong><span>考频 ${frequency >= 0 ? frequency : '未标注'}</span>${word.group ? `<span>List ${escapeHTML(word.group)}${word.unit ? ` · Unit ${escapeHTML(word.unit)}` : ''}</span>` : ''}${word.page ? `<span>${sourceLink(word.sourceUrl, word.page, `原文件第 ${word.page} 页`)}</span>` : ''}</td><th scope="row" class="table1400-word-cell" role="rowheader"><span class="table1400-word">${escapeHTML(word.word)}</span>${word.phonetic ? `<span class="table1400-phonetic">${escapeHTML(word.phonetic)}</span>` : ''}</th><td class="table1400-definitions" data-label="完整释义" role="cell">${definitionsHTML(word)}</td><td class="table1400-related" data-label="近义、相关词与助记" role="cell">${relationsHTML(word, relations[word.id])}</td><td class="table1400-actions" data-label="特殊待复习" role="cell">${actionsHTML(word, state)}</td></tr>`;
    }

    function shellHTML() {
      const lists = [...new Set(entries.map(entry => entry.word.group).filter(hasContent))].sort((a, b) => Number(a) - Number(b));
      return `<section class="table1400" aria-label="${scope === 'special' ? '1400 词特殊待复习表格' : '1400 词考频背诵表格'}"><header class="table1400-header"><div><h1 class="page-title" tabindex="-1">${scope === 'special' ? '特殊待复习 · 1400 词' : '1400 词 · 考频表格'}</h1><p>按原书考频从高到低排列，同频保留原书顺序。点击右侧按钮，直接加入或移出特殊待复习。</p></div></header><div class="table1400-stats" aria-label="全词库学习统计">${[['total', '全词库'], ['special', '特殊待复习']].map(([key, label]) => `<span>${label} <strong data-table1400-stat="${key}">0</strong></span>`).join('')}</div><form class="table1400-filters" role="search"><label class="table1400-search"><span>搜索词汇与释义</span><input type="search" data-table1400-filter="search" value="${escapeHTML(prefs.search)}" placeholder="单词、中文、英文、近义词或相关词" autocomplete="off"></label><label><span>原书 List</span><select data-table1400-filter="list"><option value="">全部 List</option>${lists.map(list => `<option value="${escapeHTML(list)}" ${String(list) === prefs.list ? 'selected' : ''}>List ${escapeHTML(list)}</option>`).join('')}</select></label><label><span>每页词数</span><select data-table1400-filter="pageSize">${[25, 50, 100, 'all'].map(size => `<option value="${size}" ${prefs.pageSize === size ? 'selected' : ''}>${size === 'all' ? '全部词汇' : `${size} 词`}</option>`).join('')}</select></label>${scope === 'all' ? `<label class="table1400-only-special"><input type="checkbox" data-table1400-filter="specialOnly" ${prefs.specialOnly ? 'checked' : ''}><span>仅特殊待复习</span></label>` : ''}<button type="button" class="table1400-reset" data-table1400-reset>清空筛选</button></form><div class="table1400-result-bar"><span data-table1400-results></span><span class="table1400-muted">完整释义默认展示 · 近义词按来源分别列出</span></div><p class="table1400-notice" data-table1400-notice role="status" aria-live="polite"></p><div class="table1400-scroll"><table role="table"><caption class="sr-only">按原书 GRE 考频排序的词汇。每行右侧按钮可直接加入或移出特殊待复习。</caption><colgroup><col class="table1400-col-source"><col class="table1400-col-word"><col class="table1400-col-definition"><col class="table1400-col-related"><col class="table1400-col-actions"></colgroup><thead role="rowgroup"><tr role="row"><th scope="col">原序／考频</th><th scope="col">单词</th><th scope="col">完整多义释义</th><th scope="col">近义、相关词与助记</th><th scope="col">特殊待复习</th></tr></thead><tbody role="rowgroup" data-table1400-body></tbody></table></div><div class="table1400-empty" data-table1400-empty hidden><strong data-table1400-empty-title></strong><p data-table1400-empty-text></p></div><nav class="table1400-pagination" aria-label="词汇表格分页"><span data-table1400-page-summary></span><div><button type="button" data-table1400-page="first" aria-label="第一页">首页</button><button type="button" data-table1400-page="prev">上一页</button><label>第 <select data-table1400-page="select" aria-label="跳转到页码"></select> 页</label><button type="button" data-table1400-page="next">下一页</button><button type="button" data-table1400-page="last" aria-label="最后一页">末页</button></div></nav></section>`;
    }

    function updateStats(state = stateNow()) {
      const counts = { total: entries.length, special: 0 };
      for (const { word } of entries) { if (isSpecial(word.id, state)) counts.special += 1; }
      Object.entries(counts).forEach(([key, count]) => { root.querySelector(`[data-table1400-stat="${key}"]`).textContent = count.toLocaleString('zh-CN'); });
    }

    function setNotice(message, isError = false) {
      const notice = root.querySelector('[data-table1400-notice]');
      if (!notice) return;
      notice.textContent = message;
      notice.classList.toggle('is-error', isError);
    }

    function renderResults() {
      const state = stateNow();
      const terms = normalize(prefs.search).split(' ').filter(Boolean);
      matched = entries.filter(({ word, search }) => (!prefs.list || String(word.group) === prefs.list) && (!prefs.specialOnly || isSpecial(word.id, state)) && terms.every(term => search.includes(term)));
      pageCount = prefs.pageSize === 'all' ? 1 : Math.max(1, Math.ceil(matched.length / prefs.pageSize));
      prefs.page = Math.min(pageCount, Math.max(1, prefs.page));
      const first = prefs.pageSize === 'all' ? 0 : (prefs.page - 1) * prefs.pageSize;
      const last = prefs.pageSize === 'all' ? matched.length : Math.min(matched.length, first + prefs.pageSize);
      const shown = matched.filter((_, index) => index >= first && index < last);
      root.querySelector('[data-table1400-body]').innerHTML = shown.map(entry => rowHTML(entry, state)).join('');
      root.querySelector('[data-table1400-results]').textContent = matched.length ? `共 ${matched.length.toLocaleString('zh-CN')} 词，当前展示第 ${first + 1}–${last} 词` : '当前筛选下共 0 词';
      root.querySelector('[data-table1400-page-summary]').textContent = matched.length ? `第 ${prefs.page} / ${pageCount} 页` : '暂无结果';
      const pageSelect = root.querySelector('[data-table1400-page="select"]');
      pageSelect.innerHTML = Array.from({ length: pageCount }, (_, index) => `<option value="${index + 1}" ${index + 1 === prefs.page ? 'selected' : ''}>${index + 1}</option>`).join('');
      pageSelect.disabled = pageCount <= 1;
      ['first', 'prev', 'next', 'last'].forEach(action => { root.querySelector(`[data-table1400-page="${action}"]`).disabled = action === 'first' || action === 'prev' ? prefs.page <= 1 : prefs.page >= pageCount; });
      const empty = root.querySelector('[data-table1400-empty]');
      empty.hidden = matched.length > 0;
      root.querySelector('.table1400-scroll').hidden = !matched.length;
      const emptySpecial = prefs.specialOnly && !entries.some(({ word }) => isSpecial(word.id, state));
      root.querySelector('[data-table1400-empty-title]').textContent = emptySpecial ? '特殊待复习中还没有词' : '没有符合筛选条件的词';
      root.querySelector('[data-table1400-empty-text]').textContent = emptySpecial ? '在 1400 词表格中点击“加入特殊待复习”，就会显示在这里。' : '可以修改搜索内容，或清空筛选条件。';
      snapshotChanged = false;
      setNotice('');
      updateStats(state);
      savePreferences();
    }

    function updateRow(row, state) {
      const id = row.dataset.wordId;
      const active = isSpecial(id, state);
      const button = row.querySelector('[data-special]');
      button.setAttribute('aria-pressed', String(active));
      button.setAttribute('aria-label', `${entryById.get(id)?.word.word || id}：${active ? '移出' : '加入'}特殊待复习`);
      button.textContent = active ? '已加入 · 点击移出' : '加入特殊待复习';
    }

    async function mutateRow(row, value) {
      const id = row.dataset.wordId;
      const word = entryById.get(id)?.word;
      if (!word || row.dataset.pending === 'true') return;
      row.dataset.pending = 'true';
      pendingCount += 1;
      try {
        const callback = options.setSpecial;
        if (typeof callback !== 'function') throw new Error('缺少保存回调');
        const saved = await callback(id, value);
        if (saved === false) throw new Error('浏览器未能保存，请先导出学习数据备份。');
        if (destroyed) return;
        const state = stateNow();
        updateRow(row, state);
        updateStats(state);
        snapshotChanged ||= prefs.specialOnly;
        const confirmation = `${word.word}：${value ? '已加入' : '已移出'}特殊待复习`;
        setNotice(confirmation + (snapshotChanged ? '。本页保持当前位置，切换筛选或页码时更新列表。' : '。'));
        options.onChange?.({ id, action: 'special', value });
      } catch (error) {
        if (!destroyed) { updateRow(row, stateNow()); setNotice(`保存未完成，请重试。${error?.message || ''}`, true); }
      } finally { pendingCount -= 1; delete row.dataset.pending; }
    }

    function handleClick(event) {
      const special = event.target.closest('button[data-special]');
      if (special && root.contains(special)) {
        const row = special.closest('[data-word-id]');
        mutateRow(row, !isSpecial(row.dataset.wordId));
        return;
      }
      const reset = event.target.closest('[data-table1400-reset]');
      if (reset) {
        prefs = { ...defaults, pageSize: prefs.pageSize, specialOnly: scope === 'special' };
        root.querySelector('[data-table1400-filter="search"]').value = '';
        root.querySelector('[data-table1400-filter="list"]').value = '';
        const specialFilter = root.querySelector('[data-table1400-filter="specialOnly"]');
        if (specialFilter) specialFilter.checked = prefs.specialOnly;
        renderResults();
        return;
      }
      const page = event.target.closest('button[data-table1400-page]');
      if (!page || page.disabled) return;
      const action = page.dataset.table1400Page;
      prefs.page = action === 'first' ? 1 : action === 'last' ? pageCount : prefs.page + (action === 'prev' ? -1 : 1);
      renderResults();
      root.querySelector('.table1400-result-bar').scrollIntoView({ block: 'start', behavior: 'auto' });
    }

    function handleInput(event) {
      if (event.target.dataset.table1400Filter !== 'search') return;
      prefs.search = event.target.value;
      prefs.page = 1;
      renderResults();
    }

    function handleChange(event) {
      const target = event.target;
      if (target.matches('select[data-table1400-page]')) { prefs.page = Number(target.value) || 1; renderResults(); return; }
      const key = target.dataset.table1400Filter;
      if (!key || key === 'search') return;
      prefs[key] = key === 'specialOnly' ? target.checked : key === 'pageSize' && target.value !== 'all' ? Number(target.value) : target.value;
      prefs.page = 1;
      renderResults();
    }

    function preventSubmit(event) { if (event.target.matches('.table1400-filters')) event.preventDefault(); }
    function refresh() {
      if (destroyed) return;
      readPreferences();
      root.innerHTML = shellHTML();
      renderResults();
    }
    function destroy() {
      destroyed = true;
      root.removeEventListener('click', handleClick);
      root.removeEventListener('input', handleInput);
      root.removeEventListener('change', handleChange);
      root.removeEventListener('submit', preventSubmit);
      if (mounted.get(root) === api) mounted.delete(root);
    }
    const api = { refresh, destroy, get pending() { return pendingCount > 0; } };
    mounted.set(root, api);
    root.addEventListener('click', handleClick);
    root.addEventListener('input', handleInput);
    root.addEventListener('change', handleChange);
    root.addEventListener('submit', preventSubmit);
    refresh();
    return api;
  }

  window.GRETable1400 = { mount };
})();
