'use strict';

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k.startsWith('aria-') && v != null) { e.setAttribute(k, String(v)); continue; }
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

/* ---------- companies ---------- */
const STATUSES = ['Met', 'Follow up', 'Applied', 'Not interested'];
state.companies = [];
state.filter = { q: '', status: '' };

function starsRO(n) {
  return h('span', { class: 'stars ro', 'aria-label': `Interest ${n} of 5` },
    [1, 2, 3, 4, 5].map(i => h('span', { class: i <= n ? '' : 'off' }, '★')));
}
function starPicker(value, onChange) {
  const wrap = h('div', { class: 'stars', role: 'group', 'aria-label': 'Interest' });
  const paint = () => [...wrap.children].forEach((b, i) => b.classList.toggle('on', i < value));
  for (let i = 1; i <= 5; i++) {
    wrap.append(h('button', { type: 'button', 'aria-label': `${i} star`, onclick: () => {
      value = value === i ? 0 : i; paint(); onChange(value);
    } }, '★'));
  }
  paint();
  return wrap;
}
function statusPicker(value, onChange) {
  const wrap = h('div', { class: 'chips' });
  const paint = () => [...wrap.children].forEach(b => b.setAttribute('aria-pressed', b.dataset.s === value));
  for (const s of STATUSES) {
    wrap.append(h('button', { type: 'button', class: 'chip status', 'data-s': s, onclick: () => { value = s; paint(); onChange(s); } },
      h('span', { class: 'dot' }), s));
  }
  paint();
  return wrap;
}

async function saveCompany(c) {
  c.updated = Date.now();
  await DB.put('companies', c);
  const i = state.companies.findIndex(x => x.id === c.id);
  if (i >= 0) state.companies[i] = c; else state.companies.push(c);
}

function companyCard(c) {
  const meta = [];
  if (c.booth) meta.push(h('div', null, 'Booth ', h('b', null, c.booth)));
  if (c.contact) meta.push(h('div', null, c.contact));
  if (c.email) meta.push(h('a', { href: 'mailto:' + c.email }, c.email));
  if (c.phone) meta.push(h('a', { href: 'tel:' + c.phone.replace(/[^\d+]/g, '') }, c.phone));
  const qBtn = typeof askedCount === 'function'
    ? h('button', { class: 'btn', onclick: () => openChecklist(c.id) }, 'Questions ' + askedCount(c)) : null;
  return h('article', { class: 'card' },
    h('div', { class: 'top' },
      h('div', null, h('h3', null, c.name || '(no name)'), c.role ? h('div', { class: 'muted small' }, c.role) : null),
      h('button', { class: 'chip status', 'data-s': c.status, 'aria-pressed': 'true', 'aria-label': 'Status ' + c.status + ', tap to change',
        onclick: async () => {
          c.status = STATUSES[(STATUSES.indexOf(c.status) + 1) % STATUSES.length];
          await saveCompany(c); renderCompanies(); toast('Status: ' + c.status);
        } }, h('span', { class: 'dot' }), c.status)),
    meta.length ? h('div', { class: 'meta' }, meta) : null,
    c.interest ? starsRO(c.interest) : null,
    c.notes ? h('div', { class: 'notes' }, c.notes) : null,
    h('div', { class: 'actions' },
      qBtn,
      h('button', { class: 'btn', onclick: () => editCompany(c) }, 'Edit'),
      h('button', { class: 'btn danger', onclick: async () => {
        if (!(await confirmBox(`Delete "${c.name}"? This cannot be undone.`))) return;
        await DB.del('companies', c.id);
        state.companies = state.companies.filter(x => x.id !== c.id);
        renderCompanies(); toast('Deleted');
      } }, 'Delete')));
}

function renderStatusFilter() {
  const f = $('#statusFilter');
  const count = (s) => state.companies.filter(c => !s || c.status === s).length;
  f.replaceChildren(...['', ...STATUSES].map(s => h('button', {
    class: 'chip' + (s ? ' status' : ''), 'data-s': s || null, 'aria-pressed': state.filter.status === s,
    onclick: () => { state.filter.status = s; renderCompanies(); },
  }, s ? h('span', { class: 'dot' }) : null, `${s || 'All'} ${count(s)}`)));
}

function renderCompanies() {
  renderStatusFilter();
  const q = state.filter.q.trim().toLowerCase();
  const list = state.companies
    .filter(c => !state.filter.status || c.status === state.filter.status)
    .filter(c => !q || [c.name, c.booth, c.contact, c.email, c.phone, c.role, c.notes].join(' ').toLowerCase().includes(q))
    .sort((a, b) => b.created - a.created);
  $('#companyList').replaceChildren(...(list.length ? list.map(companyCard)
    : [h('div', { class: 'empty' }, state.companies.length ? 'No matches.' : 'No companies yet. Tap + to add one.')]));
}
renderers.companies = renderCompanies;
$('#search').addEventListener('input', (e) => { state.filter.q = e.target.value; renderCompanies(); });

function editCompany(orig) {
  const isNew = !orig;
  const c = isNew
    ? { id: uid(), name: '', booth: '', contact: '', email: '', phone: '', role: '', notes: '', interest: 0, status: 'Met', asked: [], extra: [], created: Date.now() }
    : { ...orig };
  const inp = (key, label, type = 'text', extra = {}) => {
    const el = h('input', { type, value: c[key] || '', autocomplete: 'off', ...extra });
    el.addEventListener('input', () => { c[key] = el.value; });
    return [h('label', { class: 'field' }, label, el), el];
  };
  const [fName, nameEl] = inp('name', 'Company name', 'text', { autocapitalize: 'words', enterkeyhint: 'done' });
  nameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  const notes = h('textarea', { value: c.notes || '', placeholder: 'Notes (Apple Pencil Scribble works here)' });
  notes.addEventListener('input', () => { c.notes = notes.value; });
  const form = h('div', { class: 'form' },
    fName,
    h('div', { class: 'two' }, inp('booth', 'Booth')[0], inp('role', 'Role / position')[0]),
    inp('contact', 'Contact person', 'text', { autocapitalize: 'words' })[0],
    h('div', { class: 'two' },
      inp('email', 'Email', 'email', { autocapitalize: 'off', inputmode: 'email' })[0],
      inp('phone', 'Phone', 'tel', { inputmode: 'tel' })[0]),
    h('label', { class: 'field' }, 'Notes', notes),
    h('div', { class: 'field' }, h('span', { class: 'muted small', style: 'font-weight:600' }, 'Interest'),
      starPicker(c.interest || 0, v => { c.interest = v; })),
    h('div', { class: 'field' }, h('span', { class: 'muted small', style: 'font-weight:600' }, 'Status'),
      statusPicker(c.status, v => { c.status = v; })));
  async function save() {
    c.name = c.name.trim();
    if (!c.name) { toast('Company name required'); nameEl.focus(); return; }
    await saveCompany(c);
    closeSheet(); renderCompanies(); toast(isNew ? 'Added' : 'Saved');
  }
  openSheet(isNew ? 'New company' : 'Edit company', form,
    { right: h('button', { class: 'btn primary', onclick: save }, 'Save') });
  if (isNew) nameEl.focus();
}
$('#addCompany').addEventListener('click', () => editCompany());

/* ---------- boot ---------- */
async function boot() {
  await DB.open();
  const s = await DB.get('kv', 'settings');
  if (s) Object.assign(state.settings, s);
  applyTheme();
  state.companies = await DB.all('companies');
  showTab('companies');
}
boot().catch(err => { console.error(err); toast('Storage error: ' + err.message); });
