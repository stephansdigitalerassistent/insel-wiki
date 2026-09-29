// Presentation mode component — lightweight slide engine with 3-minute pitch timer
import DOMPurify from 'dompurify';
import { parseSlides, calculateSlideScale } from '../utils/presentation-parser.js';

let overlayEl = null;
let stageEl = null;
let deckTitleEl = null;
let slideCounterEl = null;
let progressFillEl = null;
let prevBtn = null;
let nextBtn = null;
let notesDrawerEl = null;
let notesContentEl = null;
let notesToggleBtn = null;
let fullscreenBtn = null;
let timerContainer = null;
let timerDisplay = null;
let timerToggleBtn = null;
let timerResetBtn = null;

let slides = [];
let currentIndex = 0;
let isOpen = false;
let notesOpen = false;
let currentDeckPageId = null;
let lastTitle = '';
let lastContent = '';

// 3-Minute Pitch Timer (180 seconds)
const TIMER_DEFAULT_SECONDS = 180;
let timerSeconds = TIMER_DEFAULT_SECONDS;
let timerInterval = null;
let timerRunning = false;
// Epoch ms at which timerSeconds reaches 0. The timer is derived from this
// rather than decremented per interval: browsers clamp and then heavily throttle
// timers in a hidden tab, so a presenter who alt-tabs to demo an app came back
// to a timer running slow and an alarm that fired late.
let timerDeadline = null;
const TIMER_POLL_MS = 250;

// Slide Countdown Widgets (for target-time & duration clocks)
let slideCountdownTimers = [];

// Mouse inactivity detection
let idleTimer = null;
const IDLE_DELAY_MS = 3500;

// Touch tracking
let touchStartX = 0;
let touchStartY = 0;

// ──────────────────────────────────────────────
// Audio Effects & Sound Mute State
// ──────────────────────────────────────────────
let soundToggleBtn = null;
let timerSoundBtn = null;
let isMuted = false;
let pitchTimerAudioRef = { ping: null, tick: null, alarm: null };
let lastSoundTimestamps = { ping: 0, tick: 0, alarm: 0 };
let soundListener = null;

try {
  if (typeof localStorage !== 'undefined') {
    isMuted = localStorage.getItem('hanspecathon_presentation_muted') === 'true';
  }
} catch (e) {}

let audioCtx = null;
function getAudioContext() {
  if (typeof window === 'undefined') return null;
  const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtxClass) return null;
  try {
    if (!audioCtx) {
      audioCtx = new AudioCtxClass();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  } catch (e) {
    return null;
  }
}

function throttleSound(type, fn) {
  const now = Date.now();
  if (now - (lastSoundTimestamps[type] || 0) < 80) return;
  lastSoundTimestamps[type] = now;
  fn();
}

/**
 * Plays a resonant chime ping at 1 minute remaining.
 */
export function playPingSound() {
  if (isMuted) return;
  throttleSound('ping', () => {
    if (typeof soundListener === 'function') soundListener('ping');
    const ctx = getAudioContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      // Primary chime tone (A5, 880 Hz)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(880, now);
      gain1.gain.setValueAtTime(0.3, now);
      gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.85);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.85);

      // Harmonic chime overtone (E6, 1320 Hz)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1320, now);
      gain2.gain.setValueAtTime(0.15, now);
      gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now);
      osc2.stop(now + 0.6);
    } catch (e) {}
  });
}

/**
 * Plays a crisp woodblock second tick for the last 5 seconds (5, 4, 3, 2, 1).
 */
export function playTickSound() {
  if (isMuted) return;
  throttleSound('tick', () => {
    if (typeof soundListener === 'function') soundListener('tick');
    const ctx = getAudioContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1200, now);
      osc.frequency.exponentialRampToValueAtTime(450, now + 0.045);
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.045);
    } catch (e) {}
  });
}

/**
 * Plays an unmistakable, hilariously annoying alarm when reaching 0 seconds:
 * rapid piercing digital timer beeps followed by an aggressive buzzer finish ("BEEP-BEEP-BEEP-BEEP-BZZZZT!").
 */
export function playAlarmSound() {
  if (isMuted) return;
  throttleSound('alarm', () => {
    if (typeof soundListener === 'function') soundListener('alarm');
    const ctx = getAudioContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;

      // 1. Four rapid piercing digital alarm beeps (square wave ~2093 Hz)
      const beeps = [0.00, 0.11, 0.22, 0.33];
      beeps.forEach(start => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(2093, now + start);
        gain.gain.setValueAtTime(0.35, now + start);
        gain.gain.setValueAtTime(0.35, now + start + 0.07);
        gain.gain.linearRampToValueAtTime(0.001, now + start + 0.08);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + start);
        osc.stop(now + start + 0.08);
      });

      // 2. Heavy aggressive game-show / shot-clock buzzer finish: "BZZZZT!" (0.46s to 1.22s)
      const buzzerStart = now + 0.46;
      const buzzerDur = 0.76;

      const buzzerLayers = [
        { type: 'sawtooth', freq: 185, vol: 0.35 },
        { type: 'sawtooth', freq: 220, vol: 0.35 },
        { type: 'square', freq: 950, vol: 0.25 }
      ];

      buzzerLayers.forEach(b => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = b.type;
        osc.frequency.setValueAtTime(b.freq, buzzerStart);
        // Slight downward pitch bend at end of buzzer for comedic "time's up" drop
        osc.frequency.setValueAtTime(b.freq, buzzerStart + buzzerDur - 0.15);
        osc.frequency.linearRampToValueAtTime(b.freq * 0.75, buzzerStart + buzzerDur);

        gain.gain.setValueAtTime(b.vol, buzzerStart);
        gain.gain.setValueAtTime(b.vol, buzzerStart + buzzerDur - 0.08);
        gain.gain.linearRampToValueAtTime(0.0001, buzzerStart + buzzerDur);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(buzzerStart);
        osc.stop(buzzerStart + buzzerDur);
      });
    } catch (e) {}
  });
}

