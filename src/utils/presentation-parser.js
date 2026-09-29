// Presentation slide parser — splits Markdown or HTML into presentation slides
import { marked } from 'marked';

/**
 * Escapes HTML characters for safe attribute/content insertion.
 * @param {string} str 
 * @returns {string}
 */
export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Calculates scale factor to ensure content always fits within available bounds (1 screen).
 *
 * @param {Object} dims
 * @param {number} dims.availHeight
 * @param {number} dims.availWidth
 * @param {number} dims.contentHeight
 * @param {number} dims.contentWidth
 * @returns {number} Scale factor between 0.35 and 1.0
 */
export function calculateSlideScale({ availHeight, availWidth, contentHeight, contentWidth }) {
  if (!availHeight || !contentHeight || contentHeight <= 0 || availHeight <= 0) return 1;
  if (!availWidth || !contentWidth || contentWidth <= 0 || availWidth <= 0) return 1;

  if (contentHeight <= availHeight && contentWidth <= availWidth) {
    return 1;
  }

  const scaleY = availHeight / contentHeight;
  const scaleX = availWidth / contentWidth;
  const scale = Math.max(0.35, Math.min(scaleY, scaleX) * 0.98);
  return Number(scale.toFixed(3));
}


/**
 * Parses a countdown token from text or bracketed placeholder.
 * Supports both target times ("bis 12:00", "bis 13:30") and durations ("15:00", "15 min", "10m").
 *
 * @param {string} raw
 * @returns {{ type: 'target'|'duration', target?: string, duration?: number, label: string, matched: string } | null}
 */
export function cleanCountdownText(raw) {
  if (!raw || typeof raw !== 'string') return '';
  // Strip inner HTML tags, common entities, leading/trailing escaped brackets
  return raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/^[\\\[\s⏱️⏰]+|[\\\]\s]+$/g, '')
    .trim();
}

export function parseCountdownToken(raw) {
  if (!raw || typeof raw !== 'string') return null;

  const clean = cleanCountdownText(raw);

  // 1. Target Time: "bis HH:MM", "Restzeit bis HH:MM", "Grosse Uhr — Restzeit bis HH:MM", "Uhr bis HH:MM"
  const targetMatch = clean.match(/(?:(?:grosse uhr\s*[-—–]\s*)?restzeit bis|countdown bis|uhr bis|countdown:\s*bis)\s*(\d{1,2}:\d{2})(?:\s*uhr)?/i);
  if (targetMatch) {
    const timeStr = targetMatch[1];
    return {
      type: 'target',
      target: timeStr,
      label: `Restzeit bis ${timeStr} Uhr`,
      matched: targetMatch[0]
    };
  }

  // 2. Duration MM:SS: "Countdown 15:00", "countdown: 15:00"
  const durationMmSsMatch = clean.match(/(?:countdown:?)\s*(\d{1,2}):(\d{2})\b/i);
  if (durationMmSsMatch) {
    const mins = parseInt(durationMmSsMatch[1], 10);
    const secs = parseInt(durationMmSsMatch[2], 10);
    const totalSeconds = mins * 60 + secs;
    return {
      type: 'duration',
      duration: totalSeconds,
      label: `Countdown ${mins}:${String(secs).padStart(2, '0')}`,
      matched: durationMmSsMatch[0]
    };
  }

  // 3. Duration in minutes: "Countdown 15 min", "Countdown 15m", "countdown: 10m"
  const durationMinMatch = clean.match(/(?:countdown:?)\s*(\d+)\s*(?:min(?:uten)?|m)\b/i);
  if (durationMinMatch) {
    const mins = parseInt(durationMinMatch[1], 10);
    return {
      type: 'duration',
      duration: mins * 60,
      label: `Countdown ${mins} Min.`,
      matched: durationMinMatch[0]
    };
  }

  return null;
}

/**
 * Renders HTML markup for a countdown widget inside presentation slides.
 *
 * @param {Object} token
 * @param {'target'|'duration'} token.type
 * @param {string} [token.target]
 * @param {number} [token.duration]
 * @param {string} [token.label]
 * @returns {string}
 */
export function renderCountdownWidgetHTML(token) {
  const initialDigits = token.type === 'duration' && token.duration
    ? `${String(Math.floor(token.duration / 60)).padStart(2, '0')}:${String(token.duration % 60).padStart(2, '0')}`
    : '--:--:--';

  const label = token.label || (token.type === 'target' ? `Bis ${token.target} Uhr` : 'Countdown');

  return `<div class="slide-countdown-card" data-countdown-type="${token.type}" data-countdown-target="${token.target || ''}" data-countdown-duration="${token.duration || ''}" data-countdown-label="${escapeHtml(label)}">
  <div class="slide-countdown-header">
    <span class="slide-countdown-icon">⏱️</span>
    <span class="slide-countdown-label">${escapeHtml(label)}</span>
    <span class="slide-countdown-badge">LIVE</span>
  </div>
  <div class="slide-countdown-display" title="Klicken: Start/Pause">
    <span class="slide-countdown-digits">${initialDigits}</span>
  </div>
  <div class="slide-countdown-controls">
    <button type="button" class="slide-countdown-btn slide-countdown-toggle" title="Pause / Start">⏸️</button>
    <button type="button" class="slide-countdown-btn slide-countdown-reset" title="Zurücksetzen">🔄</button>
    <button type="button" class="slide-countdown-btn slide-countdown-sound" title="Ton stummschalten (M)">🔊</button>
  </div>
</div>`;
}

