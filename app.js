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

/* ---------- CV ---------- */
state.cv = null;      // { kind: 'images' | 'pdf', files: [{ name, type, blob }], updated }
state.cvUrls = [];
const CV_ACCEPT = 'image/*';

function cvObjectUrls() {
  if (!state.cvUrls.length && state.cv) state.cvUrls = state.cv.files.map(f => URL.createObjectURL(f.blob));
  return state.cvUrls;
}
function resetCvUrls() { state.cvUrls.forEach(u => URL.revokeObjectURL(u)); state.cvUrls = []; }

function pickCv() {
  const input = h('input', { type: 'file', accept: CV_ACCEPT, multiple: true, style: 'display:none' });
  input.addEventListener('change', async () => {
    const files = [...input.files];
    input.remove();
    if (!files.length) return;
    try { await storeCv(files); } catch (e) { console.error(e); toast('Could not save CV: ' + e.message); }
  });
  document.body.append(input);
  input.click();
}
async function storeCv(files) {
  const pdf = files.find(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  const imgs = files.filter(f => f.type.startsWith('image/'));
  if (pdf && typeof renderPdfPages !== 'function') { toast('PDF not supported, use images'); return; }
  const chosen = pdf ? [pdf] : imgs;
  if (!chosen.length) { toast('Pick image files'); return; }
  // copy into fresh Blobs so the stored value does not depend on the picked File handle
  const list = await Promise.all(chosen.map(async f => ({ name: f.name, type: f.type || 'application/pdf', blob: new Blob([await f.arrayBuffer()], { type: f.type || 'application/pdf' }) })));
  state.cv = { kind: pdf ? 'pdf' : 'images', files: list, updated: Date.now() };
  await DB.put('kv', state.cv, 'cv');
  resetCvUrls();
  renderCv(); toast('CV saved');
}

async function cvPageNodes(forThumbs) {
  if (!state.cv) return [];
  if (state.cv.kind === 'pdf') return renderPdfPages(state.cv.files[0].blob, forThumbs);
  return cvObjectUrls().map((u, i) => h('img', { src: u, alt: 'CV page ' + (i + 1), draggable: 'false' }));
}

async function renderCv() {
  const v = $('#cvView');
  if (!state.cv) {
    v.replaceChildren(
      h('h2', null, 'Your CV'),
      h('p', { class: 'muted' }, 'Upload photos or screenshots of your CV pages (select several for multiple pages)' +
        (typeof renderPdfPages === 'function' ? ', or a PDF.' : '.')),
      h('button', { class: 'btn primary block', onclick: pickCv }, 'Upload CV'));
    return;
  }
  const thumbs = h('div', { class: 'cv-thumbs' }, h('p', { class: 'muted' }, 'Loading…'));
  v.replaceChildren(
    h('h2', null, 'Your CV'),
    h('p', { class: 'muted small' }, `${state.cv.kind === 'pdf' ? 'PDF' : state.cv.files.length + ' image(s)'} · saved ${new Date(state.cv.updated).toLocaleString()}`),
    h('button', { class: 'btn primary block', onclick: openViewer }, 'View full screen'),
    thumbs,
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: pickCv }, 'Replace'),
      h('button', { class: 'btn danger', onclick: async () => {
        if (!(await confirmBox('Remove the stored CV from this device?', 'Remove'))) return;
        await DB.del('kv', 'cv'); state.cv = null; resetCvUrls(); renderCv(); toast('CV removed');
      } }, 'Remove')));
  try {
    const nodes = await cvPageNodes(true);
    thumbs.replaceChildren(...nodes.map(n => h('button', { 'aria-label': 'Open CV', onclick: openViewer }, n)));
  } catch (e) { console.error(e); thumbs.replaceChildren(h('p', { class: 'muted' }, 'Could not render CV: ' + e.message)); }
}
renderers.cv = renderCv;

