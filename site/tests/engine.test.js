import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createEngine, formatNu, pressKey, isCommittable, dayNumber, MAX_AMOUNT } from '../engine.js';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/customers.json', import.meta.url)));
const START = 20000; // any day number; the fixture is relative to it
const engine = () => createEngine({ fixture, startDay: START });
const owes = (e, id) => e.summary(id).owes.toFixed(0);

describe('fixture', () => {
  it('starts at Nu 12,480 with Karma Dorji and Tashi Lhamo overdue', () => {
    const e = engine();
    expect(formatNu(e.shopTotal())).toBe('Nu 12,480');
    const overdue = e.customers().filter(c => c.overdue).map(c => [c.name, c.daysUnpaid]);
    expect(overdue).toEqual([['Karma Dorji', 41], ['Tashi Lhamo', 35]]);
  });

  it('applies the fixture payment FIFO (Pema Choden owes 2,150, oldest unpaid 20 days)', () => {
    const s = engine().summary('c2');
    expect(s.owes.toFixed(0)).toBe('2150');
    expect(s.daysUnpaid).toBe(20);
  });
});

describe('formatNu (design D7: Indian grouping)', () => {
  it.each([
    ['0', 'Nu 0'], ['450', 'Nu 450'], ['3790', 'Nu 3,790'], ['12480', 'Nu 12,480'],
    ['100000', 'Nu 1,00,000'], ['999999', 'Nu 9,99,999'],
  ])('%s → %s', (n, out) => expect(formatNu(n)).toBe(out));
});

describe('keypad (design D7: prevent, don\'t scold)', () => {
  it('builds an amount and ignores digits past 9,99,999', () => {
    let a = '';
    for (const k of ['9', '9', '9', '9', '9', '9']) a = pressKey(a, k);
    expect(a).toBe('999999');
    expect(pressKey(a, '1')).toBe('999999');
    expect(pressKey(a, '00')).toBe('999999');
  });

  it('handles 00, backspace, leading zeros and junk keys', () => {
    expect(pressKey('4', '00')).toBe('400');
    expect(pressKey('400', 'back')).toBe('40');
    expect(pressKey('', '0')).toBe('');
    expect(pressKey('', '00')).toBe('');
    expect(pressKey('12', '.')).toBe('12');
  });

  it('only commits whole amounts from 1 to the max', () => {
    expect(isCommittable('')).toBe(false);
    expect(isCommittable('0')).toBe(false);
    expect(isCommittable('450')).toBe(true);
    expect(isCommittable(String(MAX_AMOUNT + 1))).toBe(false);
    expect(isCommittable('-5')).toBe(false);
  });
});

describe('recording', () => {
  it('credit raises the balance and the shop total', () => {
    const e = engine();
    e.record('c1', 'credit', '450');
    expect(owes(e, 'c1')).toBe('4240');
    expect(formatNu(e.shopTotal())).toBe('Nu 12,930');
  });

  it('rejects bad amounts and types instead of recording them', () => {
    const e = engine();
    expect(() => e.record('c1', 'credit', '0')).toThrow();
    expect(() => e.record('c1', 'gift', '10')).toThrow();
    expect(() => e.record('nobody', 'credit', '10')).toThrow();
    expect(owes(e, 'c1')).toBe('3790');
  });

  it('a payment clears the oldest credit first and can clear the overdue flag', () => {
    const e = engine();
    e.record('c1', 'payment', '2400'); // exactly the 41-day credit
    const s = e.summary('c1');
    expect(s.owes.toFixed(0)).toBe('1390');
    expect(s.daysUnpaid).toBe(12);
    expect(s.overdue).toBe(false);
  });

  it('overpayment becomes an advance that the next credit uses up (D13/D27)', () => {
    const e = engine();
    e.record('c4', 'payment', '1140'); // owes 980
    let s = e.summary('c4');
    expect(s.owes.toFixed(0)).toBe('0');
    expect(s.advance.toFixed(0)).toBe('160');
    expect(s.overdue).toBe(false);
    e.record('c4', 'credit', '100');
    s = e.summary('c4');
    expect(s.advance.toFixed(0)).toBe('60');
    expect(s.owes.toFixed(0)).toBe('0');
  });

  it('sums stay exact over 1,000 entries (no float drift)', () => {
    const e = engine();
    for (let i = 0; i < 1000; i++) e.record('c6', 'credit', '7');
    expect(owes(e, 'c6')).toBe(String(1350 + 7000));
  });
});

describe('corrections (D13/D27: reverse once, never a reversal)', () => {
  it('a correction reverses the entry and marks it corrected in history', () => {
    const e = engine();
    const credit = e.record('c3', 'credit', '500');
    const rev = e.correct(credit.id);
    expect(owes(e, 'c3')).toBe('1320');
    const h = e.history('c3');
    expect(h[0]).toMatchObject({ id: rev.id, type: 'reversal', reverses: credit.id });
    expect(h.find(x => x.id === credit.id).corrected).toBe(true);
  });

  it('refuses a second correction and a correction of a reversal', () => {
    const e = engine();
    const credit = e.record('c3', 'credit', '500');
    const rev = e.correct(credit.id);
    expect(e.canCorrect(credit.id)).toBe(false);
    expect(e.canCorrect(rev.id)).toBe(false);
    expect(() => e.correct(credit.id)).toThrow();
    expect(() => e.correct(rev.id)).toThrow();
  });

  it('correcting a payment restores the debt', () => {
    const e = engine();
    const pay = e.record('c5', 'payment', '890');
    expect(owes(e, 'c5')).toBe('2000');
    e.correct(pay.id);
    expect(owes(e, 'c5')).toBe('2890');
  });
});

describe('demo clock (design D12)', () => {
  it('"One month later" moves today by 30 days and ages debts', () => {
    const e = engine();
    expect(e.oneMonthLater()).toBe(START + 30);
    expect(e.summary('c1').daysUnpaid).toBe(71);
    expect(e.summary('c3').overdue).toBe(true); // 14 + 30 days
  });

  it('names the oldest unpaid customer for the banner', () => {
    const e = engine();
    e.oneMonthLater();
    expect(e.oldestUnpaidCustomer().name).toBe('Karma Dorji');
  });

  it('new entries are dated on the demo clock', () => {
    const e = engine();
    e.oneMonthLater();
    expect(e.record('c6', 'credit', '10').day).toBe(START + 30);
  });
});

describe('reset and reload (design D11, ER-D11)', () => {
  it('reset restores the fixture and today', () => {
    const e = engine();
    e.record('c1', 'credit', '450');
    e.oneMonthLater();
    e.reset();
    expect(formatNu(e.shopTotal())).toBe('Nu 12,480');
    expect(e.today()).toBe(START);
  });

  it('a snapshot restores entries and the clock after a reload', () => {
    const e = engine();
    e.record('c1', 'credit', '450');
    e.oneMonthLater();
    const snap = JSON.parse(JSON.stringify(e.snapshot())); // as if read back from IndexedDB
    const reloaded = engine();
    reloaded.restore(snap);
    expect(owes(reloaded, 'c1')).toBe('4240');
    expect(reloaded.today()).toBe(START + 30);
  });
});

describe('dayNumber', () => {
  it('ignores the time of day', () => {
    expect(dayNumber(new Date(2026, 9, 26, 0, 5))).toBe(dayNumber(new Date(2026, 9, 26, 23, 55)));
    expect(dayNumber(new Date(2026, 9, 27)) - dayNumber(new Date(2026, 9, 26))).toBe(1);
  });
});
