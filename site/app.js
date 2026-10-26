// DrukStock interview demo: screens and wiring (flat variant).
// Screens: start (founder) → opening → list ⇄ customer → end → log (founder).

import { createEngine, formatNu, pressKey, isCommittable, dayNumber } from './engine.js';
import { createLog, decide } from './log.js';
import { LABELS, fill } from './labels.js';
import { createStore, requestPersistence } from './store.js';
import { createNav } from './nav.js';
import { TEST_STANDALONE, BUILD, CACHE } from './config.js';

const CONTACT_NUMBER = ''; // eng D25: the separate DrukStock WhatsApp number, set before interviews
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LOCK_MS = 600;   // design D5
const HOLD_MS = 1500;  // eng D38 / ER-D4

const app = document.getElementById('app');
const banner = document.getElementById('banner');
const live = document.getElementById('live');

// ---------- tiny DOM helper ----------
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid);
  return el;
}

// Bilingual label: Dzongkha line above English when the speaker has supplied it.
function bi(key, vars) {
  const l = LABELS[key];
  const en = fill(l.en, vars);
  const dz = l.dz ? fill(l.dz, vars) : '';
  return h('span', { class: 'bi', 'aria-label': dz ? `${dz} ${en}` : en },
    dz && h('span', { class: 'dz', lang: 'dz', text: dz }), h('span', { text: en }));
}