/**
 * Checks remaining timer seconds and triggers audio cues for 1 min ping, last 5s ticks, and 0s alarm.
 * @param {number} currentSec
 * @param {number} prevSec
 * @param {Object} audioRef
 */
export function handleTimerAudio(currentSec, prevSec, audioRef) {
  if (isMuted) return;
  if (prevSec === currentSec) return;

  // 1 minute ping
  if ((currentSec === 60 || (prevSec > 60 && currentSec < 60)) && audioRef.ping !== currentSec) {
    audioRef.ping = currentSec;
    playPingSound();
  }

  // Last 5 seconds ticks (5, 4, 3, 2, 1)
  if (currentSec >= 1 && currentSec <= 5 && audioRef.tick !== currentSec) {
    audioRef.tick = currentSec;
    playTickSound();
  }

  // 0 seconds alarm
  if ((currentSec === 0 || (prevSec > 0 && currentSec < 0)) && audioRef.alarm !== currentSec) {
    audioRef.alarm = currentSec;
    playAlarmSound();
  }
}

/**
 * Updates sound icons across all presentation controls.
 */
function updateSoundUI() {
  const soundIconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`;
  const noSoundIconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`;

  if (soundToggleBtn) {
    soundToggleBtn.classList.toggle('muted', isMuted);
    soundToggleBtn.title = isMuted ? 'Ton aktivieren (M)' : 'Ton stummschalten (M)';
    soundToggleBtn.innerHTML = isMuted ? noSoundIconSvg : soundIconSvg;
  }

  if (timerSoundBtn) {
    timerSoundBtn.textContent = isMuted ? '🔇' : '🔊';
    timerSoundBtn.title = isMuted ? 'Ton aktivieren (M)' : 'Ton stummschalten (M)';
    timerSoundBtn.classList.toggle('muted', isMuted);
  }

  if (stageEl) {
    const cardSoundBtns = stageEl.querySelectorAll('.slide-countdown-sound');
    cardSoundBtns.forEach(btn => {
      btn.textContent = isMuted ? '🔇' : '🔊';
      btn.title = isMuted ? 'Ton aktivieren (M)' : 'Ton stummschalten (M)';
      btn.classList.toggle('muted', isMuted);
    });
  }
}

/**
 * Toggles presentation audio mute state.
 */
export function toggleMute() {
  setMuted(!isMuted);
}

/**
 * Sets presentation audio mute state.
 * @param {boolean} muted
 */
export function setMuted(muted) {
  isMuted = Boolean(muted);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('hanspecathon_presentation_muted', isMuted ? 'true' : 'false');
    }
  } catch (e) {}
  updateSoundUI();
}

/**
 * Returns whether presentation audio is muted.
 * @returns {boolean}
 */
export function isAudioMuted() {
  return isMuted;
}

/**
 * Sets a sound listener callback for testing.
 * @param {Function|null} listener
 */
export function setSoundListenerForTesting(listener) {
  soundListener = listener;
}

/**
 * Creates the DOM elements for the presentation overlay if not present.
 */
