/**
 * Unit tests for parseSlides() — src/utils/presentation-parser.js
 * Run with: node src/utils/presentation-parser.test.js
 */

const { parseSlides, escapeHtml, calculateSlideScale, parseCountdownToken, transformCountdownWidgets } = await import('./presentation-parser.js');

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
    toBeTruthy() {
      if (!actual) throw new Error(`Expected truthy but got "${actual}"`);
    },
    toBeFalsy() {
      if (actual) throw new Error(`Expected falsy but got "${actual}"`);
    },
    toContain(sub) {
      if (!actual || !actual.includes(sub)) throw new Error(`Expected "${actual}" to contain "${sub}"`);
    },
    not: {
      toContain(sub) {
        if (actual && actual.includes(sub)) throw new Error(`Expected "${actual}" NOT to contain "${sub}"`);
      }
    }
  };
}

console.log('\n📽️  parseSlides() — Markdown and HTML Slide Parsing');

test('escapes HTML characters correctly', () => {
  expect(escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
});

test('splits markdown by horizontal rules (---)', () => {
  const md = `# Slide 1
Intro text

---

## Slide 2
Content 2

---

## Slide 3
Content 3`;

  const result = parseSlides({ title: 'My Talk', content: md, isMarkdown: true });
  expect(result.slides).toHaveLength(3);
  expect(result.slides[0].html).toContain('Slide 1');
  expect(result.slides[1].html).toContain('Slide 2');
  expect(result.slides[2].html).toContain('Slide 3');
});

test('prepends page title to Slide 1 if missing H1 in markdown', () => {
  const md = `Just some intro bullets without H1
* Point A
* Point B

---

## Next Slide`;

  const result = parseSlides({ title: 'Autonomous Agents', content: md, isMarkdown: true });
  expect(result.slides).toHaveLength(2);
  expect(result.slides[0].html).toContain('<h1 class="presentation-title">Autonomous Agents</h1>');
});

test('falls back to splitting by ## headings when no --- delimiter exists', () => {
  const md = `# Main Topic
Introduction

## First Chapter
Details A

## Second Chapter
Details B`;

  const result = parseSlides({ title: 'Fallback Test', content: md, isMarkdown: true });
  expect(result.slides).toHaveLength(3);
  expect(result.slides[0].html).toContain('Main Topic');
  expect(result.slides[1].html).toContain('First Chapter');
  expect(result.slides[2].html).toContain('Second Chapter');
});

test('extracts speaker notes from markdown blockquotes and comments', () => {
  const md = `## Problem Slide
The problem description

> 🗣️ Erwähnen: Zeitverlust von 15min pro Fall!

<!-- note: Max 45 Sekunden für diese Folie -->

---

## Solution Slide
Our prototype

> **Notiz:** Jetzt Live-Demo zeigen`;

  const result = parseSlides({ title: 'Pitch', content: md, isMarkdown: true });
  expect(result.slides).toHaveLength(2);

  // Slide 1 notes
  expect(result.slides[0].notes).toHaveLength(2);
  expect(result.slides[0].notes[0]).toContain('Max 45 Sekunden');
  expect(result.slides[0].notes[1]).toContain('Zeitverlust von 15min');
  // Note text should be stripped from main slide HTML
  expect(result.slides[0].html).not.toContain('Erwähnen: Zeitverlust');

  // Slide 2 notes
  expect(result.slides[1].notes).toHaveLength(1);
  expect(result.slides[1].notes[0]).toContain('Jetzt Live-Demo zeigen');
  expect(result.slides[1].html).not.toContain('Notiz:');
});

test('splits HTML content by <hr> tags (WYSIWYG mode)', () => {
  const html = `<h1>Team Brain</h1><p>Members: Alice, Bob</p><hr><h2 id="prob">Problem</h2><p>Pain points</p>`;
  const result = parseSlides({ title: 'Team Brain', content: html, isMarkdown: false });

  expect(result.slides).toHaveLength(2);
  expect(result.slides[0].html).toContain('Team Brain');
  expect(result.slides[1].html).toContain('Problem');
});

test('splits HTML content by <h2> tags when no <hr> exists', () => {
  const html = `<p>Intro text</p><h2>Section 1</h2><p>Part 1</p><h2>Section 2</h2><p>Part 2</p>`;
  const result = parseSlides({ title: 'HTML Fallback', content: html, isMarkdown: false });

  expect(result.slides).toHaveLength(3);
  expect(result.slides[0].html).toContain('<h1 class="presentation-title">HTML Fallback</h1>');
  expect(result.slides[1].html).toContain('Section 1');
  expect(result.slides[2].html).toContain('Section 2');
});

test('extracts speaker notes in HTML mode', () => {
  const html = `<h2>Demo</h2><p>Demo text</p><blockquote><p>🗣️ Hier die Maske erklären</p></blockquote>`;
  const result = parseSlides({ title: 'Demo', content: html, isMarkdown: false });

  expect(result.slides).toHaveLength(1);
  expect(result.slides[0].notes).toHaveLength(1);
  expect(result.slides[0].notes[0]).toBe('Hier die Maske erklären');
  expect(result.slides[0].html).not.toContain('Hier die Maske erklären');
});

test('handles empty content gracefully', () => {
  const result = parseSlides({ title: 'Empty Page', content: '', isMarkdown: true });
  expect(result.slides).toHaveLength(1);
  expect(result.slides[0].html).toContain('Empty Page');
  expect(result.slides[0].html).toContain('Diese Seite enthält noch keinen Inhalt');
});

test('calculateSlideScale returns 1 when content fits inside available screen', () => {
  const scale = calculateSlideScale({
    availHeight: 600,
    availWidth: 1000,
    contentHeight: 450,
    contentWidth: 800
  });
  expect(scale).toBe(1);
});

test('calculateSlideScale scales down proportionally when content is too tall', () => {
  const scale = calculateSlideScale({
    availHeight: 500,
    availWidth: 1000,
    contentHeight: 800,
    contentWidth: 800
  });
  // 500 / 800 * 0.98 = 0.6125 -> 0.613
  expect(scale < 1).toBeTruthy();
  expect(scale).toBe(0.613);
});

test('calculateSlideScale enforces floor of 0.35 on very large content', () => {
  const scale = calculateSlideScale({
    availHeight: 300,
    availWidth: 1000,
    contentHeight: 2500,
    contentWidth: 800
  });
  expect(scale).toBe(0.35);
});

console.log('\n⏱️  parseCountdownToken() & Countdown Widget Generation');

test('parseCountdownToken parses target time with Grosse Uhr and Restzeit bis', () => {
  const token = parseCountdownToken('## ⏱️ [Grosse Uhr — Restzeit bis 12:00]');
  expect(token).toBeTruthy();
  expect(token.type).toBe('target');
  expect(token.target).toBe('12:00');
  expect(token.label).toContain('12:00');
});

test('parseCountdownToken parses target time with escaped brackets from Plan page', () => {
  const token = parseCountdownToken('## ⏱️ \\[Grosse Uhr — Restzeit bis 12:00\\]');
  expect(token).toBeTruthy();
  expect(token.type).toBe('target');
  expect(token.target).toBe('12:00');
});

test('parseCountdownToken parses target time with Countdown bis HH:MM', () => {
  const token = parseCountdownToken('# ⏱️ [Countdown bis 13:30]');
  expect(token).toBeTruthy();
  expect(token.type).toBe('target');
  expect(token.target).toBe('13:30');
});

test('parseCountdownToken parses duration MM:SS format', () => {
  const token = parseCountdownToken('# ⏱️ [Countdown 15:00]');
  expect(token).toBeTruthy();
  expect(token.type).toBe('duration');
  expect(token.duration).toBe(900);
});

test('parseCountdownToken parses duration in minutes syntax', () => {
  const token = parseCountdownToken('[Countdown 10 min]');
  expect(token).toBeTruthy();
  expect(token.type).toBe('duration');
  expect(token.duration).toBe(600);
});

test('parseCountdownToken parses explicit countdown: prefix', () => {
  const tokenTarget = parseCountdownToken('[countdown: bis 14:00]');
  expect(tokenTarget.type).toBe('target');
  expect(tokenTarget.target).toBe('14:00');

  const tokenDuration = parseCountdownToken('[countdown: 20:00]');
  expect(tokenDuration.type).toBe('duration');
  expect(tokenDuration.duration).toBe(1200);
});

test('splits markdown by asterisks with spaces (* * *) like on Plan wiki page', () => {
  const md = `# Slide A
Content A

* * *

# Slide B
## ⏱️ [Grosse Uhr — Restzeit bis 12:00]
Content B

* * *

# Slide C
Content C`;

  const result = parseSlides({ title: 'Plan Test', content: md, isMarkdown: true });
  expect(result.slides).toHaveLength(3);
  expect(result.slides[0].html).toContain('Slide A');
  expect(result.slides[1].html).toContain('slide-countdown-card');
  expect(result.slides[1].html).toContain('data-countdown-target="12:00"');
  expect(result.slides[2].html).toContain('Slide C');
});

test('extracts notes and strips 🗣️ **Notiz:** cleanly', () => {
  const md = `# Slide D
Content D

> 🗣️ **Notiz:** 1 Minute Ansage. Reihenfolge vorher auslosen.`;

  const result = parseSlides({ title: 'Plan Test 2', content: md, isMarkdown: true });
  expect(result.slides[0].notes).toHaveLength(1);
  expect(result.slides[0].notes[0]).toBe('1 Minute Ansage. Reihenfolge vorher auslosen.');
  expect(result.slides[0].html).not.toContain('Notiz:');
});

test('converts countdown placeholder in HTML mode', () => {
  const html = `<h2>⏱️ [Countdown bis 13:30]</h2><p>Finish tasks</p>`;
  const result = parseSlides({ title: 'HTML Countdown', content: html, isMarkdown: false });
  expect(result.slides[0].html).toContain('slide-countdown-card');
  expect(result.slides[0].html).toContain('data-countdown-type="target"');
  expect(result.slides[0].html).toContain('data-countdown-target="13:30"');
});

test('a countdown token buried in a sentence keeps its surrounding prose', () => {
  const html = '<p>Wir starten um 09:00, die Restzeit bis 12:00 Uhr steht oben, danach die Demo.</p>';
  const out = transformCountdownWidgets(html);
  expect(out).toContain('Wir starten um 09:00');
  expect(out).toContain('danach die Demo');
  expect(out).not.toContain('slide-countdown-card');
});

test('a bracketed token inside a sentence becomes a widget without eating the sentence', () => {
  const html = '<p>Gleich geht es los. [Restzeit bis 12:00] Danach die Demo.</p>';
  const out = transformCountdownWidgets(html);
  expect(out).toContain('slide-countdown-card');
  expect(out).toContain('Gleich geht es los');
  expect(out).toContain('Danach die Demo');
});

test('a block that is only a countdown token is still replaced wholesale', () => {
  for (const html of [
    '<h2>⏱️ [Grosse Uhr — Restzeit bis 12:00]</h2>',
    '<h1>⏱️ [Countdown bis 13:30]</h1>',
    '<p>Countdown 15 min</p>'
  ]) {
    const out = transformCountdownWidgets(html);
    expect(out).toContain('slide-countdown-card');
  }
});

test('markdown mode keeps ordinary blockquotes on the slide', () => {
  const md = '## Team\n\n> Ein ganz normales Zitat von jemandem.\n\n- Anna\n';
  const result = parseSlides({ title: 'Q', content: md, isMarkdown: true });
  expect(result.slides[0].html).toContain('Ein ganz normales Zitat');
  expect(result.slides[0].notes).toHaveLength(0);
});

test('markdown mode still extracts marked notes, and only those', () => {
  const md = [
    '## Team',
    '',
    '> Ein ganz normales Zitat.',
    '',
    '> 🗣️ **Notiz:** Nur das hier ist eine Notiz.',
    '',
    '> Note: Und das hier auch.',
    ''
  ].join('\n');
  const result = parseSlides({ title: 'Q', content: md, isMarkdown: true });
  expect(result.slides[0].notes).toHaveLength(2);
  expect(result.slides[0].notes[0]).toBe('Nur das hier ist eine Notiz.');
  expect(result.slides[0].notes[1]).toBe('Und das hier auch.');
  expect(result.slides[0].html).toContain('Ein ganz normales Zitat');
});

test('adjacent note lines merge into one note without leaking the marker', () => {
  const md = '## S\n\n> 🗣️ **Notiz:** Erste.\n> Note: Zweite.\n';
  const result = parseSlides({ title: 'T', content: md, isMarkdown: true });
  expect(result.slides[0].notes).toHaveLength(1);
  expect(result.slides[0].notes[0]).toBe('Erste.\nZweite.');
});

test('a colon inside note text is not mistaken for a marker', () => {
  const md = '## S\n\n> 🗣️ **Notiz:** Merke: kurz halten.\n';
  const result = parseSlides({ title: 'T', content: md, isMarkdown: true });
  expect(result.slides[0].notes[0]).toBe('Merke: kurz halten.');
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('✅ All presentation parser tests passed!');
}
