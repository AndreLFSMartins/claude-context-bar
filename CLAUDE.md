# CLAUDE.md

## Project

**Claude Context Bar (fork)** — a VS Code extension (`claude-context-bar-fork`, publisher `andremartins`) that shows real-time context-window usage for Claude Code sessions in the status bar.

Fork of [edenaion/claude-context-bar](https://github.com/edenaion/claude-context-bar). Fork-specific behavior:

- Shows only sessions whose cwd is inside the current window's workspace folders (`onlyCurrentWindow`, default `true`).
- Hides scheduled/background runs (`showScheduledTasks`, default `false`).
- Configurable status bar item cap (`maxItems`, default `12`) instead of a silent hardcoded 5.

## Stack

- **Language:** TypeScript 5 (`strict: true`), target ES2020, `commonjs` modules
- **Runtime:** Node.js (VS Code extension host, engine `^1.74.0`)
- **Package manager:** npm
- **Build:** `tsc` — `src/` → `out/`, entry point `out/extension.js`
- **Tests:** `node --test` (Node built-in test runner) over compiled `out/*.test.js`
- **Dependencies:** none at runtime; devDeps are `typescript`, `@types/node`, `@types/vscode`

## Layout

```text
src/
  extension.ts        # activation, status bar items, session discovery/refresh (largest module)
  contextLimit.ts     # per-model context window sizing + user overrides
  sessionFilter.ts    # window-scoped filtering, scheduled-task exclusion
  usage.ts            # opt-in Claude subscription usage (/usage endpoint)
  debug.ts            # logging / diagnostics
  *.test.ts           # colocated tests, one per module
out/                  # tsc output (generated, not source)
images/               # extension icon and assets
```

## Commands

| Task | Command |
| --- | --- |
| Compile | `npm run compile` |
| Watch | `npm run watch` |
| Test | `npm test` (compiles, then `node --test out/*.test.js`) |
| Package `.vsix` | `npm run package` |
| Publish | `npm run publish` |

**Caveats (verified 2026-08-09):**

- `npm run lint` is declared in `package.json` but **eslint is not installed** and there is no eslint config in the repo — the script fails. There is no working linter; rely on `tsc --strict` and review.
- `npm run package` / `npm run publish` need `vsce`, which is also not in `devDependencies` (use `npx @vscode/vsce`).

## Conventions

- 4-space indentation, double quotes in JSON config; TypeScript files follow the existing style in `src/`.
- Tests are colocated as `<module>.test.ts` and use `node:test` + `node:assert`.
- New user-facing settings go under the `claudeContextBar.*` namespace in `package.json` → `contributes.configuration`, with a `description` that states the default and any opt-in risk.
- `src/extension.ts` is large (~880 lines); prefer extracting new pure logic into its own module with tests rather than growing it.