function ensureOverlayDOM() {
  if (overlayEl && stageEl) return;

  overlayEl = document.getElementById('presentation-overlay');
  if (!overlayEl) {
    overlayEl = document.createElement('div');
    overlayEl.id = 'presentation-overlay';
    overlayEl.className = 'presentation-overlay hidden';
    overlayEl.setAttribute('tabindex', '-1');
    overlayEl.setAttribute('role', 'dialog');
    overlayEl.setAttribute('aria-modal', 'true');
    overlayEl.setAttribute('aria-label', 'Präsentation');
    document.body.appendChild(overlayEl);
  }

  overlayEl.innerHTML = `
    <!-- Top HUD: Title, Timer, Actions -->
    <div class="presentation-top-hud">
      <div class="presentation-deck-title" id="presentation-deck-title"></div>

      <!-- 3-Minute Pitch Timer -->
      <div class="presentation-timer-container timer-ok" id="presentation-timer-container" title="Klicken: Start/Pause | Doppelklick: Reset (Tastenkürzel: T, R)">
        <span class="presentation-timer-icon">⏱️</span>
        <span class="presentation-timer-display" id="presentation-timer-display">03:00</span>
        <button type="button" class="presentation-timer-btn" id="presentation-timer-toggle" title="Timer Pause/Start">▶️</button>
        <button type="button" class="presentation-timer-btn" id="presentation-timer-reset" title="Timer zurücksetzen">🔄</button>
        <button type="button" class="presentation-timer-btn" id="presentation-timer-sound" title="Ton stummschalten (M)">🔊</button>
      </div>

      <div class="presentation-top-actions">
        <button type="button" id="presentation-notes-toggle" class="presentation-hud-btn" title="Sprechernotizen umschalten (N)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
        </button>
        <button type="button" id="presentation-sound-toggle" class="presentation-hud-btn" title="Ton stummschalten (M)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
        </button>
        <button type="button" id="presentation-fullscreen-btn" class="presentation-hud-btn" title="Vollbild (F)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
          </svg>
        </button>
        <button type="button" id="presentation-close-btn" class="presentation-hud-btn presentation-close-btn" title="Beenden (Esc)">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- Main Slide Stage -->
    <div class="presentation-stage" id="presentation-stage"></div>

    <!-- Bottom HUD: Prev/Next, Counter, Progress Bar -->
    <div class="presentation-bottom-hud">
      <div class="presentation-bottom-bar">
        <div class="presentation-nav">
          <button type="button" id="presentation-prev-btn" class="presentation-nav-btn" title="Vorherige Folie (←, Backspace)">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span id="presentation-slide-counter" class="presentation-slide-counter">1 / 1</span>
          <button type="button" id="presentation-next-btn" class="presentation-nav-btn" title="Nächste Folie (→, Leertaste)">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
      </div>
      <div class="presentation-progress-bar">
        <div id="presentation-progress-fill" class="presentation-progress-fill" style="width: 0%;"></div>
      </div>
    </div>

    <!-- Speaker Notes Drawer -->
    <div id="presentation-notes-drawer" class="presentation-notes-drawer hidden">
      <div class="presentation-notes-header">
        <span>🗣️ Notizen & Hinweise</span>
        <button type="button" id="presentation-notes-close" class="presentation-timer-btn" title="Schliessen">✕</button>
      </div>
      <div id="presentation-notes-content" class="presentation-notes-content"></div>
    </div>
  `;

  document.body.appendChild(overlayEl);

  // Cache DOM references
  stageEl = overlayEl.querySelector('#presentation-stage');
  deckTitleEl = overlayEl.querySelector('#presentation-deck-title');
  slideCounterEl = overlayEl.querySelector('#presentation-slide-counter');
  progressFillEl = overlayEl.querySelector('#presentation-progress-fill');
  prevBtn = overlayEl.querySelector('#presentation-prev-btn');
  nextBtn = overlayEl.querySelector('#presentation-next-btn');
  notesDrawerEl = overlayEl.querySelector('#presentation-notes-drawer');
  notesContentEl = overlayEl.querySelector('#presentation-notes-content');
  notesToggleBtn = overlayEl.querySelector('#presentation-notes-toggle');
  soundToggleBtn = overlayEl.querySelector('#presentation-sound-toggle');
  fullscreenBtn = overlayEl.querySelector('#presentation-fullscreen-btn');
  timerContainer = overlayEl.querySelector('#presentation-timer-container');
  timerDisplay = overlayEl.querySelector('#presentation-timer-display');
  timerToggleBtn = overlayEl.querySelector('#presentation-timer-toggle');
  timerResetBtn = overlayEl.querySelector('#presentation-timer-reset');
  timerSoundBtn = overlayEl.querySelector('#presentation-timer-sound');

  // Wire event handlers
  prevBtn.addEventListener('click', prevSlide);
  nextBtn.addEventListener('click', nextSlide);
  fullscreenBtn.addEventListener('click', toggleFullscreen);
  overlayEl.querySelector('#presentation-close-btn').addEventListener('click', closePresentation);

  notesToggleBtn.addEventListener('click', toggleNotes);
  overlayEl.querySelector('#presentation-notes-close').addEventListener('click', () => {
    notesOpen = false;
    notesDrawerEl.classList.add('hidden');
    notesToggleBtn.classList.remove('active');
  });

  if (soundToggleBtn) {
    soundToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      getAudioContext();
      toggleMute();
    });
  }

  if (timerSoundBtn) {
    timerSoundBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      getAudioContext();
      toggleMute();
    });
  }

  // Timer controls
  timerContainer.addEventListener('click', (e) => {
    if (e.target.closest('#presentation-timer-reset') || e.target.closest('#presentation-timer-sound')) return;
    toggleTimer();
  });
  timerContainer.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    resetTimer();
  });
  timerResetBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    resetTimer();
  });

  updateSoundUI();

  // Mouse idle detection
  overlayEl.addEventListener('mousemove', resetIdleTimer);
  overlayEl.addEventListener('click', resetIdleTimer);

  // Touch swipe support
  overlayEl.addEventListener('touchstart', (e) => {
    if (e.touches.length > 0) {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }
  }, { passive: true });

  overlayEl.addEventListener('touchend', (e) => {
    if (e.changedTouches.length > 0) {
      const deltaX = e.changedTouches[0].clientX - touchStartX;
      const deltaY = e.changedTouches[0].clientY - touchStartY;
      // Ensure horizontal swipe is dominant
      if (Math.abs(deltaX) > 45 && Math.abs(deltaX) > Math.abs(deltaY)) {
        if (deltaX < 0) {
          nextSlide();
        } else {
          prevSlide();
        }
      }
    }
  }, { passive: true });
}

