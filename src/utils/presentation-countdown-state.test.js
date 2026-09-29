/**
 * Unit tests for slide countdown persistence and drift — src/utils/presentation-countdown-state.test.js
 * Run with: node src/utils/presentation-countdown-state.test.js
 *
 * Unlike presentation-live-sync.test.js this harness gives the mock DOM real
 * `.slide-countdown-card` elements and a controllable clock, so the countdown
 * cards actually run.
 */

// ── Controllable clock ────────────────────────────────────────────
let fakeNow = 1_700_000_000_000;
const realDateNow = Date.now;
Date.now = () => fakeNow;

const intervals = new Set();
global.setInterval = (fn, ms) => {
  const handle = { fn, ms };
  intervals.add(handle);
  return handle;
};
global.clearInterval = (handle) => { if (handle) intervals.delete(handle); };
global.setTimeout = (fn) => ({ fn });
global.clearTimeout = () => {};

/** Advances the clock and lets every live interval observe the new time. */
function advance(ms) {
  fakeNow += ms;
  [...intervals].forEach(h => h.fn());
}

// ── DOM mock, with countdown cards parsed out of innerHTML ────────
const elements = new Map();

function createMockElement(tag = 'div') {
  const classSet = new Set();
  const attributes = new Map();
  const el = {
    tagName: tag.toUpperCase(),
    _id: '',
    get id() { return this._id; },
    set id(val) { this._id = val; if (val) elements.set(val, el); },
    style: {},
    children: [],
    dataset: {},
    _cards: [],
    _innerHTML: '',
    get innerHTML() { return this._innerHTML; },
    set innerHTML(val) {
      this._innerHTML = val;
      for (const m of val.matchAll(/id=["']([^"']+)["']/g)) {
        if (!elements.has(m[1])) {
          const child = createMockElement();
          child.id = m[1];
          elements.set(m[1], child);
        }
      }
      el._cards = parseCountdownCards(val);
    },
    textContent: '',
    classList: {
      add: (...cls) => cls.forEach(c => classSet.add(c)),
      remove: (...cls) => cls.forEach(c => classSet.delete(c)),
      toggle: (c, force) => {
        if (force === undefined) {
          if (classSet.has(c)) classSet.delete(c); else classSet.add(c);
        } else if (force) classSet.add(c); else classSet.delete(c);
      },
      contains: (c) => classSet.has(c)
    },
    setAttribute: (k, v) => attributes.set(k, v),
    getAttribute: (k) => attributes.get(k),
    appendChild: (child) => { el.children.push(child); return child; },
    removeChild: (child) => { el.children = el.children.filter(c => c !== child); return child; },
    addEventListener: () => {},
    removeEventListener: () => {},
    querySelector: (sel) => (sel.startsWith('#') ? elements.get(sel.slice(1)) || null : null),
    querySelectorAll: (sel) => (sel === '.slide-countdown-card' ? el._cards : [])
  };
  return el;
}

/** Builds a card element per rendered widget, carrying its data-countdown-* set. */
function parseCountdownCards(html) {
  const cards = [];
  for (const m of html.matchAll(/<div class="slide-countdown-card"([^>]*)>/g)) {
    const attrs = m[1];
    const card = createMockElement();
    const read = (name) => (attrs.match(new RegExp(`data-countdown-${name}="([^"]*)"`)) || [])[1] || '';
    card.dataset = {
      countdownType: read('type'),
      countdownTarget: read('target'),
      countdownDuration: read('duration'),
      countdownLabel: read('label')
    };
    const parts = new Map();
    card.querySelector = (sel) => {
      if (!parts.has(sel)) parts.set(sel, createMockElement());
      return parts.get(sel);
    };
    cards.push(card);
  }
  return cards;
}

const mockBody = createMockElement('body');
global.document = {
  body: mockBody,
  getElementById: (id) => elements.get(id) || null,
  createElement: (tag) => createMockElement(tag),
  addEventListener: () => {},
  removeEventListener: () => {},
  fullscreenElement: null
};
global.window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  innerWidth: 1920,
  innerHeight: 1080
};
global.requestAnimationFrame = (fn) => fn();
global.localStorage = { getItem: () => null, setItem: () => {} };

