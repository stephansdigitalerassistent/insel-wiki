/**
 * The DevOps-Bot's status banner.
 *
 * Everything the bot says about a request — which stage it is at, what it
 * proposes, and the decisions it is waiting for — is rendered here, out of the
 * page document's fields. It is deliberately NOT part of the collaborative
 * document.
 *
 * It used to be. The bot wrote its status and its checkboxes into the page's
 * markdown, so its control state and the reader's own prose lived in one CRDT
 * that both sides rewrote. Three failures came out of that arrangement in a
 * single evening: the daemon read a projection of the document that lagged the
 * real one by days, it answered by deleting the Yjs document (which a
 * connected tab then re-published, empty, over the proposal it had just been
 * sent), and a request could only be advanced by string-matching `[x]` in
 * prose that anybody could edit. A field cannot be half-ticked, cannot be
 * clobbered by a stale tab, and needs no projection to read.
 *
 * The document itself is left alone for the reader to write in.
 */

import i18next from 'i18next';

const STAGES = {
    waiting:          { tone: 'info',    icon: '🤖' },
    analyzing:        { tone: 'busy',    icon: '⏳' },
    queuing:          { tone: 'busy',    icon: '📥' },
    subpage_created:  { tone: 'info',    icon: '🔍' },
    proposed:         { tone: 'action',  icon: '📋' },
    approved:         { tone: 'info',    icon: '✅' },
    queued:           { tone: 'busy',    icon: '📥' },
    running:          { tone: 'busy',    icon: '⚙️' },
    preview:          { tone: 'action',  icon: '👀' },
    rejected:         { tone: 'info',    icon: '🗑️' },
    completed:        { tone: 'success', icon: '✅' },
    failed:           { tone: 'error',   icon: '❌' }
};

function t(key, fallback, vars) {
    let translated;
    try {
        translated = i18next.t(`bot.${key}`, vars);
    } catch {
        return fallback;
    }
    // A missing translation comes back two different ways depending on how far
    // i18next got: it echoes the key once initialised, and returns undefined
    // before that. Both must fall through to the German written here, or the
    // banner renders buttons labelled "undefined" — which is what it did until
    // a test asked what an uninitialised i18next actually returns.
    if (typeof translated !== 'string' || !translated || translated === `bot.${key}`) {
        return fallback;
    }
    return translated;
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
}

/**
 * The buttons a given stage offers, as [action, label, variant].
 *
 * A stage the bot is working through offers nothing: there is no honest button
 * for "wait". Every other stage names the decision it needs in the button, so
 * the reader never has to infer what ticking something would do.
 */
export function actionsFor(status, ciState) {
    switch (status) {
        case 'waiting':
            return [['start_analysis', t('action.startAnalysis', 'Analyse starten'), 'primary']];
        case 'proposed':
            return [
                ['approve', t('action.approve', 'Umsetzung freigeben'), 'primary'],
                ['restart', t('action.restart', 'Analyse neu starten'), 'secondary']
            ];
        case 'failed':
            return [['restart', t('action.restart', 'Analyse neu starten'), 'secondary']];
        case 'preview':
            // Rejecting is always available; shipping waits for green CI,
            // because the preview being judged is built by those same checks.
            // Offering "ship it" while they run would be offering to publish
            // something nobody can look at yet.
            return [
                ...(ciState === 'passed'
                    ? [['ship', t('action.ship', 'Live schalten'), 'primary']]
                    : []),
                ['reject', t('action.reject', 'Verwerfen'), 'secondary']
            ];
        default:
            return [];
    }
}

/**
 * One plan step as a sentence.
 *
 * Proposals stored before the plan became a list of sentences hold
 * `{cmd, desc}` objects, where `cmd` was a shell command the bot was never
 * able to run. Show the description; fall back to the command only when there
 * is nothing else, so an old proposal still reads as something.
 */
export function planStepText(step) {
    if (typeof step === 'string') return step.trim();
    if (!step || typeof step !== 'object') return '';
    return String(step.desc || step.details || step.step || step.cmd || '').trim();
}