// ──────────────────────────────────────────────
// Timer Implementation
// ──────────────────────────────────────────────
function formatTimerString(seconds) {
  const isNegative = seconds < 0;
  const abs = Math.abs(seconds);
  const mins = Math.floor(abs / 60);
  const secs = abs % 60;
  const formatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return isNegative ? `+${formatted}` : formatted;
}

/**
 * Recomputes the overlay's `last-minute` state from *every* clock on screen:
 * the pitch timer plus any slide countdown card. Both used to write the class
 * independently, so a card that dropped under a minute had the class stripped
 * again by the pitch timer's next tick.
 */
function updateLastMinuteState() {
  if (!overlayEl) return;
  const pitchInLastMinute = timerSeconds <= 60;
  const cardInLastMinute = slideCountdownTimers.some(
    t => typeof t.getSeconds === 'function' && t.getSeconds() <= 60
  );
  overlayEl.classList.toggle('last-minute', pitchInLastMinute || cardInLastMinute);
}

function updateTimerUI() {
  if (!timerDisplay) return;
  timerDisplay.textContent = formatTimerString(timerSeconds);

  timerContainer.classList.remove('timer-ok', 'timer-warning', 'timer-critical', 'timer-overtime');

  if (timerSeconds > 60) {
    timerContainer.classList.add('timer-ok');
  } else if (timerSeconds > 15) {
    timerContainer.classList.add('timer-warning');
  } else if (timerSeconds >= 0) {
    timerContainer.classList.add('timer-critical');
  } else {
    timerContainer.classList.add('timer-overtime');
  }

  updateLastMinuteState();

  if (timerToggleBtn) {
    timerToggleBtn.textContent = timerRunning ? '⏸️' : '▶️';
  }
}

function tickTimer() {
  const prevSeconds = timerSeconds;
  timerSeconds = Math.ceil((timerDeadline - Date.now()) / 1000);
  // Polled faster than 1 Hz so the display lands on the real second boundary;
  // most polls are a no-op.
  if (timerSeconds === prevSeconds) return;
  updateTimerUI();
  handleTimerAudio(timerSeconds, prevSeconds, pitchTimerAudioRef);
}

function startTimer() {
  if (timerRunning) return;
  timerRunning = true;
  timerDeadline = Date.now() + timerSeconds * 1000;
  timerInterval = setInterval(tickTimer, TIMER_POLL_MS);
  updateTimerUI();
}

function pauseTimer() {
  if (!timerRunning) return;
  timerRunning = false;
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
  timerDeadline = null;
  updateTimerUI();
}

function toggleTimer() {
  if (timerRunning) {
    pauseTimer();
  } else {
    startTimer();
  }
}

function resetTimer() {
  pauseTimer();
  pitchTimerAudioRef = { ping: null, tick: null, alarm: null };
  timerSeconds = TIMER_DEFAULT_SECONDS;
  updateTimerUI();
}

/**
 * Automatically scales down slide content if it exceeds the card's visible bounds,
 * ensuring the slide ALWAYS fits on a single screen without scrolling.
 */
function autoFitSlide() {
  if (!isOpen || !stageEl) return;
  const card = stageEl.querySelector('.presentation-slide-card');
  const content = stageEl.querySelector('.presentation-slide-content');
  if (!card || !content) return;

  // Reset transform to measure true unscaled scroll dimensions
  content.style.transform = '';

  const cardStyle = window.getComputedStyle(card);
  const paddingTop = parseFloat(cardStyle.paddingTop) || 0;
  const paddingBottom = parseFloat(cardStyle.paddingBottom) || 0;
  const paddingLeft = parseFloat(cardStyle.paddingLeft) || 0;
  const paddingRight = parseFloat(cardStyle.paddingRight) || 0;

  const availHeight = Math.max(80, card.clientHeight - paddingTop - paddingBottom - 12);
  const availWidth = Math.max(80, card.clientWidth - paddingLeft - paddingRight - 12);

  const contentHeight = content.scrollHeight;
  const contentWidth = content.scrollWidth;

  const scale = calculateSlideScale({
    availHeight,
    availWidth,
    contentHeight,
    contentWidth
  });

  if (scale < 1) {
    content.style.transform = `scale(${scale})`;
    content.style.transformOrigin = 'center center';
  } else {
    content.style.transform = '';
  }
}

// ──────────────────────────────────────────────
// Slide Countdown Widgets Implementation
// ──────────────────────────────────────────────