/**
 * Reports whether a block's text is nothing but the countdown token itself,
 * ignoring decoration (brackets, dashes, clock emoji, punctuation).
 *
 * @param {string} raw - Raw inner HTML of the block
 * @param {{matched?: string}} token - Token returned by parseCountdownToken
 * @returns {boolean}
 */
export function isStandaloneCountdown(raw, token) {
  if (!token || !token.matched) return false;
  const clean = cleanCountdownText(raw);
  const idx = clean.toLowerCase().indexOf(token.matched.toLowerCase());
  if (idx === -1) return false;
  const residue = clean.slice(0, idx) + clean.slice(idx + token.matched.length);
  // Anything left that is a letter or a digit is real prose, not decoration.
  return !/[\p{L}\p{N}]/u.test(residue);
}

/**
 * Finds countdown placeholders within slide HTML and replaces them with live countdown widget elements.
 *
 * @param {string} html
 * @returns {string}
 */
export function transformCountdownWidgets(html) {
  if (!html) return html;

  // Step 1: Replace tags (h1-h6, p) whose content is *only* a countdown token.
  // The whole block is swapped for the widget, so a token buried in a sentence
  // must be left alone here — otherwise the surrounding prose is silently lost.
  // A *bracketed* token inside a sentence is still picked up by the inline pass
  // below, which replaces just the token and keeps the sentence; an unbracketed
  // mention of a time simply stays prose.
  const blockRegex = /<(?<tag>h[1-6]|p)[^>]*>(?<inner>[\s\S]*?)<\/\k<tag>>/gi;
  let transformed = html.replace(blockRegex, (fullMatch, tag, inner) => {
    const token = parseCountdownToken(inner);
    if (token && isStandaloneCountdown(inner, token)) {
      return renderCountdownWidgetHTML(token);
    }
    return fullMatch;
  });

  // Step 2: Replace any remaining standalone bracketed countdown tokens
  const inlineRegex = /(?:⏱️|⏰)?\s*\\?\[(?:⏱️|⏰)?\s*([^\]]+?)\s*\\?\]/g;
  transformed = transformed.replace(inlineRegex, (fullMatch, inner) => {
    const token = parseCountdownToken(inner);
    if (token) {
      return renderCountdownWidgetHTML(token);
    }
    return fullMatch;
  });

  return transformed;
}

/**
 * Parses document content (Markdown or HTML) into slides.
 *
 * Splitting priority:
 * 1. Explicit slide dividers (---, ***, ___ or <hr>)
 * 2. Headings fallback (split on H2 / ## if no divider exists)
 * 3. Fallback to single slide
 *
 * Notes extraction:
 * - Blockquotes starting with 🗣️, Notiz:, Note:
 * - HTML comments <!-- note: ... -->
 *
 * @param {Object} options
 * @param {string} [options.title=''] - Page title
 * @param {string} [options.content=''] - Content string (Markdown or HTML)
 * @param {boolean} [options.isMarkdown=false] - True if content is raw Markdown
 * @returns {{ slides: Array<{ index: number, html: string, notes: string[] }> }}
 */
