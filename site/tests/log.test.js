import { describe, it, expect } from 'vitest';
import { createLog, decide, timeToFirstCredit, toCsv } from '../log.js';

// One full interview: hand over at t, first touch, optional transition, taps, credit.
function run(log, { start = 0, touch = 1000, transition = 0, taps = 3, credit = 6000, help = false, fallback = false } = {}) {
  log.handOver(start);
  log.tap(start + touch);
  if (transition) { log.transitionStart(start + touch); log.tap(start + touch + 100, { skipsTransition: true }); log.transitionEnd(start + touch + transition); }
  for (let i = 1; i < taps; i++) log.tap(start + touch + transition + i);
  if (fallback) log.markFallback();
  if (credit !== null) log.firstCredit(start + credit);
  log.setField('help', help);
  return log.close();
}

describe('alternation', () => {
  it('odd interviews are 3D, even are flat, and Reset/Try again do not advance it', () => {
    const log = createLog();
    expect(log.nextVariant()).toBe('3d');
    run(log);
    expect(log.nextVariant()).toBe('flat');
    expect(run(log).variant).toBe('flat');
    expect(log.nextVariant()).toBe('3d');
  });

  it('an override applies once and marks the interview a repeat by default (founder can clear it)', () => {
    const log = createLog();
    run(log);
    log.setOverride('3d');
    const iv = log.handOver(10000);
    expect(iv.variant).toBe('3d');
    expect(iv.repeat).toBe(true);
    log.setField('repeat', false);
    expect(log.current().repeat).toBe(false);
  });

  it('refuses to hand over while an interview is running', () => {
    const log = createLog();
    log.handOver(0);
    expect(() => log.handOver(1)).toThrow();
  });
});

describe('timing (eng D34, ER-D9)', () => {
  it('measures from first touch to first credit', () => {
    const iv = run(createLog(), { touch: 1500, credit: 7500 });
    expect(timeToFirstCredit(iv)).toBe(6000);
  });

  it('excludes the 3D transition and the skip tap', () => {
    const iv = run(createLog(), { touch: 1000, transition: 800, taps: 4, credit: 6000 });
    expect(iv.transitionMs).toBe(800);
    expect(timeToFirstCredit(iv)).toBe(4200);
    expect(iv.taps).toBe(4);
  });

  it('stops counting taps after the first credit', () => {
    const log = createLog();
    log.handOver(0); log.tap(10); log.firstCredit(20); log.tap(30); log.tap(40);
    expect(log.close().taps).toBe(1);
  });
});

describe('session flags', () => {
  it('no credit at close means abandoned (ER-D4)', () => {
    expect(run(createLog(), { credit: null }).abandoned).toBe(true);
  });

  it('fallback applies only to 3D sessions (ER-D10)', () => {
    const log = createLog();
    expect(run(log, { fallback: true }).renderer).toBe('fallback');
    expect(run(log, { fallback: true }).renderer).toBe('flat');
  });

  it('survives a reload via toJSON and flags it (ER-D11)', () => {
    const log = createLog();
    log.handOver(0); log.tap(500);
    const restored = createLog(JSON.parse(JSON.stringify(log.toJSON())));
    restored.markReloaded();
    restored.firstCredit(4000);
    const iv = restored.close();
    expect(iv.reloaded).toBe(true);
    expect(timeToFirstCredit(iv)).toBe(3500);
  });

  it('rejects unknown founder fields', () => {
    const log = createLog();
    log.handOver(0);
    expect(() => log.setField('hacked', true)).toThrow();
  });
});

// Build a closed interview record directly for decision-rule tests.
const iv = (n, variant, { ms = 5000, help = false, renderer, repeat = null, reloaded = false, credit = true } = {}) => ({
  n, variant, renderer: renderer ?? (variant === 'flat' ? 'flat' : '3d'), closed: true,
  firstTouchAt: 0, firstCreditAt: credit ? ms : null, transitionMs: 0, taps: 3,
  abandoned: !credit, reloaded, repeat, help, realUseQuestion: null, realUseNote: '', followUp: null, shopType: null,
});
const alt = (k, opts3d, optsFlat) => Array.from({ length: k }, (_, i) => (i % 2 ? iv(i + 1, 'flat', optsFlat) : iv(i + 1, '3d', opts3d)));

describe('decision rule (Demo Spec)', () => {
  it('3D wins when no-help share is at least flat and median is within 2 s', () => {
    expect(decide(alt(10, { ms: 6500 }, { ms: 5000 })).verdict).toBe('3d');
  });

  it('flat wins when 3D is more than 2 s slower', () => {
    expect(decide(alt(10, { ms: 7100 }, { ms: 5000 })).verdict).toBe('flat');
  });

  it('flat wins a tie on share when 3D needed more help', () => {
    const list = alt(10, {}, {});
    list[0].help = true; // one 3D session needed help
    expect(decide(list).verdict).toBe('flat');
  });

  it('excludes fallback, repeat and reloaded sessions, then asks for more interviews', () => {
    const list = alt(10, {}, {});
    list[0].renderer = 'fallback'; list[2].repeat = true; // 3D now has 3 counted
    expect(decide(list)).toMatchObject({ verdict: 'pending', reason: 'run more interviews' });
  });

  it('defaults to flat when the extra-interview cap is reached without enough sessions', () => {
    const list = alt(14, { renderer: 'fallback' }, {});
    expect(decide(list).verdict).toBe('flat');
  });

  it('is pending while fewer than 10 interviews are done', () => {
    expect(decide(alt(4, {}, {})).reason).toBe('interviews still running');
  });

  it('counts abandoned sessions as not succeeding without help', () => {
    const list = alt(10, {}, {});
    list[0] = iv(1, '3d', { credit: false });
    expect(decide(list).d3.noHelpShare).toBe(0.8);
  });
});

describe('CSV (design D9)', () => {
  it('exports blanks as — and escapes notes', () => {
    const rec = iv(1, '3d');
    rec.realUseNote = 'asked "can it remind?", twice';
    const [header, row] = toCsv([rec]).trim().split('\n');
    expect(header.startsWith('n,variant,renderer,shopType')).toBe(true);
    expect(row).toContain('—');
    expect(row).toContain('"asked ""can it remind?"", twice"');
  });
});
