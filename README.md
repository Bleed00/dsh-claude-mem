# dsh-claude-mem

A [DeepSeek Harness](https://github.com/deepseek-ai) plugin that integrates [claude-mem](https://github.com/thedotmack/claude-mem): query persisted cross-session memory, inject per-project context at session start, save manual memories, and drive session summarization — all through a local claude-mem worker's HTTP API.

[![npm](https://img.shields.io/npm/v/@bleed00/dsh-claude-mem?label=npm&logo=npm)](https://www.npmjs.com/package/@bleed00/dsh-claude-mem)
[![npm downloads](https://img.shields.io/npm/dm/@bleed00/dsh-claude-mem?logo=npm)](https://www.npmjs.com/package/@bleed00/dsh-claude-mem)
[![GitHub](https://img.shields.io/badge/github-Bleed00%2Fdsh--claude--mem-181717?logo=github)](https://github.com/Bleed00/dsh-claude-mem)
[![CI](https://github.com/Bleed00/dsh-claude-mem/actions/workflows/ci.yml/badge.svg)](https://github.com/Bleed00/dsh-claude-mem/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520.12-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-dsh--plugin-4D6BFE)](https://github.com/deepseek-ai)
[![dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-555555)](https://github.com/topics/dsh-plugin)

It registers the model-facing tools `mem_search`, `mem_timeline`, `mem_get_observations`, `mem_save`, and `mem_context`, the `mem-search` skill, and the lifecycle hooks (`agent/session-start` context injection, optional `tools/post-execute` ingestion, optional `agent/turn-stopping` summarization). It is a single self-contained package with no monorepo-only dependencies.

## Install

One-liner with `npx` (no global install — `npx` fetches the `dsh` launcher and
`dsh plugin` forwards `add` to pnpm in the target profile):

```sh
npx -y @deepseek-ai/dsh plugin --profile demo add @bleed00/dsh-claude-mem
```

If you already have `dsh` on `PATH`, the same command without `npx`:

```sh
dsh plugin --profile demo add @bleed00/dsh-claude-mem
```

**npm** (recommended — ships prebuilt `lib/`, no build permission needed):

```sh
npx -y @deepseek-ai/dsh plugin --profile demo add @bleed00/dsh-claude-mem
```

**GitHub** (sources; runs a `prepare` build on first install):

```sh
npx -y @deepseek-ai/dsh plugin --profile demo add github:Bleed00/dsh-claude-mem
```

A GitHub install fetches sources, not build output, so pnpm runs this package's `prepare` script to build from `src/`. pnpm ≥10 refuses to run a git dependency's `prepare` until it is allowlisted; the first `add` fails and points at the fix — copy the exact package key pnpm printed into the profile's `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  '@bleed00/dsh-claude-mem': true
```

then re-run the `add`. Treat that allowance as permission to run this package's code at install time; pin a commit for reproducible installs:

```sh
dsh plugin --profile demo add github:Bleed00/dsh-claude-mem#<sha>
```

**Local checkout**:

```sh
dsh plugin --profile demo add ./dsh-claude-mem
```

## Requirements

- A [DeepSeek Harness](https://github.com/deepseek-ai) installation with `dsh` on `PATH`.
- The claude-mem worker already running on its default port (`http://127.0.0.1:37700`). Override with the `baseUrl` config or the `DSH_MEM_BASE_URL` environment variable.

## Config

| Field | Default | Description |
|---|---|---|
| `baseUrl` | `http://127.0.0.1:<37700 + uid % 100>` | Worker base URL. |
| `timeoutMs` | `30000` | Per-request timeout (ms). |
| `dedupe` | `true` | Collapse duplicate observations in query results (content fingerprint, never identity). |
| `platformSource` | unset | Optional platform filter; omitted = search all memory. |
| `project` | unset | Project name; defaults to the session cwd basename. |
| `injectContext` | `true` | Inject session-start context. |
| `ingest` | `false` | Save observed tool results as memories. |
| `summarize` | `false` | Summarize sessions on turn stop. |
| `toolFilter.names` | `read, write, edit, bash` | Tools observed when `ingest` is true. |

Platform scoping is a **signal, never a restriction**: default requests are unfiltered, and `platformSource` only adds an opt-in filter.

### Duplicate handling

The worker can persist the same observation many times (a boilerplate "session
initiated" record, or a re-run tool result) — identical content, different `id`.
With `dedupe: true` (the default), query results collapse those copies: an
observation's **content fingerprint** is built from `title` + `subtitle` +
`text` + `narrative` + `facts` (normalized), so two entries that merely share a
generated title but differ in narrative are kept. The first copy (lowest `id`)
is retained. Structured results (`mem_get_observations`) are deduplicated by
fingerprint; rendered index/text results are deduplicated by exact rendered
row. Set `dedupe: false` to see the raw, unfiltered results.

### Example override in the profile's `cordis.patch.yml`

```yaml
- id: claude-mem
  config:
    baseUrl: http://127.0.0.1:37700
    platformSource: dsh
    ingest: true
    summarize: true
```

## Tools

| Tool | Purpose |
|---|---|
| `mem_search` | Search memory; returns an index (ids, titles, types). |
| `mem_timeline` | Get context around one observation. |
| `mem_get_observations` | Fetch full details for ids. |
| `mem_save` | Save one manual memory. |
| `mem_context` | Render the worker's session-start context text. |

The `mem-search` skill teaches the model the `search → filter → fetch` workflow that keeps token usage low.

## Development

```sh
pnpm install
pnpm run build   # tsc + tsdown → lib/index.js
pnpm test
```

The package targets Node ≥ 20.12, TypeScript 6.0, and is authored against the `@deepseek-ai/*` framework packages (cordis, schemastery, dsh-tools, dsh-llm, dsh-skill, dsh-agent).

## License

[Apache-2.0](LICENSE) © Bleed00