async function openViewer() {
  const vw = $('#viewer');
  const pages = h('div', { class: 'pages' });
  const scroll = h('div', { class: 'scroll' }, pages);
  let zoom = 1;
  const setZoom = (z, cx, cy) => {
    // cx, cy: point inside the scroll viewport that should stay fixed
    z = Math.min(5, Math.max(1, z));
    if (cx == null) { cx = scroll.clientWidth / 2; cy = scroll.clientHeight / 2; }
    const k = z / zoom, x = scroll.scrollLeft + cx, y = scroll.scrollTop + cy;
    zoom = z; pages.style.width = (z * 100) + '%';
    scroll.scrollLeft = x * k - cx; scroll.scrollTop = y * k - cy;
  };
  vw.replaceChildren(
    h('div', { class: 'head' },
      h('button', { class: 'btn', onclick: closeViewer }, 'Close'),
      h('span', null, 'CV'),
      h('button', { class: 'btn', 'aria-label': 'Zoom out', onclick: () => setZoom(zoom / 1.5) }, '−'),
      h('button', { class: 'btn', 'aria-label': 'Zoom in', onclick: () => setZoom(zoom * 1.5) }, '+')),
    scroll);
  vw.hidden = false;
  pages.append(h('p', { style: 'color:#ccc;text-align:center' }, 'Loading…'));
  try { pages.replaceChildren(...await cvPageNodes(false)); }
  catch (e) { pages.replaceChildren(h('p', { style: 'color:#fff' }, 'Could not render CV: ' + e.message)); }

  // pinch zoom (two fingers) + double-tap; one-finger scroll stays native
  let pinch = null, lastTap = 0;
  const rel = (t) => { const r = scroll.getBoundingClientRect(); return [t.clientX - r.left, t.clientY - r.top]; };
  scroll.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      const [a, b] = [rel(e.touches[0]), rel(e.touches[1])];
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: zoom,
        x: scroll.scrollLeft + (a[0] + b[0]) / 2, y: scroll.scrollTop + (a[1] + b[1]) / 2 };
    }
  }, { passive: true });
  scroll.addEventListener('touchmove', (e) => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    const [a, b] = [rel(e.touches[0]), rel(e.touches[1])];
    const z = Math.min(5, Math.max(1, pinch.z * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d));
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, k = z / pinch.z;
    zoom = z; pages.style.width = (z * 100) + '%';
    scroll.scrollLeft = pinch.x * k - mx; scroll.scrollTop = pinch.y * k - my;
  }, { passive: false });
  scroll.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) pinch = null;
    if (e.touches.length === 0 && e.changedTouches.length === 1) {
      const now = Date.now();
      if (now - lastTap < 300) {
        e.preventDefault(); touchDbl = now;
        const [x, y] = rel(e.changedTouches[0]);
        setZoom(zoom > 1.01 ? 1 : 2.5, x, y); lastTap = 0;
      } else lastTap = now;
    }
  }, { passive: false });
  let touchDbl = 0;
  scroll.addEventListener('dblclick', (e) => {
    if (Date.now() - touchDbl < 800) return;
    const [x, y] = rel(e); setZoom(zoom > 1.01 ? 1 : 2.5, x, y);
  });
  scroll.addEventListener('touchmove', () => { lastTap = 0; }, { passive: true });
}
function closeViewer() { const v = $('#viewer'); v.hidden = true; v.replaceChildren(); }
// stop Safari's own page zoom gestures inside the viewer / QR screen
for (const id of ['#viewer', '#qrScreen']) $(id).addEventListener('gesturestart', (e) => e.preventDefault());

/* ---------- QR ---------- */
state.qr = { mode: 'vcard', name: '', email: '', phone: '', linkedin: '', includeLinkedin: true, url: '' };
const saveQr = () => DB.put('kv', state.qr, 'qr');
const qrField = (k) => (state.qr[k] || state.profile[k] || '').trim();
const vEsc = (s) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
const withScheme = (u) => /^[a-z]+:/i.test(u) ? u : 'https://' + u;

