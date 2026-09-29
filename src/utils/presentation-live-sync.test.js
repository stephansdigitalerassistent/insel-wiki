/**
 * Unit tests for live presentation synchronization — src/utils/presentation-live-sync.test.js
 * Run with: node src/utils/presentation-live-sync.test.js
 */

// Setup minimal DOM mocks before importing presentation component
const elements = new Map();

function createMockElement(tag = 'div') {
  const classSet = new Set();
  const attributes = new Map();
  const el = {
    tagName: tag.toUpperCase(),
    _id: '',
    get id() { return this._id; },
    set id(val) {
      this._id = val;
      if (val) elements.set(val, el);
    },
    style: {},
    children: [],
    dataset: {},
    _innerHTML: '',
    get innerHTML() { return this._innerHTML; },
    set innerHTML(val) {
      this._innerHTML = val;
      // parse child IDs if any
      const idMatches = [...val.matchAll(/id=["']([^"']+)["']/g)];
      for (const m of idMatches) {
        if (!elements.has(m[1])) {
          const child = createMockElement();
          child.id = m[1];
          elements.set(m[1], child);
        }
      }
    },
    textContent: '',
    classList: {
      add: (...cls) => cls.forEach(c => classSet.add(c)),
      remove: (...cls) => cls.forEach(c => classSet.delete(c)),
      toggle: (c, force) => {
        if (force === undefined) {
          if (classSet.has(c)) classSet.delete(c);
          else classSet.add(c);
        } else if (force) classSet.add(c);
        else classSet.delete(c);
      },
      contains: (c) => classSet.has(c)
    },
    setAttribute: (k, v) => attributes.set(k, v),
    getAttribute: (k) => attributes.get(k),
    appendChild: (child) => { el.children.push(child); return child; },
    removeChild: (child) => { el.children = el.children.filter(c => c !== child); return child; },
    addEventListener: () => {},
    removeEventListener: () => {},
    querySelector: (sel) => {
      if (sel.startsWith('#')) {
        const id = sel.slice(1);
        return elements.get(id) || null;
      }
      return null;
    },
    querySelectorAll: () => []
  };
  return el;
}

const mockBody = createMockElement('body');

global.document = {
  body: mockBody,
  getElementById: (id) => elements.get(id) || null,
  createElement: (tag) => {
    const el = createMockElement(tag);
    return el;
  },
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

const { openPresentation, updatePresentation, closePresentation, isPresentationOpen, goToSlide, setTimerSeconds, getTimerSeconds, toggleMute, setMuted, isAudioMuted, handleTimerAudio, setSoundListenerForTesting, handleKeyDown } = await import('../components/presentation.js');

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
    toEqual(expected) {
      const a = JSON.stringify(actual);
      const e = JSON.stringify(expected);
      if (a !== e) throw new Error(`Expected ${e} but got ${a}`);
    },
    toBeTruthy() {
      if (!actual) throw new Error(`Expected truthy but got "${actual}"`);
    },
    toBeFalsy() {
      if (actual) throw new Error(`Expected falsy but got "${actual}"`);
    },
    toContain(sub) {
      if (!actual || !actual.includes(sub)) throw new Error(`Expected "${actual}" to contain "${sub}"`);
    }
  };
}

console.log('\n📽️ Presentation Live Synchronization Tests');

test('openPresentation sets presentation as open and renders initial slides', () => {
  openPresentation({
    title: 'Hackathon Pitch',
    content: '# Slide 1\nContent 1\n---\n# Slide 2\nContent 2',
    isMarkdown: true,
    pageId: 'page-1'
  });

  expect(isPresentationOpen()).toBe(true);
  const deckTitleEl = elements.get('presentation-deck-title');
  expect(deckTitleEl.textContent).toBe('Hackathon Pitch');

  const counterEl = elements.get('presentation-slide-counter');
  expect(counterEl.textContent).toBe('1 / 2');
});

test('updatePresentation on the same page updates slides and preserves current slide index', () => {
  goToSlide(1);
  const counterEl = elements.get('presentation-slide-counter');
  expect(counterEl.textContent).toBe('2 / 2');

  // Update content on page-1 with 3 slides
  updatePresentation({
    title: 'Hackathon Pitch (Updated)',
    content: '# Slide 1\nContent 1\n---\n# Slide 2\nContent 2 Updated\n---\n# Slide 3\nContent 3',
    isMarkdown: true,
    pageId: 'page-1'
  });

  const deckTitleEl = elements.get('presentation-deck-title');
  expect(deckTitleEl.textContent).toBe('Hackathon Pitch (Updated)');
  // Still on slide 2 (index 1) of 3 slides
  expect(counterEl.textContent).toBe('2 / 3');

  const stageEl = elements.get('presentation-stage');
  expect(stageEl.innerHTML).toContain('Content 2 Updated');
});

test('updatePresentation clamps index if new content has fewer slides', () => {
  // Currently on slide 2 of 3. Update to only 1 slide.
  updatePresentation({
    title: 'Hackathon Pitch',
    content: '# Only Slide',
    isMarkdown: true,
    pageId: 'page-1'
  });

  const counterEl = elements.get('presentation-slide-counter');
  expect(counterEl.textContent).toBe('1 / 1');
});

