/**
 * Unit tests for series-helper.js
 * Run with: node src/utils/series-helper.test.js
 */

const {
  predictNextMeetingTitle,
  extractOpenTasks,
  extractScaffold,
  generateFollowupMeetingMarkdown
} = await import('./series-helper.js');

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
    console.error(`    ${err.message}`);
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
    toHaveLength(n) {
      if (actual.length !== n) throw new Error(`Expected length ${n} but got ${actual.length}`);
    },
    toContain(substr) {
      if (!actual || !actual.includes(substr)) throw new Error(`Expected to contain "${substr}" in "${actual}"`);
    },
    notToContain(substr) {
      if (actual && actual.includes(substr)) throw new Error(`Expected NOT to contain "${substr}" in "${actual}"`);
    },
    toBeTruthy() {
      if (!actual) throw new Error(`Expected truthy but got "${actual}"`);
    },
    toBeFalsy() {
      if (actual) throw new Error(`Expected falsy but got "${actual}"`);
    }
  };
}

console.log('\n🔢 predictNextMeetingTitle()');

test('increments hyphenated number suffix (micha-11 -> micha-12)', () => {
  expect(predictNextMeetingTitle('micha-11')).toBe('micha-12');
  expect(predictNextMeetingTitle('meeting-1')).toBe('meeting-2');
});

test('increments hash number suffix (Micha #11 -> Micha #12)', () => {
  expect(predictNextMeetingTitle('Micha #11')).toBe('Micha #12');
  expect(predictNextMeetingTitle('1:1 Micha #11')).toBe('1:1 Micha #12');
});

test('increments space and underscore number suffixes', () => {
  expect(predictNextMeetingTitle('micha_11')).toBe('micha_12');
  expect(predictNextMeetingTitle('Sprint 4')).toBe('Sprint 5');
});

test('increments bracketed numbers (Micha (11) -> Micha (12))', () => {
  expect(predictNextMeetingTitle('Micha (11)')).toBe('Micha (12)');
  expect(predictNextMeetingTitle('Sprint [4]')).toBe('Sprint [5]');
});

test('increments ISO dates by 7 days (Jour Fixe 2026-08-26 -> Jour Fixe 2026-09-02)', () => {
  expect(predictNextMeetingTitle('Jour Fixe 2026-08-26')).toBe('Jour Fixe 2026-09-02');
  expect(predictNextMeetingTitle('2026-12-28 - Sync')).toBe('2027-01-04 - Sync');
});

test('increments Swiss/German dates by 7 days', () => {
  expect(predictNextMeetingTitle('Standup 26.08.2026')).toBe('Standup 02.09.2026');
});

test('falls back gracefully on non-numbered titles', () => {
  expect(predictNextMeetingTitle('Micha 1:1')).toBe('Micha 1:1 #2');
  expect(predictNextMeetingTitle('Team Sync')).toBe('Team Sync #2');
  expect(predictNextMeetingTitle('micha')).toBe('micha-2');
});

console.log('\n📋 extractOpenTasks()');

test('extracts only unchecked tasks and formats with predecessor attribution', () => {
  const content = `
# Meeting
- [x] Completed task
- [ ] Open task 1
- [ ] Open task 2
Some other text
`;
  const tasks = extractOpenTasks(content, 'micha-11');
  expect(tasks).toHaveLength(2);
  expect(tasks[0].text).toBe('Open task 1');
  expect(tasks[0].formatted).toBe('- [ ] Open task 1 (aus micha-11)');
  expect(tasks[1].text).toBe('Open task 2');
  expect(tasks[1].formatted).toBe('- [ ] Open task 2 (aus micha-11)');
});

test('does not stack attributions on a task that was already carried over', () => {
  const tasks = extractOpenTasks('- [ ] Alte Pendenz (aus micha-10)', 'micha-11');
  expect(tasks[0].formatted).toBe('- [ ] Alte Pendenz (aus micha-10)');
});

console.log('\n🏗️ extractScaffold()');

test('retains headings and table structures while omitting body notes', () => {
  const content = `
⏮ **Vorheriges Meeting:** [micha-10](#/123/micha-10) | 📅 **Datum:** 2026-08-25
---

### 📋 Traktanden / Agenda
1. Alter Punkt 1
2. Alter Punkt 2

### 📝 Notizen & Diskussion
Hier standen sehr lange Diskussionen und alte Notizen, die nicht übernommen werden sollen.

| Thema | Status |
| --- | --- |
| Alt | Fertig |

### ✅ Neue Beschlüsse & Action Items
- [x] Erledigt
- [ ] Offen
`;

  const scaffold = extractScaffold(content);
  expect(scaffold).toContain('### 📋 Traktanden / Agenda');
  expect(scaffold).toContain('### 📝 Notizen & Diskussion');
  expect(scaffold).toContain('### ✅ Neue Beschlüsse & Action Items');
  expect(scaffold).toContain('| Thema | Status |');
  expect(scaffold).toContain('| --- | --- |');
  expect(scaffold).notToContain('Hier standen sehr lange Diskussionen');
  expect(scaffold).notToContain('Alter Punkt 1');
});

console.log('\n✨ generateFollowupMeetingMarkdown()');

test('generates complete follower markdown with nav, rollover tasks, and scaffold', () => {
  const prevContent = `
- [ ] Feedback von IT-Sicherheit einholen
- [x] Bereits erledigt

### 📋 Traktanden
### 📝 Notizen
`;

  const md = generateFollowupMeetingMarkdown({
    predecessorId: 'prev-id-123',
    predecessorTitle: 'micha-11',
    predecessorContent: prevContent,
    customDate: '2026-09-02',
    carryoverTasks: true,
    carryoverScaffold: true
  });

  expect(md).toContain('⏮ **Vorheriges Meeting:** [micha-11](#/prev-id-123/micha-11)');
  expect(md).toContain('📅 **Datum:** 2026-09-02');
  expect(md).toContain('2026-09-02\n\n---');
  expect(md).toContain('### ⏳ Offene Pendenzen aus vorherigem Meeting');
  expect(md).toContain('- [ ] Feedback von IT-Sicherheit einholen (aus micha-11)');
  expect(md).notToContain('Bereits erledigt');
  expect(md).toContain('### 📋 Traktanden');
  expect(md).toContain('### 📝 Notizen');
});

test('escapes brackets in the predecessor title so the back link stays intact', () => {
  const md = generateFollowupMeetingMarkdown({ predecessorId: 'p1', predecessorTitle: 'Sprint [4]' });
  expect(md).toContain('[Sprint \\[4\\]](#/p1/sprint-4)');
});

console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('❌ Some tests failed!');
  process.exit(1);
} else {
  console.log('✅ All tests passed!');
}
