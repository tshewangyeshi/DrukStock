// Bilingual UI strings (Demo Spec Labels, eng re-review ER-D8).
// `dz` is written and checked by the native speaker; until then it stays
// empty and only the English line shows. `{n}` is a number placeholder.
// Numbers use 0-9 in both lines (ER-D8, pending the speaker's confirmation).

export const LABELS = {
  headline:       { en: 'Your baki book, on your phone.', dz: '' },
  tryIt:          { en: 'Try it',                         dz: '' },
  gaveCredit:     { en: 'Gave credit',                    dz: '' },
  gotPayment:     { en: 'Got payment',                    dz: '' },
  done:           { en: 'Done',                           dz: '' },
  monthLater:     { en: 'One month later →',              dz: '' },
  daysUnpaid:     { en: '{n} days unpaid',                dz: '' },
  endCardLine:    { en: 'Want this for your shop?',       dz: '' },
};

// Every bilingual label still missing its Dzongkha line.
export function missingDzongkha() {
  return Object.keys(LABELS).filter(k => !LABELS[k].dz);
}

export function fill(text, vars = {}) {
  return text.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}
