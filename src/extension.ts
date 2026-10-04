import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import { execFileSync } from 'child_process';
import { getContextLimitForModel } from './contextLimit';
import { getUsage, UsageData, UsageMeter } from './usage';
import { encodeProjectPath, belongsToWorkspace, isScheduledTask } from './sessionFilter';
import { resolveClickAction, CLAUDE_REVEAL_COMMAND } from './revealSession';
import { buildItemLabel } from './tabLabel';
import { filterToOpenTabs } from './openTabMatch';
import { deriveProjectName } from './projectName';
import { groupAndNumberSessions } from './sessionGroups';
import { extractUserPromptText } from './userPromptText';
import { parseOpenSessions, keepOpenSessions, OpenSession } from './claudeTabState';
import { resolveOpenSessionFiles, entrypointFromHead, skipInScan, HEAD_BYTES } from './openSessionFiles';

interface SessionInfo {
    projectName: string;
    projectPath: string;
    sessionId: string;
    fullSessionId: string;
    entrypoint: string;
    lastPrompt: string;
    aiTitle: string;
    customTitle: string;
    derivedPrompt: string;
    sessionFile: string;
    inputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    totalTokens: number;
    percentage: number;
    lastUpdated: Date;
    model: string;
    contextLimit: number;
    firstMessage: string;
    sessionCreated: Date | null;
    wasCleared: boolean;
    /** Listed in this window's tab state (see sessionGroups.ts). */
    open: boolean;
}

interface StatusBarEntry {
    item: vscode.StatusBarItem;
    sessionFile: string;
}

const statusBarItems: Map<string, StatusBarEntry> = new Map();
// Session files whose text matched an open tab on the PREVIOUS refresh. It is
// what buys a session one refresh of grace when its .jsonl title outruns its
// tab label — see filterToOpenTabs() in openTabMatch.ts.
let matchedOpenTabs: ReadonlySet<string> = new Set();
let fileWatcher: fs.FSWatcher | null = null;

// The Claude Code tab state of THIS window (see claudeTabState.ts). The
// database is re-read only when its mtime moves. A failed stat or sqlite3
// read is not cached, so the next refresh retries it; content that does not
// parse is cached like any other read. Each cause of "unknown" is logged once.
const TAB_STATE_FILE = 'state.vscdb';
let tabStateDb: string | null = null;
let tabStateCache: { mtimeMs: number; sessions: OpenSession[] | null } | null = null;
const loggedTabStateCauses = new Set<string>();
let tabStateWatcher: fs.FSWatcher | null = null;
// Open session id → its .jsonl, from the previous refresh (openSessionFiles.ts).
let openSessionFileCache: Map<string, string> = new Map();
let refreshInterval: NodeJS.Timeout | null = null;

// Subscription usage shown in a single
// status bar item to the right of the per-tab context items.
let usageItem: vscode.StatusBarItem | null = null;
let usageData: UsageData | null = null;
let usageInterval: NodeJS.Timeout | null = null;

const STATUS_BAR_PRIORITY_BASE = 900;
const ITEM_CLAUDE_ICON = '✴️';

export function activate(context: vscode.ExtensionContext) {
    console.log('Claude Context Bar is now active');

    // Clicking a status bar item opens that session's Claude Code tab in this window.
    // The command it delegates to is private API of the Claude Code extension, so its
    // presence is checked every time and a missing command degrades to a message.
    const revealCommand = vscode.commands.registerCommand(
        'claudeContextBar.revealSession',
        async (fullSessionId: string, entrypoint: string) => {
            const available = (await vscode.commands.getCommands(true)).includes(CLAUDE_REVEAL_COMMAND);
            const action = resolveClickAction({ sessionId: fullSessionId, entrypoint }, available);

            if (action.kind === 'reveal') {
                await vscode.commands.executeCommand(CLAUDE_REVEAL_COMMAND, action.sessionId);
            } else {
                vscode.window.showInformationMessage(action.message);
            }
        }
    );
    context.subscriptions.push(revealCommand);

    // Listen for configuration changes and refresh immediately
    const configWatcher = vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('claudeContextBar')) {
            refreshAllSessions();
            refreshUsageData();
        }
    });
    context.subscriptions.push(configWatcher);

    // Rescan when the window regains focus so returning to a session
    // restores its bar as soon as fresh activity lands in the session file
    const focusWatcher = vscode.window.onDidChangeWindowState(state => {
        if (state.focused) {
            refreshAllSessions();
        }
    });
    context.subscriptions.push(focusWatcher);

    // Rescan when a tab opens, closes or retitles itself. The open-tab filter
    // reads tab labels, and a Claude Code tab retitles itself after the .jsonl
    // write that triggered the refresh — so without this the bar carried a
    // stale judgement until the next timer tick.
    const tabWatcher = vscode.window.tabGroups.onDidChangeTabs(() => {
        refreshAllSessions();
    });
    context.subscriptions.push(tabWatcher);

    // VS Code places storageUri at workspaceStorage/<hash>/<extension id>, so
    // its parent is this window's own <hash> directory. No workspace open →
    // no storageUri → the tab state is unknown and the title heuristic runs.
    tabStateDb = context.storageUri
        ? path.join(path.dirname(context.storageUri.fsPath), TAB_STATE_FILE)
        : null;
    console.log(`Claude Context Bar: tab state database ${tabStateDb ?? '(none: no workspace open)'}`);

    // A tab opened or closed rewrites the database about a second later
    // (measured 2026-10-04), so watching it redraws the bar without waiting
    // for the timer. The directory is watched, filtered to the one file.
    if (tabStateDb) {
        try {
            tabStateWatcher = fs.watch(path.dirname(tabStateDb), (event, filename) => {
                // filename can be null on some platforms: refresh rather than miss it.
                if (!filename || filename === TAB_STATE_FILE) {
                    refreshAllSessions();
                }
            });
        } catch (e) {
            console.error('Failed to set up tab state watcher:', e);
        }
    }

    // Initial scan
    refreshAllSessions();
    refreshUsageData();

    // Set up file watcher
    const claudeProjectsDir = getClaudeProjectsDir();
    if (fs.existsSync(claudeProjectsDir)) {
        try {
            fileWatcher = fs.watch(claudeProjectsDir, { recursive: true }, (event, filename) => {
                if (filename?.endsWith('.jsonl')) {
                    refreshAllSessions();
                }
            });
        } catch (e) {
            console.error('Failed to set up file watcher:', e);
        }
    }

    // Set up periodic refresh
    const config = vscode.workspace.getConfiguration('claudeContextBar');
    const intervalSeconds = config.get<number>('refreshInterval', 30);
    refreshInterval = setInterval(refreshAllSessions, intervalSeconds * 1000);
    const usageIntervalSeconds = config.get<number>('usageRefreshInterval', 60);
    usageInterval = setInterval(refreshUsageData, usageIntervalSeconds * 1000);

    // Clean up on deactivation
    context.subscriptions.push({
        dispose: () => {
            if (fileWatcher) {
                fileWatcher.close();
            }
            tabStateWatcher?.close();
            if (refreshInterval) {
                clearInterval(refreshInterval);
            }
            if (usageInterval) {
                clearInterval(usageInterval);
            }
            statusBarItems.forEach(entry => entry.item.dispose());
            statusBarItems.clear();
            usageItem?.dispose();
            usageItem = null;
        }
    });
}

