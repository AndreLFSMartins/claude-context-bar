/**
 * Decide whether a session's last prompt still corresponds to a Claude Code
 * tab that is actually open, rather than one that has since been closed.
 *
 * findActiveSessions() treats any .jsonl file modified within idleTimeout as
 * "active." A closed tab's file keeps a recent mtime and lingers there for up
 * to idleTimeout — and since the status bar item now labels itself with the
 * session's last prompt (tabLabel.ts) instead of the project name, a lingering
 * item shows what looks like a real, current message that in fact belongs to
 * a tab that no longer exists.
 *
 * vscode.window.tabGroups exposes open tab titles but not session ids — the
 * Claude Code extension's private `sessionPanels` map (keyed by session id) is
 * not public API. So matching is by title text: Claude Code truncates its tab
 * title from the same last-prompt text this reads from the .jsonl, with a
 * trailing "…" when it doesn't fit. This is a best-effort heuristic, not an
 * identity check — see detectionLooksReliable() for the safety net that
 * bounds how much a wrong guess here can hide.
 *
 * Pure so the behaviour is testable without a VS Code host, following the
 * same pattern as tabLabel.ts and sessionFilter.ts.
 */

import { collapsePrompt } from './tabLabel';

/**
 * @param lastPrompt      The session's last prompt, as read from its .jsonl.
 * @param openTabTitles   Titles of the Claude Code tabs currently open in
 *                        this window (vscode.window.tabGroups, filtered to
 *                        the claudeVSCodePanel view type).
 */
export function hasMatchingOpenTab(lastPrompt: string, openTabTitles: string[]): boolean {
    const collapsed = collapsePrompt(lastPrompt);

    // No prompt recorded yet (a session can be up to one message old before
    // its first last-prompt line lands) — nothing to correlate, so this can
    // never be evidence the tab is closed.
    if (!collapsed) {
        return true;
    }

    return openTabTitles.some((title) => {
        // Strip a trailing ellipsis left by VS Code's own truncation before
        // comparing — the raw title is a truncation of the prompt, or, for a
        // short prompt, the whole prompt untruncated.
        const stripped = title.replace(/…\s*$/, '').trimEnd();
        if (!stripped) {
            return false;
        }
        return collapsed.startsWith(stripped) || stripped.startsWith(collapsed);
    });
}
