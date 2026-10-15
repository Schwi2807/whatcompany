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

/* ---------- ask (questions) ---------- */
state.questions = [];
const SEED_QUESTIONS = [
  'What does the first year look like for a graduate engineer here?',
  'What kind of projects would a new graduate work on?',
  'What training or mentoring do you give new engineers?',
  'Which skills or tools do you value most in graduate hires?',
  'What does the hiring process and timeline look like?',
  'Are graduate or internship roles open now, and how should I apply?',
];
const sortedQuestions = () => [...state.questions].sort((a, b) => a.order - b.order);

function askedCount(c) {
  const ids = new Set(state.questions.map(q => q.id));
  const asked = (c.asked || []).filter(id => ids.has(id)).length + (c.extra || []).filter(x => x.asked).length;
  return `${asked}/${state.questions.length + (c.extra || []).length}`;
}
function askedTexts(c) {
  const asked = new Set(c.asked || []);
  return [...sortedQuestions().filter(q => asked.has(q.id)).map(q => q.text),
    ...(c.extra || []).filter(x => x.asked).map(x => x.text)];
}

async function addQuestion(text) {
  const q = { id: uid(), text, order: Math.max(0, ...state.questions.map(x => x.order)) + 1 };
  await DB.put('questions', q);
  state.questions.push(q);
}

function renderAsk() {
  const v = $('#askView');
  const companies = [...state.companies].sort((a, b) => a.name.localeCompare(b.name));
  const pick = h('select', { 'aria-label': 'Company' },
    h('option', { value: '' }, companies.length ? 'Choose a company…' : 'No companies yet'),
    companies.map(c => h('option', { value: c.id }, `${c.name}  (${askedCount(c)})`)));
  pick.addEventListener('change', () => { if (pick.value) openChecklist(pick.value); pick.value = ''; });

  const list = h('div', { class: 'list' }, sortedQuestions().map(q => {
    const inp = h('input', { type: 'text', value: q.text, 'aria-label': 'Question' });
    inp.addEventListener('change', async () => {
      const t = inp.value.trim();
      if (!t) { inp.value = q.text; return; }
      q.text = t; await DB.put('questions', q); toast('Saved');
    });
    return h('div', { class: 'item' }, inp,
      h('button', { class: 'btn ghost danger', 'aria-label': 'Delete question', onclick: async () => {
        if (!(await confirmBox(`Delete question "${q.text}"?`))) return;
        await DB.del('questions', q.id);
        state.questions = state.questions.filter(x => x.id !== q.id);
        renderAsk();
      } }, '✕'));
  }));
  const add = h('input', { type: 'text', placeholder: 'New question', enterkeyhint: 'done' });
  const doAdd = async () => {
    const t = add.value.trim(); if (!t) return;
    await addQuestion(t); renderAsk(); toast('Added');
  };
  add.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdd(); });

  v.replaceChildren(
    h('h2', null, 'Checklist for a company'),
    pick,
    h('p', { class: 'muted small' }, 'Or tap "Questions" on a company card.'),
    h('h2', null, 'Prepared questions'),
    state.questions.length ? list : h('p', { class: 'muted' }, 'No questions yet.'),
    h('div', { class: 'addrow' }, add, h('button', { class: 'btn primary', onclick: doAdd }, 'Add')));
}
renderers.ask = renderAsk;

function openChecklist(id) {
  const c = state.companies.find(x => x.id === id);
  if (!c) return;
  c.asked = c.asked || []; c.extra = c.extra || [];
  const body = h('div');
  const checkRow = (text, checked, onToggle, onDelete) => {
    const cb = h('input', { type: 'checkbox' });
    cb.checked = checked;
    const lab = h('label', { class: 'check' + (checked ? ' done' : '') }, cb, h('span', { class: 'txt' }, text));
    cb.addEventListener('change', async () => { lab.classList.toggle('done', cb.checked); await onToggle(cb.checked); });
    return h('div', { class: 'item' }, lab,
      onDelete ? h('button', { class: 'btn ghost danger', 'aria-label': 'Delete', onclick: onDelete }, '✕') : null);
  };
  const paint = () => {
    const add = h('input', { type: 'text', placeholder: 'Question only for ' + c.name, enterkeyhint: 'done' });
    const doAdd = async () => {
      const t = add.value.trim(); if (!t) return;
      c.extra.push({ id: uid(), text: t, asked: false });
      await saveCompany(c); paint();
    };
    add.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdd(); });
    body.replaceChildren(
      h('h2', null, 'Prepared questions'),
      state.questions.length ? h('div', { class: 'list' }, sortedQuestions().map(q => checkRow(q.text, c.asked.includes(q.id), async (on) => {
        c.asked = c.asked.filter(x => x !== q.id);
        if (on) c.asked.push(q.id);
        await saveCompany(c);
      }))) : h('p', { class: 'muted' }, 'Add prepared questions in the Ask tab.'),
      h('h2', null, 'Only for ' + c.name),
      c.extra.length ? h('div', { class: 'list' }, c.extra.map(x => checkRow(x.text, x.asked, async (on) => {
        x.asked = on; await saveCompany(c);
      }, async () => {
        c.extra = c.extra.filter(y => y.id !== x.id); await saveCompany(c); paint();
      }))) : null,
      h('div', { class: 'addrow' }, add, h('button', { class: 'btn primary', onclick: doAdd }, 'Add')));
  };
  paint();
  state.onSheetClose = () => { if (renderers[state.tab]) renderers[state.tab](); };
  openSheet(c.name + ' – questions', body, { right: h('button', { class: 'btn primary', onclick: closeSheet }, 'Done') });
}

