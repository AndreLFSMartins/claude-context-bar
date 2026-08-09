import { test, describe } from 'node:test';
import assert from 'node:assert';
import { encodeProjectPath, belongsToWorkspace, isScheduledTask } from './sessionFilter';

describe('encodeProjectPath', () => {
    test('encodes an absolute path the way Claude Code names its project dirs', () => {
        assert.strictEqual(
            encodeProjectPath('/Users/andre/Documents/Obsidian/AndreMartins'),
            '-Users-andre-Documents-Obsidian-AndreMartins'
        );
    });

    test('collapses nothing: every non-alphanumeric char becomes its own dash', () => {
        // A literal dash in a folder name and a path separator are indistinguishable
        // after encoding. That ambiguity is Claude Code's, and we mirror it exactly.
        assert.strictEqual(
            encodeProjectPath('/Users/andre/Documents/GitHub/Tools/ormah'),
            '-Users-andre-Documents-GitHub-Tools-ormah'
        );
    });

    test('encodes a leading dot directory into a double dash', () => {
        assert.strictEqual(encodeProjectPath('/Users/andre/.claude'), '-Users-andre--claude');
    });

    test('strips a trailing separator so the encoding matches the project dir', () => {
        assert.strictEqual(
            encodeProjectPath('/Users/andre/Documents/GitHub/'),
            '-Users-andre-Documents-GitHub'
        );
    });
});

describe('belongsToWorkspace', () => {
    const vault = encodeProjectPath('/Users/andre/Documents/Obsidian/AndreMartins');
    const github = encodeProjectPath('/Users/andre/Documents/GitHub');

    test('keeps the session whose project dir is exactly the workspace root', () => {
        assert.strictEqual(
            belongsToWorkspace('-Users-andre-Documents-Obsidian-AndreMartins', [vault]),
            true
        );
    });

    test('keeps a session running in a subdirectory of the workspace root', () => {
        assert.strictEqual(
            belongsToWorkspace('-Users-andre-Documents-GitHub-Tools-ormah', [github]),
            true
        );
    });

    test('rejects a sibling directory that merely shares the root as a string prefix', () => {
        // /Users/andre/Documents/GitHubOutro must NOT match /Users/andre/Documents/GitHub.
        // This is why the check requires an exact match or a following dash.
        assert.strictEqual(
            belongsToWorkspace('-Users-andre-Documents-GitHubOutro', [github]),
            false
        );
    });

    test('rejects another window workspace (the whole point of the filter)', () => {
        assert.strictEqual(
            belongsToWorkspace('-Users-andre-Documents-GitHub-Tools-ormah', [vault]),
            false
        );
    });

    test('rejects a scratchpad under /private/tmp when the workspace is the vault', () => {
        assert.strictEqual(
            belongsToWorkspace('-private-tmp-claude-501--Users-andre-Documents-GitHub-Tools-ormah-abc-scratchpad', [vault]),
            false
        );
    });

    test('keeps everything when the window has no workspace folder open', () => {
        // Fail open: a window with no folder should not lose its status bar entirely.
        assert.strictEqual(belongsToWorkspace('-Users-andre-Documents-GitHub-Tools-ormah', []), true);
    });

    test('keeps a session matching any root of a multi-root workspace', () => {
        assert.strictEqual(
            belongsToWorkspace('-Users-andre-Documents-GitHub-Tools-ormah', [vault, github]),
            true
        );
    });
});

describe('isScheduledTask', () => {
    test('detects a scheduled task by its opening tag', () => {
        assert.strictEqual(
            isScheduledTask('<scheduled-task name="dream-do-obsidian" file="/Users/a'),
            true
        );
    });

    test('tolerates leading whitespace before the tag', () => {
        assert.strictEqual(isScheduledTask('\n  <scheduled-task name="x"'), true);
    });

    test('does not flag a normal prompt', () => {
        assert.strictEqual(
            isScheduledTask('Como ver o context ocupado qdo usando a extensão do cla'),
            false
        );
    });

    test('does not flag a prompt that merely mentions the words', () => {
        assert.strictEqual(isScheduledTask('what is a scheduled-task in cron?'), false);
    });

    test('treats an unreadable first message as a real session', () => {
        // Empty firstMessage means we could not read one, which is not evidence
        // of a scheduled task. Fail open rather than hide a real tab.
        assert.strictEqual(isScheduledTask(''), false);
    });
});
