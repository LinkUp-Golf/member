Autopilot: pick up the next ready ClickUp task and run it to a PR. One iteration.

This command processes **one** task per invocation. Drive it continuously with the
`/loop` skill in an interactive session (where the ClickUp MCP is authenticated):

```
/loop /clickup-autopilot
```

## Configuration

- **SPACE**: `Linkup Golf Projects`
- **LIST**: `Linkup Golf App`  (this is the LinkUp project list)
- **READY_STATUS**: the ClickUp status that means "ready for autonomous dev"
  — e.g. `Ready for Dev`. **Set this to the exact status name used in the list.**

> Trigger model: **status only**. Any task in `Linkup Golf App` with
> status = READY_STATUS is eligible. Keep this list curated — every task in it
> with that status will be picked up.

## Steps

1. **Load tools.** Use the **local `clickup` server** (tools prefixed
   `mcp__clickup__`); `ToolSearch` query `clickup` if needed. Always use
   `mcp__clickup__*`, never the `claude_ai_ClickUp` connector (it drops out in
   headless runs). If the `mcp__clickup__*` tools are unavailable, stop and report
   — the loop must not spin without the local MCP.
2. **Find work.** Query LIST for tasks where status = READY_STATUS, oldest first.
   - If none: report "no ready tasks" and stop this iteration (the loop will check
     again on its next tick).
3. **Pick one.** Take the oldest eligible task. To avoid double-processing, skip
   any task that already has an open PR referencing its id
   (`gh pr list --search "<taskId>"`) or whose status is no longer READY_STATUS.
4. **Run it.** Execute the full per-ticket flow defined in
   `.claude/commands/clickup-task.md` for that task id (fetch → branch → implement
   → verify → self-review → PR → hand off). **Process only ONE task this
   iteration**, then stop so the loop stays serial and reviewable.
5. **Report.** Output the task id/title, the outcome (PR opened / Blocked /
   needs-clarification), and the PR URL if any.

## Guardrails (do not override)

- One task at a time; never run tasks in parallel.
- Branch + PR only — **never merge**, never push to `develop`/`main`.
- The verify gate (`npm run lint`, `npm test`, `npm run build`) must pass before a
  PR; on failure, mark the task Blocked with the output and move on next tick.
- Never widen scope beyond the task's acceptance criteria; ask on ClickUp instead.
- If the same task fails twice across iterations, leave it Blocked and skip it.

## Pacing

Let `/loop` self-pace. A long interval is fine — there's no value polling ClickUp
every few seconds; a tick every several minutes keeps it responsive without churn.