export function deactivate() {
    if (fileWatcher) {
        fileWatcher.close();
    }
    tabStateWatcher?.close();
    if (refreshInterval) {
        clearInterval(refreshInterval);
    }
    if (usageInterval) {
        clearInterval(usageInterval);
    }
    statusBarItems.forEach(entry => entry.item.dispose());
    statusBarItems.clear();
    usageItem?.dispose();
    usageItem = null;
}

function getClaudeProjectsDir(): string {
    const homeDir = os.homedir();
    return path.join(homeDir, '.claude', 'projects');
}

function decodeProjectPath(encodedName: string): { name: string; fullPath: string } {
    // Claude encodes paths like: C--dev-my-cool-project or -Users-name-work-my-project
    // The double-dash after drive letter represents the colon (C: -> C--)
    // Single dashes represent path separators, BUT folder names can also contain dashes
    // 
    // Strategy: Detect OS from the pattern and reconstruct path
    let decoded = encodedName;

    // Remove leading dash if present
    if (decoded.startsWith('-')) {
        decoded = decoded.substring(1);
    }

    // Split by dashes and filter out empty strings (from double-dashes)
    const parts = decoded.split('-').filter(p => p.length > 0);
    let fullPath: string;
    let projectName: string;

    // Check if Windows pattern (first part is single drive letter like 'c', 'd', etc.)
    if (parts.length > 0 && parts[0].length === 1 && /[a-zA-Z]/.test(parts[0])) {
        // Windows path: C:\dev\my-cool-project
        // Claude typically encodes as: C--dev-my-cool-project
        // After filtering empty strings: ['C', 'dev', 'my', 'cool', 'project']
        fullPath = parts[0].toUpperCase() + ':\\' + parts.slice(1).join('\\');

        // Project name: use last few segments only (not full path chain)
        // For C:\dev\webapp -> parts = ['C', 'dev', 'webapp'] -> projectName = 'webapp'
        // For C:\dev\tools\extensions\vscode\my-extension -> use last 3 parts -> 'my-extension'
        if (parts.length >= 3) {
            // Skip drive letter and first folder, but limit to last 3 segments for deeply nested paths
            const startIndex = Math.max(2, parts.length - 3);
            const projectParts = parts.slice(startIndex);
            projectName = projectParts.join('-');
        } else {
            projectName = parts[parts.length - 1] || 'Unknown';
        }
    } else {
        // Unix path: /Users/Ed/work/my-project
        fullPath = '/' + parts.join('/');

        // Similar heuristic for Unix
        if (parts.length >= 3) {
            // Skip common prefixes like Users, home, etc.
            const projectParts = parts.slice(Math.max(2, parts.length - 3));
            projectName = projectParts.join('-');
        } else {
            projectName = parts[parts.length - 1] || 'Unknown';
        }
    }

    return { name: projectName, fullPath };
}

interface TokenUsage {
    inputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    totalTokens: number;
    model: string;
    firstMessage: string;
    sessionCreated: Date | null;
    wasCleared: boolean;  // True if session ended with /clear command
    entrypoint: string;   // 'claude-vscode' | 'cli' | 'sdk-cli' | 'claude-desktop' | ''
    lastPrompt: string;   // Latest user prompt — what the Claude Code tab shows until a title exists
    aiTitle: string;      // AI-generated session title — what the tab shows once generated ('' before that)
    customTitle: string;  // Name set with /rename — what the tab shows once set, over the AI title
    derivedPrompt: string; // Latest prompt read from the messages, for sessions that emit neither line
    cwd: string;          // Working directory the session runs in, as recorded on its lines
}

