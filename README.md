# dsh-claude-mem

A [DeepSeek Harness](https://github.com/deepseek-ai) plugin that integrates [claude-mem](https://github.com/thedotmack/claude-mem): query persisted cross-session memory, inject per-project context at session start, save manual memories, and drive session summarization — all through a local claude-mem worker's HTTP API.

It registers the model-facing tools `mem_search`, `mem_timeline`, `mem_get_observations`, `mem_save`, and `mem_context`, the `mem-search` skill, and the lifecycle hooks. It is a single self-contained package with no monorepo-only dependencies.

## Install

From a git checkout on the local machine:

```sh
dsh plugin --profile demo add ./dsh-claude-mem
```

From npm (recommended — ships prebuilt `lib/`, no build permission needed):

```sh
dsh plugin --profile demo add @bleed00/dsh-claude-mem
```

From GitHub:

```sh
dsh plugin --profile demo add github:Bleed00/dsh-claude-mem
```

A GitHub install fetches sources, not build output, so pnpm runs this package's `prepare` script to build from `src/`. pnpm ≥10 refuses to run a git dependency's `prepare` until it is allowlisted; the first `add` fails with a message pointing at the fix — copy the exact package key pnpm printed into the profile's `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  '@bleed00/dsh-claude-mem': true
```

then re-run the `add`. Treat that allowance as permission to run this package's code at install time; pin a commit for reproducible installs:

```sh
dsh plugin --profile demo add github:Bleed00/dsh-claude-mem#<sha>
```

## Requirements

The claude-mem worker must already be running on its default port (`http://127.0.0.1:37700`). Override with the `baseUrl` config or the `DSH_MEM_BASE_URL` environment variable.

## Config

| Field | Default | Description |
|---|---|---|
| `baseUrl` | `http://127.0.0.1:<37700 + uid % 100>` | Worker base URL. |
| `timeoutMs` | `30000` | Per-request timeout. |
| `platformSource` | unset | Optional platform filter; omitted = search all memory. |
| `project` | `null` | Project name; defaults to the session cwd basename. |
| `injectContext` | `true` | Inject session-start context. |
| `ingest` | `false` | Save observed tool results as memories. |
| `summarize` | `false` | Summarize sessions on turn stop. |
| `toolFilter.names` | `read, write, edit, bash` | Tools observed when `ingest` is true. |

Platform scoping is a **signal, never a restriction**: default requests are unfiltered, and `platformSource` only adds an opt-in filter.

## License

Apache-2.0.
