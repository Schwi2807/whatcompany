'use strict';

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'value') value = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : String(k));
  if (value !== undefined) e.value = value;
  return e;
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1600);
}

/* ---------- IndexedDB ---------- */
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('whatcompany', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('companies', { keyPath: 'id' });
        d.createObjectStore('questions', { keyPath: 'id' });
        d.createObjectStore('kv');
      };
      r.onsuccess = () => res(this.db = r.result);
      r.onerror = () => rej(r.error);
    });
  },
  run(store, mode, fn) {
    return new Promise((res, rej) => {
      const t = this.db.transaction(store, mode);
      let req;
      try { req = fn(t.objectStore(store)); } catch (e) { rej(e); return; }
      t.oncomplete = () => res(req && req.result);
      t.onerror = t.onabort = () => rej(t.error);
    });
  },
  all: (s) => DB.run(s, 'readonly', st => st.getAll()),
  get: (s, k) => DB.run(s, 'readonly', st => st.get(k)),
  put: (s, v, k) => DB.run(s, 'readwrite', st => k === undefined ? st.put(v) : st.put(v, k)),
  del: (s, k) => DB.run(s, 'readwrite', st => st.delete(k)),
  clear: (s) => DB.run(s, 'readwrite', st => st.clear()),
};

/* ---------- state ---------- */
const state = {
  tab: 'companies',
  settings: { theme: 'system' },
};

/* ---------- theme ---------- */
function applyTheme() {
  const t = state.settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  try { localStorage.setItem('wc-theme', t); } catch (e) {}
}
async function setTheme(t) {
  state.settings.theme = t;
  applyTheme();
  await DB.put('kv', state.settings, 'settings');
}

/* ---------- sheet (modal) ---------- */
function openSheet(title, body, { left, right, cls } = {}) {
  const s = $('#sheet');
  s.className = 'sheet' + (cls ? ' ' + cls : '');
  s.replaceChildren(h('div', { class: 'box', role: 'dialog', 'aria-label': title },
    h('div', { class: 'head' },
      left || h('button', { class: 'btn ghost', onclick: closeSheet }, 'Close'),
      h('h2', null, title),
      right || h('span', { style: 'width:72px' })),
    h('div', { class: 'body' }, body)));
  s.hidden = false;
  s.onclick = (e) => { if (e.target === s) closeSheet(); };
}
function closeSheet() {
  const s = $('#sheet');
  s.hidden = true;
  s.replaceChildren();
  if (state.onSheetClose) { const f = state.onSheetClose; state.onSheetClose = null; f(); }
}
function confirmBox(msg, okLabel = 'Delete') {
  return new Promise(res => {
    const done = (v) => { state.onSheetClose = null; closeSheet(); res(v); };
    openSheet('Confirm', h('div', { class: 'form' },
      h('p', { style: 'margin:0' }, msg),
      h('div', { class: 'row end' },
        h('button', { class: 'btn', onclick: () => done(false) }, 'Cancel'),
        h('button', { class: 'btn primary', style: 'background:var(--danger);border-color:var(--danger)', onclick: () => done(true) }, okLabel))),
      { cls: 'confirm', left: h('span', { style: 'width:72px' }) });
    state.onSheetClose = () => res(false);
  });
}

/* ---------- tabs ---------- */
const renderers = {};
function showTab(name) {
  state.tab = name;
  for (const sec of $$('main > .tab')) sec.hidden = sec.id !== 'tab-' + name;
  for (const b of $$('#tabbar button')) b.setAttribute('aria-selected', b.dataset.tab === name);
  $('main').scrollTop = 0;
  if (renderers[name]) renderers[name]();
}
$('#tabbar').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (b) showTab(b.dataset.tab);
});

/* ---------- boot ---------- */
async function boot() {
  await DB.open();
  const s = await DB.get('kv', 'settings');
  if (s) Object.assign(state.settings, s);
  applyTheme();
  showTab('companies');
}
boot().catch(err => { console.error(err); toast('Storage error: ' + err.message); });
