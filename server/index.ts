import type { ServerWebSocket } from "bun";
import type { ClientMessage, ServerMessage, PlayerState } from "../shared/types";
import { TICK_RATE, PLAYER_COLORS } from "../shared/types";

// ─── State ────────────────────────────────────────────────────────────────────

const players = new Map<string, PlayerState>();
const sockets = new Map<string, ServerWebSocket<{ id: string }>>();

let colorIndex = 0;
function nextColor(): number {
  return PLAYER_COLORS[colorIndex++ % PLAYER_COLORS.length] ?? 0xffffff;
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 9);
}

function broadcast(msg: ServerMessage, excludeId?: string) {
  const data = JSON.stringify(msg);
  for (const [id, ws] of sockets) {
    if (id !== excludeId) ws.send(data);
  }
}

// ─── Mime types ───────────────────────────────────────────────────────────────

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js:   "application/javascript; charset=utf-8",
  ts:   "application/javascript; charset=utf-8",
  css:  "text/css; charset=utf-8",
  json: "application/json",
  png:  "image/png",
  svg:  "image/svg+xml",
  glb:  "model/gltf-binary",
};

function mimeFor(path: string): string {
  const ext = path.split(".").pop() ?? "";
  return MIME[ext] ?? "text/plain";
}

async function serveFile(filePath: string): Promise<Response> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(file, {
    headers: { "Content-Type": mimeFor(filePath) },
  });
}

import indexHtml from "../client/index.html";

// ─── Game Loop ────────────────────────────────────────────────────────────────
setInterval(() => {
  if (players.size === 0) return;
  const msg: ServerMessage = { type: "tick", players: [...players.values()] };
  broadcast(msg);
}, 1000 / TICK_RATE);

// ─── Server ───────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? "3000", 10);

const server = Bun.serve<{ id: string }>({
  port: PORT,

  routes: {
    "/": indexHtml,
    "/health": new Response(JSON.stringify({ status: "ok" }), {
      headers: { "Content-Type": "application/json" },
    }),
    "/Sail_Ship.glb": () => serveFile("/app/Sail_Ship.glb"),
  },

  async fetch(req, server) {
    // ── WebSocket upgrade ────────────────────────────────────────────────────
    if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
      if (server.upgrade(req, { data: { id: generateId() } })) return undefined as unknown as Response;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    return new Response("Not found", { status: 404 });
  },

  websocket: {
    open(ws) {
      const id = ws.data.id;
      console.log(`[+] Socket connected: ${id}`);
      sockets.set(id, ws);
    },

    message(ws, raw) {
      const id = ws.data.id;
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw as string) as ClientMessage;
      } catch {
        return;
      }

      switch (msg.type) {
        case "join": {
          const player: PlayerState = {
            id,
            name: (msg.name || "Player").slice(0, 20),
            position: { x: 0, y: 3, z: 0 },
            rotation: 0,
            color: nextColor(),
            joinedAt: Date.now(),
          };
          players.set(id, player);

          const welcome: ServerMessage = {
            type: "welcome",
            id,
            players: [...players.values()],
          };
          ws.send(JSON.stringify(welcome));

          broadcast({ type: "player_joined", player }, id);
          console.log(`[+] Player joined: ${player.name} (${id}) — total: ${players.size}`);
          break;
        }

        case "move": {
          const player = players.get(id);
          if (!player) return;
          const p = msg.position;
          const BOUND = 150;
          player.position = {
            x: Math.max(-BOUND, Math.min(BOUND, p.x)),
            y: Math.max(-5,     Math.min(50, p.y)),
            z: Math.max(-BOUND, Math.min(BOUND, p.z)),
          };
          player.rotation = msg.rotation;
          broadcast(
            { type: "player_moved", id, position: player.position, rotation: player.rotation },
            id
          );
          break;
        }

        case "ping": {
          ws.send(JSON.stringify({ type: "pong", t: msg.t } satisfies ServerMessage));
          break;
        }
      }
    },

    close(ws) {
      const id = ws.data.id;
      sockets.delete(id);
      const player = players.get(id);
      if (player) {
        players.delete(id);
        broadcast({ type: "player_left", id });
        console.log(`[-] Player left: ${player.name} (${id}) — total: ${players.size}`);
      }
    },
  },
});

console.log(`Island Engine running at http://localhost:${server.port}`);
