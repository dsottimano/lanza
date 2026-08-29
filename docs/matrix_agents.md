# Matrix agents — parallel worktrees, one tmux window each

How the lead session (the Claude Dave talks to) opens other terminals, puts an
agent in each, and drives them. Written 2026-08-29, after building and testing it
end to end.

**The shape:** Dave talks to ONE lead session in its own terminal, outside tmux.
Workers live in a tmux session called `lanza`, one window per git worktree, each
running its own Claude plus its own dev server. The lead sees them, messages them,
and creates more.

---

## The command

`~/.zsh/lanza-wt.zsh`, sourced from `~/.zshrc`. Backup of the pre-change zshrc is
at `~/.zshrc.bak.lz`.

```sh
lz                             # attach; creates the session with a plain-shell 'main' window
lz shell editor brand          # a worktree + window for each name, then attach
lz -m sonnet -e low editor     # same, choosing model and effort for those workers
lz -k shell                    # remove one worktree and close its window
```

`-m` takes `opus`/`sonnet`/`fable` or a full model name, `-e` takes
`low|medium|high|xhigh|max`. Both are omitted from the command line when unset, so
Dave's configured defaults apply.

**Worktree, branch and window are stable per name; the session address is not.**
`lz editor` always uses `../lanza-editor` on `ui/editor` in a window called `editor`,
so work survives a restart — but the Claude session is named `editor-7f3a`, with a
fresh random suffix each launch. The name IS the address, and a stale one collides
after a kill and respawn. So read the current address from `ListAgents`; never
hardcode it.

Each worker window:

```
┌──────────────────────────────────────┐
│  claude --dangerously-skip-permissions│  75%
│  -n <name>   (cwd = ../lanza-<name>)  │
├──────────────────────────────────────┤
│  lz_dev  ->  npm ci + npm run dev     │  25%
└──────────────────────────────────────┘
```

- Worktrees land at `../lanza-<name>` on branch `ui/<name>`, cut from the current
  local `main`.
- `admin/.env` is copied in. It is gitignored, and **without it the dev gh-proxy is
  dead** in that worktree.
- `lz_dev` installs only what is missing, root and `admin/` concurrently, with
  `--prefer-offline`. Re-running `lz` on an existing window leaves it alone.
- The `main` window is a **plain shell on purpose** — git, builds, logs. A second
  Claude there would start cold and drift from what the lead knows.

## What the lead can do from outside tmux

All of this works from the lead's own terminal, with Dave attached or not:

```sh
tmux ls                                     # is the session up, is he attached
tmux list-panes -a -F '#{session_name}:#{window_name}.#{pane_index} #{pane_current_command} #{pane_current_path}'
tmux capture-pane -p -t lanza:<name>.0      # read what a worker's screen shows
tmux capture-pane -p -t lanza:<name>.1      # read its dev server output
zsh -c 'source ~/.zsh/lanza-wt.zsh; lz <name>'   # open a NEW worker window
```

The trailing `attach` fails with `open terminal failed: not a terminal` when the
lead runs `lz`. That is harmless and expected — the window is still created, and it
appears live in Dave's attached session.

## Addressing the workers

Each worker registers as a peer session named by its `-n` flag.

- `ListAgents` lists them with their tmux coordinates (`tmux lanza:@1.%1`) and
  whether each is idle or busy.
- `SendMessage` with `to: "<name>"` delivers; the worker processes it whether or
  not Dave is looking at that window, and replies come back to the lead.
- **The name IS the address**, so names must be unique on the machine. `lz` handles
  this with the random suffix; take the live name from `ListAgents` each time.
- **Identical replies get dropped as duplicates at the receiver's inbox.** A worker
  that answers a bare "done" or "ack" twice has the second silently collapsed —
  observed 2026-08-29 in an ack test. Tell workers to make every reply distinct
  (their own name plus what they finished), which matters most when several report
  at once.
- **Round trip is ~5s**, one model turn each way; transport is negligible. Treat
  workers as colleagues, not RPC: batch instructions rather than chatting.
- **Use `notify_when_idle: true` on SendMessage** to learn when a worker is done —
  one-shot, no polling, and strictly better than watching its pane.

## Facts established by testing, so they are not re-derived

- **No trust prompt.** `--dangerously-skip-permissions` skips the workspace trust
  dialog, including in a sibling worktree the session has never seen. There is
  nothing to pre-seed in `~/.claude.json`.
- **Ports never collide.** `scripts/dev.mjs` probes for free ports on BOTH loopbacks
  and names each process after its folder, so `pgrep -af lanza-try-admin` finds a
  specific worktree's server without guessing a port.
- **`pane_current_command` lies right after launch** — it reports `zsh` for a second
  or two while Claude boots, and npm can leave a pane's `pane_current_path` pointing
  somewhere odd. Trust `capture-pane`, not the format strings.
- **Claude Code has `--worktree` and `--tmux=classic` built in.** Tested, works, no
  trust prompt, bases the worktree on `origin/main`. Not used here because it opens a
  SEPARATE tmux session per worktree, gives no dev-server pane, and creates
  `.claude/worktrees/` inside the repo — which is **not gitignored** and shows up as
  untracked. Worth reaching for only if throwaway isolation is the whole goal.
- **`~/.tmux.conf` was created by this work** with `focus-events on` (Claude Code
  asks for it) and `escape-time 10` (the 500ms default makes ESC, Claude's interrupt
  key, feel broken).

## How to split work across workers

The terminals are the easy part. The split is what decides whether this pays off.

1. **One session alone first** for anything shared — the design pass on
   `admin/src/styles.css` and the `ui/` primitives. Merge to `main` BEFORE fanning
   out, or you get one visual language per worker and a merge that eats the day.
2. **Then fan out by view, not by concern.** Each worker owns its files outright; no
   two touch one file. Natural seams in `admin/src/`: shell (`App.vue`,
   `ui/Sidebar.vue`), editor (`editor/*`, `ui/EditorView.vue`, `ui/PreviewPane.vue`),
   settings (`ui/BrandView.vue`, `ui/ContentTypesView.vue`, `ui/SiteHealthView.vue`,
   `ui/UpdatesView.vue`).
3. **After step 1, `styles.css` is off-limits to everyone.** A worker needing a new
   token comes back to the lead.

Two repo rules every worker must be told, because a reskin breaks them silently:
`admin/src/schema.ts` is the content model, not a UI file — do not let a restyle
touch it; and per CLAUDE.md rule 6, anything touching field paths, the template
renderer or the preview reads `docs/review-surface.md` first (`FieldForm.test.ts`
pins the form and the engine together).

## Teardown

```sh
lz -k <name>          # worktree + window, one worker
tmux kill-server      # everything
git worktree list     # confirm nothing is left behind
```

`lz -k` refuses to remove a worktree with uncommitted work and says so. That is
deliberate.
