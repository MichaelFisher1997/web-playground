export interface NetworkMoveState {
  x: number;
  y: number;
  z: number;
}

export interface INetworkClient {
  readonly myId: string | null;
  readonly connected: boolean;
  readonly ping: number;
  connect(playerName: string): void;
  sendMove(position: NetworkMoveState, rotation: number): void;
  interpolate(): void;
  getRemoteCount(): number;
  destroy(): void;
}
