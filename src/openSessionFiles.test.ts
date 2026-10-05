import { test, describe } from 'node:test';
import assert from 'node:assert';
import * as path from 'path';
import { resolveOpenSessionFiles, openSessionsWithoutFile, entrypointFromHead, skipInScan } from './openSessionFiles';
import { CLAUDE_IDE_ENTRYPOINT } from './revealSession';

const DIRS = ['/p/-Users-a-vault', '/p/-Users-a-elsewhere'];

function fsWith(files: string[]) {
    const present = new Set(files);
    let listed = 0;
    return {
        listDirs: () => { listed++; return DIRS; },
        exists: (f: string) => present.has(f),
        listedCount: () => listed
    };
}

describe('resolveOpenSessionFiles', () => {
    test('finds an open session in any project directory, not only the workspace ones', () => {
        const file = path.join('/p/-Users-a-elsewhere', 'aaa.jsonl');
        const fs = fsWith([file]);

        const resolved = resolveOpenSessionFiles(['aaa'], new Map(), fs.listDirs, fs.exists);

        assert.deepStrictEqual([...resolved], [['aaa', file]]);
    });

    test('a cached path that still exists is reused without listing directories', () => {
        const file = path.join('/p/-Users-a-vault', 'aaa.jsonl');
        const fs = fsWith([file]);

        const resolved = resolveOpenSessionFiles(['aaa'], new Map([['aaa', file]]), fs.listDirs, fs.exists);

        assert.deepStrictEqual([...resolved], [['aaa', file]]);
        assert.strictEqual(fs.listedCount(), 0);
    });

    test('a cached path whose file is gone is resolved again', () => {
        const moved = path.join('/p/-Users-a-elsewhere', 'aaa.jsonl');
        const fs = fsWith([moved]);

        const resolved = resolveOpenSessionFiles(
            ['aaa'], new Map([['aaa', path.join('/p/-Users-a-vault', 'aaa.jsonl')]]), fs.listDirs, fs.exists
        );

        assert.deepStrictEqual([...resolved], [['aaa', moved]]);
    });

    test('an open session with no file yet is left out', () => {
        const fs = fsWith([]);

        assert.deepStrictEqual([...resolveOpenSessionFiles(['aaa'], new Map(), fs.listDirs, fs.exists)], []);
    });

    test('ids no longer open drop out of the result, so the cache does not grow', () => {
        const file = path.join('/p/-Users-a-vault', 'bbb.jsonl');
        const fs = fsWith([file, path.join('/p/-Users-a-vault', 'aaa.jsonl')]);

        const resolved = resolveOpenSessionFiles(
            ['bbb'], new Map([['aaa', path.join('/p/-Users-a-vault', 'aaa.jsonl')]]), fs.listDirs, fs.exists
        );

        assert.deepStrictEqual([...resolved], [['bbb', file]]);
    });

    test('lists the project directories at most once per call', () => {
        const fs = fsWith([path.join('/p/-Users-a-vault', 'aaa.jsonl'), path.join('/p/-Users-a-elsewhere', 'bbb.jsonl')]);

        resolveOpenSessionFiles(['aaa', 'bbb', 'ccc'], new Map(), fs.listDirs, fs.exists);

        assert.strictEqual(fs.listedCount(), 1);
    });
});

describe('openSessionsWithoutFile', () => {
    test('returns the open sessions with no file yet, with their tab titles, in tab-state order', () => {
        const open = [
            { sessionId: 'ccc', title: 'Claude Code' },
            { sessionId: 'aaa', title: 'Fix the bar' },
            { sessionId: 'bbb', title: '' }
        ];

        const unstarted = openSessionsWithoutFile(open, new Map([['aaa', '/p/-Users-a-vault/aaa.jsonl']]));

        assert.deepStrictEqual(unstarted, [
            { sessionId: 'ccc', title: 'Claude Code' },
            { sessionId: 'bbb', title: '' }
        ]);
    });

    test('returns none once every open session has a file', () => {
        const open = [{ sessionId: 'aaa', title: 'Fix the bar' }];

        assert.deepStrictEqual(openSessionsWithoutFile(open, new Map([['aaa', '/p/x/aaa.jsonl']])), []);
    });
});

describe('entrypointFromHead', () => {
    // Shape of the first lines of a real IDE session (Claude Code 2.1.289,
    // 2026-10-04): the entrypoint first appears on line 3-9.
    const head = [
        '{"type":"permission-mode","permissionMode":"default","sessionId":"aaa"}',
        '{"type":"file-history-snapshot","messageId":"m1","snapshot":{}}',
        '{"parentUuid":null,"isSidechain":false,"type":"user","message":{"role":"user","content":"hi"},"entrypoint":"claude-vscode","cwd":"/w"}',
        '{"type":"assistant","entrypoint":"claude-vscode","message":{"content":[]}}'
    ].join('\n');

    test('returns the first entrypoint the head records', () => {
        assert.strictEqual(entrypointFromHead(head), 'claude-vscode');
    });

    test('returns "" when the head records none', () => {
        assert.strictEqual(entrypointFromHead('{"type":"permission-mode"}\n{"type":"user","mes'), '');
    });

    test('ignores an entrypoint quoted inside message text', () => {
        const quoted = '{"type":"user","message":{"content":"set \\"entrypoint\\":\\"claude-vscode\\" here"},"entrypoint":"cli"}';
        assert.strictEqual(entrypointFromHead(quoted), 'cli');
    });
});

describe('skipInScan', () => {
    const never = () => { throw new Error('head read'); };

    test('with the tab state unknown, the scan skips nothing and reads no head', () => {
        assert.strictEqual(skipInScan('aaa', null, never), false);
    });

    test('skips an open session without reading its head: it is read by id', () => {
        assert.strictEqual(skipInScan('aaa', new Set(['aaa']), never), true);
    });

    test('skips a closed IDE session: it would be dropped anyway', () => {
        assert.strictEqual(skipInScan('bbb', new Set(['aaa']), () => CLAUDE_IDE_ENTRYPOINT), true);
    });

    test('keeps a terminal or Desktop session, and one whose head records no entrypoint', () => {
        assert.strictEqual(skipInScan('bbb', new Set(['aaa']), () => 'cli'), false);
        assert.strictEqual(skipInScan('bbb', new Set(['aaa']), () => 'claude-desktop'), false);
        assert.strictEqual(skipInScan('bbb', new Set(['aaa']), () => ''), false);
    });
});