function qrPayload() {
  const q = state.qr;
  if (q.mode === 'url') { const u = (q.url || '').trim(); return u ? { text: withScheme(u), cap: u, sub: '' } : null; }
  const name = qrField('name'), email = qrField('email'), phone = qrField('phone'), li = qrField('linkedin');
  if (!name && !email && !phone) return null;
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `N:;${vEsc(name)};;;`, `FN:${vEsc(name)}`];
  if (email) lines.push(`EMAIL;TYPE=INTERNET:${email}`);
  if (phone) lines.push(`TEL;TYPE=CELL:${phone}`);
  if (q.includeLinkedin && li) lines.push(`URL:${withScheme(li)}`);
  lines.push('END:VCARD');
  return { text: lines.join('\r\n'), cap: name || 'Contact', sub: [email, phone].filter(Boolean).join(' · ') };
}

function qrCanvas(text) {
  qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount(), m = 4, k = 16, size = (n + m * 2) * k;
  const cv = h('canvas', { class: 'qr', width: size, height: size, role: 'img', 'aria-label': 'QR code' });
  const x = cv.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, size, size);
  x.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) x.fillRect((c + m) * k, (r + m) * k, k, k);
  return cv;
}

function showQr() {
  const p = qrPayload();
  if (!p) { toast(state.qr.mode === 'url' ? 'Set a URL in Me → QR code' : 'Add name/email/phone in Me'); return; }
  const s = $('#qrScreen');
  s.replaceChildren(
    h('button', { class: 'btn', onclick: (e) => { e.stopPropagation(); closeQr(); } }, 'Close'),
    qrCanvas(p.text),
    h('div', { class: 'cap' }, p.cap),
    p.sub ? h('div', { class: 'sub' }, p.sub) : null,
    h('div', { class: 'sub' }, state.qr.mode === 'vcard' ? 'Scan with the camera to save my contact' : 'Scan with the camera'));
  s.hidden = false;
  s.onclick = closeQr;
}
function closeQr() { const s = $('#qrScreen'); s.hidden = true; s.replaceChildren(); }
$('#showQr').addEventListener('click', showQr);

function renderQrSettings() {
  const q = state.qr;
  const panel = h('div', { class: 'panel' });
  const field = (k, label, type, extra = {}) => {
    const el = h('input', { type, value: q[k] || '', placeholder: (state.profile[k] || '') || label, autocomplete: 'off', ...extra });
    el.addEventListener('change', () => { q[k] = el.value.trim(); saveQr(); });
    return h('label', { class: 'field' }, label, el);
  };
  const paint = () => {
    const seg = h('div', { class: 'seg' }, [['vcard', 'Contact (vCard)'], ['url', 'URL']].map(([k, label]) =>
      h('button', { 'aria-pressed': q.mode === k, onclick: () => { q.mode = k; saveQr(); paint(); } }, label)));
    const kids = [seg];
    if (q.mode === 'vcard') {
      const cb = h('input', { type: 'checkbox' }); cb.checked = q.includeLinkedin;
      cb.addEventListener('change', () => { q.includeLinkedin = cb.checked; saveQr(); });
      kids.push(h('p', { class: 'muted small', style: 'margin:0' }, 'Blank fields use your details above.'),
        h('div', { class: 'form' },
          field('name', 'Name', 'text'),
          h('div', { class: 'two' }, field('email', 'Email', 'email', { autocapitalize: 'off' }), field('phone', 'Phone', 'tel')),
          field('linkedin', 'LinkedIn', 'url', { autocapitalize: 'off' }),
          h('label', { class: 'check' }, cb, h('span', { class: 'txt' }, 'Include LinkedIn'))));
    } else {
      kids.push(field('url', 'URL (portfolio, LinkedIn, CV link…)', 'url', { autocapitalize: 'off' }));
    }
    kids.push(h('button', { class: 'btn primary', onclick: () => { document.activeElement.blur && document.activeElement.blur(); showQr(); } }, 'Show QR'));
    panel.replaceChildren(...kids);
  };
  paint();
  return panel;
}

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
  Object.assign(state.qr, await DB.get('kv', 'qr'));
  state.cv = (await DB.get('kv', 'cv')) || null;
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().then(p => { state.persisted = p; if (state.tab === 'me') renderMe(); }).catch(() => {});
  }
  showTab('companies');
}
boot().catch(err => { console.error(err); toast('Storage error: ' + err.message); });
