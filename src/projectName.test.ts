import { describe, it } from 'node:test';
import assert from 'node:assert';
import { deriveProjectName } from './projectName';

describe('deriveProjectName', () => {
    it('names the project after the folder the session runs in', () => {
        assert.strictEqual(
            deriveProjectName('/Users/andre/Documents/GitHub/Tools/ormah', 'GitHub-Tools-ormah'),
            'ormah'
        );
    });

    it('keeps dashes that belong to the folder name', () => {
        // The encoded directory name cannot tell these dashes from separators,
        // which is exactly why the recorded cwd is preferred over it.
        assert.strictEqual(
            deriveProjectName('/Users/andre/Documents/GitHub/claude-context-bar', 'GitHub-claude-context-bar'),
            'claude-context-bar'
        );
    });

    it('tolerates a trailing separator', () => {
        assert.strictEqual(deriveProjectName('/Users/andre/work/webapp/', 'work-webapp'), 'webapp');
    });

    it('handles Windows paths', () => {
        assert.strictEqual(deriveProjectName('C:\\dev\\my-cool-project', 'dev-my-cool-project'), 'my-cool-project');
    });

    it('falls back when the session recorded no cwd', () => {
        assert.strictEqual(deriveProjectName('', 'GitHub-Tools-ormah'), 'GitHub-Tools-ormah');
        assert.strictEqual(deriveProjectName(undefined, 'GitHub-Tools-ormah'), 'GitHub-Tools-ormah');
    });

    it('falls back when the cwd has no usable last segment', () => {
        assert.strictEqual(deriveProjectName('/', 'fallback'), 'fallback');
        assert.strictEqual(deriveProjectName('   ', 'fallback'), 'fallback');
    });
});
