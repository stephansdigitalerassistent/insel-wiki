// Run: cd functions && npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeEmail, normalizeCode, generateCode, hashCode, defaultDisplayName,
  planSend, checkCode, buildCodeMail,
  CODE_TTL_MS, RESEND_COOLDOWN_MS, SEND_WINDOW_MS, MAX_SENDS_PER_WINDOW, MAX_VERIFY_ATTEMPTS,
} from '../lib/login-code.js';

const EMAIL = 'max.muster@insel.ch';
const NOW = 1_800_000_000_000;

test('normalizeEmail accepts only @insel.ch mailboxes', () => {
  assert.equal(normalizeEmail('  Max.Muster@Insel.CH '), EMAIL);
  for (const bad of ['max@gmail.com', 'max@insel.ch.evil.com', 'max@evilinsel.ch', '@insel.ch',
    'a b@insel.ch', 'max@insel.ch\nBcc: x@y.z', 'max@sub.insel.ch', '', null, 42, {}]) {
    assert.equal(normalizeEmail(bad), null, String(bad));
  }
});

test('normalizeCode tolerates pasted spaces and dashes, nothing else', () => {
  assert.equal(normalizeCode('123 456'), '123456');
  assert.equal(normalizeCode('123-456'), '123456');
  assert.equal(normalizeCode(123456), '123456');
  for (const bad of ['12345', '1234567', 'abcdef', '', null, undefined]) {
    assert.equal(normalizeCode(bad), null, String(bad));
  }
});

test('generateCode is always six digits, including leading zeros', () => {
  assert.equal(generateCode(() => 42), '000042');
  for (let i = 0; i < 200; i++) assert.match(generateCode(), /^\d{6}$/);
});

test('defaultDisplayName mirrors the client rule', () => {
  assert.equal(defaultDisplayName('max.muster@insel.ch'), 'Max Muster');
  assert.equal(defaultDisplayName('anna-lena_meier@insel.ch'), 'Anna Lena Meier');
});

test('planSend issues a fresh record for a new address', () => {
  const plan = planSend(null, NOW, EMAIL, '123456');
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.record, {
    email: EMAIL, codeHash: hashCode(EMAIL, '123456'), expiresAt: NOW + CODE_TTL_MS,
    attempts: 0, sentAt: NOW, windowStart: NOW, windowCount: 1,
  });
});

test('planSend enforces the resend cooldown', () => {
  const first = planSend(null, NOW, EMAIL, '111111').record;
  const tooSoon = planSend(first, NOW + 20_000, EMAIL, '222222');
  assert.deepEqual(tooSoon, { ok: false, reason: 'cooldown', retryAfterSec: 40 });
  assert.equal(planSend(first, NOW + RESEND_COOLDOWN_MS, EMAIL, '222222').ok, true);
});

test('planSend caps sends per hour and recovers when the window rolls over', () => {
  let record = null;
  let now = NOW;
  for (let i = 0; i < MAX_SENDS_PER_WINDOW; i++) {
    const plan = planSend(record, now, EMAIL, '111111');
    assert.equal(plan.ok, true, `send ${i + 1}`);
    record = plan.record;
    now += RESEND_COOLDOWN_MS;
  }
  const blocked = planSend(record, now, EMAIL, '111111');
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'too_many_requests');
  assert.ok(blocked.retryAfterSec > 0);

  const later = planSend(record, NOW + SEND_WINDOW_MS, EMAIL, '111111');
  assert.equal(later.ok, true);
  assert.equal(later.record.windowCount, 1);
});

test('a resend resets the guess counter and replaces the code', () => {
  const first = { ...planSend(null, NOW, EMAIL, '111111').record, attempts: 3 };
  const second = planSend(first, NOW + RESEND_COOLDOWN_MS, EMAIL, '222222').record;
  assert.equal(second.attempts, 0);
  assert.equal(checkCode(second, NOW + RESEND_COOLDOWN_MS, EMAIL, '111111').ok, false);
  assert.equal(checkCode(second, NOW + RESEND_COOLDOWN_MS, EMAIL, '222222').ok, true);
});

test('checkCode accepts the right code once and consumes it', () => {
  const record = planSend(null, NOW, EMAIL, '123456').record;
  assert.deepEqual(checkCode(record, NOW + 1000, EMAIL, '123456'), { ok: true, consume: true });
});

test('checkCode rejects a code issued to another address', () => {
  const record = planSend(null, NOW, EMAIL, '123456').record;
  assert.equal(checkCode(record, NOW, 'someone.else@insel.ch', '123456').ok, false);
});

test('checkCode treats missing, consumed and expired codes alike', () => {
  const record = planSend(null, NOW, EMAIL, '123456').record;
  assert.equal(checkCode(null, NOW, EMAIL, '123456').reason, 'expired');
  const { codeHash, ...consumed } = record;
  assert.deepEqual(checkCode(consumed, NOW, EMAIL, '123456'), { ok: false, reason: 'expired', consume: false });
  assert.deepEqual(checkCode(record, NOW + CODE_TTL_MS + 1, EMAIL, '123456'),
    { ok: false, reason: 'expired', consume: true });
});

test('checkCode burns the code on the last wrong guess', () => {
  let record = planSend(null, NOW, EMAIL, '123456').record;
  for (let i = 1; i < MAX_VERIFY_ATTEMPTS; i++) {
    const verdict = checkCode(record, NOW, EMAIL, '000000');
    assert.deepEqual(verdict, { ok: false, reason: 'invalid_code', consume: false, attempts: i });
    record = { ...record, attempts: verdict.attempts };
  }
  assert.deepEqual(checkCode(record, NOW, EMAIL, '000000'),
    { ok: false, reason: 'too_many_attempts', consume: true });
  // Even the correct code is refused once the guesses are spent.
  assert.equal(checkCode({ ...record, attempts: MAX_VERIFY_ATTEMPTS }, NOW, EMAIL, '123456').ok, false);
});

test('buildCodeMail localises and falls back to German', () => {
  assert.match(buildCodeMail('123456', 'fr').subject, /^123456 est votre code/);
  assert.match(buildCodeMail('123456', 'en-GB').body, /123456/);
  assert.match(buildCodeMail('123456', 'xx').subject, /Anmeldecode/);
  assert.match(buildCodeMail('123456', undefined).subject, /Anmeldecode/);
});
