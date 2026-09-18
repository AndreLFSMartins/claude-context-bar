/**
 * Decide whether a session still corresponds to a Claude Code tab that is
 * actually open, rather than one that has since been closed.
 *
 * findActiveSessions() treats any .jsonl file modified within idleTimeout as
 * "active." A closed tab's file keeps a recent mtime and lingers there for up
 * to idleTimeout — and since the status bar item now labels itself with the
 * session's own text (tabLabel.ts) instead of the project name, a lingering
 * item shows what looks like a real, current tab that in fact no longer
 * exists.
 *
 * vscode.window.tabGroups exposes open tab titles but not session ids — the
 * Claude Code extension's private `sessionPanels` map (keyed by session id) is
 * not public API. So matching is by title text. The Claude Code tab titles
 * itself with the name given by /rename once one exists (`custom-title` in
 * the .jsonl), then with the AI-generated session title (`ai-title`), and
 * with the latest prompt before either, truncated with a trailing "…" when it
 * doesn't fit.
 *
 * A tab shows exactly ONE of those at a time, so this matches exactly one —
 * the same `customTitle || aiTitle || lastPrompt` chain buildItemLabel uses.
 * Keeping the older texts as extra candidates was tried and reverted: a
 * session whose tab is really closed then survives by colliding with some
 * OTHER open tab titled from its leftover prompt, which is the ghost class
 * this module exists to remove. The cost is one refresh of flicker in the
 * window between a /rename (or the first ai-title) landing in the .jsonl and
 * the webview retitling its tab; detectionLooksReliable() bounds it.
 *
 * This is a best-effort heuristic, not an identity check — see
 * detectionLooksReliable() for the safety net that bounds how much a wrong
 * guess here can hide.
 *
 * Pure so the behaviour is testable without a VS Code host, following the
 * same pattern as tabLabel.ts and sessionFilter.ts.
 */

import { collapsePrompt } from './tabLabel';

/** The texts a Claude Code tab may be titling itself with. */
export interface TabTitleSource {
    customTitle?: string;
    aiTitle?: string;
    lastPrompt: string;
}

function titleMatchesText(title: string, collapsedText: string): boolean {
    // Strip a trailing ellipsis left by VS Code's own truncation before
    // comparing — the raw title is a truncation of the text, or, for a
    // short text, the whole text untruncated. Either way the title is a
    // PREFIX of the text, never the other way round.
    //
    // The reverse direction (`stripped.startsWith(collapsedText)`) used to be
    // accepted too, and nothing the comment above claims justifies it. It
    // made every short recorded text match any longer tab title sharing its
    // opening characters: a closed session named "Auth" matched an unrelated
    // open tab titled "Authentication" and stayed on the bar. Harmless while
    // the only texts were prompts and AI titles, which are long; /rename made
    // short texts ordinary, so it had to go.
    const stripped = title.replace(/…\s*$/, '').trimEnd();
    if (!stripped) {
        return false;
    }
    return collapsedText.startsWith(stripped);
}

/**
 * @param session         The session's custom title, AI title and last prompt,
 *                        as read from its .jsonl.
 * @param openTabTitles   Titles of the Claude Code tabs currently open in
 *                        this window (vscode.window.tabGroups, filtered to
 *                        the claudeVSCodePanel view type).
 */
export function hasMatchingOpenTab(session: TabTitleSource, openTabTitles: string[]): boolean {
    const candidate = collapsePrompt(session.customTitle ?? '')
        || collapsePrompt(session.aiTitle ?? '')
        || collapsePrompt(session.lastPrompt);

    // Neither a title nor a prompt recorded yet (a session can be up to one
    // message old before its first lines land) — nothing to correlate, so
    // this can never be evidence the tab is closed.
    if (!candidate) {
        return true;
    }

    return openTabTitles.some((title) => titleMatchesText(title, candidate));
}

/**
 * Is the open-tab title list trustworthy enough to filter sessions with?
 *
 * Checking only the most-recently-updated session (an earlier version of
 * this function did that) breaks on the single most common case: closing
 * the tab you were just using makes *that* session the freshest one on
 * disk, and it correctly stops matching — its tab really is gone. Reading
 * that as "the whole mechanism is broken" throws away the filter exactly
 * when it just did its job.
 *
 * Instead: trust the mechanism if *any* session that has a recorded title
 * or prompt matches *some* open tab. A session with neither recorded is not
 * evidence either way — hasMatchingOpenTab always passes it regardless of
 * whether matching is actually working, so it can't confirm anything.
 * Zero open tabs detected at all is treated as untrustworthy too: it's
 * ambiguous between "every tab really is closed" and "the viewType check
 * in getOpenClaudeTabTitles() broke" (e.g. a future Claude Code release
 * renamed its panel view type), and there's no way to tell those apart
 * from here.
 *
 * Callers should skip the filter entirely when this returns false, falling
 * back to plain idleTimeout, so a detection failure degrades to today's
 * existing behaviour rather than hiding every active session.
 */
export function detectionLooksReliable(
    sessions: TabTitleSource[],
    openTabTitles: string[]
): boolean {
    if (sessions.length === 0) {
        return true;
    }
    if (openTabTitles.length === 0) {
        return false;
    }

    const withEvidence = sessions.filter(
        (s) => collapsePrompt(s.customTitle ?? '') !== ''
            || collapsePrompt(s.aiTitle ?? '') !== ''
            || collapsePrompt(s.lastPrompt) !== ''
    );
    if (withEvidence.length === 0) {
        return true;
    }

    return withEvidence.some((s) => hasMatchingOpenTab(s, openTabTitles));
}
