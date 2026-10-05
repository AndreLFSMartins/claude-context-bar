/**
 * Find the `.jsonl` of each open session, and tell a session's origin from the
 * head of its file without parsing the whole thing.
 *
 * An open tab can sit idle for hours, so its file falls out of the
 * `idleTimeout` window that the directory scan uses; and its file can live
 * outside the workspace-scope directories (1 of 166 listed ids on 2026-10-04,
 * see issue #5). The tab state already proves the session belongs to this
 * window, so each open id is looked up as `<dir>/<id>.jsonl` across EVERY
 * directory under ~/.claude/projects, and the id → path answer is reused on
 * the next refresh. An id with no file yet is left out here (issue #9).
 *
 * With the open set known, an IDE session that is not in it is dropped
 * anyway, so the directory scan does not need to parse its file to find that
 * out. The entrypoint first appears on line 3-9 of a session file, within the
 * first ~11 KB (60 most recent files, measured 2026-10-04), so reading the
 * head answers it. Over all 2,142 session files on this machine on
 * 2026-10-04, the first 64 KB gave the same entrypoint as a full parse for
 * 2,141 and none for 1, never a different one. A head that records none
 * returns "" and the scan parses the file as before.
 *
 * Pure so the behaviour is testable without a VS Code host or a filesystem.
 */

import * as path from 'path';
import { CLAUDE_IDE_ENTRYPOINT } from './revealSession';

/** How much of a session file's head the scan reads for its entrypoint. */
export const HEAD_BYTES = 64 * 1024;

/**
 * @param ids             Open session ids, in tab-state order.
 * @param previous        This function's result on the previous refresh.
 * @param listProjectDirs Full paths of the directories under ~/.claude/projects;
 *                        called only on a cache miss, at most once.
 * @param exists          Whether a file exists.
 * @returns id → `.jsonl` path for every open id that has a file. Only the ids
 *          passed in, so it can be stored as the next `previous`.
 */
export function resolveOpenSessionFiles(
    ids: readonly string[],
    previous: ReadonlyMap<string, string>,
    listProjectDirs: () => string[],
    exists: (file: string) => boolean
): Map<string, string> {
    const resolved = new Map<string, string>();
    let dirs: string[] | null = null;
    for (const id of ids) {
        const cached = previous.get(id);
        if (cached && exists(cached)) {
            resolved.set(id, cached);
            continue;
        }
        // ponytail: an open id with no file yet re-lists and stats every
        // project dir on each refresh (~180 dirs today); cache misses too if
        // that ever shows up in a profile.
        dirs ??= listProjectDirs();
        const found = dirs.map((dir) => path.join(dir, `${id}.jsonl`)).find(exists);
        if (found) {
            resolved.set(id, found);
        }
    }
    return resolved;
}

/**
 * The first `"entrypoint":"…"` the head of a session file records, or "" when
 * it records none. A quote inside a JSON string value is escaped, so an
 * entrypoint quoted in message text does not match.
 */
export function entrypointFromHead(head: string): string {
    return /"entrypoint":"([^"\\]*)"/.exec(head)?.[1] ?? '';
}

/**
 * Does the directory scan leave this session file alone? Only when the tab
 * state is known: an open session is read by id instead, and a closed IDE
 * session would be dropped anyway. With it unknown (`null`) the scan is
 * today's and skips nothing.
 *
 * @param headEntrypoint Reads the file's head; called only when needed.
 */
export function skipInScan(
    sessionId: string,
    openIds: ReadonlySet<string> | null,
    headEntrypoint: () => string
): boolean {
    if (!openIds) {
        return false;
    }
    return openIds.has(sessionId) || headEntrypoint() === CLAUDE_IDE_ENTRYPOINT;
}
