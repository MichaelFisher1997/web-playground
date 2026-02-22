# AGENTS.md

Guidance for coding agents working in this repository.

## Project Snapshot

- Stack: Bun + TypeScript + Three.js + Bun WebSocket server.
- Runtime: Bun (prefer Bun commands/APIs over Node toolchains).
- Client app is served from `server/index.ts` via `Bun.serve`.
- Main gameplay code lives in `client/` with shared message types in `shared/types.ts`.

## Build / Run / Test Commands

```bash
# Install dependencies
bun install

# Run dev server (hot reload)
bun run dev

# Run production-style server
bun start

# Build entrypoint bundle sanity check
bun build ./client/main.ts --outdir /tmp/build-check

# Run all tests (if present)
bun test

# Run a single test file
bun test path/to/file.test.ts

# Run a single test by name pattern
bun test path/to/file.test.ts -t "test name"

# Watch tests
bun test --watch
```

Notes:
- There is currently no dedicated lint script in `package.json`.
- There is currently no dedicated typecheck script; `bun build` is used as a quick compile check.

## Docker Commands

```bash
# Build image
docker compose build island-engine

# Build without cache
docker compose build --no-cache island-engine

# Start service
docker compose up -d island-engine

# Rebuild + restart
docker compose build island-engine && docker compose up -d island-engine

# Logs
docker compose logs --tail=50 island-engine
```

## External Rule Files

- `.cursor/rules/`: not present at time of writing.
- `.cursorrules`: not present at time of writing.
- `.github/copilot-instructions.md`: not present at time of writing.
- `CLAUDE.md` is present and should be treated as guidance (Bun-first workflow).

## Repository Layout

```text
client/
  main.ts                # app bootstrap, render loop, mode routing
  index.html             # UI markup + CSS
  network/sync.ts        # WS client sync + remote player interpolation
  player/controller.ts   # sandbox/god movement
  player/play-controller.ts
  ui/menu.ts
  ui/play-menu.ts
  ui/sandbox-panel.ts
  world/generator.ts
  world/water.ts
  world/ocean-floor.ts
  world/islands.ts
  world/noise.ts
server/
  index.ts               # Bun.serve + websocket handlers
shared/
  types.ts               # client/server message contracts
```

## Code Style and Conventions

### Language and Formatting

- Use TypeScript for all app logic.
- Use single quotes and semicolons (match existing files).
- Prefer explicit return types for exported/public APIs.
- Keep functions focused; extract helpers for non-trivial camera/physics math.

### Naming

- Files: kebab-case (`play-controller.ts`, `ocean-floor.ts`).
- Classes/types/interfaces: PascalCase (`WorldGenerator`, `PlayerState`).
- Functions/locals: camelCase.
- Constants: UPPER_SNAKE_CASE for shared constants.
- Private instance members: `_prefix` (existing pattern in controllers/network).

### Imports

- Group order: external first, then internal.
- Use `import type` for type-only imports.
- In client modules, follow local convention for extension usage:
  - many imports use `.js` extension from TS (`./world/generator.js`),
  - some legacy modules omit extension; preserve local file convention when editing.
- Do not introduce path aliasing unless project config is added for it.

### Types

- Reuse shared protocol types from `shared/types.ts` for network payloads.
- Prefer narrow union types for message variants.
- Avoid `any`; use typed object shapes or discriminated unions.
- Use `ReturnType<typeof setInterval>`/`setTimeout` for timer handles (already used).

### Error Handling

- For WebSocket parsing, use guarded JSON parse with early return on failure.
- For nullable DOM refs, either check null or use `!` only when truly guaranteed.
- Fail soft in realtime loops (avoid throwing from per-frame/per-message paths).
- Keep reconnection logic defensive (`onclose`, backoff/retry timers cleanup).

### Three.js / Rendering

- Use `import * as THREE from 'three'`.
- Dispose geometry/material when replacing world meshes.
- Keep camera/movement smoothing in update loop (`lerp`, damped transitions).
- Prefer small reusable vectors where possible in hot paths.
- Use `castShadow` intentionally; avoid excessive shadow casters for perf.

### Gameplay / Input

- Pointer lock transitions should not create ESC open/close loops.
- Keep crosshair state centralized and deterministic.
- Movement should be camera-relative in play mode; verify A/D orientation after edits.
- First-person and third-person camera logic should share one directional source (`yaw/pitch`).

### Networking

- Client messages: `join`, `move`, `ping`.
- Server messages: `welcome`, `player_joined`, `player_left`, `player_moved`, `pong`, `tick`.
- Keep interpolation client-side (`NetworkSync.interpolate`) and send movement throttled.

### Comments and Docs

- Keep comments short and practical; explain non-obvious math/physics decisions.
- Use section separators in complex files when it improves readability.
- Avoid stale comments when behavior changes (especially camera/controls).

## Validation Checklist

- After edits, run `bun build ./client/main.ts --outdir /tmp/build-check`.
- For runtime checks, restart Docker service and inspect logs.
- For camera/control changes, verify A/D orientation, look behavior, weapon visibility, and ESC/pointer-lock flow.
- Keep Bun-first patterns and preserve the current client/server/shared architecture.
