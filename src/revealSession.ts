/**
 * Pure decision for what clicking a status bar item should do.
 *
 * The Claude Code extension keys its open webview panels by session id and
 * exposes `claude-vscode.editor.open`, which reveals the panel for an id it
 * knows. That command is private, undocumented API, and when it does NOT
 * recognise the id it creates a brand new tab instead of revealing one. Both
 * facts are why the decision lives here, behind two guards, rather than being
 * a bare `executeCommand` at the click site.
 *
 * Pure so the behaviour is testable without a VS Code host, following the same
 * pattern as `getContextLimitForModel` in contextLimit.ts.
 */

/** `entrypoint` value written by Claude Code sessions running as a VS Code tab. */
export const CLAUDE_IDE_ENTRYPOINT = 'claude-vscode';

/**
 * Private command of the Claude Code extension that reveals a session's panel.
 *
 * Deliberately NOT `claude-vscode.editor.open`, the obvious candidate. That one
 * runs `if (viewColumn !== ViewColumn.Active) setPreferredLocation("panel")`
 * before revealing anything, and `setPreferredLocation` writes
 * `claudeCode.preferredLocation` to the user's GLOBAL settings. We pass only a
 * session id, so `viewColumn` is undefined and the write would fire on every
 * click — silently flipping the preference for anyone who uses the sidebar.
 *
 * `primaryEditor.open` reaches the same `createPanel` with `ViewColumn.Active`
 * and touches no settings.
 */
export const CLAUDE_REVEAL_COMMAND = 'claude-vscode.primaryEditor.open';

export type ClickAction =
    | { kind: 'reveal'; sessionId: string }
    | { kind: 'notice'; message: string };

/**
 * @param session                 Full (untruncated) session id plus the origin
 *                                recorded in the session's `.jsonl`.
 * @param claudeCommandAvailable  Whether CLAUDE_REVEAL_COMMAND is registered.
 *
 * Origin is checked first: when both guards fail, the origin is the more
 * specific explanation. An empty entrypoint fails closed — older session files
 * do not record one, and guessing would risk opening an unwanted tab.
 */
export function resolveClickAction(
    session: { sessionId: string; entrypoint: string },
    claudeCommandAvailable: boolean
): ClickAction {
    if (session.entrypoint !== CLAUDE_IDE_ENTRYPOINT) {
        const origin = session.entrypoint || 'unknown';
        return {
            kind: 'notice',
            message: `This session has no Claude Code tab in this window to open (origin: ${origin}).`
        };
    }

    if (!claudeCommandAvailable) {
        return {
            kind: 'notice',
            message: 'The Claude Code extension for VS Code was not found, so its tab cannot be opened.'
        };
    }

    return { kind: 'reveal', sessionId: session.sessionId };
}
