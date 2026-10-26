// Two-entry history (eng re-review ER-D5): every screen change replaces the
// current entry; one guard entry is pushed when an interview starts (on the
// Hand over tap). The system back gesture then pops the guard, and we decide
// what "back" means per screen:
//   customer → list, end → list, log → the screen it was opened from,
//   list/opening → stay (guard re-armed on the next tap), start → leave app.

const BACK = {
  customer: () => 'list',
  end: () => 'list',
  list: () => null,
  opening: () => null,
};

export function createNav({ onBack }) {
  let screen = 'start';
  let guarded = false;
  let logReturn = null;

  function armGuard() {
    if (guarded || screen === 'start') return;
    history.pushState({ guard: true }, '');
    guarded = true;
  }

  window.addEventListener('popstate', () => {
    guarded = false;
    if (screen === 'start') return; // let the gesture leave the app
    let target;
    if (screen === 'log') target = logReturn ?? 'start';
    else target = BACK[screen]?.() ?? null;
    if (target) onBack(target);
    // Browsers ignore pushState without a user gesture, so re-arm on next tap.
  });

  // Re-arm the guard on the next user tap inside the app.
  window.addEventListener('pointerdown', armGuard, { capture: true });

  return {
    get screen() { return screen; },
    go(next, { fromLog } = {}) {
      if (next === 'log') logReturn = fromLog ?? screen;
      screen = next;
      history.replaceState({ screen: next }, '');
    },
    // Called from the Hand over tap (a user gesture).
    startInterview() { guarded = false; armGuard(); },
  };
}
