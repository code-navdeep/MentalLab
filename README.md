# Mental Lab

A fully local, single-user macOS research workspace that unifies four
capabilities into one Electron app:

| Mode | What it does |
| --- | --- |
| **Chat** | Ask your indexed notes/documents/papers; answers stream with clickable source citations. Hybrid semantic + keyword search. |
| **Reader** | Import PDFs; read in a split view beside a copilot whose answers quote the paper verbatim and jump-to-page. Highlights, annotations, per-paper notes. |
| **Tasks** | Delegate real work to an agent with sandboxed shell + file tools, skills, scheduled automations, and MCP servers. Dangerous operations gate on your approval. |
| **Vault** | An Obsidian-compatible markdown knowledge vault auto-built from Apple Mail + Apple Calendar, with backlinks and a graph view. |

Everything runs on-device: embedded Postgres (PGlite), local embeddings,
no accounts, no telemetry. AI calls route through user-configured sources —
Apple Intelligence (on-device), Ollama, or OpenAI / DeepSeek / Claude API
keys — via a three-tier difficulty router.

## Prerequisites

- An **Apple Silicon** Mac running macOS 12 or later. Builds are arm64-only;
  Intel Macs are not supported.
- Node.js ≥ 20, npm
- Xcode toolchain with a macOS 26+ SDK — optional, only for the `applekit`
  Swift sidecar (Apple Intelligence + Calendar). The app runs without it;
  those features report "unavailable".

## Development

```bash
npm install
npm run dev        # bundles main/preload/worker, starts Vite, launches Electron
npm run typecheck  # tsc -b across all workspace packages
./scripts/build-sidecar.sh   # build the Swift sidecar (optional)
```

`scripts/dev.mjs` orchestrates everything; renderer changes hot-reload,
main-process changes need a restart.

## Packaging

```bash
npm run package --workspace=apps/main   # unsigned .app in apps/main/out/
npm run make --workspace=apps/main      # .dmg via Electron Forge
```

## Data locations

- `~/Library/Application Support/Mental Lab/` — database (`db/`), imported
  papers (`papers/`), agent skills (`skills/`), embedding model cache
  (`models/`), config.
- Vault: a user-chosen folder of plain Markdown (Obsidian-compatible).
  Synced raw material lives under `<vault>/_sources/`.

## What the agent can reach

Tasks-mode agents work in your home folder by default — `list_files`,
`grep_files` and `shell_command` start there when no path is given. Two gates
constrain that:

- **Reading credentials asks first.** `.ssh`, `.gnupg`, `.aws`, `.env`, shell
  histories and similar paths pause the task for your approval. The list is
  yours to edit in Settings → Agent → Protected paths.
- **Writing outside the allowlist asks first.** Sandboxed commands may only
  write to `/tmp` and the app's data folder, and may only reach an allowlist of
  network domains. Anything broader runs in direct mode, which always asks
  before it runs and shows you the exact command.