const dayLabel = day => { const d = new Date(day * 86400000); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
const isStandalone = () => TEST_STANDALONE || matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function say(text) { live.textContent = ''; requestAnimationFrame(() => { live.textContent = text; }); }

// ---------- state ----------
const fixture = await (await fetch('fixtures/customers.json')).json();
const store = await createStore();
const savedLog = await store.get('log');
const log = createLog(savedLog ?? undefined);
let engine = createEngine({ fixture, startDay: dayNumber(new Date()) });
let ui = { customerId: null, amount: '', confirm: '', lockUntil: 0 };
let persisted = null;
let lastExport = (await store.get('lastExport')) ?? null;

// ER-D11: an interview running before a reload comes back on the list.
const saved = await store.get('interview');
const running = log.current();
const resumed = !!(running && !running.closed && saved);
if (resumed) {
  engine = createEngine({ fixture, startDay: saved.startDay });
  engine.restore(saved.engine);
  log.markReloaded();
}

async function persist() {
  await store.set('log', log.toJSON());
  const iv = log.current();
  if (iv && !iv.closed) await store.set('interview', { startDay: engine.today() - engine.snapshot().clockOffset, engine: engine.snapshot() });
  else await store.del('interview');
}

const firstCreditDone = () => log.current()?.firstCreditAt != null;
const now = () => performance.timeOrigin + performance.now();

// ---------- navigation ----------
const nav = createNav({ onBack: target => show(target) });

function show(screen, opts) {
  if (screen !== 'customer') ui.amount = '';
  nav.go(screen, opts);
  render();
}

// ---------- founder hold (two fingers, 1.5 s) on every screen but start ----------
let holdTimer = null;
document.addEventListener('touchstart', e => {
  if (e.touches.length === 2 && nav.screen !== 'start' && nav.screen !== 'log') {
    holdTimer = setTimeout(() => show('log', { fromLog: nav.screen }), HOLD_MS);
  }
}, { passive: true });
for (const ev of ['touchend', 'touchcancel', 'touchmove']) document.addEventListener(ev, () => clearTimeout(holdTimer), { passive: true });
if (TEST_STANDALONE) {
  document.addEventListener('keydown', e => { if (e.key === 'L' && e.shiftKey && nav.screen !== 'start') show('log', { fromLog: nav.screen }); });
}

// Every shopkeeper tap counts toward tap count until the first credit.
app.addEventListener('pointerdown', () => {
  if (['opening', 'list', 'customer', 'end'].includes(nav.screen)) log.tap(now());
}, { capture: true });

// ---------- screens ----------
function startScreen() {
  const standalone = isStandalone();
  const ready = standalone && offlineReady; // eng D24: only after the precache finished
  const next = log.nextVariant();
  let status;
  if (!standalone) status = h('p', { class: 'status notready', text: 'Open DrukStock from your home screen' });
  else if (!ready) status = h('p', { class: 'status notready', text: 'Not ready: connect to Wi-Fi' });
  else status = h('p', { class: 'status ready', text: '● Offline ready' });
  return h('section', { class: 'screen' },
    h('p', { class: 'wordmark', text: 'DrukStock' }),
    status,
    persisted === false && h('p', { class: 'muted', text: 'Log may be cleared: export after every interview' }),
    h('button', { class: 'btn primary', disabled: !ready, onclick: handOver, text: 'Hand over' }),
    h('p', { class: 'muted start-meta', text: `Next: ${next === '3d' ? '3D' : 'flat'} · interview ${(log.toJSON().interviews.length) + 1} · build ${BUILD}` }),
    next === '3d' && h('p', { class: 'muted', text: '3D isn\'t built yet: this interview will use flat and be logged as fallback.' }),
    h('button', { class: 'btn', onclick: () => show('log', { fromLog: 'start' }), text: 'Open log' }),
    h('button', { class: 'btn', onclick: resetDemo, text: 'Reset demo' }),
  );
}

function openingScreen() {
  return h('section', { class: 'screen' },
    h('p', { class: 'wordmark', text: 'DrukStock' }),
    h('div', { class: 'cover', 'aria-hidden': 'true' }, h('span', { class: 'cover-label', text: 'Baki' })),
    h('p', { class: 'headline' }, bi('headline')),
    h('button', { class: 'btn primary', onclick: () => show('list') }, bi('tryIt')),
  );
}

function listScreen() {
  const rows = engine.customers().map(c => h('li', {},
    h('button', { class: 'row', onclick: () => { ui.customerId = c.id; ui.confirm = ''; show('customer'); } },
      h('span', {}, h('span', { class: 'name', text: c.name }), c.overdue && h('br'), c.overdue && h('span', { class: 'tag' }, bi('daysUnpaid', { n: c.daysUnpaid }))),
      h('span', { class: 'amt', text: c.advance.gt(0) ? `Advance ${formatNu(c.advance)}` : formatNu(c.owes) }))));
  return h('section', { class: 'screen' },
    h('p', { class: 'total-label muted', text: 'Customers owe you' }),
    h('p', { class: 'total', text: formatNu(engine.shopTotal()) }),
    h('ul', { class: 'rows' }, rows),
    firstCreditDone() && h('div', { class: 'list-actions' },
      h('button', { class: 'btn', onclick: monthLater }, bi('monthLater')),
      h('button', { class: 'btn primary', onclick: () => show('end') }, bi('done'))),
  );
}

function customerScreen() {
  const c = engine.customers().find(x => x.id === ui.customerId);
  const committable = isCommittable(ui.amount);
  const lines = engine.history(c.id).map(e => {
    const what = e.type === 'reversal' ? 'correction' : e.type;
    const label = `${dayLabel(e.day)} · ${what} · ${formatNu(e.amount)}`;
    const canFix = engine.canCorrect(e.id);
    return h('li', { class: e.corrected ? 'corrected' : '' },
      h('button', { class: 'line', onclick: canFix ? () => { ui.reveal = ui.reveal === e.id ? null : e.id; render(); } : null, text: label }),
      ui.reveal === e.id && canFix && h('button', { class: 'fix', onclick: () => correct(e.id), text: 'Correct' }));
  });
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', 'back'].map(k =>
    h('button', { class: 'key', 'aria-label': k === 'back' ? 'Delete digit' : k, onclick: () => { ui.amount = pressKey(ui.amount, k); ui.confirm = ''; render(); } },
      k === 'back' ? deleteIcon() : k));
  return h('section', { class: 'screen customer' },
    h('div', { class: 'customer-scroll' },
      h('button', { class: 'back', onclick: () => show('list'), text: '← Customers' }),
      h('p', { class: 'cust-name', text: c.name }),
      h('p', { class: 'balance' + (ui.bump ? ' bump' : ''), text: c.advance.gt(0) ? `Advance ${formatNu(c.advance)}` : `owes ${formatNu(c.owes)}` }),
      c.overdue && h('span', { class: 'tag' }, bi('daysUnpaid', { n: c.daysUnpaid })),
      lines.length > 0 && h('ul', { class: 'history' }, lines)),
    h('div', { class: 'dock' },
      // After a commit the box shows the confirmation (design D5) until the next key press.
      ui.confirm && !ui.amount
        ? h('div', { class: 'amount-box confirm' }, ui.confirm)
        : h('div', { class: 'amount-box' + (ui.amount ? '' : ' empty'), text: formatNu(ui.amount || '0') }),
      h('div', { class: 'keys' }, keys),
      h('button', { class: 'btn primary', disabled: !committable, onclick: () => commit('credit') }, bi('gaveCredit')),
      h('button', { class: 'btn', disabled: !committable, onclick: () => commit('payment') }, bi('gotPayment'))),
  );
}

function deleteIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '28'); svg.setAttribute('height', '28'); svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<path d="M9 5h11v14H9l-6-7z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 9l5 6m0-6l-5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';
  return svg;
}

function endScreen() {
  return h('section', { class: 'screen' },
    h('p', { class: 'end-line' }, bi('endCardLine')),
    h('div', { class: 'qr', text: CONTACT_NUMBER ? 'QR' : 'QR appears once the DrukStock number is set' }),
    h('p', { class: 'phone', text: CONTACT_NUMBER || 'Number not set yet' }),
    h('button', { class: 'btn', onclick: () => show('list'), text: 'Try again' }),
  );
}

function choice(field, value, options) {
  return h('div', { class: 'choice' }, options.map(([v, label]) =>
    h('button', { 'aria-pressed': String(value === v), onclick: () => { log.setField(field, value === v ? null : v); persist(); render(); }, text: label })));
}

function logScreen() {
  const iv = log.current();
  const open = iv && !iv.closed;
  const yn = [[true, 'yes'], [false, 'no']];
  const d = decide(log.toJSON().interviews);
  const share = x => (x === null ? '—' : `${Math.round(x * 100)}%`);
  const ms = x => (x === null ? '—' : `${(x / 1000).toFixed(1)} s`);
  return h('section', { class: 'screen' },
    h('p', { class: 'wordmark', text: 'Founder log' }),
    iv ? h('div', {},
      h('p', { text: `Interview ${iv.n} · ${iv.variant === '3d' ? '3D' : 'flat'}${iv.renderer === 'fallback' ? ' (fallback)' : ''}${iv.reloaded ? ' · reloaded' : ''}${open ? '' : ' · closed'}` }),
      h('div', { class: 'field' }, h('span', { text: 'Needed help' }), choice('help', iv.help, yn)),
      h('div', { class: 'field' }, h('span', { text: 'Real-use question' }), choice('realUseQuestion', iv.realUseQuestion, yn)),
      h('input', { class: 'note', placeholder: 'Note (e.g. asked about reminders)', value: iv.realUseNote ?? '', oninput: e => { log.setField('realUseNote', e.target.value); persist(); } }),
      h('div', { class: 'field' }, h('span', { text: 'Wants follow-up' }), choice('followUp', iv.followUp, yn)),
      h('div', { class: 'field' }, h('span', { text: 'Repeat' }), choice('repeat', iv.repeat, yn)),
      h('div', { class: 'field' }, h('span', { text: 'Shop type' }), choice('shopType', iv.shopType, [['grocery', 'grocery'], ['hardware', 'hardware']])),
    ) : h('p', { class: 'muted', text: 'No interviews yet' }),
    open && h('button', { class: 'btn primary', onclick: nextShopkeeper, text: 'Next shopkeeper' }),
    h('button', { class: 'btn', onclick: exportCsv, text: 'Export CSV' }),
    h('p', { class: 'muted', text: `Stored interviews: ${log.toJSON().interviews.length} · last export: ${lastExport ?? 'never'}` }),
    h('button', { class: 'btn', onclick: resetDemo, text: 'Reset demo' }),
    h('button', { class: 'btn', onclick: () => show(open ? 'list' : 'start'), text: open ? 'Back to demo' : 'Back to start' }),
    h('p', { class: 'summary', text:
      `Decision: ${d.verdict} (${d.reason})\n3D: ${d.d3.n} counted · no help ${share(d.d3.noHelpShare)} · median ${ms(d.d3.medianMs)}\nFlat: ${d.flat.n} counted · no help ${share(d.flat.noHelpShare)} · median ${ms(d.flat.medianMs)}` }),
  );
}