/**
 * Snapshots the live state of every countdown card currently on the slide, keyed
 * so it can be handed back to initSlideCountdowns after a re-render.
 *
 * @returns {Map<string, Object>}
 */
function captureCountdownState() {
  const state = new Map();
  slideCountdownTimers.forEach(timer => {
    if (typeof timer.snapshot !== 'function') return;
    const snap = timer.snapshot();
    if (snap && snap.key) state.set(snap.key, snap);
  });
  return state;
}

/**
 * Clears all active slide countdown timers.
 */
function clearSlideCountdowns() {
  if (slideCountdownTimers && slideCountdownTimers.length > 0) {
    slideCountdownTimers.forEach(timer => {
      if (typeof timer.cleanup === 'function') timer.cleanup();
    });
    slideCountdownTimers = [];
  }
}

/**
 * Computes remaining seconds until target HH:MM time.
 * Handles the September 9, 2026 event day, pre-event countdowns, and general testing.
 *
 * @param {string} targetTimeStr - Target time string in format "HH:MM"
 * @returns {number} Seconds until target (negative if overtime)
 */
function calculateTargetRemainingSeconds(targetTimeStr) {
  if (!targetTimeStr) return 0;
  const parts = targetTimeStr.split(':');
  const tHours = parseInt(parts[0], 10);
  const tMins = parseInt(parts[1], 10);
  const now = new Date();

  // Event target: Wednesday, September 9, 2026
  const eventTarget = new Date(2026, 8, 9, tHours, tMins, 0, 0);

  let targetDate;
  const isEventDay = (now.getFullYear() === 2026 && now.getMonth() === 8 && now.getDate() === 9);

  if (isEventDay) {
    targetDate = new Date(2026, 8, 9, tHours, tMins, 0, 0);
  } else if (now < eventTarget && (eventTarget.getTime() - now.getTime()) <= 36 * 3600 * 1000) {
    // Within 36 hours before event target (e.g. Sept 8): count down to event deadline
    targetDate = eventTarget;
  } else {
    // General testing: target today at tHours:tMins
    targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), tHours, tMins, 0, 0);
    // If today's target is more than 30 minutes in the past, target next day
    if ((now.getTime() - targetDate.getTime()) > 30 * 60 * 1000) {
      targetDate.setDate(targetDate.getDate() + 1);
    }
  }

  return Math.floor((targetDate.getTime() - now.getTime()) / 1000);
}

/**
 * Formats seconds into HH:MM:SS or MM:SS string with overtime '+' prefix if negative.
 *
 * @param {number} totalSeconds
 * @returns {string}
 */
