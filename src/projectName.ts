/**
 * Name a session's project after the folder it actually runs in.
 *
 * The directory Claude Code stores a session under is the project path with
 * every separator replaced by a dash, which makes it ambiguous: nothing in
 * `-Users-andre-Documents-GitHub-claude-context-bar` says whether the dashes
 * in "claude-context-bar" are separators or part of the folder name.
 * decodeProjectPath() works around that by joining the last three segments,
 * so a nested project reads as "GitHub-Tools-ormah" — and, with compactMode
 * on, gets acronymed down to "GHTO".
 *
 * Every session line records the real `cwd`, so the folder name is available
 * unambiguously and needs no guessing. The encoded form stays as the fallback
 * for the case where no line carries a cwd.
 *
 * Pure so the behaviour is testable without a VS Code host, following the same
 * pattern as tabLabel.ts and sessionFilter.ts.
 */

/**
 * @param cwd           Working directory recorded in the session file, or
 *                      ''/absent when none was recorded.
 * @param fallbackName  Name derived from the encoded directory, used when the
 *                      cwd is missing or has no usable last segment.
 */
export function deriveProjectName(cwd: string | undefined, fallbackName: string): string {
    // Split on both separators rather than using path.basename: a Windows path
    // reaching a POSIX host (or the reverse) must still resolve to its folder.
    const segments = (cwd ?? '').split(/[/\\]/).map((s) => s.trim());
    const folder = segments.filter((s) => s !== '').pop();
    return folder || fallbackName;
}
