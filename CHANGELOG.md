# Changelog

## Unreleased

- Internal: every change to the team and the task list goes through one reducer each (`reduceTeam`, `reduceTasks` in hooks/room/team.ts), and a teammate's state moves only as one table says, by cause and by the state it was in. The hooks hand over events and log a teammate's shutdown from the change it made. Behaviour is unchanged, but the log's "shut down" line now follows the change itself: once per teammate that shuts down by its answer or a notice, none for one already down.

## Liveroom 0.4.0

- **team** panel: an agent team's teammates, those at work first, ● working, ○ idle with how long it has waited, ■ shut down, ✗ failed, with the task each works on; ▣ marks one in a terminal pane of its own. Below them, the last three messages between the lead and its teammates, shutdown and plan answers included, each a summary or first line with credentials masked.
- **tasks** panel: the task list the Task tools keep, work in progress first, then what waits, then the newest done, each with its owner.
- A teammate no longer shows as a finished agent card after its first turn: teammates leave the agent cards for the team panel, so the agents header and the status line's `agents` count leave them out. The status line counts working teammates (`team 1/2`), and the inline summary gives teammates still running a row, showing two agents instead of three when there is one, unless `panels` leaves `team` out.
- A teammate whose spawn names no model and runs on the lead's gets the delegation rule's ⚠ in the team panel and the summary, as an agent card did.
- A teammate stopped without the shutdown handshake, whose turn is cut short and who has left the session's agent list or is listed as ended, shows ■; one interrupted but still running waits. The status line follows a teammate waking or stopping.
- A message or a turn of its own brings back an in-process teammate that stopped, as Claude Code revives it; an idle notice for a turn that ended on an API error marks the teammate failed.
- `/clear` and `/liveroom reset` keep teammates, their ⚠ and the task list, since `/clear` clears only the lead's conversation; the team's messages go, and so does a pane teammate that shut down.
- Teammates in panes of their own run outside the lead's process. Their state is read from their messages and the team's idle, shutdown and termination notices; their plan requests and plan and shutdown answers show as such, and anything else they write, JSON included, as a message. See "What is inferred".
- The team panel shows only the team's messages, between the lead and a teammate or two teammates: SendMessage to or from another session stays out. A plan answer, a shutdown request, or a task assigned to it with TaskUpdate wakes a teammate like a message.
- A session that ends other than by `/clear` (a resume, a branch, an exit) clears its team, as Claude Code brings none of its teammates back; the task list stays.
- Task subjects, task owners and teammates' names are stored with credentials masked, as every other text from a tool input; a name masked that way carries a short digest (`•••#1x2y3z`), so it still finds its own teammate and task, and two names that mask alike stay two teammates.
- A teammate respawned under its address drops its old ⚠ unless the new spawn earns one; the inline summary lists working teammates first.
- A mailbox delivery another mod consumes doesn't count, and one it rewrites is read as rewritten.
- A pane teammate's task completion notice marks its task done on the board, under the subject and owner the notice gives.
- The status line's team total counts every teammate not shut down, a failed one included.
- A session that ends other than by `/clear` takes its teammates' ⚠ notes with them.
- Requires Claude Code 2.1.289 or later, which gives mods teammate spawns.
- The roster never drops a teammate still running: past 24 it drops the ones that shut down earliest, and the team panel shows the latest to shut down, by when they did, not by when they joined.
- The task list keeps 200 tasks by dropping the oldest done; every task in progress or waiting stays, past 200 if it must.
- A teammate whose first step comes before its spawn's answer leaves the other-loops row when it joins, also when it joins while that step's request runs. One whose first turn already ended by then joins waiting, not working.
- A message from another agent or session reaches the log as its tag and sender (`teammate message from scout`), not as your prompt: Claude Code now puts a note before it. A background architect's hand-back behind that note is read as its advice again.
- A pane teammate that writes a plan request or refuses a shutdown is working, as one that writes a message is; one that shut down stays so, whatever arrives from it later.
- A teammate cut short counts as still there only while the agent list gives it a live status (`pending`, `running`, `waiting` or `idle`); any other, one a later Claude Code adds included, shows ■ until a turn of its own brings it back.
- A task assigned and completed (or deleted) in one TaskUpdate leaves its owner waiting.
- A mailbox notice counts only for the teammate whose mailbox sent it: one that names another teammate changes no one.
- A stored team entry that can't be read (after a version change or a broken write) is dropped instead of breaking the pane.
- An assignment notice gives its task the subject it carries, as a completion notice does; a pane teammate may have renamed the task unseen.
- A teammate addressed by its full id in SendMessage reads as its name, so it is woken and its message shows.
- A completion notice changes the board only when its sender is a current teammate: a departed one's late notice after a resume is not this team's.
- The turn receipt counts the teammates a turn spawned among its agents, though they have no card.
- An assignment notice changes the board only when it comes from the lead or a current teammate.
- A task that completes moves after those done before it, so the board's newest done and the 200-task bound follow the order tasks finished in; a TaskList answer keeps that order for the done tasks the pane saw finish.
- A log line's sender for a tagged turn opener is masked as a teammate's name is before it is cut to width.
- A pane teammate's JSON whose `type` is a name every object answers to (`constructor`) shows as its words, not as a protocol message; your own prompt that starts like Claude Code's peer note is logged whole.
- A teammate's row shows a task it owns that waits when it owns none in progress, as a pane teammate's own start never reaches the lead. A TaskList answer puts a task the pane held open and now finds done after the earlier completions.
- A SendMessage or a delivery involving an agent outside the team (an ordinary subagent) stays out of the team panel, even beside a teammate named `agent`.
- A teammate's SendMessage counts for the member whose agent id made it, so a late message from one respawned under its name can't change the replacement.
- The default `panels` lists `team` and `tasks` after `agents`; a custom value keeps its own list. In the wide layout the team panel joins the right column and the tasks panel the left.