function formatCountdownDisplay(totalSeconds) {
  const isNegative = totalSeconds < 0;
  const abs = Math.abs(totalSeconds);
  const hours = Math.floor(abs / 3600);
  const mins = Math.floor((abs % 3600) / 60);
  const secs = abs % 60;

  let timeString = '';
  if (hours > 0) {
    timeString = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  } else {
    timeString = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  return isNegative ? `+${timeString}` : timeString;
}

/**
 * Initializes interactive countdown clocks on any .slide-countdown-card inside the slide.
 */
function initSlideCountdowns(preserved = new Map()) {
  clearSlideCountdowns();
  if (!stageEl) return;

  const seenKeys = new Map();
  const cards = stageEl.querySelectorAll('.slide-countdown-card');
  cards.forEach(card => {
    const type = card.dataset.countdownType || 'duration';
    const targetStr = card.dataset.countdownTarget || '';
    const initialDuration = parseInt(card.dataset.countdownDuration, 10) || 0;

    // Identity is the card's own definition, not its position, so a card keeps
    // its state when an edit elsewhere on the slide re-renders the deck. A
    // duplicate definition on one slide is disambiguated by occurrence.
    const baseKey = `${type}|${targetStr}|${initialDuration}|${card.dataset.countdownLabel || ''}`;
    const occurrence = (seenKeys.get(baseKey) || 0) + 1;
    seenKeys.set(baseKey, occurrence);
    const key = `${baseKey}#${occurrence}`;

    const digitsEl = card.querySelector('.slide-countdown-digits');
    const toggleBtn = card.querySelector('.slide-countdown-toggle');
    const resetBtn = card.querySelector('.slide-countdown-reset');
    const displayEl = card.querySelector('.slide-countdown-display');
    const badgeEl = card.querySelector('.slide-countdown-badge');

    const isTarget = (type === 'target');
    let currentSeconds = isTarget ? calculateTargetRemainingSeconds(targetStr) : initialDuration;
    let isRunning = true;
    let intervalId = null;
    let cardDeadline = null;
    let isDemoMode = false;
    let cardAudioRef = { ping: null, tick: null, alarm: null };

    // Carry over the state this card had before the re-render. Target cards
    // recompute their seconds from the wall clock, so only their run/demo state
    // is worth restoring; duration cards would otherwise jump back to their full
    // value every time anyone edited the page.
    const restored = preserved.get(key);
    if (restored) {
      isRunning = restored.isRunning;
      isDemoMode = restored.isDemoMode;
      cardAudioRef = restored.audioRef || cardAudioRef;
      if (isDemoMode || !isTarget) currentSeconds = restored.seconds;
    }
    const soundBtn = card.querySelector('.slide-countdown-sound');

    function updateCardUI() {
      if (digitsEl) {
        digitsEl.textContent = formatCountdownDisplay(currentSeconds);
      }

      card.classList.remove('countdown-ok', 'countdown-warning', 'countdown-critical', 'countdown-overtime');

      if (currentSeconds > 300) {
        card.classList.add('countdown-ok');
      } else if (currentSeconds > 60) {
        card.classList.add('countdown-warning');
      } else if (currentSeconds >= 0) {
        card.classList.add('countdown-critical');
      } else {
        card.classList.add('countdown-overtime');
      }

      updateLastMinuteState();

      if (toggleBtn) {
        toggleBtn.textContent = isRunning ? '⏸️' : '▶️';
        toggleBtn.title = isRunning ? 'Timer pausieren (C)' : 'Timer starten (C)';
      }

      if (soundBtn) {
        soundBtn.textContent = isMuted ? '🔇' : '🔊';
        soundBtn.title = isMuted ? 'Ton aktivieren (M)' : 'Ton stummschalten (M)';
        soundBtn.classList.toggle('muted', isMuted);
      }

      if (badgeEl) {
        if (isDemoMode) {
          badgeEl.textContent = 'DEMO';
        } else if (currentSeconds < 0) {
          badgeEl.textContent = 'OVERTIME';
        } else if (isRunning) {
          badgeEl.textContent = 'LIVE';
        } else {
          badgeEl.textContent = 'PAUSE';
        }
      }
    }

    function tick() {
      const prevSeconds = currentSeconds;
      if (isTarget && !isDemoMode) {
        currentSeconds = calculateTargetRemainingSeconds(targetStr);
      } else {
        // Deadline-derived, like the pitch timer, so a throttled background tab
        // cannot make the card run slow.
        currentSeconds = Math.ceil((cardDeadline - Date.now()) / 1000);
      }
      if (currentSeconds === prevSeconds) return;
      updateCardUI();
      handleTimerAudio(currentSeconds, prevSeconds, cardAudioRef);
    }

    function start() {
      if (isRunning && intervalId) return;
      isRunning = true;
      if (isTarget && !isDemoMode) {
        currentSeconds = calculateTargetRemainingSeconds(targetStr);
      }
      cardDeadline = Date.now() + currentSeconds * 1000;
      intervalId = setInterval(tick, TIMER_POLL_MS);
      updateCardUI();
    }

    function pause() {
      isRunning = false;
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      cardDeadline = null;
      updateCardUI();
    }

    function toggle() {
      if (isRunning) pause();
      else start();
    }

    function reset() {
      pause();
      isDemoMode = false;
      cardAudioRef = { ping: null, tick: null, alarm: null };
      if (isTarget) {
        currentSeconds = calculateTargetRemainingSeconds(targetStr);
      } else {
        currentSeconds = initialDuration;
      }
      start();
    }

    function toggleDemo() {
      isDemoMode = !isDemoMode;
      cardAudioRef = { ping: null, tick: null, alarm: null };
      if (isDemoMode) {
        currentSeconds = 300; // 5-minute demo mode
      } else {
        currentSeconds = isTarget ? calculateTargetRemainingSeconds(targetStr) : initialDuration;
      }
      start();
    }

    if (toggleBtn) {
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggle();
      });
    }

    if (soundBtn) {
      soundBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        getAudioContext();
        toggleMute();
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        reset();
      });
      resetBtn.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        toggleDemo();
      });
    }

    if (displayEl) {
      displayEl.addEventListener('click', (e) => {
        e.stopPropagation();
        toggle();
      });
      displayEl.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        toggleDemo();
      });
    }

    // Registered before start() so the first updateCardUI() paint already sees
    // this card when it recomputes the overlay's last-minute state.
    slideCountdownTimers.push({
      cleanup() {
        if (intervalId) clearInterval(intervalId);
      },
      getSeconds: () => currentSeconds,
      snapshot: () => ({
        key,
        seconds: currentSeconds,
        isRunning,
        isDemoMode,
        audioRef: cardAudioRef
      }),
      toggle,
      reset
    });

    // Auto-start, unless this card was paused before a re-render carried it over
    if (isRunning) {
      start();
    } else {
      updateCardUI();
    }
  });

  // A slide with no countdown cards must also be able to clear a stale
  // last-minute state left behind by the previous slide.
  updateLastMinuteState();
}

