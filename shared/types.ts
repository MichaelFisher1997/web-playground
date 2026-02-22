// Shared types between server and client

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface PlayerState {
  id: string;
  name: string;
  position: Vec3;
  rotation: number; // Y-axis rotation in radians
  color: number;    // hex color
  joinedAt: number;
}

// Client -> Server messages
export type ClientMessage =
  | { type: "join"; name: string }
  | { type: "move"; position: Vec3; rotation: number }
  | { type: "ping"; t: number };

// Server -> Client messages
export type ServerMessage =
  | { type: "welcome"; id: string; players: PlayerState[] }
  | { type: "player_joined"; player: PlayerState }
  | { type: "player_left"; id: string }
  | { type: "player_moved"; id: string; position: Vec3; rotation: number }
  | { type: "pong"; t: number }
  | { type: "tick"; players: PlayerState[] };

export const TICK_RATE = 20; // server ticks per second
export const WORLD_SIZE = 200;
export const ISLAND_RADIUS = 60;

// Player colors palette
export const PLAYER_COLORS = [
  0xff4444, // red
  0x44aaff, // blue
  0x44ff88, // green
  0xffcc00, // yellow
  0xff44cc, // pink
  0x44ffee, // cyan
  0xff8844, // orange
  0xaa44ff, // purple
];