test('updatePresentation when switching to a different page resets index to first slide', () => {
  // Update to page-2 with 3 slides
  updatePresentation({
    title: 'Second Page Deck',
    content: '# Page 2 Slide 1\n---\n# Page 2 Slide 2',
    isMarkdown: true,
    pageId: 'page-2'
  });

  const deckTitleEl = elements.get('presentation-deck-title');
  expect(deckTitleEl.textContent).toBe('Second Page Deck');

  const counterEl = elements.get('presentation-slide-counter');
  expect(counterEl.textContent).toBe('1 / 2');
});

test('closePresentation resets open state and cleans up', () => {
  closePresentation();
  expect(isPresentationOpen()).toBe(false);
});

test('last-minute countdown stays active during final 60 seconds and overtime', () => {
  openPresentation({
    title: 'Countdown Test',
    content: '# Slide 1\nHello',
    isMarkdown: true,
    pageId: 'countdown-page'
  });

  const overlayEl = document.getElementById('presentation-overlay');
  expect(overlayEl.classList.contains('last-minute')).toBe(false);

  // Set timer to 61s: not last minute
  setTimerSeconds(61);
  expect(overlayEl.classList.contains('last-minute')).toBe(false);

  // Set timer to 60s: enters last minute
  setTimerSeconds(60);
  expect(overlayEl.classList.contains('last-minute')).toBe(true);

  // Set timer to 15s: critical
  setTimerSeconds(15);
  expect(overlayEl.classList.contains('last-minute')).toBe(true);

  // Overtime: -10s
  setTimerSeconds(-10);
  expect(overlayEl.classList.contains('last-minute')).toBe(true);

  // Reset timer (180s): exits last minute
  setTimerSeconds(180);
  expect(overlayEl.classList.contains('last-minute')).toBe(false);

  // When timer hits last minute and presentation closes, last-minute is cleared
  setTimerSeconds(45);
  expect(overlayEl.classList.contains('last-minute')).toBe(true);
  closePresentation();
  expect(overlayEl.classList.contains('last-minute')).toBe(false);
});

test('handleTimerAudio triggers ping at 60s, ticks at 5..1s, alarm at 0s, and respects mute', () => {
  const sounds = [];
  setSoundListenerForTesting((s) => sounds.push(s));
  setMuted(false);

  const ref = { ping: null, tick: null, alarm: null };

  // 61 -> 60: ping
  handleTimerAudio(60, 61, ref);
  expect(sounds[sounds.length - 1]).toBe('ping');

  // 60 -> 59: nothing
  handleTimerAudio(59, 60, ref);
  expect(sounds[sounds.length - 1]).toBe('ping');

  // 6 -> 5: tick
  handleTimerAudio(5, 6, ref);
  expect(sounds[sounds.length - 1]).toBe('tick');

  // 5 -> 4: tick
  handleTimerAudio(4, 5, ref);
  expect(sounds[sounds.length - 1]).toBe('tick');

  // 4 -> 3: tick
  handleTimerAudio(3, 4, ref);
  expect(sounds[sounds.length - 1]).toBe('tick');

  // 3 -> 2: tick
  handleTimerAudio(2, 3, ref);
  expect(sounds[sounds.length - 1]).toBe('tick');

  // 2 -> 1: tick
  handleTimerAudio(1, 2, ref);
  expect(sounds[sounds.length - 1]).toBe('tick');

  // 1 -> 0: alarm!
  handleTimerAudio(0, 1, ref);
  expect(sounds[sounds.length - 1]).toBe('alarm');

  // 0 -> -1: no sound
  const count = sounds.length;
  handleTimerAudio(-1, 0, ref);
  expect(sounds.length).toBe(count);

  // Muted: no sounds triggered
  setMuted(true);
  expect(isAudioMuted()).toBe(true);
  const mutedRef = { ping: null, tick: null, alarm: null };
  handleTimerAudio(60, 61, mutedRef);
  handleTimerAudio(5, 6, mutedRef);
  handleTimerAudio(0, 1, mutedRef);
  expect(sounds.length).toBe(count);

  // Toggle mute back
  toggleMute();
  expect(isAudioMuted()).toBe(false);

  setSoundListenerForTesting(null);
});

// Every presentation binding is an unmodified key. Ctrl+R must stay a browser
// reload rather than resetting the pitch timer mid-pitch, Ctrl+F must stay
// find, and Ctrl+S must not toggle mute.
test('modified key combinations are left to the browser', () => {
  openPresentation({ title: 'Deck', content: '# A\n\n---\n\n# B', isMarkdown: true, pageId: 'p-mod' });

  for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
    for (const key of ['r', 'f', 's', 't', 'n', 'm', 'c', 'ArrowRight', 'Escape']) {
      setTimerSeconds(123);
      let prevented = false;
      handleKeyDown({ key, [modifier]: true, preventDefault: () => { prevented = true; } });
      expect(prevented).toBe(false);
      expect(getTimerSeconds()).toBe(123);
      expect(isPresentationOpen()).toBe(true);
    }
  }

  // Unmodified keys still work: 'r' resets the pitch timer.
  setTimerSeconds(42);
  let barePrevented = false;
  handleKeyDown({ key: 'r', preventDefault: () => { barePrevented = true; } });
  expect(barePrevented).toBe(true);
  expect(getTimerSeconds()).toBe(180);

  // Shift is deliberately not treated as a modifier: Shift+Space steps back.
  goToSlide(1);
  let shiftPrevented = false;
  handleKeyDown({ key: ' ', shiftKey: true, preventDefault: () => { shiftPrevented = true; } });
  expect(shiftPrevented).toBe(true);

  closePresentation();
});

console.log(`\n────────────────────────────────────────\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('✅ All presentation live sync tests passed!');
}