export function parseSlides({ title = '', content = '', isMarkdown = false } = {}) {
  const text = (content || '').trim();

  // If completely empty, return default single slide
  if (!text) {
    return {
      slides: [
        {
          index: 0,
          html: `<h1 class="presentation-title">${escapeHtml(title || 'Präsentation')}</h1>\n<p class="presentation-empty-hint">Diese Seite enthält noch keinen Inhalt.</p>`,
          notes: []
        }
      ]
    };
  }

  const slides = [];

  if (isMarkdown) {
    // Standard markdown horizontal rule: 3 or more -, *, or _ optionally separated by spaces
    const hrRegex = /(?:^|\n)\s*(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})\s*(?:\n|$)/;
    let chunks = [];

    if (hrRegex.test(text)) {
      chunks = text.split(hrRegex);
    } else if (/(?:^|\n)##\s+/m.test(text)) {
      // Fallback: split on ## headings
      chunks = text.split(/(?=(?:^|\n)##\s+)/);
    } else {
      chunks = [text];
    }

    chunks = chunks.map(c => c.trim()).filter(Boolean);
    if (chunks.length === 0) chunks = [''];

    chunks.forEach((chunk, index) => {
      const notes = [];

      // Extract comments <!-- note: ... -->
      const commentRegex = /<!--\s*(?:note|speaker):\s*([\s\S]*?)-->/gi;
      let cMatch;
      while ((cMatch = commentRegex.exec(chunk)) !== null) {
        notes.push(cMatch[1].trim());
      }
      let cleanedChunk = chunk.replace(commentRegex, '');

      // Extract blockquote notes: > 🗣️ or > **Notiz:** or > Notiz: or > Note:
      // The marker is REQUIRED. It used to be optional, which matched every `>`
      // line and silently moved ordinary pull-quotes off the slide and into the
      // speaker notes. The HTML branch below has always required it.
      // A blank line also terminates a note, so two notes on one slide stay two
      // notes instead of the first swallowing the rest of the chunk.
      const noteBqRegex = /(?:^|\n)>\s*(?:(?:🗣️|🗣)\s*(?:\*\*(?:Notiz|Note):\*\*|(?:Notiz|Note):)?|\*\*(?:Notiz|Note):\*\*|(?:Notiz|Note):)\s*([\s\S]*?)(?=(?:\n\s*\n|\n[^\n>]|$))/gi;
      let bqMatch;
      while ((bqMatch = noteBqRegex.exec(cleanedChunk)) !== null) {
        let noteText = bqMatch[1].trim().replace(/\n>\s*/g, '\n');
        // Markdown joins adjacent `>` lines into one blockquote, so a second
        // note written without a blank line between arrives as a continuation
        // line. Strip the marker off every line, not just the first, or the
        // label shows up as literal text in the speaker notes.
        noteText = noteText
          .split('\n')
          .map(line => line.replace(/^(?:🗣️|🗣)?\s*(?:\*\*(?:Notiz|Note):\*\*|(?:Notiz|Note):)\s*/i, ''))
          .join('\n')
          .replace(/^(?:🗣️|🗣)\s*/, '')
          .trim();
        if (noteText) notes.push(noteText);
      }
      cleanedChunk = cleanedChunk.replace(noteBqRegex, '').trim();

      // Convert chunk to HTML
      let html = marked.parse(cleanedChunk || '');

      // Transform countdown placeholders to widgets
      html = transformCountdownWidgets(html);

      // Prepend title to first slide if missing H1
      if (index === 0 && !/<h1\b/i.test(html) && title) {
        html = `<h1 class="presentation-title">${escapeHtml(title)}</h1>\n` + html;
      }

      slides.push({
        index,
        html: html.trim(),
        notes
      });
    });
  } else {
    // HTML mode (e.g. from Tiptap getHTML())
    let rawHtml = text;
    const globalNotes = [];

    // Extract comments
    const commentRegex = /<!--\s*(?:note|speaker):\s*([\s\S]*?)-->/gi;
    let cMatch;
    while ((cMatch = commentRegex.exec(rawHtml)) !== null) {
      globalNotes.push(cMatch[1].trim());
    }
    rawHtml = rawHtml.replace(commentRegex, '');

    const hasHr = /<hr\b[^>]*>/i.test(rawHtml);
    let chunks = [];

    if (hasHr) {
      chunks = rawHtml.split(/<hr\b[^>]*>/i);
    } else if (/<h2\b[^>]*>/i.test(rawHtml)) {
      // Fallback: split on <h2
      chunks = rawHtml.split(/(?=<h2\b[^>]*>)/i);
    } else {
      chunks = [rawHtml];
    }

    chunks = chunks.map(c => c.trim()).filter(c => c.length > 0 && c !== '<p></p>' && c !== '<p><br></p>');
    if (chunks.length === 0) chunks = [''];

    chunks.forEach((chunk, index) => {
      const slideNotes = [...(index === 0 ? globalNotes : [])];

      // Extract blockquote notes from HTML:
      // <blockquote>... (🗣️|Notiz:|Note:) ...</blockquote>
      const bqHtmlRegex = /<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi;
      let cleanedHtml = chunk.replace(bqHtmlRegex, (match, inner) => {
        const textOnly = inner.replace(/<[^>]*>/g, '').trim();
        if (/^(?:🗣️|🗣|\*\*Notiz:\*\*|Notiz:|Note:)/i.test(textOnly)) {
          const cleanNote = textOnly
            .replace(/^(?:🗣️|🗣)?\s*(?:\*\*(?:Notiz|Note):\*\*|(?:Notiz|Note):)?\s*/i, '')
            .trim();
          if (cleanNote) slideNotes.push(cleanNote);
          return ''; // Strip note from main slide body
        }
        return match;
      });

      // Transform countdown placeholders to widgets
      cleanedHtml = transformCountdownWidgets(cleanedHtml);

      if (index === 0 && !/<h1\b/i.test(cleanedHtml) && title) {
        cleanedHtml = `<h1 class="presentation-title">${escapeHtml(title)}</h1>\n` + cleanedHtml;
      }

      slides.push({
        index,
        html: cleanedHtml.trim(),
        notes: slideNotes
      });
    });
  }

  // Ensure there is at least one non-empty slide
  if (slides.length === 0 || (slides.length === 1 && !slides[0].html)) {
    return {
      slides: [
        {
          index: 0,
          html: `<h1 class="presentation-title">${escapeHtml(title || 'Präsentation')}</h1>\n<p class="presentation-empty-hint">Diese Seite enthält noch keinen Inhalt.</p>`,
          notes: []
        }
      ]
    };
  }

  return { slides };
}
