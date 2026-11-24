# usage-left

A Claude Code mod that shows, under the text box, how much of your 5-hour session
limit is left and when it resets, plus which git worktree the session is in.

Example (the repository, ticket and PR number are made up):

```
⎇ PROJ-1234-example (fix/PROJ-1234-example)  iOS  Web    PROJ-1234    PR #1234 open
Opus 5.5 (high): ███░░░░░░░░░░░░░░░░░ 86% left · Resets 1:50 PM
```

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install usage-left --marketplace crystaldonut/usage-left
```

Answer `y` to add the marketplace, then pick a scope (the user scope loads the
mod in every session). The bars appear right away, with no reload.

From a shell:

```sh
claude plugin install usage-left --marketplace crystaldonut/usage-left
```

In the desktop app, where `/plugin` does not run: click + next to the prompt
box, then Plugins, Add marketplace with `crystaldonut/usage-left`, then Add
plugin.

Needs Claude Code 2.1.275 or later.

## What each part means

**Worktree line** (only when the session is inside a linked git worktree)

| Part | Meaning |
| --- | --- |
| `⎇ name (branch)` | The worktree folder name, and its branch when the two differ. |
| Colored tags | Which product the branch changes, from the files changed compared with `origin/main` (uncommitted changes included), using that repository's list in `areas.json`. A branch that changes two products gets two tags; files outside every product give the repository's fallback tag. With no changes yet, the tag is guessed from words in the branch name. |
| Ticket | The ticket in the branch name, matched and linked as that repository's `ticket` entry in `areas.json` says. |
| `PR #nnnn state` | The branch's pull request and its state (open, draft, merged, closed); clicking it opens the PR. |

**Usage line**

| Part | Meaning |
| --- | --- |
| `Opus 5.5 (high)` | The session's current model and effort level. Its bar is the 5-hour session limit, with the clock time it resets. |

Bar colors: green while under 70% used, yellow from 70%, red from 90%.

## Configuring products per repository

Without any setup, the worktree line shows the repository name as a grey tag
and no ticket link. To get product tags and ticket links, write an `areas.json`
with one entry per repository.

The mod looks for the file in these places and uses the first one it finds:

1. `~/.claude/usage-left/areas.json` (or `$CLAUDE_CONFIG_DIR/usage-left/areas.json`
   when that variable is set). Use this one for an installed mod: it survives
   updates.
2. `areas.json` in the mod's own folder. This suits a mod run from a checkout;
   an installed mod's folder is replaced on every update.

[`areas.sample.json`](areas.sample.json) shows every option with made-up
repositories: a monorepo keyed by `owner/repo`, a repo keyed by name with a
Linear ticket link, and a `"*"` catch-all. Copy it to start your own:

```sh
mkdir -p ~/.claude/usage-left
curl -fsSL https://raw.githubusercontent.com/crystaldonut/usage-left/main/areas.sample.json \
  -o ~/.claude/usage-left/areas.json
```

```json
{
  "repos": {
    "my-org/my-monorepo": {
      "fallback": { "name": "monorepo", "color": "#94a3b8" },
      "areas": [
        { "name": "iOS", "color": "#a855f7", "paths": ["apps/ios/"], "branchWords": ["ios", "mobile"] }
      ],
      "ticket": { "pattern": "PROJ-\\d+", "url": "https://my-org.atlassian.net/browse/{ticket}" }
    }
  }
}
```

| Field | Meaning |
| --- | --- |
| repo key | Which repository the entry is for: `owner/repo` from the `origin` remote (`my-org/my-monorepo`), or just the repo name (`my-monorepo`), or the main checkout's folder name. `"*"` applies to any repository without its own entry. |
| `fallback` | The tag shown when the changed files belong to no product, or nothing matches. Left out: the repo name in grey. |
| `areas[].paths` | Folder prefixes, from the repository root, that belong to the product. |
| `areas[].branchWords` | Words in the branch name that point to the product when nothing has changed yet. |
| `areas[].color` | The tag's background color, as `#rrggbb`. |
| `ticket` | Optional. `pattern` is a regular expression found in the branch name; `{ticket}` in `url` is replaced by what it matched. Left out: no ticket link. |

The file is read again on every refresh, so an edit shows after the next reply,
with no reload. A missing file or invalid JSON leaves just the repo-name tag.

## Where the numbers come from

| Figure | Source | How often |
| --- | --- | --- |
| 5-hour limit | The rate-limit figures Claude Code gives mods after each reply (`five_hour`). | After each reply |
| Model and effort | The session's model requests. | Each request |
| Worktree, tags, ticket | `git` in the session's folder. | Session start, after each reply, when entering or leaving a worktree |
| Pull request | `gh pr list --head <branch>`. | At most every 2 minutes |

## What the mod reaches

Everything the mod does outside drawing its two lines:

- Runs `git` (read-only commands) and `gh pr list` in the session's folder.
- Reads `areas.json` and the `HOME` and `CLAUDE_CONFIG_DIR` environment variables.

It sends nothing anywhere else and writes no files.

## Known limits

- Nothing can be placed above the `auto mode on` label: Claude Code draws it
  outside the line the mod can change.
- The PR link needs `gh` installed and logged in to an account that can see the
  repository.
- Product tags compare against `origin/main`; a repository whose main branch
  has another name gets tags from uncommitted changes and the branch name only.
- Reset times are shown on a 12-hour clock.

## Working on the mod

Run it from a checkout, for one session:

```sh
git clone https://github.com/crystaldonut/usage-left
claude --plugin-dir ./usage-left
```

Or for every session, name the folder in the `env` block of
`~/.claude/settings.json`:

```json
"CLAUDE_CODE_PLUGIN_DIRS": "/absolute/path/to/usage-left"
```

An open session reloads the mod by itself when a file in the folder is saved.

| File | What it holds |
| --- | --- |
| `.claude-plugin/plugin.json` | Name, version, description, author, license. |
| `.claude-plugin/marketplace.json` | Lets this repository be installed from directly. |
| `hooks/hooks.json` | Points Claude Code at `register.tsx`. |
| `hooks/register.tsx` | All the mod's code. |
| `types/index.d.ts` | The shape of the values the mod keeps between redraws. |
| `areas.sample.json` | An example `areas.json` with every option. |
| `tsconfig.json` | Extends the types Claude Code writes into `.claude-plugin/types/` when it loads the mod (git-ignored). |

Check a change:

```sh
claude plugin validate .
npx tsc -p . --noEmit
```

## License

[MIT](LICENSE)