const {
  openPresentation, updatePresentation, closePresentation,
  getSlideCountdownStateForTesting, getTimerSeconds, setTimerSeconds, handleKeyDown
} = await import('../components/presentation.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✕ ${name}`);
    console.error(`    ${err.message}\n${err.stack}`);
  }
}

function expect(actual) {
  return {
    toBe(expected) {
      if (actual !== expected) throw new Error(`Expected "${expected}" but got "${actual}"`);
    },
    toBeTruthy() {
      if (!actual) throw new Error(`Expected truthy but got "${actual}"`);
    },
    toBeFalsy() {
      if (actual) throw new Error(`Expected falsy but got "${actual}"`);
    }
  };
}

console.log('\n⏱️ Slide Countdown State & Timer Drift Tests');

const DECK = '# Plan\n\n## Countdown 15 min\n\n---\n\n## Zweite Folie\n';

test('a running duration countdown survives a live edit of the same slide', () => {
  openPresentation({ title: 'Plan', content: DECK, isMarkdown: true, pageId: 'p1' });

  let [card] = getSlideCountdownStateForTesting();
  expect(card).toBeTruthy();
  expect(card.seconds).toBe(900);

  advance(120_000); // two minutes of the working block elapse
  [card] = getSlideCountdownStateForTesting();
  expect(card.seconds).toBe(780);

  // Somebody — possibly a remote collaborator — types on the page.
  updatePresentation({ title: 'Plan', content: DECK + '\nNoch ein Satz.\n', isMarkdown: true, pageId: 'p1' });

  [card] = getSlideCountdownStateForTesting();
  expect(card.seconds).toBe(780);
  expect(card.isRunning).toBe(true);

  closePresentation();
});

test('a paused countdown stays paused across a live edit', () => {
  openPresentation({ title: 'Plan', content: DECK, isMarkdown: true, pageId: 'p2' });

  handleKeyDown({ key: 'c', preventDefault: () => {} }); // pause all slide countdowns
  let [card] = getSlideCountdownStateForTesting();
  expect(card.isRunning).toBe(false);

  advance(30_000); // paused: the clock must not move
  [card] = getSlideCountdownStateForTesting();
  expect(card.seconds).toBe(900);

  updatePresentation({ title: 'Plan', content: DECK + '\nEdit.\n', isMarkdown: true, pageId: 'p2' });

  [card] = getSlideCountdownStateForTesting();
  expect(card.isRunning).toBe(false);
  expect(card.seconds).toBe(900);

  closePresentation();
});

test('moving to another slide and back still starts the countdown fresh', () => {
  openPresentation({ title: 'Plan', content: DECK, isMarkdown: true, pageId: 'p3' });
  advance(60_000);
  expect(getSlideCountdownStateForTesting()[0].seconds).toBe(840);

  handleKeyDown({ key: 'ArrowRight', preventDefault: () => {} });
  expect(getSlideCountdownStateForTesting().length).toBe(0);

  handleKeyDown({ key: 'ArrowLeft', preventDefault: () => {} });
  expect(getSlideCountdownStateForTesting()[0].seconds).toBe(900);

  closePresentation();
});

test('the pitch timer is derived from a deadline, not from interval count', () => {
  openPresentation({ title: 'Plan', content: DECK, isMarkdown: true, pageId: 'p4' });

  handleKeyDown({ key: 't', preventDefault: () => {} }); // start the 3-minute timer
  expect(getTimerSeconds()).toBe(180);

  // A hidden tab gets its timers throttled: 45s of wall clock passes but the
  // interval only fires a couple of times. The timer must still be right.
  fakeNow += 45_000;
  [...intervals].forEach(h => h.fn());
  expect(getTimerSeconds()).toBe(135);

  // And it keeps counting normally afterwards.
  advance(5_000);
  expect(getTimerSeconds()).toBe(130);

  setTimerSeconds(180);
  closePresentation();
});

Date.now = realDateNow;

console.log(`\n────────────────────────────────────────\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('✅ All countdown state tests passed!');
}