// ──────────────────────────────────────────────
// Slide Navigation & Rendering
// ──────────────────────────────────────────────
function renderSlide(index) {
  if (!stageEl || slides.length === 0) return;

  const nextIndex = Math.max(0, Math.min(index, slides.length - 1));
  // A live edit re-renders the slide the presenter is already on. Countdown
  // state has to survive that, or a running clock resets itself every time
  // anyone — including a remote collaborator — types on the page. Moving to a
  // different slide still starts its countdowns fresh.
  const preserved = nextIndex === currentIndex ? captureCountdownState() : new Map();

  clearSlideCountdowns();

  currentIndex = nextIndex;
  const slide = slides[currentIndex];

  // Sanitize HTML, ensuring data-countdown attributes are preserved
  const cleanHtml = DOMPurify && typeof DOMPurify.sanitize === 'function'
    ? DOMPurify.sanitize(slide.html, {
        ADD_ATTR: ['data-countdown-type', 'data-countdown-target', 'data-countdown-duration', 'data-countdown-label']
      })
    : slide.html;

  stageEl.innerHTML = `
    <div class="presentation-slide-card" id="presentation-slide-card">
      <div class="presentation-slide-content" id="presentation-slide-content">
        ${cleanHtml}
      </div>
    </div>
  `;

  // Initialize interactive slide countdowns
  initSlideCountdowns(preserved);

  // Scale down to always fit on 1 screen
  autoFitSlide();
  requestAnimationFrame(autoFitSlide);

  // If slide contains images, re-fit once images load
  const images = stageEl.querySelectorAll('img');
  images.forEach(img => {
    if (!img.complete) {
      img.addEventListener('load', autoFitSlide, { once: true });
      img.addEventListener('error', autoFitSlide, { once: true });
    }
  });

  // Update counter & progress bar
  if (slideCounterEl) {
    slideCounterEl.textContent = `${currentIndex + 1} / ${slides.length}`;
  }
  if (progressFillEl) {
    const percent = ((currentIndex + 1) / slides.length) * 100;
    progressFillEl.style.width = `${percent}%`;
  }

  // Update navigation button states
  if (prevBtn) prevBtn.disabled = currentIndex === 0;
  if (nextBtn) nextBtn.disabled = currentIndex === slides.length - 1;

  // Update speaker notes
  const hasNotes = slide.notes && slide.notes.length > 0;
  if (notesToggleBtn) {
    notesToggleBtn.classList.toggle('has-notes', hasNotes);
  }
  if (notesContentEl) {
    if (hasNotes) {
      notesContentEl.innerHTML = slide.notes.map(n => `<p>${DOMPurify ? DOMPurify.sanitize(n) : n}</p>`).join('');
    } else {
      notesContentEl.innerHTML = '<p class="presentation-no-notes">Keine Notizen für diese Folie.</p>';
    }
    const notesLinks = notesContentEl.querySelectorAll('a');
    notesLinks.forEach(link => {
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
    });
  }

  // Intercept links inside presentation to avoid accidentally losing presentation view
  const links = stageEl.querySelectorAll('a');
  links.forEach(link => {
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
  });
}

export function nextSlide() {
  if (currentIndex < slides.length - 1) {
    // If advancing from Slide 1 and timer hasn't started, auto-start pitch timer
    if (currentIndex === 0 && !timerRunning && timerSeconds === TIMER_DEFAULT_SECONDS) {
      startTimer();
    }
    renderSlide(currentIndex + 1);
  }
}

export function prevSlide() {
  if (currentIndex > 0) {
    renderSlide(currentIndex - 1);
  }
}

export function goToSlide(index) {
  renderSlide(index);
}

// ──────────────────────────────────────────────
// Fullscreen & Idle Detection
// ──────────────────────────────────────────────
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    if (overlayEl.requestFullscreen) {
      overlayEl.requestFullscreen().catch(() => {});
    }
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
  }
}

function toggleNotes() {
  notesOpen = !notesOpen;
  if (notesDrawerEl) notesDrawerEl.classList.toggle('hidden', !notesOpen);
  if (notesToggleBtn) notesToggleBtn.classList.toggle('active', notesOpen);
}

function resetIdleTimer() {
  if (!overlayEl) return;
  overlayEl.classList.remove('hud-idle', 'cursor-hidden');
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (isOpen) {
      overlayEl.classList.add('hud-idle', 'cursor-hidden');
    }
  }, IDLE_DELAY_MS);
}

// ──────────────────────────────────────────────
// Global Key Listener
// ──────────────────────────────────────────────
export function handleKeyDown(e) {
  if (!isOpen) return;

  // Every binding below is an unmodified key, so anything carrying Ctrl/Cmd/Alt
  // belongs to the browser or the OS. Without this guard Ctrl+R reset the pitch
  // timer instead of reloading, Ctrl+F opened fullscreen instead of find, and
  // Ctrl+S toggled mute. Shift is deliberately allowed through: Shift+Space
  // steps back a slide.
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  switch (e.key) {
    case 'ArrowRight':
    case 'ArrowDown':
    case 'PageDown':
      e.preventDefault();
      nextSlide();
      break;

    case ' ': // Space
      e.preventDefault();
      if (e.shiftKey) {
        prevSlide();
      } else {
        nextSlide();
      }
      break;

    case 'ArrowLeft':
    case 'ArrowUp':
    case 'Backspace':
    case 'PageUp':
      e.preventDefault();
      prevSlide();
      break;

    case 'Home':
      e.preventDefault();
      goToSlide(0);
      break;

    case 'End':
      e.preventDefault();
      goToSlide(slides.length - 1);
      break;

    case 'Escape':
      e.preventDefault();
      closePresentation();
      break;

    case 'f':
    case 'F':
      e.preventDefault();
      toggleFullscreen();
      break;

    case 't':
    case 'T':
      e.preventDefault();
      toggleTimer();
      break;

    case 'r':
    case 'R':
      e.preventDefault();
      resetTimer();
      break;

    case 'n':
    case 'N':
      e.preventDefault();
      toggleNotes();
      break;

    case 'c':
    case 'C':
      if (slideCountdownTimers.length > 0) {
        e.preventDefault();
        slideCountdownTimers.forEach(t => {
          if (typeof t.toggle === 'function') t.toggle();
        });
      }
      break;

    case 'm':
    case 'M':
    case 's':
    case 'S':
      e.preventDefault();
      getAudioContext();
      toggleMute();
      break;
  }
}