const SCREENS = { start: startScreen, opening: openingScreen, list: listScreen, customer: customerScreen, end: endScreen, log: logScreen };

function render() {
  app.replaceChildren(SCREENS[nav.screen]());
  ui.bump = false;
}

// ---------- actions ----------
async function handOver() {
  log.handOver(now());
  if (log.current().variant === '3d') log.markFallback(); // 3D renderer not built yet
  engine.reset();
  ui = { customerId: null, amount: '', confirm: '', lockUntil: 0 };
  if (persisted === null) persisted = await requestPersistence();
  show('opening');
  nav.startInterview();
  await persist();
}

async function commit(type) {
  if (performance.now() < ui.lockUntil || !isCommittable(ui.amount)) return; // design D5 lockout
  const c = engine.customers().find(x => x.id === ui.customerId);
  engine.record(c.id, type, ui.amount);
  if (type === 'credit') log.firstCredit(now());
  const amt = formatNu(ui.amount);
  ui.confirm = type === 'credit' ? `${amt} written for ${c.name}` : `${amt} received from ${c.name}`;
  say(ui.confirm);
  ui.amount = '';
  ui.lockUntil = performance.now() + LOCK_MS;
  ui.bump = true;
  render();
  setTimeout(() => { if (ui.confirm) { ui.confirm = ''; if (nav.screen === 'customer') render(); } }, 2000);
  await persist();
}

async function correct(entryId) {
  engine.correct(entryId);
  ui.reveal = null;
  render();
  await persist();
}

async function monthLater() {
  engine.oneMonthLater();
  const c = engine.oldestUnpaidCustomer();
  const text = c ? `30 days later: ${c.name} has not paid` : '30 days later';
  banner.textContent = text; banner.hidden = false; say(text);
  setTimeout(() => { banner.hidden = true; }, 4000);
  render();
  await persist();
}

async function nextShopkeeper() {
  log.close();
  engine.reset();
  await persist();
  show('start');
}

async function resetDemo() {
  engine.reset();
  ui.amount = ''; ui.confirm = '';
  await persist();
  render();
}

async function markExported() { lastExport = new Date().toISOString().slice(0, 10); await store.set('lastExport', lastExport); render(); }

function exportCsv() {
  const blob = new Blob([log.csv()], { type: 'text/csv' });
  const name = `drukstock-interviews-${new Date().toISOString().slice(0, 10)}.csv`;
  const file = new File([blob], name, { type: 'text/csv' });
  if (navigator.canShare?.({ files: [file] })) {
    navigator.share({ files: [file] }).then(markExported).catch(() => {}); // design D9: cancelling changes nothing
  } else {
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    a.click();
    markExported();
  }
}

// ---------- offline (eng D24) ----------
let offlineReady = false;
async function checkOffline() {
  const was = offlineReady;
  offlineReady = typeof caches !== 'undefined' && !!(await caches.has(CACHE) && await (await caches.open(CACHE)).match('./__precache-complete__'));
  if (offlineReady !== was && nav.screen === 'start') render();
}
if ('serviceWorker' in navigator && BUILD !== 'dev') {
  navigator.serviceWorker.register('sw.js').then(reg => {
    reg.addEventListener('updatefound', () => reg.installing?.addEventListener('statechange', checkOffline));
  });
  navigator.serviceWorker.addEventListener('controllerchange', checkOffline);
  setInterval(checkOffline, 2000);
}
await checkOffline();

// ---------- boot ----------
show(resumed ? 'list' : 'start');
if (resumed) { nav.startInterview(); await persist(); }
