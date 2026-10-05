# Claude Context Bar

A status bar that shows how full the context window is for each Claude Code conversation the user has open in this VS Code window.

## Language

**Session**:
One Claude Code conversation, stored as one `.jsonl` file whose name is the session id.
_Avoid_: conversation, chat, file

**IDE session**:
A session started from the Claude Code VS Code extension, as opposed to one started from a terminal or the Desktop app.
_Avoid_: VS Code session, tab session

**Window**:
One VS Code window, which has exactly one workspace open.
_Avoid_: instance, editor

**Tab state**:
The Claude Code extension's own record of which sessions are open as editor tabs in a window.
_Avoid_: tab list, open tabs, workspace state

**Open session**:
A session the window's tab state lists. It is shown on the bar whatever its age or usage, including at 0% when it has no file yet. A session shown only in the Claude Code sidebar is not an open session.
_Avoid_: active session, live session, visible tab

**Bar item**:
One status bar entry, standing for one session.
_Avoid_: badge, indicator