export function headlineFor(page) {
    const status = page.bot_status;
    switch (status) {
        case 'waiting':         return t('stage.waiting', 'Anfrage erkannt.');
        case 'analyzing':       return t('stage.analyzing', 'Die Anfrage wird analysiert …');
        case 'subpage_created': return t('stage.subpageCreated', 'Die Analyse läuft auf der Unterseite.');
        case 'proposed':        return t('stage.proposed', 'Vorschlag bereit — bitte freigeben.');
        case 'approved':        return t('stage.approved', 'Freigegeben.');
        case 'preview':         return t('stage.preview', 'Bereit zum Anschauen — noch nicht live.');
        case 'rejected':        return t('stage.rejected', 'Verworfen.');
        case 'queuing':         return t('stage.queuing', 'Wird eingereiht …');
        case 'queued':          return t('stage.queued', 'In der Warteschlange.');
        case 'running':         return t('stage.running', 'Wird gerade umgesetzt.');
        case 'completed':       return t('stage.completed', 'Umgesetzt.');
        case 'failed':          return t('stage.failed', 'Fehlgeschlagen.');
        default:                return status || '';
    }
}

/**
 * Render (or re-render) the banner for `page` into `container`.
 *
 * Returns the banner element, or null when the page is not a bot page — a
 * normal wiki page must look exactly as it did before this existed.
 *
 * Re-rendering replaces the node wholesale rather than diffing it. The banner
 * is small, it changes only when the daemon moves a request to a new stage,
 * and a whole-node swap cannot leave a button wired to a stage that has passed.
 */
export function renderBotBanner(container, page, onAction) {
    const existing = container.querySelector('.bot-banner');
    if (existing) existing.remove();
    if (!page || !page.bot_status || page.bot_status === 'new') return null;

    const stage = STAGES[page.bot_status] || { tone: 'info', icon: '🤖' };
    const banner = el('div', `bot-banner bot-banner--${stage.tone}`);
    banner.dataset.botStatus = page.bot_status;

    const head = el('div', 'bot-banner__head');
    head.appendChild(el('span', 'bot-banner__icon', stage.icon));
    head.appendChild(el('strong', 'bot-banner__headline', headlineFor(page)));
    banner.appendChild(head);

    if (page.bot_detail) {
        banner.appendChild(el('p', 'bot-banner__detail', page.bot_detail));
    }

    // The evidence, not a description of it: a running copy of the change on
    // its own Firebase channel. This link is the entire reason the gate exists,
    // so it goes above the plan, not buried under it.
    if (page.bot_status === 'preview' && page.preview_url) {
        const links = el('div', 'bot-banner__links');
        const preview = el('a', 'bot-banner__link bot-banner__link--preview',
                           t('action.openPreview', 'Vorschau öffnen'));
        preview.href = page.preview_url;
        preview.target = '_blank';
        preview.rel = 'noopener noreferrer';
        links.appendChild(preview);
        if (page.pr_url) {
            const pr = el('a', 'bot-banner__link', t('action.openPr', 'Änderungen ansehen'));
            pr.href = page.pr_url;
            pr.target = '_blank';
            pr.rel = 'noopener noreferrer';
            links.appendChild(pr);
        }
        banner.appendChild(links);
    }

    const proposal = page.proposal;
    if (proposal && (page.bot_status === 'proposed' || page.bot_status === 'approved')) {
        const body = el('div', 'bot-banner__body');
        if (proposal.analysis) {
            body.appendChild(el('p', 'bot-banner__analysis', proposal.analysis));
        }
        const steps = Array.isArray(proposal.plan) ? proposal.plan : [];
        if (steps.length) {
            const list = el('ol', 'bot-banner__plan');
            for (const step of steps) {
                const text = planStepText(step);
                if (text) list.appendChild(el('li', null, text));
            }
            body.appendChild(list);
        }
        if (body.hasChildNodes()) {
            banner.appendChild(body);
        }
    }

    const actions = actionsFor(page.bot_status, page.ci_state);
    if (actions.length) {
        const bar = el('div', 'bot-banner__actions');
        for (const [action, label, variant] of actions) {
            const btn = el('button', `bot-banner__btn bot-banner__btn--${variant}`, label);
            btn.type = 'button';
            btn.addEventListener('click', async () => {
                // Disable the whole bar, not just the button pressed: the
                // choices are mutually exclusive, and a second click while the
                // first write is in flight would queue a contradicting action.
                bar.querySelectorAll('button').forEach(b => { b.disabled = true; });
                btn.textContent = t('action.sending', 'Wird gesendet …');
                try {
                    await onAction(action);
                } catch (e) {
                    btn.textContent = label;
                    bar.querySelectorAll('button').forEach(b => { b.disabled = false; });
                    throw e;
                }
            });
            bar.appendChild(btn);
        }
        banner.appendChild(bar);
    }

    container.prepend(banner);
    return banner;
}
