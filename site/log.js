// Founder interview log: per-interview metrics, variant alternation, the
// 3D-vs-flat decision rule and CSV export. Pure logic; the caller persists
// `toJSON()` (IndexedDB in the browser) and passes it back to `createLog`.
//
// Timing rules (Demo Spec, eng D34 / ER-D9 / ER-D10):
//   time to first credit = first committed credit − shopkeeper's first touch
//                          − time spent in the 3D opening transition
//   tap count = taps from the first touch to the first credit, excluding
//               taps that skip the transition

export const MIN_PER_VARIANT = 4;  // Demo Spec decision rule
export const EXTRA_CAP = 4;        // at most 4 extra interviews (office-hours R2-1)
export const MARGIN_MS = 2000;     // 3D may be at most 2 s slower
export const BASE_INTERVIEWS = 10;

const FIELDS = ['help', 'realUseQuestion', 'realUseNote', 'followUp', 'repeat', 'shopType'];

function newInterview(n, variant) {
  return {
    n, variant, renderer: variant === 'flat' ? 'flat' : '3d',
    handOverAt: null, firstTouchAt: null, firstCreditAt: null,
    transitionStartAt: null, transitionMs: 0, taps: 0,
    abandoned: false, reloaded: false,
    help: null, realUseQuestion: null, realUseNote: '', followUp: null, repeat: null, shopType: null,
  };
}

export function createLog(saved = { interviews: [], override: null }) {
  const data = JSON.parse(JSON.stringify(saved));
  data.interviews ??= [];
  data.override ??= null;
  const current = () => data.interviews.at(-1) ?? null;
  const active = () => { const c = current(); return c && !c.closed ? c : null; };

  function nextVariant() {
    if (data.override) return data.override;
    return (data.interviews.length + 1) % 2 === 1 ? '3d' : 'flat';
  }

  return {
    nextVariant,
    current: () => (current() ? { ...current() } : null),

    // Founder override ("Next: flat") for the next interview only.
    setOverride(variant) { data.override = variant; },

    handOver(now) {
      if (active()) throw new Error('interview already running');
      const prior = data.interviews.length;
      const variant = nextVariant();
      const forced = data.override !== null;
      data.override = null;
      const iv = newInterview(prior + 1, variant);
      iv.handOverAt = now;
      // Eng D38: a forced variant right after a counted interview is a repeat.
      if (forced && prior > 0) iv.repeat = true;
      data.interviews.push(iv);
      return { ...iv };
    },

    // Any shopkeeper tap. `skipsTransition` = the tap that skips the 3D opening.
    tap(now, { skipsTransition = false } = {}) {
      const iv = active();
      if (!iv) return;
      if (iv.firstTouchAt === null) iv.firstTouchAt = now;
      if (iv.firstCreditAt === null && !skipsTransition) iv.taps += 1;
    },

    transitionStart(now) { const iv = active(); if (iv) iv.transitionStartAt = now; },
    transitionEnd(now) {
      const iv = active();
      if (!iv || iv.transitionStartAt === null) return;
      if (iv.firstCreditAt === null) iv.transitionMs += now - iv.transitionStartAt;
      iv.transitionStartAt = null;
    },

    // ER-D10 / D29: tapped before the first frame, WebGL failed, or too slow.
    markFallback() { const iv = active(); if (iv && iv.variant === '3d') iv.renderer = 'fallback'; },

    // ER-D11: the page reloaded mid-interview.
    markReloaded() { const iv = active(); if (iv) iv.reloaded = true; },

    firstCredit(now) {
      const iv = active();
      if (iv && iv.firstCreditAt === null) iv.firstCreditAt = now;
    },

    // Founder-entered fields (D3 log layout).
    setField(name, value) {
      if (!FIELDS.includes(name)) throw new Error(`unknown field ${name}`);
      const iv = current();
      if (!iv) throw new Error('no interview');
      iv[name] = value;
    },

    // "Next shopkeeper": closes the interview; no credit means abandoned.
    close() {
      const iv = active();
      if (!iv) return null;
      if (iv.firstCreditAt === null) iv.abandoned = true;
      iv.closed = true;
      return { ...iv };
    },

    toJSON() { return JSON.parse(JSON.stringify(data)); },

    timeToFirstCredit,
    decision: () => decide(data.interviews),
    csv: () => toCsv(data.interviews),
  };
}

export function timeToFirstCredit(iv) {
  if (iv.firstTouchAt === null || iv.firstCreditAt === null) return null;
  return iv.firstCreditAt - iv.firstTouchAt - iv.transitionMs;
}

export function counted(iv) {
  return iv.closed && iv.renderer !== 'fallback' && iv.repeat !== true && !iv.reloaded;
}

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function stats(list) {
  const noHelp = list.filter(iv => iv.firstCreditAt !== null && iv.help === false).length;
  const times = list.map(timeToFirstCredit).filter(t => t !== null);
  return { n: list.length, noHelpShare: list.length ? noHelp / list.length : null, medianMs: median(times) };
}

// Demo Spec decision rule.
export function decide(interviews) {
  const done = interviews.filter(iv => iv.closed);
  const pool = done.filter(counted);
  const d3 = stats(pool.filter(iv => iv.variant === '3d'));
  const flat = stats(pool.filter(iv => iv.variant === 'flat'));
  const enough = d3.n >= MIN_PER_VARIANT && flat.n >= MIN_PER_VARIANT;
  if (!enough) {
    const capReached = done.length >= BASE_INTERVIEWS + EXTRA_CAP;
    if (capReached) return { verdict: 'flat', reason: 'not enough counted sessions after the extra-interview cap', d3, flat };
    const reason = done.length < BASE_INTERVIEWS ? 'interviews still running' : 'run more interviews';
    return { verdict: 'pending', reason, d3, flat };
  }
  const shareOk = d3.noHelpShare >= flat.noHelpShare;
  const timeOk = d3.medianMs !== null && flat.medianMs !== null && d3.medianMs - flat.medianMs <= MARGIN_MS;
  return shareOk && timeOk
    ? { verdict: '3d', reason: 'no-help share at least flat and median within 2 s', d3, flat }
    : { verdict: 'flat', reason: 'flat carries forward (3D did not meet both conditions)', d3, flat };
}

// Design D9: unfilled fields export as "—" so blank differs from "no".
const COLUMNS = ['n', 'variant', 'renderer', 'shopType', 'timeToFirstCreditMs', 'taps', 'transitionMs',
  'abandoned', 'reloaded', 'repeat', 'help', 'realUseQuestion', 'realUseNote', 'followUp', 'counted'];

function cell(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(interviews) {
  const rows = interviews.map(iv => [
    iv.n, iv.variant, iv.renderer, iv.shopType, timeToFirstCredit(iv), iv.taps, iv.transitionMs,
    iv.abandoned, iv.reloaded, iv.repeat, iv.help, iv.realUseQuestion, iv.realUseNote, iv.followUp,
    counted(iv),
  ].map(cell).join(','));
  return [COLUMNS.join(','), ...rows].join('\n') + '\n';
}
