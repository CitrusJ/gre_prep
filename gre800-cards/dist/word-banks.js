/* Vocabulary collections share the interface and keep separate learning records. */
(() => {
  'use strict';
  const preferenceKey = 'gre-word-studio-bank-v1';
  const banks = {
    '800': { id: '800', label: 'GRE 800 词', title: 'GRE800词', storageKey: 'gre800-word-studio-v1', sourceUrl: '../../materials/vocabulary/《GRE800词 》.pdf', words: window.GRE_WORDS || [] },
    '1400': { id: '1400', label: '急救 1400 词', title: '学而思GRE急救1400词2026版', storageKey: 'gre1400-word-studio-v1', sourceUrl: '../../materials/vocabulary/学而思GRE急救1400词2026版.pdf', words: window.GRE_WORDS_1400 || [] }
  };
  let remembered = '800';
  try { remembered = localStorage.getItem(preferenceKey) || remembered; } catch {}
  const requested = new URL(location.href).searchParams.get('bank');
  const id = Object.hasOwn(banks, requested) ? requested : Object.hasOwn(banks, remembered) ? remembered : '800';
  const current = banks[id];
  const select = document.getElementById('word-bank');
  if (select) {
    select.value = id;
    select.addEventListener('change', () => {
      const next = select.value;
      if (!Object.hasOwn(banks, next) || next === id) return;
      if (!banks[next].words.length) {
        select.value = id;
        document.getElementById('storage-status').textContent = '这本词库尚未加载，请保留完整应用文件夹后刷新。';
        return;
      }
      try { localStorage.setItem(preferenceKey, next); } catch {}
      const url = new URL(location.href);
      url.searchParams.set('bank', next);
      location.assign(url.href);
    });
  }
  document.title = `词间 · ${current.label}`;
  const brand = document.querySelector('.brand');
  if (brand) brand.setAttribute('aria-label', `词间 ${current.label} 首页`);
  const brandLabel = document.querySelector('.brand-copy > span');
  if (brandLabel) brandLabel.textContent = `GRE ${id}`;
  window.GREWordBanks = { current, banks };
})();