/* ---------- me ---------- */
const PROFILE_FIELDS = [
  ['name', 'Name', 'text', { autocapitalize: 'words' }],
  ['matric', 'Matric no.', 'text', { autocapitalize: 'characters' }],
  ['ic', 'IC no.', 'text', { inputmode: 'numeric' }],
  ['email', 'Email', 'email', { autocapitalize: 'off', inputmode: 'email' }],
  ['phone', 'Phone', 'tel', { inputmode: 'tel' }],
  ['linkedin', 'LinkedIn', 'url', { autocapitalize: 'off', placeholder: 'linkedin.com/in/…' }],
  ['university', 'University', 'text', {}],
  ['programme', 'Programme', 'text', {}],
  ['cgpa', 'CGPA', 'text', { inputmode: 'decimal' }],
  ['grad', 'Graduation date', 'text', { placeholder: 'e.g. Aug 2026' }],
];
state.profile = { custom: [] };
state.meEdit = false;
state.persisted = null;

async function copyText(t) {
  try { await navigator.clipboard.writeText(t); }
  catch (e) {
    const ta = h('textarea', { value: t, readonly: true, style: 'position:fixed;top:0;left:0;opacity:0' });
    document.body.append(ta); ta.select(); ta.setSelectionRange(0, t.length);
    document.execCommand('copy'); ta.remove();
  }
  toast('Copied');
}
const saveProfile = () => DB.put('kv', state.profile, 'profile');

function renderMe() {
  const p = state.profile;
  const v = $('#meView');
  $('#meEdit').textContent = state.meEdit ? 'Done' : 'Edit';
  $('#meEdit').classList.toggle('primary', state.meEdit);
  const parts = [];
  if (!state.meEdit) {
    const chips = [
      ...PROFILE_FIELDS.filter(([k]) => p[k]).map(([k, label]) => [label, p[k]]),
      ...(p.custom || []).filter(x => x.value).map(x => [x.label || 'Custom', x.value]),
    ].map(([label, val]) => h('button', { class: 'copy', onclick: () => copyText(val) },
      h('span', { class: 'lbl' }, label), h('span', { class: 'val' }, val)));
    parts.push(h('h2', null, 'Tap to copy'),
      chips.length ? h('div', { class: 'copy-grid' }, chips) : h('p', { class: 'muted' }, 'Tap Edit to add your details.'));
  } else {
    const form = h('div', { class: 'form' }, PROFILE_FIELDS.map(([k, label, type, extra]) => {
      const el = h('input', { type, value: p[k] || '', autocomplete: 'off', ...extra });
      el.addEventListener('change', () => { p[k] = el.value.trim(); saveProfile(); });
      return h('label', { class: 'field' }, label, el);
    }));
    const custom = h('div', { class: 'form' }, (p.custom || []).map(x => {
      const l = h('input', { type: 'text', value: x.label, placeholder: 'Label', 'aria-label': 'Label' });
      const val = h('input', { type: 'text', value: x.value, placeholder: 'Value', 'aria-label': 'Value' });
      l.addEventListener('change', () => { x.label = l.value.trim(); saveProfile(); });
      val.addEventListener('change', () => { x.value = val.value.trim(); saveProfile(); });
      return h('div', { class: 'custom-row' }, l, val,
        h('button', { class: 'btn ghost danger', 'aria-label': 'Remove field', onclick: async () => {
          p.custom = p.custom.filter(y => y !== x); await saveProfile(); renderMe();
        } }, '✕'));
    }));
    parts.push(h('h2', null, 'My details'), form,
      h('h2', null, 'Custom fields'), custom,
      h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'btn', onclick: async () => {
        p.custom = p.custom || [];
        p.custom.push({ id: uid(), label: '', value: '' }); await saveProfile(); renderMe();
        const rows = $$('#meView .custom-row input'); if (rows.length) rows[rows.length - 2].focus();
      } }, '+ Add custom field')));
  }

  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Theme' },
    [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']].map(([k, label]) =>
      h('button', { 'aria-pressed': state.settings.theme === k, onclick: async () => { await setTheme(k); renderMe(); } }, label)));
  parts.push(h('h2', null, 'Appearance'), seg);
  if (typeof renderQrSettings === 'function') parts.push(h('h2', null, 'QR code'), renderQrSettings());
  if (typeof renderDataPanel === 'function') parts.push(h('h2', null, 'Data'), renderDataPanel());
  parts.push(h('p', { class: 'muted small' },
    state.persisted === true ? 'Storage: persistent.' : state.persisted === false ? 'Storage: not marked persistent (browser may evict if space is low; keep a backup).' : ''));
  v.replaceChildren(...parts);
}
renderers.me = renderMe;
$('#meEdit').addEventListener('click', () => {
  // let any focused input commit its change event first
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  state.meEdit = !state.meEdit; renderMe();
});

/* ---------- boot ---------- */
async function boot() {
  await DB.open();
  const s = await DB.get('kv', 'settings');
  if (s) Object.assign(state.settings, s);
  applyTheme();
  state.companies = await DB.all('companies');
  state.questions = await DB.all('questions');
  if (!(await DB.get('kv', 'seeded'))) {
    for (const t of SEED_QUESTIONS) await addQuestion(t);
    await DB.put('kv', true, 'seeded');
  }
  state.profile = Object.assign({ custom: [] }, await DB.get('kv', 'profile'));
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().then(p => { state.persisted = p; if (state.tab === 'me') renderMe(); }).catch(() => {});
  }
  showTab('companies');
}
boot().catch(err => { console.error(err); toast('Storage error: ' + err.message); });
