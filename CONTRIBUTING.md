# Contributing

Issues and pull requests are welcome.

## Set up

```sh
git clone https://github.com/chelebyy/claude-liveroom
cd claude-liveroom
claude --plugin-dir .
```

Edits to `hooks/` hot-reload in that session when Claude's turn ends.

## Before a pull request

```sh
claude plugin validate --strict .
claude plugin test .
npx -p typescript tsc -p .
```

All three must pass. The type check needs `.claude-plugin/types/`, which Claude Code writes the first time it loads the mod.

CI (`.github/workflows/ci.yml`) runs the first two on every pull request and push to `main`, with Claude Code pinned to the version in the workflow; it needs no login. The type check stays local: its types are written only when a Claude Code session loads the mod, which a CI runner can't do without signing in.

## Ground rules

- **Real data only.** Every number on the pane must come from a session event. If something is inferred, label it in the pane and in the README's "What is inferred" section.
- **Watch, don't act.** Hooks pass their events on unchanged; Liveroom never denies, rewrites or delays anything.
- **Behaviour in `hooks/core.ts`.** Reducers and layout rules are pure functions with tests. `register.tsx` wires them to events and draws.
- **Narrow panes.** Check a drawing change at 40, 64 and 120 columns.
- **No secrets in state.** Anything stored from a tool input goes through `redact()` first.

When you report a bug, include `claude --version` and any dim `liveroom:` line from the transcript.