// ──────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────

/**
 * Launches Presentation Mode.
 *
 * @param {Object} options
 * @param {string} [options.title=''] - Page title
 * @param {string} [options.content=''] - Markdown or HTML content
 * @param {boolean} [options.isMarkdown=false] - True if content is raw Markdown
 * @param {string|null} [options.pageId=null] - Page id of the deck
 */
export function openPresentation({ title = '', content = '', isMarkdown = false, pageId = null } = {}) {
  ensureOverlayDOM();

  currentDeckPageId = pageId;
  lastTitle = title;
  lastContent = content;

  const parsed = parseSlides({ title, content, isMarkdown });
  slides = parsed.slides;
  currentIndex = 0;
  isOpen = true;

  if (deckTitleEl) {
    deckTitleEl.textContent = title || 'hAnSpecathon Pitch';
  }

  overlayEl.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  resetTimer();
  updateSoundUI();
  renderSlide(0);
  resetIdleTimer();

  window.addEventListener('keydown', handleKeyDown, { capture: true });
  window.addEventListener('resize', autoFitSlide);
  document.addEventListener('fullscreenchange', autoFitSlide);
}

/**
 * Updates an already open presentation when the underlying page content or page changes.
 *
 * @param {Object} options
 * @param {string} [options.title=''] - Page title
 * @param {string} [options.content=''] - Markdown or HTML content
 * @param {boolean} [options.isMarkdown=false] - True if content is raw Markdown
 * @param {string|null} [options.pageId=null] - Page id of the deck
 */
export function updatePresentation({ title = '', content = '', isMarkdown = false, pageId = null } = {}) {
  if (!isOpen) return;

  if (content === lastContent && title === lastTitle && pageId === currentDeckPageId) {
    return;
  }

  const isNewPage = pageId !== null && currentDeckPageId !== null && pageId !== currentDeckPageId;
  if (pageId !== null) {
    currentDeckPageId = pageId;
  }
  lastTitle = title;
  lastContent = content;

  const parsed = parseSlides({ title, content, isMarkdown });
  slides = parsed.slides;

  if (deckTitleEl) {
    deckTitleEl.textContent = title || 'hAnSpecathon Pitch';
  }

  if (isNewPage) {
    currentIndex = 0;
    resetTimer();
  } else {
    currentIndex = Math.max(0, Math.min(currentIndex, slides.length - 1));
  }

  renderSlide(currentIndex);
}

/**
 * Exits Presentation Mode.
 */
export function closePresentation() {
  if (!isOpen) return;

  isOpen = false;
  currentDeckPageId = null;
  lastTitle = '';
  lastContent = '';
  pauseTimer();
  clearSlideCountdowns();

  if (overlayEl) {
    overlayEl.classList.add('hidden');
    overlayEl.classList.remove('hud-idle', 'cursor-hidden', 'last-minute');
  }

  document.body.style.overflow = '';

  if (idleTimer) clearTimeout(idleTimer);
  window.removeEventListener('keydown', handleKeyDown, { capture: true });
  window.removeEventListener('resize', autoFitSlide);
  document.removeEventListener('fullscreenchange', autoFitSlide);

  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
}

/**
 * Returns whether presentation mode is currently active.
 * @returns {boolean}
 */
export function isPresentationOpen() {
  return isOpen;
}

/**
 * Sets the pitch timer seconds (useful for testing or custom countdown durations).
 * @param {number} seconds
 */
export function setTimerSeconds(seconds) {
  timerSeconds = seconds;
  if (timerRunning) timerDeadline = Date.now() + seconds * 1000;
  updateTimerUI();
}

/**
 * Returns current pitch timer seconds.
 * @returns {number}
 */
export function getTimerSeconds() {
  return timerSeconds;
}

/**
 * Snapshots the live state of every countdown card on the current slide.
 * Exposed for tests; mirrors what survives a re-render.
 *
 * @returns {Array<Object>}
 */
export function getSlideCountdownStateForTesting() {
  return slideCountdownTimers
    .filter(t => typeof t.snapshot === 'function')
    .map(t => t.snapshot());
}