// Fuzzy emoji matching based on project name
function getEmojiForProject(projectName: string): string {
    const name = projectName.toLowerCase();

    // Emoji mappings with keywords
    const emojiMap: [string[], string][] = [
        // Music & Audio
        [['music', 'audio', 'sound', 'song', 'beat', 'dj', 'ableton', 'daw', 'synth', 'midi', 'tone', 'rhythm'], '🎵'],
        // Games
        [['game', 'play', 'unity', 'unreal', 'godot', 'arcade', 'puzzle'], '🎮'],
        // Web & Frontend
        [['web', 'website', 'frontend', 'react', 'vue', 'angular', 'html', 'css', 'ui', 'ux'], '🌐'],
        // Backend & API
        [['api', 'backend', 'server', 'rest', 'graphql', 'microservice'], '⚙️'],
        // Mobile
        [['mobile', 'ios', 'android', 'app', 'flutter', 'react-native', 'swift', 'kotlin'], '📱'],
        // Data & ML
        [['data', 'ml', 'ai', 'machine', 'learning', 'model', 'train', 'neural', 'tensor'], '🤖'],
        // Database
        [['database', 'db', 'sql', 'mongo', 'postgres', 'mysql', 'redis'], '🗄️'],
        // DevOps & Cloud
        [['devops', 'cloud', 'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'k8s', 'deploy'], '☁️'],
        // Security
        [['security', 'auth', 'crypto', 'encrypt', 'password', 'oauth'], '🔐'],
        // Testing
        [['test', 'spec', 'jest', 'mocha', 'cypress', 'selenium'], '🧪'],
        // Documentation
        [['doc', 'docs', 'readme', 'wiki', 'guide', 'tutorial'], '📚'],
        // Tools & Extensions
        [['tool', 'extension', 'plugin', 'vscode', 'editor'], '🔧'],
        // Chat & Communication
        [['chat', 'message', 'slack', 'discord', 'bot'], '💬'],
        // Finance
        [['finance', 'money', 'payment', 'bank', 'crypto', 'trade'], '💰'],
        // Health
        [['health', 'medical', 'fitness', 'workout'], '❤️'],
        // E-commerce
        [['shop', 'store', 'ecommerce', 'cart', 'product'], '🛒'],
        // Media & Video
        [['video', 'stream', 'youtube', 'media', 'film', 'movie'], '🎬'],
        // Art & Design
        [['art', 'design', 'draw', 'paint', 'sketch', 'creative', 'graphic'], '🎨'],
    ];

    for (const [keywords, emoji] of emojiMap) {
        for (const keyword of keywords) {
            if (name.includes(keyword)) {
                return emoji;
            }
        }
    }

    // Default brain emoji for coding/AI projects
    return '🧠';
}

// Extract the last syllable from a word for compact naming
// "typescript" → "script", "webpack" → "pack", "frontend" → "tend"
function extractLastSyllable(word: string): string {
    // Find a consonant cluster followed by vowel(s) followed by optional consonants at the end
    // This captures common syllable patterns like "tron", "script", "pack"
    const match = word.match(/[bcdfghjklmnpqrstvwxz]+[aeiou]+[bcdfghjklmnpqrstvwxz]*$/i);
    if (match) {
        return match[0];
    }
    // Fallback: just return last 3-4 chars
    return word.slice(-Math.min(4, word.length));
}

// Generate a short name for a project
// Multi-word: "my-cool-project" → "MCP" (acronym)
// Single-word: "typescript" → "Tscript" (first letter + last syllable)
// Short names (≤3 chars) are kept as-is
// Session numbers (-2, -3) are preserved
function getShortName(projectName: string, customNames: Record<string, string>): string {
    // Check custom override first (check both full name and base name)
    if (customNames[projectName]) {
        return customNames[projectName];
    }

    // Extract session number suffix if present (e.g., "my-project-2" → "-2")
    const sessionMatch = projectName.match(/-(\d+)$/);
    const sessionSuffix = sessionMatch ? sessionMatch[0] : '';
    const baseName = sessionMatch ? projectName.slice(0, -sessionSuffix.length) : projectName;

    // Check custom override for base name too
    if (customNames[baseName]) {
        return customNames[baseName] + sessionSuffix;
    }

    // If base name is already short (5 chars or less), don't shorten
    if (baseName.length <= 5) {
        return projectName;
    }

    // Split on common delimiters (dash, underscore, space) or camelCase boundaries
    const words = baseName.split(/[-_\s]|(?=[A-Z])/).filter(w => w.length > 0);

    let shortBase: string;
    if (words.length > 1) {
        // Multi-word: create acronym from first letter of each word
        shortBase = words.map(w => w[0]?.toUpperCase() || '').join('');
    } else {
        // Single-word: first letter uppercase + last syllable
        const lastSyllable = extractLastSyllable(baseName);
        shortBase = baseName[0].toUpperCase() + lastSyllable;
    }

    return shortBase + sessionSuffix;
}

async function getLatestTokenCount(jsonlPath: string): Promise<TokenUsage> {
    return new Promise((resolve) => {
        try {
            const stats = fs.statSync(jsonlPath);
            if (stats.size === 0) {
                resolve({ inputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 0, model: '', firstMessage: '', sessionCreated: null, wasCleared: false, entrypoint: '', lastPrompt: '', aiTitle: '', customTitle: '', derivedPrompt: '', cwd: '' });
                return;
            }

            // Read the file
            const content = fs.readFileSync(jsonlPath, 'utf-8');
            const lines = content.trim().split('\n');

            // Scan backwards to find the last /clear command AND check for user activity after it
            let lastClearIndex = -1;
            let userMessagesAfterClear = 0;

            for (let i = lines.length - 1; i >= 0; i--) {
                const line = lines[i];
                if (!line.trim()) continue;
                try {
                    const entry = JSON.parse(line);

                    // Check for User message
                    if (entry.type === 'user' && entry.message?.content) {
                        const msgContent = entry.message.content;

                        // Check for /clear command
                        if (typeof msgContent === 'string' && msgContent.includes('<command-name>/clear</command-name>')) {
                            lastClearIndex = i;
                            break; // Found the latest clear, stop scanning
                        }

                        // If not clear, it's a user message after the clear point (since we're going backwards)
                        userMessagesAfterClear++;
                    }
                } catch (e) {
                    continue;
                }
            }

            // Determine if session is effectively cleared
            // It is cleared IF:
            // 1. We found a /clear command
            // 2. AND there are NO user messages after it (meaning the user hasn't continued the session yet)
            const wasCleared = (lastClearIndex !== -1 && userMessagesAfterClear === 0);

            // Calculate usage and finding first message starting from AFTER the clear
            const startIndex = lastClearIndex >= 0 ? lastClearIndex + 1 : 0;

            let firstMessage = '';
            let sessionCreated: Date | null = null;
            let model = '';
            let entrypoint = '';
            let lastPrompt = '';
            let aiTitle = '';
            let customTitle = '';
            let derivedPrompt = '';
            let cwd = '';
            let finalUsage ={ inputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 0 };

            // Forward pass from start index to find metadata and latest usage
            for (let i = startIndex; i < lines.length; i++) {
                const line = lines[i];
                if (!line.trim()) continue;
                try {
                    const entry = JSON.parse(line);

                    // Get session creation timestamp (first valid timestamp after clear)
                    if (!sessionCreated && entry.timestamp) {
                        sessionCreated = new Date(entry.timestamp);
                    }

                    // Session origin. Present on nearly every user/assistant/attachment
                    // line, so the pass that starts after the last /clear still sees it.
                    if (!entrypoint && typeof entry.entrypoint === 'string') {
                        entrypoint = entry.entrypoint;
                    }

                    // Latest prompt wins: the Claude Code tab retitles itself on
                    // every message, so the last one is what the tab is showing.
                    if (entry.type === 'last-prompt' && typeof entry.lastPrompt === 'string') {
                        lastPrompt = entry.lastPrompt;
                    }

                    // AI-generated session title (present since ~2026-08-09).
                    // Once it exists the tab shows it instead of the prompt.
                    // Latest wins: it is re-emitted after messages and can be
                    // regenerated after a /clear (scan already starts there).
                    if (entry.type === 'ai-title' && typeof entry.aiTitle === 'string') {
                        aiTitle = entry.aiTitle;
                    }

                    // Name the user set with /rename. It outranks the AI title
                    // on the tab itself, so it outranks it here too. Latest
                    // wins: /rename can run again.
                    // ponytail: only the in-transcript line is read. Claude
                    // Code also keeps a `<sessionId>/custom-title.json`
                    // sidecar. Read the sidecar too the moment a session
                    // turns up with one and no matching transcript line.
                    //
                    // The ceiling is worse than a stale label, and was
                    // reproduced against these modules on 2026-09-18: with a
                    // sidecar-only renamed session beside a normally renamed
                    // one, the second makes detectionLooksReliable() true,
                    // the filter switches on, and the sidecar-only session —
                    // still open — is dropped from the bar. The one refresh of
                    // grace filterToOpenTabs() now gives it delays that drop;
                    // it does not prevent it, because the tab never retitles
                    // to anything the transcript records.
                    //
                    // Not fixed because the state does not occur here: of 187
                    // sessions, 2 carry a sidecar and BOTH also carry the
                    // line, with the same value (checked 2026-09-18). The
                    // sidecar looks like a mirror, not a fallback.
                    if (entry.type === 'custom-title' && typeof entry.customTitle === 'string') {
                        customTitle = entry.customTitle;
                    }

                    // Working directory of the session itself. A subagent
                    // running in a worktree records its own cwd, so only the
                    // main thread's lines count — the first one wins.
                    if (!cwd && typeof entry.cwd === 'string' && entry.isSidechain !== true) {
                        cwd = entry.cwd;
                    }

                    // Latest typed prompt, recovered from the messages for
                    // sessions that never emit a last-prompt line (bridged
                    // ones). Latest wins, matching how the tab retitles itself.
                    // isMeta marks content a skill or hook injected as if the
                    // user had sent it, so it never reaches the label.
                    if (entry.type === 'user' && entry.isSidechain !== true &&
                        entry.isMeta !== true && entry.message?.content) {
                        const typed = extractUserPromptText(entry.message.content);
                        if (typed) {
                            derivedPrompt = typed;
                        }
                    }

                    // Look for first user message (for display)
                    if (!firstMessage && entry.type === 'user' && entry.message?.content) {
                        const msgContent = entry.message.content;
                        // Skip command-related messages
                        if (typeof msgContent === 'string' &&
                            !msgContent.includes('<command-name>') &&
                            !msgContent.includes('<local-command-') &&
                            !msgContent.includes('Caveat:')) {
                            firstMessage = msgContent.substring(0, 60);
                        } else if (Array.isArray(msgContent) && msgContent[0]?.text) {
                            firstMessage = msgContent[0].text.substring(0, 60);
                        }
                    }

                    // Update latest usage/model as we go (capturing the last valid usage report)
                    if (entry.message?.model) {
                        model = entry.message.model;
                    }
                    if (entry.message?.usage || entry.usage) {
                        const u = entry.message?.usage || entry.usage;
                        finalUsage = {
                            inputTokens: u.input_tokens || 0,
                            cacheReadTokens: u.cache_read_input_tokens || 0,
                            cacheCreationTokens: u.cache_creation_input_tokens || 0,
                            totalTokens: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)
                        };
                    }
                } catch (e) {
                    continue;
                }
            }

            resolve({
                inputTokens: finalUsage.inputTokens,
                cacheReadTokens: finalUsage.cacheReadTokens,
                cacheCreationTokens: finalUsage.cacheCreationTokens,
                totalTokens: finalUsage.totalTokens,
                model,
                firstMessage: firstMessage ? firstMessage + '...' : '',
                sessionCreated,
                wasCleared,
                entrypoint,
                lastPrompt,
                aiTitle,
                customTitle,
                derivedPrompt,
                cwd
            });

        } catch (e) {
            resolve({ inputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 0, model: '', firstMessage: '', sessionCreated: null, wasCleared: false, entrypoint: '', lastPrompt: '', aiTitle: '', customTitle: '', derivedPrompt: '', cwd: '' });
        }
    });
}

/**
 * Titles of the Claude Code tabs currently open in this window. Empty when
 * none are open, or when reading tabGroups throws for any reason (an
 * unexpected VS Code API failure should never crash a refresh cycle).
 */
function getOpenClaudeTabTitles(): string[] {
    try {
        const titles: string[] = [];
        for (const group of vscode.window.tabGroups.all) {
            for (const tab of group.tabs) {
                if (tab.input instanceof vscode.TabInputWebview &&
                    tab.input.viewType.includes('claudeVSCodePanel')) {
                    titles.push(tab.label);
                }
            }
        }
        return titles;
    } catch (e) {
        console.error('Claude Context Bar: failed to read open tabs:', e);
        return [];
    }
}

function tabStateUnknown(cause: string, error?: unknown): null {
    if (!loggedTabStateCauses.has(cause)) {
        loggedTabStateCauses.add(cause);
        console.warn(`Claude Context Bar: tab state unknown, matching open tabs by title instead: ${cause}`, error ?? '');
    }
    return null;
}

/**
 * The sessions with a Claude Code tab open in this window, or null when that
 * cannot be known. Synchronous on purpose: the database changes only when a
 * tab opens, closes or retitles, so the read is rare, and a synchronous read
 * cannot let an older refresh render after a newer one.
 */
function readOpenSessions(): OpenSession[] | null {
    if (!tabStateDb) {
        return tabStateUnknown('no workspace open (context.storageUri is undefined)');
    }
    let mtimeMs: number;
    try {
        mtimeMs = fs.statSync(tabStateDb).mtimeMs;
    } catch (e) {
        return tabStateUnknown(`cannot stat ${tabStateDb}`, e);
    }
    if (tabStateCache?.mtimeMs === mtimeMs) {
        return tabStateCache.sessions;
    }

    let raw: string;
    try {
        raw = execFileSync(
            '/usr/bin/sqlite3',
            ['-readonly', tabStateDb, "select value from ItemTable where key='Anthropic.claude-code'"],
            { timeout: 2000, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }
        );
    } catch (e) {
        // Missing binary, locked database or timeout: unknown for this refresh only.
        return tabStateUnknown('sqlite3 read failed', e);
    }

    // sqlite3 prints nothing when the key is absent.
    const value = raw.trim() === '' ? undefined : raw;
    const sessions = parseOpenSessions(value);
    tabStateCache = { mtimeMs, sessions };
    if (!sessions) {
        return tabStateUnknown(value === undefined
            ? 'key Anthropic.claude-code is missing'
            : 'Anthropic.claude-code is not JSON or has no panelTabSessions array');
    }
    return sessions;
}

/** The entrypoint the head of a session file records, or "" (openSessionFiles.ts). */
function readHeadEntrypoint(file: string): string {
    let fd: number | undefined;
    try {
        fd = fs.openSync(file, 'r');
        const head = Buffer.alloc(HEAD_BYTES);
        const bytes = fs.readSync(fd, head, 0, HEAD_BYTES, 0);
        return entrypointFromHead(head.toString('utf-8', 0, bytes));
    } catch {
        return '';
    } finally {
        if (fd !== undefined) {
            fs.closeSync(fd);
        }
    }
}

function toSessionInfo(
    file: string,
    mtime: Date,
    usage: TokenUsage,
    open: boolean,
    contextLimit: number,
    modelContextLimits: Record<string, number>
): SessionInfo {
    // The encoded directory name cannot say which dashes are path separators,
    // so the cwd the session recorded names the project when it is available.
    const { name, fullPath } = decodeProjectPath(path.basename(path.dirname(file)));
    // Short session ID for display only — the Claude Code command needs the
    // full id, kept separately.
    const fullSessionId = path.basename(file, '.jsonl');
    // Auto-detect context limit based on model
    const sessionContextLimit = getContextLimitForModel(usage.model, contextLimit, modelContextLimits);
    return {
        projectName: deriveProjectName(usage.cwd, name),
        projectPath: usage.cwd || fullPath,
        sessionId: fullSessionId.substring(0, 8),
        fullSessionId,
        entrypoint: usage.entrypoint,
        lastPrompt: usage.lastPrompt,
        aiTitle: usage.aiTitle,
        customTitle: usage.customTitle,
        derivedPrompt: usage.derivedPrompt,
        sessionFile: file,
        inputTokens: usage.inputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheCreationTokens: usage.cacheCreationTokens,
        totalTokens: usage.totalTokens,
        percentage: Math.round((usage.totalTokens / sessionContextLimit) * 100),
        lastUpdated: mtime,
        model: usage.model,
        contextLimit: sessionContextLimit,
        firstMessage: usage.firstMessage,
        sessionCreated: usage.sessionCreated,
        wasCleared: usage.wasCleared,
        open
    };
}

async function findActiveSessions(): Promise<SessionInfo[]> {
    const sessions: SessionInfo[] = [];
    const claudeDir = getClaudeProjectsDir();

    if (!fs.existsSync(claudeDir)) {
        return sessions;
    }

    const config = vscode.workspace.getConfiguration('claudeContextBar');
    const contextLimit = config.get<number>('contextLimit', 200000);
    const modelContextLimits = config.get<Record<string, number>>('modelContextLimits', {});
    const idleTimeout = config.get<number>('idleTimeout', 180);
    const onlyCurrentWindow = config.get<boolean>('onlyCurrentWindow', true);
    const showScheduledTasks = config.get<boolean>('showScheduledTasks', false);

    // Workspace roots of THIS window, in Claude's encoded form. Empty when the
    // filter is off or the window has no folder open, which keeps every session.
    const encodedRoots = onlyCurrentWindow
        ? (vscode.workspace.workspaceFolders ?? []).map(f => encodeProjectPath(f.uri.fsPath))
        : [];

    // Only look at sessions modified within the idle timeout (active sessions)
    // idleTimeout of 0 (or negative) disables the timeout: sessions never go stale
    const cutoffTime = idleTimeout > 0 ? Date.now() - (idleTimeout * 1000) : 0;

    // Read before the scan: when it is known, open sessions are read by id
    // below, and the scan leaves every IDE session to that path.
    const openSessions = onlyCurrentWindow ? readOpenSessions() : null;
    const openIds = openSessions ? new Set(openSessions.map(s => s.sessionId)) : null;

    try {
        const projectDirs = fs.readdirSync(claudeDir);

        for (const projectDir of projectDirs) {
            const projectPath = path.join(claudeDir, projectDir);
            const stat = fs.statSync(projectPath);

            if (!stat.isDirectory()) continue;

            // Skip Claude Memory and plugin directories (background agents, not interactive sessions)
            if (projectDir.includes('claude-plugins') || projectDir.includes('claude-mem')) continue;

            // Skip projects belonging to another window's workspace
            if (!belongsToWorkspace(projectDir, encodedRoots)) continue;

            // Find JSONL files modified within cutoff time
            const files = fs.readdirSync(projectPath)
                .filter(f => f.endsWith('.jsonl'))
                // Skip agent files (claude-mem background processes)
                .filter(f => !f.startsWith('agent-'))
                .map(f => ({
                    name: f,
                    path: path.join(projectPath, f),
                    mtime: fs.statSync(path.join(projectPath, f)).mtime
                }))
                .filter(f => f.mtime.getTime() > cutoffTime)
                .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

            if (files.length === 0) continue;

            // Get token count from EACH active session file (1 per Claude Code tab)
            for (const file of files) {
                // With the tab state known, an open session is read by id
                // below and a closed IDE session is dropped anyway, so neither
                // is parsed here (openSessionFiles.ts).
                if (skipInScan(path.basename(file.name, '.jsonl'), openIds, () => readHeadEntrypoint(file.path))) continue;

                const usage = await getLatestTokenCount(file.path);

                if (usage.totalTokens > 0) {
                    // Scheduled/background runs are sessions but not tabs; they
                    // otherwise compete with real tabs for status bar slots.
                    if (!showScheduledTasks && isScheduledTask(usage.firstMessage)) continue;

                    sessions.push(toSessionInfo(file.path, file.mtime, usage, false, contextLimit, modelContextLimits));
                }
            }
        }
    } catch (e) {
        console.error('Error scanning Claude projects:', e);
    }

    // Each open session is shown however long it sat idle, wherever its file
    // lives, at 0% if it has no usage yet and even right after a /clear: the
    // tab state proves it is open, so none of the scan's guesses apply.
    if (openSessions) {
        try {
            openSessionFileCache = resolveOpenSessionFiles(
                openSessions.map(s => s.sessionId),
                openSessionFileCache,
                () => fs.readdirSync(claudeDir).map(d => path.join(claudeDir, d)),
                fs.existsSync
            );
        } catch (e) {
            console.error('Error resolving open Claude Code sessions:', e);
            // The previous map may hold ids closed since: never reuse it.
            openSessionFileCache = new Map();
        }
        for (const file of openSessionFileCache.values()) {
            let mtime: Date;
            try {
                mtime = fs.statSync(file).mtime;
            } catch {
                continue; // deleted since it was resolved
            }
            const usage = await getLatestTokenCount(file);
            sessions.push(toSessionInfo(file, mtime, usage, true, contextLimit, modelContextLimits));
        }
    }

    // A session file can stay within idleTimeout after its actual Claude Code
    // tab has been closed. onlyCurrentWindow means every real tab for these
    // sessions must be in *this* window's tabGroups, so cross-check against
    // what's genuinely open and drop the rest — instead of waiting out
    // idleTimeout while showing a stale prompt as if it were the current tab.
    //
    // When the Claude Code tab state is readable it decides, by session id
    // (claudeTabState.ts), and the title heuristic below does not run.
    // Otherwise only IDE sessions are judged by title, and a session gets one
    // refresh of grace — both decided in openTabMatch.ts, which explains why.
    let liveSessions = sessions;
    if (openSessions) {
        liveSessions = keepOpenSessions(sessions, openSessions);
        // Grace is for a match on the PREVIOUS refresh; one from before the
        // tab state became readable must not carry over if it turns unknown.
        matchedOpenTabs = new Set();
    } else if (onlyCurrentWindow) {
        const { kept, matchedNow } = filterToOpenTabs(
            sessions,
            getOpenClaudeTabTitles(),
            (s) => s.sessionFile,
            matchedOpenTabs
        );
        matchedOpenTabs = matchedNow;
        liveSessions = kept;
    }

    // Grouping, supersession and numbering are one pure decision — see
    // sessionGroups.ts for why the key is the project PATH, not its name.
    const finalSessions = groupAndNumberSessions(liveSessions);

    // Sort by mtime for display order (most recent first)
    finalSessions.sort((a, b) => b.lastUpdated.getTime() - a.lastUpdated.getTime());

    // Cap the list, but make the cap visible instead of silently truncating:
    // a dropped session used to vanish with no trace, so a tab sitting at 80%
    // could be invisible. maxItems <= 0 means no cap.
    const maxItems = config.get<number>('maxItems', 12);
    if (maxItems > 0 && finalSessions.length > maxItems) {
        console.warn(
            `Claude Context Bar: showing ${maxItems} of ${finalSessions.length} active sessions ` +
            `(raise claudeContextBar.maxItems to see the rest)`
        );
        return finalSessions.slice(0, maxItems);
    }
    return finalSessions;
}

function formatTokens(tokens: number): string {
    if (tokens >= 1000000) {
        return (tokens / 1000000).toFixed(1) + 'M';
    } else if (tokens >= 1000) {
        return Math.round(tokens / 1000) + 'K';
    }
    return tokens.toString();
}

async function refreshAllSessions() {
    const sessions = await findActiveSessions();
    const config = vscode.workspace.getConfiguration('claudeContextBar');
    const warningThreshold = config.get<number>('warningThreshold', 50);
    const dangerThreshold = config.get<number>('dangerThreshold', 75);
    const contextLimit = config.get<number>('contextLimit', 200000);
    const autoColor = config.get<boolean>('autoColor', true);
    const baseColor = config.get<string>('baseColor', 'White');
    const showEmoji = config.get<boolean>('showEmoji', true);
    const compactMode = config.get<boolean>('compactMode', false);
    const shortNames = config.get<Record<string, string>>('shortNames', {});
    const tabNameLength = config.get<number>('tabNameLength', 6);

    // Pastel color palette for auto-coloring
    const pastelPalette = [
        '#a8d8ea', // Soft blue
        '#d4a5a5', // Dusty rose
        '#b5d8c7', // Sage green
        '#e8d5b7', // Warm beige
        '#c9b1ff', // Lavender
        '#ffd6a5', // Peach
        '#caffbf', // Mint
        '#bdb2ff', // Periwinkle
        '#ffc6ff', // Pink
    ];

    // Base color variations (subtle shifts from user's chosen color)
    const baseColorVariations: Record<string, string[]> = {
        'White': ['#ffffff', '#f5f5f5', '#ebebeb', '#e0e0e0', '#d5d5d5'],
        'Blue': ['#a8d8ea', '#9ecfe0', '#94c6d6', '#8abccc', '#80b2c2'],
        'Purple': ['#c9b1ff', '#bfa7f5', '#b59deb', '#ab93e1', '#a189d7'],
        'Cyan': ['#a0e7e5', '#96ddd9', '#8cd3cd', '#82c9c1', '#78bfb5'],
        'Green': ['#b5d8c7', '#abcebd', '#a1c4b3', '#97baa9', '#8db09f'],
        'Yellow': ['#ffeaa7', '#f5e09d', '#ebd693', '#e1cc89', '#d7c27f'],
        'Orange': ['#ffd6a5', '#f5cc9b', '#ebc291', '#e1b887', '#d7ae7d'],
        'Pink': ['#ffc6ff', '#f5bcf5', '#ebb2eb', '#e1a8e1', '#d79ed7'],
    };

    // Track project names to assign consistent colors
    const projectColorMap = new Map<string, string>();
    let colorIndex = 0;

    if (autoColor) {
        // Auto mode: use pastel palette
        for (const session of sessions) {
            if (!projectColorMap.has(session.projectName)) {
                projectColorMap.set(session.projectName, pastelPalette[colorIndex % pastelPalette.length]);
                colorIndex++;
            }
        }
    } else {
        // Manual mode: use variations of the base color
        const variations = baseColorVariations[baseColor] || baseColorVariations['White'];
        for (const session of sessions) {
            if (!projectColorMap.has(session.projectName)) {
                projectColorMap.set(session.projectName, variations[colorIndex % variations.length]);
                colorIndex++;
            }
        }
    }

    // Track which sessions we've seen
    const seenPaths = new Set<string>();

    // Sessions are sorted newest-first, so reverse for oldest-left display
    // For Left alignment: higher priority = further left
    for (let i = 0; i < sessions.length; i++) {
        const session = sessions[i];
        seenPaths.add(session.sessionFile);

        let entry = statusBarItems.get(session.sessionFile);

        if (!entry) {
            // Create new status bar item - Right align, very high priority to appear LEFT of Claude's items
            // Higher priority = further left on right-aligned items. Context items stack
            // above the usage item (STATUS_BAR_PRIORITY_BASE), so they sit to its left.
            const priority = STATUS_BAR_PRIORITY_BASE + (sessions.length - i);
            const item = vscode.window.createStatusBarItem(
                vscode.StatusBarAlignment.Right,
                priority
            );
            entry = { item, sessionFile: session.sessionFile };
            statusBarItems.set(session.sessionFile, entry);
        }

        // Update the status bar item with fuzzy emoji matching
        const icon = showEmoji ? getEmojiForProject(session.projectName) : '';
        const iconSpace = showEmoji ? ' ' : '';
        // The project name only names the project; two tabs of the same one are
        // told apart by the text their Claude Code tab is titled with.
        const projectLabel = compactMode ? getShortName(session.projectName, shortNames) : session.projectName;
        const displayName = buildItemLabel({
            customTitle: session.customTitle,
            aiTitle: session.aiTitle,
            lastPrompt: session.lastPrompt,
            derivedPrompt: session.derivedPrompt,
            fallbackName: projectLabel,
            length: tabNameLength
        });
        entry.item.text = `${icon}${iconSpace}${displayName}: ${session.percentage}%`;

        // Set background color based on thresholds
        if (session.percentage >= dangerThreshold) {
            entry.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        } else if (session.percentage >= warningThreshold) {
            entry.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        } else {
            entry.item.backgroundColor = undefined;
        }

        // Set text color from project color map
        entry.item.color = projectColorMap.get(session.projectName) || '#ffffff';

        // Detailed tooltip with full token breakdown and first message
        const firstMsgLine = session.firstMessage ? `💬 *"${session.firstMessage}"*\n\n` : '';
        entry.item.tooltip = new vscode.MarkdownString(
            `**${session.projectName}** (${session.sessionId})\n\n` +
            firstMsgLine +
            `📁 \`${session.projectPath}\`\n\n` +
            `🤖 Model: \`${session.model || 'Unknown'}\`\n\n` +
            `📊 **Context Usage: ${session.percentage}%**\n\n` +
            `| Type | Tokens |\n|------|--------|\n` +
            `| Cache Read | ${formatTokens(session.cacheReadTokens)} |\n` +
            `| Cache Creation | ${formatTokens(session.cacheCreationTokens)} |\n` +
            `| **Total** | **${formatTokens(session.totalTokens)}** / ${formatTokens(session.contextLimit)} |\n\n` +
            `🕐 Last updated: ${session.lastUpdated.toLocaleTimeString()}\n\n` +
            `*Click to open this tab*`
        );

        // Click to open this session's Claude Code tab
        entry.item.command = {
            command: 'claudeContextBar.revealSession',
            title: 'Open Claude Code Tab',
            arguments: [session.fullSessionId, session.entrypoint]
        };

        entry.item.show();
    }

    // Remove status bar items for sessions that are no longer active
    for (const [sessionFile, entry] of statusBarItems) {
        if (!seenPaths.has(sessionFile)) {
            entry.item.dispose();
            statusBarItems.delete(sessionFile);
        }
    }

    // Render the usage item to the right of the context items.
    renderUsageItem();
}

// Render the single global usage item (e.g. "✴️ 7%") to the right of the context items.
function renderUsageItem() {
    const config = vscode.workspace.getConfiguration('claudeContextBar');
    const showUsage = config.get<boolean>('showUsage', false);

    if (!showUsage || !usageData?.session) {
        usageItem?.dispose();
        usageItem = null;
        return;
    }

    const warningThreshold = config.get<number>('usageWarningThreshold', 50);
    const dangerThreshold = config.get<number>('usageDangerThreshold', 75);

    if (!usageItem) {
        // Priority just below the context items (which start at 901) so this
        // sits immediately to their right, still left of Claude Code's own items.
        usageItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, STATUS_BAR_PRIORITY_BASE);
    }

    const session = usageData.session;
    usageItem.text = `${ITEM_CLAUDE_ICON} ${session.percentage}%`;

    if (session.percentage >= dangerThreshold) {
        usageItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else if (session.percentage >= warningThreshold) {
        usageItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
        usageItem.backgroundColor = undefined;
    }

    usageItem.tooltip = buildUsageTooltip(usageData);
    usageItem.show();
}

function formatReset(resetsAt: Date | null): string {
    if (!resetsAt) {
        return '';
    }
    const msLeft = resetsAt.getTime() - Date.now();
    if (msLeft <= 0) {
        return ' — resetting';
    }
    const hours = Math.floor(msLeft / 3_600_000);
    const days = Math.floor(hours / 24);
    const rel = days >= 1 ? `${days}d` : hours >= 1 ? `${hours}h` : `${Math.max(1, Math.round(msLeft / 60_000))}m`;
    return ` — resets in ${rel}`;
}

function buildUsageTooltip(data: UsageData): vscode.MarkdownString {
    const rows = data.meters
        .map((m: UsageMeter) => `| ${m.label} | **${m.percentage}%** | ${formatReset(m.resetsAt).replace(/^ — /, '')} |`)
        .join('\n');

    return new vscode.MarkdownString(
        `⚡ **Claude Usage**\n\n` +
        `| Limit | Used | Resets |\n|------|------|------|\n` +
        rows +
        `\n\n*Subscription rate limits (\`/usage\`)*`
    );
}

let usageFetchInFlight = false;

// Version of the Claude Code extension running in this same IDE, used for the
// usage request's User-Agent. This is the relevant client version (not any CLI on PATH).
function getClaudeCodeVersion(): string | null {
    return vscode.extensions.getExtension('anthropic.claude-code')?.packageJSON?.version ?? null;
}

async function refreshUsageData() {
    const config = vscode.workspace.getConfiguration('claudeContextBar');
    const showUsage = config.get<boolean>('showUsage', false);

    if (!showUsage) {
        usageData = null;
        renderUsageItem();
        return;
    }

    // The usage endpoint rate-limits aggressive polling; never overlap calls.
    if (usageFetchInFlight) {
        return;
    }
    usageFetchInFlight = true;
    try {
        const fetched = await getUsage(getClaudeCodeVersion());
        // Keep the last successful value on a transient failure rather than flicker.
        if (fetched) {
            usageData = fetched;
        }
    } catch (e) {
        console.error('Failed to fetch Claude usage:', e);
    } finally {
        usageFetchInFlight = false;
    }

    renderUsageItem();
}
