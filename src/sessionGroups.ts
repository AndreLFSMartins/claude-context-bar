/**
 * Group a refresh's sessions per project, drop the ones a newer session
 * superseded, and number what is left.
 *
 * This used to live inline in findActiveSessions(), which is why the defect it
 * now guards against went unnoticed: the grouping key was the session's DISPLAY
 * name. deriveProjectName() names a project after its own folder, so
 * /work/team-a/api and /work/team-b/api both read as "api"; they landed in one
 * group, and supersession then hid a still-open session in one project because
 * a session had been started later in the other (Codex, council run
 * 8e85fa04-0392ed52-7b7863d9, 2026-09-18). The key is now the project path,
 * which is what actually identifies a project. The name stays a label.
 *
 * Supersession itself is unchanged and encodes two real-world behaviours:
 * a session that ended with /clear has nothing left to report, and a session
 * last updated before a newer one in the same project was even created was
 * abandoned rather than left open.
 *
 * Pure so the behaviour is testable without a VS Code host, following the same
 * pattern as tabLabel.ts and sessionFilter.ts.
 */

/** What grouping and supersession need from a session. */
export interface GroupableSession {
    /** Identifies the project. Two sessions share a group iff they share this. */
    projectPath: string;
    /** Display label only — never an identity. Rewritten with the -2 suffix. */
    projectName: string;
    sessionCreated: Date | null;
    lastUpdated: Date;
    wasCleared: boolean;
}

export function groupAndNumberSessions<T extends GroupableSession>(sessions: T[]): T[] {
    const projectGroups = new Map<string, T[]>();
    for (const session of sessions) {
        const group = projectGroups.get(session.projectPath);
        if (group) {
            group.push(session);
        } else {
            projectGroups.set(session.projectPath, [session]);
        }
    }

    const result: T[] = [];
    for (const group of projectGroups.values()) {
        // Every session in the group shares a path, so they share a name too.
        const baseName = group[0].projectName;

        // Newest first, so a session is compared only against ones created later.
        const byCreation = [...group].sort(
            (a, b) => (b.sessionCreated?.getTime() || 0) - (a.sessionCreated?.getTime() || 0)
        );

        const active: T[] = [];
        for (let i = 0; i < byCreation.length; i++) {
            const session = byCreation[i];
            if (session.wasCleared) {
                continue;
            }
            const superseded = byCreation
                .slice(0, i)
                .some((newer) => (newer.sessionCreated?.getTime() || 0) > session.lastUpdated.getTime());
            if (!superseded) {
                active.push(session);
            }
        }

        // Oldest first, so the numbering stays stable as sessions come and go.
        active.sort((a, b) => (a.sessionCreated?.getTime() || 0) - (b.sessionCreated?.getTime() || 0));
        active.forEach((session, i) => {
            session.projectName = i === 0 ? baseName : `${baseName}-${i + 1}`;
        });

        result.push(...active);
    }

    return result;
}
