/**
 * Which Claude Code sessions have a tab open in THIS window, read from the
 * Claude Code extension's own persisted tab state rather than guessed from
 * tab title text (openTabMatch.ts).
 *
 * The Claude Code extension keeps its editor tabs in the window's workspace
 * state: `workspaceStorage/<hash>/state.vscdb`, table `ItemTable`, key
 * `Anthropic.claude-code`. The value is a JSON object whose
 * `panelTabSessions: [{ sessionId, title, fullEditor? }]` lists the open tabs;
 * `sessionId` is the full UUID, i.e. the `.jsonl` file name. Verified
 * 2026-10-04 against Claude Code 2.1.289: the list matched the tabs on screen,
 * a closed tab left it about a second after the close, each window has its own
 * list, and `fullEditor` is absent from older entries. The other top-level
 * keys (`panelSessionIds`, `lastActivationSessionId`, ...) are not used:
 * `panelSessionIds` is in only 10 of 126 databases surveyed and may no longer
 * be maintained, so trusting it could pin a closed session to the bar.
 *
 * This is private, undocumented state — the same risk class as the `.jsonl`
 * fields. So anything unexpected returns `null`, meaning "unknown", and the
 * caller falls back to the title heuristic instead of emptying the bar. An
 * empty `panelTabSessions` is a real answer (every tab closed) and returns
 * `[]`.
 *
 * Pure so the behaviour is testable without a VS Code host or a database.
 */

import { CLAUDE_IDE_ENTRYPOINT } from './revealSession';

export interface OpenSession {
    sessionId: string;
    title: string;
}

/**
 * @param value The raw `Anthropic.claude-code` value, or `undefined` when the
 *              key is missing.
 * @returns `panelTabSessions`, one entry per distinct `sessionId`, or `null`
 *          when the value is missing, not JSON, or has no
 *          `panelTabSessions` array.
 */
export function parseOpenSessions(value: string | undefined): OpenSession[] | null {
    if (value === undefined) {
        return null;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        return null;
    }
    const tabs = (parsed as { panelTabSessions?: unknown } | null)?.panelTabSessions;
    if (!Array.isArray(tabs)) {
        return null;
    }

    const seen = new Set<string>();
    const sessions: OpenSession[] = [];
    for (const tab of tabs) {
        const sessionId = tab?.sessionId;
        if (typeof sessionId !== 'string' || seen.has(sessionId)) {
            continue;
        }
        seen.add(sessionId);
        sessions.push({ sessionId, title: typeof tab.title === 'string' ? tab.title : '' });
    }
    return sessions;
}

/**
 * Drop every IDE session whose id is not an open tab. Sessions from any other
 * origin (terminal, SDK, Desktop) have no entry in the tab state and are kept
 * untouched — they stay under the `idleTimeout` rule.
 */
export function keepOpenSessions<T extends { fullSessionId: string; entrypoint: string }>(
    sessions: T[],
    open: OpenSession[]
): T[] {
    const openIds = new Set(open.map((s) => s.sessionId));
    return sessions.filter((s) => s.entrypoint !== CLAUDE_IDE_ENTRYPOINT || openIds.has(s.fullSessionId));
}