## Liveroom 0.3.0

- `language` option: `auto` (the default) follows Claude Code's own `language` setting, Turkish when it reads Turkish and English otherwise; `en` and `tr` pick one.
- Under `tr` the whole pane speaks Turkish: Flightdeck's panels, the log, the status line, `/liveroom` replies, the room panels, the delegation warnings and their toasts. The gate's drill-down keys follow the Turkish labels: `d` `k` `b` for dosya, kabuk, başka.
- Under `tr`, the architect and gate panels are named MİMAR and İZİN unless `architectLabel` or `gateLabel` names them; a label lower-cases the Turkish way only when it has a letter only Turkish has ("mimar", not "mi̇mar"; "revisión", not "revısıón").
- A consult in progress reads "12:03:45'ten beri danışıyor", the suffix following the clock as it is read aloud.
- The agents header's `1-n expand` hint gives way when it can't share the row, and a room panel's header falls back to its short hint (`1 total`), then to none. In English this fixes the codex header at 40 columns, which ran one column over.
- The main panel's title shortens an unknown model id so its working or idle state always shows after a space; `● çalışıyor` runs two columns longer than `● working`. In English this fixes a 21- or 22-character id at 40 columns, which ran over, and a 20-character one, which touched the state.
- The other-loops row keeps Flightdeck's dot count but never runs past its width once its text is longer.
- The inline summary's gate counts turn to marks (`✓7 ?1 ✗2`) when their words would leave less than four cells of strip, so the denied count always shows. The gate panel's totals do the same when their words run past its frame.
- Log lines for tagged turn openers (agent messages, task notifications, commands) name the tag in the pane's language; an unknown tag stays as written.
- Otherwise, English output is unchanged.

## Liveroom 0.2.0

- **codex** panel: work handed to Codex through the `codex:codex-rescue` agent or `codex exec` / `codex review`, with its kind, model, effort and a running clock. It uses the agent cards' status colours: ◐ running, ✓ done, ✗ failed.
- **models** panel: requests per model and effort across the main loop and every subagent.
- **skills** panel: skills called, and plugins used through their skills, agent types and MCP tools. A denied call counts toward nothing.
- Delegation rule: a subagent that names no model and silently runs on the main model gets ⚠ on its card, its lane and its row in the inline summary, and a toast. The ⚠ sits beside the status glyph, so a warned agent still shows ✓ or ✗. An architect agent, which has no card, shows it under its last consult. A subagent's own spawn is said to inherit its parent's model, not the main one. The session keeps the notes of the newest 24 agents, as many as the cards. A Codex hand-off without a model or effort gets ⚠ in the codex panel.
- The default `panels` setting lists the three new panels. A custom `panels` value keeps its own list.
- `delegationRule` option (default on) turns the ⚠ checks off, including warnings recorded before it was switched off.
- Codex calls are read from their own option words: global options before `exec` or `review` work, `-c model=…` is read, and a prompt that mentions `--model` is not mistaken for one. A codex-rescue run ends with its subagent. A `codex exec` in a background shell ends when its task notification arrives, done or failed as it says; one sent off with a trailing `&` shows `◌ bg` and is counted apart from the running ones, since no event says when it ends. A codex followed by another command on its line ends as `■`: the shell's exit status is not its own. So does one behind `||` whose line succeeded, since that success could be the command before it; behind `&&`, a failure counts as codex's. Redirections such as `2>&1` are not separators, here-document lines are not calls, a backslash-newline continues a command, and `codex exec review` counts as a review. Every codex call on a line is its own run, wrappers are read with their options (`env -i`, `timeout -s KILL 30`), a command after a shell keyword counts (`if codex …`, `do codex …`), and a backgrounded codex the line `wait`s for is not detached. A long model id is shortened so the row's status glyph and kind always show. A codex sent off with `&` on a line that failed ends as `■`, since it may never have launched. `codex exec --help` is not a hand-off, `! codex …` ends without a verdict since `!` reverses its exit status, and a rescue's `--model ollama/qwen2.5-coder:32b` is read whole.
- A rescue counts as a consult only when a clause of its own says read-only or no file edits, not when it only spares some files or mentions a read-only field.
- The codex list keeps 30 runs by dropping finished ones first, those without a verdict included; a run still in flight is never dropped.
- The session log leaves room for the new panels, so full room panels don't push the pane past its viewport.

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
