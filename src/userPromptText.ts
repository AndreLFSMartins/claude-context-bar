/**
 * Recover what the user typed from a `user` message line.
 *
 * Sessions bridged from claude.ai (`{"type":"bridge-session"}` lines, verified
 * 2026-08-15) carry ordinary user/assistant messages but never emit the
 * `{"type":"last-prompt"}` or `{"type":"ai-title"}` lines the status bar item
 * labels itself with — so those items fell all the way back to the project
 * name. Reading the message content directly gives them the same text.
 *
 * Only what the user actually typed counts: slash-command invocations, the
 * resume caveat, tool results and pasted images are all noise on a status bar
 * item, and injected system reminders are not the user's words at all. The
 * runtime also writes lines of its own as `user` messages — an interruption
 * marker, a background task notification — which read like a prompt but were
 * typed by nobody. Content injected by a skill or a hook is marked
 * `isMeta: true` on the line and is filtered by the caller, which can see it.
 *
 * Pure so the behaviour is testable without a VS Code host, following the same
 * pattern as tabLabel.ts and sessionFilter.ts.
 */

/** Markers that make a message something other than a typed prompt. */
const NOT_A_PROMPT = [
    '<command-name>',
    '<command-message>',
    '<local-command-',
    '<task-notification>',
    '<scheduled-task',
    '[Request interrupted',
    'Caveat:'
];

function cleanText(text: string): string {
    // A prompt is stored with reminders appended around it; drop them and keep
    // the human part.
    const withoutReminders = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
    if (!withoutReminders) {
        return '';
    }
    if (NOT_A_PROMPT.some((marker) => withoutReminders.includes(marker))) {
        return '';
    }
    return withoutReminders;
}

/**
 * @param content  The `message.content` of a `user` line: a plain string, or
 *                 the block array used once the message carries images or tool
 *                 results.
 * @returns The typed prompt, or '' when the message holds none.
 */
export function extractUserPromptText(content: unknown): string {
    if (typeof content === 'string') {
        return cleanText(content);
    }

    if (Array.isArray(content)) {
        for (const block of content) {
            if (block?.type === 'text' && typeof block.text === 'string') {
                const text = cleanText(block.text);
                if (text) {
                    return text;
                }
            }
        }
    }

    return '';
}
