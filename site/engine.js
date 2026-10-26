// Demo engine for the DrukStock interview demo.
// Pure logic, no DOM: fake ledger, money math (big.js), FIFO debt aging,
// the injectable demo clock and the keypad rules. Both renderers (3D and
// flat) use this module, so they always behave the same.
//
// Days are whole integers (a "day number"), never Date objects, so time
// zones can't shift an entry onto the wrong day.

import Big from 'big.js';

export const MAX_AMOUNT = 999999; // design D7: keypad ignores digits beyond 9,99,999
export const OVERDUE_DAYS = 30;   // Demo Spec: overdue when a credit is unpaid > 30 days
export const MONTH_DAYS = 30;     // design D12: "One month later" adds 30 days

const ZERO = new Big(0);

// Local calendar day number for a Date (days since 1970-01-01, local time).
export function dayNumber(date) {
  return Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000
  );
}

// "Nu 1,00,000": Indian grouping (last three digits, then pairs). Whole Nu only.
export function formatNu(amount) {
  const digits = new Big(amount).abs().round(0, Big.roundHalfUp).toFixed(0);
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  const grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3 : last3;
  return 'Nu ' + grouped;
}

// Keypad: returns the new amount string after a key press.
// Keys: '0'-'9', '00', 'back'. Digits that would pass MAX_AMOUNT are ignored.
export function pressKey(current, key) {
  if (key === 'back') return current.slice(0, -1);
  if (!/^(\d|00)$/.test(key)) return current;
  const next = (current + key).replace(/^0+/, '');
  if (next === '') return '';
  return Number(next) > MAX_AMOUNT ? current : next;
}

// An amount can be committed only if it is a whole number from 1 to MAX_AMOUNT.
export function isCommittable(amountStr) {
  return /^\d+$/.test(amountStr) && Number(amountStr) > 0 && Number(amountStr) <= MAX_AMOUNT;
}

export function createEngine({ fixture, startDay, newId } = {}) {
  if (!fixture) throw new Error('fixture is required');
  if (!Number.isInteger(startDay)) throw new Error('startDay must be a day number');
  let counter = 0;
  const makeId = newId ?? (() => `e${++counter}`);

  let state = initialState();

  function initialState() {
    return {
      clockOffset: 0,
      customers: fixture.customers.map(c => ({ ...c })),
      entries: fixture.entries.map(e => ({
        id: e.id,
        customerId: e.customerId,
        type: e.type,
        amount: new Big(e.amount).toFixed(0),
        day: startDay - e.daysAgo,
        reverses: null,
      })),
    };
  }

  const today = () => startDay + state.clockOffset;

  function customer(id) {
    const c = state.customers.find(x => x.id === id);
    if (!c) throw new Error(`unknown customer ${id}`);
    return c;
  }

  const reversedIds = () => new Set(state.entries.filter(e => e.type === 'reversal').map(e => e.reverses));

  // Entries that still count: not a reversal, and not reversed.
  function liveEntries(customerId) {
    const reversed = reversedIds();
    return state.entries.filter(
      e => e.customerId === customerId && e.type !== 'reversal' && !reversed.has(e.id)
    );
  }

  // FIFO: payments clear the oldest credits first.
  function summary(customerId) {
    customer(customerId);
    const live = liveEntries(customerId);
    const credits = live
      .filter(e => e.type === 'credit')
      .sort((a, b) => a.day - b.day || state.entries.indexOf(a) - state.entries.indexOf(b));
    let paid = live.filter(e => e.type === 'payment').reduce((s, e) => s.plus(e.amount), ZERO);
    let oldestUnpaidDay = null;
    let owes = ZERO;
    for (const c of credits) {
      const amt = new Big(c.amount);
      if (paid.gte(amt)) { paid = paid.minus(amt); continue; }
      const left = amt.minus(paid);
      paid = ZERO;
      if (oldestUnpaidDay === null) oldestUnpaidDay = c.day;
      owes = owes.plus(left);
    }
    const advance = paid; // payments left over after every credit is cleared
    const daysUnpaid = oldestUnpaidDay === null ? 0 : today() - oldestUnpaidDay;
    return {
      customerId,
      owes,
      advance,
      oldestUnpaidDay,
      daysUnpaid,
      overdue: oldestUnpaidDay !== null && daysUnpaid > OVERDUE_DAYS,
    };
  }

  return {
    today,

    customers() {
      return state.customers.map(c => ({ ...c, ...summary(c.id) }));
    },

    summary,

    // "Customers owe you": sum of what each customer owes (advances don't offset others).
    shopTotal() {
      return state.customers.reduce((s, c) => s.plus(summary(c.id).owes), ZERO);
    },

    record(customerId, type, amountStr) {
      customer(customerId);
      if (type !== 'credit' && type !== 'payment') throw new Error(`bad type ${type}`);
      if (!isCommittable(amountStr)) throw new Error(`bad amount ${amountStr}`);
      const entry = { id: makeId(), customerId, type, amount: new Big(amountStr).toFixed(0), day: today(), reverses: null };
      state.entries.push(entry);
      return { ...entry };
    },

    // Only an original credit or payment can be corrected, and only once.
    canCorrect(entryId) {
      const e = state.entries.find(x => x.id === entryId);
      return !!e && e.type !== 'reversal' && !reversedIds().has(e.id);
    },

    correct(entryId) {
      if (!this.canCorrect(entryId)) throw new Error(`cannot correct ${entryId}`);
      const original = state.entries.find(x => x.id === entryId);
      const reversal = { id: makeId(), customerId: original.customerId, type: 'reversal', amount: original.amount, day: today(), reverses: original.id };
      state.entries.push(reversal);
      return { ...reversal };
    },

    // Newest first, with whether each line has been corrected.
    history(customerId) {
      customer(customerId);
      const reversed = reversedIds();
      return state.entries
        .map((e, index) => ({ ...e, index, corrected: reversed.has(e.id) }))
        .filter(e => e.customerId === customerId)
        .sort((a, b) => b.day - a.day || b.index - a.index)
        .map(({ index, ...e }) => e);
    },

    oneMonthLater() {
      state.clockOffset += MONTH_DAYS;
      return today();
    },

    // The oldest unpaid customer, for the "30 days later: X has not paid" banner.
    oldestUnpaidCustomer() {
      let best = null;
      for (const c of this.customers()) {
        if (c.oldestUnpaidDay === null) continue;
        if (!best || c.oldestUnpaidDay < best.oldestUnpaidDay) best = c;
      }
      return best;
    },

    reset() {
      state = initialState();
    },

    // ER-D11: interview state survives a reload.
    snapshot() {
      return JSON.parse(JSON.stringify(state));
    },

    restore(snap) {
      state = JSON.parse(JSON.stringify(snap));
    },
  };
}
