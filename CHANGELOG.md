# Changelog

## Liveroom 0.2.0

- **codex** panel: work handed to Codex through the `codex:codex-rescue` agent or `codex exec` / `codex review`, with its kind, model, effort and a running clock. It uses the agent cards' status colours: ◐ running, ✓ done, ✗ failed.
- **models** panel: requests per model and effort across the main loop and every subagent.
- **skills** panel: skills called, and plugins used through their skills, agent types and MCP tools.
- Delegation rule: a subagent that names no model and silently runs on the main model gets ⚠ on its card, its lane and its row in the inline summary, and a toast. The ⚠ sits beside the status glyph, so a warned agent still shows ✓ or ✗. A Codex hand-off without a model or effort gets ⚠ in the codex panel.
- The default `panels` setting lists the three new panels. A custom `panels` value keeps its own list.
- `delegationRule` option (default on) turns the ⚠ checks off, including warnings recorded before it was switched off.
- Codex calls are read from their own option words: global options before `exec` or `review` work, `-c model=…` is read, and a prompt that mentions `--model` is not mistaken for one. A codex-rescue run ends with its subagent. A `codex exec` in a background shell ends when its task notification arrives, done or failed as it says; one sent off with a trailing `&` shows `◌ bg` and is counted apart from the running ones, since no event says when it ends. A codex followed by another command on its line ends as `■`: the shell's exit status is not its own. Redirections such as `2>&1` are not separators, here-document lines are not calls, a backslash-newline continues a command, and `codex exec review` counts as a review. Every codex call on a line is its own run, wrappers are read with their options (`env -i`, `timeout -s KILL 30`), and a backgrounded codex the line `wait`s for is not detached.
- A rescue counts as a consult only when a clause of its own says read-only or no file edits, not when it only spares some files or mentions a read-only field.
- The codex list keeps 30 runs by dropping finished ones first; a run still in flight is never dropped.

## Liveroom 0.1.0

- Forked from Flightdeck 0.3.2 and renamed: the plugin is `liveroom`, the marketplace `claude-liveroom`, the command `/liveroom`, and settings live under `pluginConfigs["liveroom"]`.
- Session state moved to the `liveroom` namespace, so counters start fresh once after switching from Flightdeck.
- Behaviour is unchanged from Flightdeck 0.3.2.

Entries below are Flightdeck's.

## 0.3.2

- A background architect's advice is read from its `SubagentHandback` tool call, where the report actually arrives, with the hand-back text as a fallback. Bold markers no longer leak into the advice line.
- README: no longer promises that counters survive every update; a change to the state's shape may reset them once.

## 0.3.1

- The main box shows the model and effort as soon as a request starts, not after the first one finishes.
- Advice from a background architect agent (such as `fable-advisor`) now reaches the architect's `»` line; it arrives as a hand-back message, not as the agent's own answer.
- New README media showing the Flightdeck header; plainer wording about opening on start.
- More gate tests (24 in all).

## 0.3.0

First public release.

- Panels: main vitals (context, compactions, cost, rate limits), architect timeline, permission gate strip with per-family drill-down, agent cards and swimlanes, other loops, turn receipt, session log.
- Layouts: docked one- or two-column, and an 8-row inline summary for the main screen. Cards fall back to swimlanes when they don't fit.
- Theme colours by default, with a `pastel` palette option.
- Animated connectors and live clocks as surface modules, only while work flows.
- Works on the terminal, desktop app, VS Code and mobile surfaces.
- Config for the architect pattern, labels, panels, layout, card limit, motion, moments, palette, opening on start and the status line.
- `/clear` and `/flightdeck reset` start the pane fresh; reads tolerate missing or older fields.
