// Email one-time login codes — the pure, side-effect-free half.
//
// Sign-up and sign-in are the same act: prove you can read an @insel.ch
// mailbox by typing back the 6-digit code we mailed to it. Everything here is
// deterministic given its inputs (clock and RNG are passed in) so it can be
// unit-tested without Firestore; functions/index.js owns the I/O.

import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

export const CODE_LENGTH = 6;
export const CODE_TTL_MS = 10 * 60 * 1000;
// A 6-digit code survives 5 guesses with a 1-in-200'000 chance of being hit.
export const MAX_VERIFY_ATTEMPTS = 5;
export const RESEND_COOLDOWN_MS = 60 * 1000;
export const SEND_WINDOW_MS = 60 * 60 * 1000;
export const MAX_SENDS_PER_WINDOW = 5;
// Ceiling on mails per day across all addresses. The endpoint is
// unauthenticated by nature, and the sender is a personal Gmail account whose
// reputation with insel.ch we cannot afford to burn.
export const MAX_SENDS_PER_DAY = 300;
// How long requestLoginCode waits for WikiBot to pick a queued mail up before
// telling the user that mail is unavailable. The bot listens live, so a
// healthy pickup takes about a second.
export const MAIL_PICKUP_TIMEOUT_MS = 12 * 1000;

const EMAIL_RE = /^[a-z0-9][a-z0-9._%+-]*@insel\.ch$/;

/**
 * Normalises and validates an address. Returns the lower-cased address, or
 * null when it is not a plausible @insel.ch mailbox.
 */
export function normalizeEmail(raw) {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) return null;
  return email;
}

/** Strips spaces/dashes a user may have pasted; null unless exactly 6 digits. */
export function normalizeCode(raw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const code = String(raw).replace(/[\s-]/g, '');
  return /^\d{6}$/.test(code) ? code : null;
}

export function generateCode(rng = randomInt) {
  return String(rng(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');
}

/** Firestore doc id for an address — never the address itself. */
export function emailDocId(email) {
  return createHash('sha256').update(email).digest('hex');
}

/** Bound to the address so a code cannot be replayed against another one. */
export function hashCode(email, code) {
  return createHash('sha256').update(`${email}:${code}`).digest('hex');
}

/** Same rule as src/utils/string.js formatDefaultName ("max.muster" → "Max Muster"). */
export function defaultDisplayName(email) {
  return email
    .split('@')[0]
    .split(/[._-]/)
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : ''))
    .join(' ')
    .trim();
}

export function dayKey(now) {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Decides whether a new code may be mailed to an address.
 *
 * @param {object|null} existing - the current login_codes doc data, if any
 * @param {number} now - epoch ms
 * @returns {{ok: true, record: object} | {ok: false, reason: string, retryAfterSec: number}}
 */
export function planSend(existing, now, email, code) {
  let windowStart = now;
  let windowCount = 0;

  if (existing) {
    const sinceLast = now - (existing.sentAt || 0);
    if (sinceLast < RESEND_COOLDOWN_MS) {
      return { ok: false, reason: 'cooldown', retryAfterSec: Math.ceil((RESEND_COOLDOWN_MS - sinceLast) / 1000) };
    }
    if (now - (existing.windowStart || 0) < SEND_WINDOW_MS) {
      windowStart = existing.windowStart;
      windowCount = existing.windowCount || 0;
      if (windowCount >= MAX_SENDS_PER_WINDOW) {
        return {
          ok: false,
          reason: 'too_many_requests',
          retryAfterSec: Math.ceil((windowStart + SEND_WINDOW_MS - now) / 1000),
        };
      }
    }
  }

  return {
    ok: true,
    record: {
      email,
      codeHash: hashCode(email, code),
      expiresAt: now + CODE_TTL_MS,
      attempts: 0,
      sentAt: now,
      windowStart,
      windowCount: windowCount + 1,
    },
  };
}

/**
 * Judges a submitted code against the stored record.
 *
 * `consume` tells the caller to drop the stored code (success, expiry, or the
 * last allowed guess); otherwise the caller must persist `attempts`.
 *
 * @returns {{ok: boolean, reason?: string, consume: boolean, attempts?: number}}
 */
export function checkCode(existing, now, email, code) {
  if (!existing || !existing.codeHash || now > (existing.expiresAt || 0)) {
    return { ok: false, reason: 'expired', consume: Boolean(existing && existing.codeHash) };
  }
  const attempts = (existing.attempts || 0) + 1;
  if (attempts > MAX_VERIFY_ATTEMPTS) {
    return { ok: false, reason: 'too_many_attempts', consume: true };
  }

  const expected = Buffer.from(existing.codeHash, 'hex');
  const actual = Buffer.from(hashCode(email, code), 'hex');
  if (expected.length === actual.length && timingSafeEqual(expected, actual)) {
    return { ok: true, consume: true };
  }
  if (attempts >= MAX_VERIFY_ATTEMPTS) {
    return { ok: false, reason: 'too_many_attempts', consume: true };
  }
  return { ok: false, reason: 'invalid_code', consume: false, attempts };
}

const MAIL_TEXT = {
  de: {
    subject: (code) => `${code} ist Ihr Insel-Wiki Anmeldecode`,
    body: (code) =>
      `Ihr Anmeldecode für das Insel-Wiki:\n\n    ${code}\n\n` +
      'Der Code ist 10 Minuten gültig. Geben Sie ihn auf der Anmeldeseite ein.\n\n' +
      'Sie haben keinen Code angefordert? Dann können Sie diese E-Mail ignorieren.',
  },
  fr: {
    subject: (code) => `${code} est votre code de connexion Insel-Wiki`,
    body: (code) =>
      `Votre code de connexion pour l'Insel-Wiki :\n\n    ${code}\n\n` +
      'Le code est valable 10 minutes. Saisissez-le sur la page de connexion.\n\n' +
      "Vous n'avez pas demandé de code ? Vous pouvez ignorer cet e-mail.",
  },
  it: {
    subject: (code) => `${code} è il tuo codice di accesso a Insel-Wiki`,
    body: (code) =>
      `Il tuo codice di accesso a Insel-Wiki:\n\n    ${code}\n\n` +
      'Il codice è valido per 10 minuti. Inseriscilo nella pagina di accesso.\n\n' +
      'Non hai richiesto alcun codice? Puoi ignorare questa e-mail.',
  },
  en: {
    subject: (code) => `${code} is your Insel-Wiki sign-in code`,
    body: (code) =>
      `Your sign-in code for the Insel-Wiki:\n\n    ${code}\n\n` +
      'The code is valid for 10 minutes. Enter it on the sign-in page.\n\n' +
      "Didn't request a code? You can ignore this email.",
  },
};

export function buildCodeMail(code, lang) {
  const text = MAIL_TEXT[String(lang || '').slice(0, 2).toLowerCase()] || MAIL_TEXT.de;
  return { subject: text.subject(code), body: text.body(code) };
}
