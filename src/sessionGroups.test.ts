import { test, describe } from 'node:test';
import assert from 'node:assert';
import { groupAndNumberSessions } from './sessionGroups';

interface Fixture {
    id: string;
    projectPath: string;
    projectName: string;
    sessionCreated: Date | null;
    lastUpdated: Date;
    wasCleared: boolean;
}

function session(id: string, opts: Partial<Fixture> = {}): Fixture {
    return {
        id,
        projectPath: '/work/api',
        projectName: 'api',
        sessionCreated: new Date(1000),
        lastUpdated: new Date(2000),
        wasCleared: false,
        ...opts
    };
}

const ids = (sessions: Fixture[]) => sessions.map((s) => s.id).sort();

describe('groupAndNumberSessions', () => {
    test('two projects sharing a folder name do not supersede each other', () => {
        // The reported defect: deriveProjectName() reduces both paths to "api",
        // and grouping by that name let the newer session hide the older one.
        const alpha = session('alpha', {
            projectPath: '/work/team-a/api',
            sessionCreated: new Date(1000),
            lastUpdated: new Date(2000)
        });
        const beta = session('beta', {
            projectPath: '/work/team-b/api',
            sessionCreated: new Date(3000),
            lastUpdated: new Date(4000)
        });

        assert.deepEqual(ids(groupAndNumberSessions([alpha, beta])), ['alpha', 'beta']);
    });

    test('and each keeps its own name, since neither is a second session of the other', () => {
        const alpha = session('alpha', { projectPath: '/work/team-a/api' });
        const beta = session('beta', { projectPath: '/work/team-b/api', sessionCreated: new Date(3000) });

        const result = groupAndNumberSessions([alpha, beta]);

        assert.deepEqual(result.map((s) => s.projectName).sort(), ['api', 'api']);
    });

    test('a session abandoned before a newer one in the SAME project is superseded', () => {
        const abandoned = session('abandoned', {
            sessionCreated: new Date(1000),
            lastUpdated: new Date(2000)
        });
        const current = session('current', {
            sessionCreated: new Date(3000),
            lastUpdated: new Date(4000)
        });

        assert.deepEqual(ids(groupAndNumberSessions([abandoned, current])), ['current']);
    });

    test('two live sessions in one project both survive and get numbered', () => {
        const first = session('first', {
            sessionCreated: new Date(1000),
            lastUpdated: new Date(5000)
        });
        const second = session('second', {
            sessionCreated: new Date(3000),
            lastUpdated: new Date(5000)
        });

        const result = groupAndNumberSessions([first, second]);

        assert.deepEqual(result.map((s) => s.projectName), ['api', 'api-2']);
    });

    test('numbering follows creation order, not input order', () => {
        const older = session('older', { sessionCreated: new Date(1000), lastUpdated: new Date(5000) });
        const newer = session('newer', { sessionCreated: new Date(3000), lastUpdated: new Date(5000) });

        const result = groupAndNumberSessions([newer, older]);

        assert.strictEqual(result.find((s) => s.id === 'older')!.projectName, 'api');
        assert.strictEqual(result.find((s) => s.id === 'newer')!.projectName, 'api-2');
    });

    test('a cleared session is dropped', () => {
        const cleared = session('cleared', { wasCleared: true });
        const live = session('live', { lastUpdated: new Date(5000) });

        assert.deepEqual(ids(groupAndNumberSessions([cleared, live])), ['live']);
    });

    test('a session with no recorded creation time still survives on its own', () => {
        const undated = session('undated', { sessionCreated: null });

        assert.deepEqual(ids(groupAndNumberSessions([undated])), ['undated']);
    });

    test('an empty input returns an empty list', () => {
        assert.deepEqual(groupAndNumberSessions([]), []);
    });
});
