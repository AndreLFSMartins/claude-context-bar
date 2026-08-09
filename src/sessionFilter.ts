/**
 * Pure helpers for deciding which Claude Code sessions a window should show.
 *
 * Upstream shows every session found under ~/.claude/projects/, from every
 * VS Code window and every background agent, then truncates the list to a
 * hardcoded 5 items. On a machine running several windows plus scheduled
 * tasks, that combination silently drops real tabs off the status bar.
 *
 * These three functions are the decisions that fix it. They are pure so the
 * behaviour is testable without a VS Code host, following the same pattern as
 * `getContextLimitForModel` in contextLimit.ts.
 */

/**
 * Reproduce Claude Code's project-directory naming: every character that is
 * not alphanumeric becomes a dash.
 *
 *   /Users/andre/Documents/Obsidian/AndreMartins
 *     -> -Users-andre-Documents-Obsidian-AndreMartins
 *
 * Note this is deliberately one-way. Decoding is ambiguous (a dash in a folder
 * name is indistinguishable from a path separator once encoded), so we always
 * compare in encoded space instead of trying to reverse it.
 */
export function encodeProjectPath(absPath: string): string {
    // Drop a trailing separator first; "/GitHub/" and "/GitHub" name the same dir.
    const trimmed = absPath.length > 1 ? absPath.replace(/[/\\]+$/, '') : absPath;
    return trimmed.replace(/[^a-zA-Z0-9]/g, '-');
}

/**
 * Does this project directory belong to one of the window's workspace roots?
 *
 * @param projectDir    Directory name as it appears in ~/.claude/projects/
 * @param encodedRoots  Workspace folder paths already run through encodeProjectPath
 *
 * Matches the root exactly, or any directory nested under it. The trailing dash
 * in the prefix test is what stops `-Users-…-GitHubOutro` from matching the root
 * `-Users-…-GitHub`.
 *
 * With no roots (a window with no folder open) everything is kept: failing open
 * costs some noise, while failing closed would empty the status bar.
 */
export function belongsToWorkspace(projectDir: string, encodedRoots: string[]): boolean {
    if (encodedRoots.length === 0) {
        return true;
    }
    return encodedRoots.some((root) => projectDir === root || projectDir.startsWith(root + '-'));
}

/**
 * Is this session a scheduled/background task rather than an interactive tab?
 *
 * Claude Code opens scheduled runs with a `<scheduled-task …>` block as the
 * first user message. Those sessions are real, but they are not tabs, and each
 * one competes for a slot in the status bar.
 *
 * An empty first message means we could not read one — that is not evidence of
 * a scheduled task, so it counts as a real session.
 */
export function isScheduledTask(firstMessage: string): boolean {
    return /^\s*<scheduled-task\b/.test(firstMessage ?? '');
}
