import * as THREE from 'three';
import type { NetworkSync } from '../network/sync.js';
import type { PlayModeController } from '../player/play-controller.js';
import type { PlayerController } from '../player/controller.js';
import type { GlobalMap } from '../ui/global-map.js';
import type { Minimap } from '../ui/minimap.js';
import type { SpawnedShip } from '../objects/ship.js';

export class UIRuntimeManager {
  private hudPos: HTMLElement;
  private hudPlayers: HTMLElement;
  private pingDisplay: HTMLElement;
  private minimapEl: HTMLElement;
  private minimap: Minimap;
  private globalMap: GlobalMap;
  private getNetwork: () => NetworkSync | null;
  private getPlayerName: () => string;
  private getGameState: () => 'menu' | 'playmenu' | 'sandbox' | 'playing' | 'paused';
  private getGodModeActive: () => boolean;
  private getCamera: () => THREE.PerspectiveCamera;
  private getPlayerController: () => PlayerController | null;
  private getPlayController: () => PlayModeController | null;
  private getGodPlayer: () => PlayerController | null;
  private getSpawnedShips: () => SpawnedShip[];
  private getDrivenShip: () => SpawnedShip | null;
  private hudTick = 0;

  constructor(args: {
    hudPos: HTMLElement;
    hudPlayers: HTMLElement;
    pingDisplay: HTMLElement;
    minimapEl: HTMLElement;
    minimap: Minimap;
    globalMap: GlobalMap;
    getNetwork: () => NetworkSync | null;
    getPlayerName: () => string;
    getGameState: () => 'menu' | 'playmenu' | 'sandbox' | 'playing' | 'paused';
    getGodModeActive: () => boolean;
    getCamera: () => THREE.PerspectiveCamera;
    getPlayerController: () => PlayerController | null;
    getPlayController: () => PlayModeController | null;
    getGodPlayer: () => PlayerController | null;
    getSpawnedShips: () => SpawnedShip[];
    getDrivenShip: () => SpawnedShip | null;
  }) {
    this.hudPos = args.hudPos;
    this.hudPlayers = args.hudPlayers;
    this.pingDisplay = args.pingDisplay;
    this.minimapEl = args.minimapEl;
    this.minimap = args.minimap;
    this.globalMap = args.globalMap;
    this.getNetwork = args.getNetwork;
    this.getPlayerName = args.getPlayerName;
    this.getGameState = args.getGameState;
    this.getGodModeActive = args.getGodModeActive;
    this.getCamera = args.getCamera;
    this.getPlayerController = args.getPlayerController;
    this.getPlayController = args.getPlayController;
    this.getGodPlayer = args.getGodPlayer;
    this.getSpawnedShips = args.getSpawnedShips;
    this.getDrivenShip = args.getDrivenShip;
  }

  refreshEscPlayers(): void {
    const list = document.getElementById('esc-player-list')!;
    const net = this.getNetwork();
    if (!net || !net.myId) {
      list.innerHTML = '<div style="color:#4fc3f7;opacity:0.4;font-size:0.65rem;letter-spacing:0.2em;">NOT CONNECTED</div>';
      return;
    }
    const remotes = net.getRemotePlayers();
    let html = `<div class="esc-player-row"><div class="pdot" style="background:#4fc3f7"></div><div class="pname">${this.getPlayerName() || 'You'}</div><div class="pyou">you</div></div>`;
    for (const rp of remotes) {
      const hex = '#' + rp.color.toString(16).padStart(6, '0');
      html += `<div class="esc-player-row"><div class="pdot" style="background:${hex}"></div><div class="pname">${rp.name}</div></div>`;
    }
    if (remotes.length === 0) {
      html += '<div style="color:#4fc3f7;opacity:0.3;font-size:0.62rem;letter-spacing:0.15em;padding:8px 0;">No other players online</div>';
    }
    list.innerHTML = html;
  }

  redrawGlobalMap(): void {
    if (!this.globalMap.isVisible) return;
    const playController = this.getPlayController();
    const player = this.getPlayerController();
    const camera = this.getCamera();
    const playerPos = playController?.getCharacterPosition() ?? (player ? camera.position : null) ?? camera.position;
    const playerYaw = this.getGodModeActive()
      ? (this.getGodPlayer()?.yaw ?? 0)
      : playController
        ? playController.yaw
        : (player?.yaw ?? 0);
    const net = this.getNetwork();
    const remotes = (net && this.getGameState() === 'playing') ? net.getRemotePlayers() : [];
    this.globalMap.draw(playerPos.x, playerPos.z, playerYaw, this.getSpawnedShips(), this.getDrivenShip(), remotes);
  }

  updateMinimap(): void {
    const show = this.getGameState() === 'playing' || this.getGameState() === 'sandbox';
    this.minimapEl.classList.toggle('hidden', !show);
    if (!show) return;

    const playController = this.getPlayController();
    const player = this.getPlayerController();
    const camera = this.getCamera();
    const playerPos = playController?.getCharacterPosition() ?? (player ? camera.position : null) ?? camera.position;
    const playerYaw = this.getGodModeActive()
      ? (this.getGodPlayer()?.yaw ?? 0)
      : playController
        ? playController.yaw
        : (player?.yaw ?? 0);
    const net = this.getNetwork();
    const remotes = (net && this.getGameState() === 'playing') ? net.getRemotePlayers() : [];

    this.minimap.update(playerPos.x, playerPos.z, playerYaw, this.getSpawnedShips(), this.getDrivenShip(), remotes);
  }

  updateHUD(): void {
    const state = this.getGameState();
    const camera = this.getCamera();
    const playController = this.getPlayController();
    const player = this.getPlayerController();

    if (state === 'playing') {
      if (this.getGodModeActive()) {
        const p = camera.position;
        this.hudPos.textContent = `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)} [GOD]`;
      } else if (playController) {
        const pcState = playController.getState();
        this.hudPos.textContent = `${pcState.position.x.toFixed(1)}, ${pcState.position.y.toFixed(1)}, ${pcState.position.z.toFixed(1)}`;
      }
    } else if (player) {
      const p = camera.position;
      this.hudPos.textContent = `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`;
    }

    const net = this.getNetwork();
    if (this.hudTick % 20 === 0 && net && state !== 'playing') {
      const remotes = net.getRemotePlayers();
      let html = `<div style="color:#e0f0ff"><span class="player-dot" style="background:#4fc3f7"></span>${this.getPlayerName() || 'You'}</div>`;
      for (const rp of remotes) {
        const hex = '#' + rp.color.toString(16).padStart(6, '0');
        html += `<div style="color:#e0f0ff"><span class="player-dot" style="background:${hex}"></span>${rp.name}</div>`;
      }
      this.hudPlayers.innerHTML = html;

      const ms = net.ping;
      this.pingDisplay.textContent = `${ms} ms`;
      this.pingDisplay.className = ms < 80 ? 'ping-good hud-value' : ms < 200 ? 'ping-mid hud-value' : 'ping-bad hud-value';
    }

    this.hudTick++;
  }
}
