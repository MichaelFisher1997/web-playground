import * as THREE from 'three';

const LERP_FACTOR = 0.18; // interpolation per frame for remote players

export class NetworkSync {
  constructor(scene, onWelcome, onNotification) {
    this.scene          = scene;
    this.onWelcome      = onWelcome;
    this.onNotification = onNotification;

    this.ws          = null;
    this.myId        = null;
    this.connected   = false;
    this.ping        = 0;

    // Map of remote player id -> { mesh, target: {position, rotation} }
    this.remotePlayers = new Map();

    this._pingInterval  = null;
    this._reconnectTimer = null;
  }

  connect(playerName) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url   = `${proto}//${location.host}`;
    this.ws     = new WebSocket(url);

    this.ws.onopen = () => {
      console.log('[WS] Connected');
      this.connected = true;
      this.ws.send(JSON.stringify({ type: 'join', name: playerName }));
      this._startPing();
    };

    this.ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      this._handleMessage(msg);
    };

    this.ws.onclose = () => {
      console.log('[WS] Disconnected');
      this.connected = false;
      clearInterval(this._pingInterval);
      // Try reconnect after 3s
      this._reconnectTimer = setTimeout(() => this.connect(playerName), 3000);
    };

    this.ws.onerror = (e) => {
      console.error('[WS] Error', e);
    };
  }

  _handleMessage(msg) {
    switch (msg.type) {
      case 'welcome': {
        this.myId = msg.id;
        // Spawn all existing players
        for (const p of msg.players) {
          if (p.id !== this.myId) this._spawnRemote(p);
        }
        this.onWelcome(msg.id);
        break;
      }

      case 'player_joined': {
        if (msg.player.id === this.myId) return;
        this._spawnRemote(msg.player);
        this.onNotification(`${msg.player.name} joined`);
        break;
      }

      case 'player_left': {
        this._removeRemote(msg.id);
        break;
      }

      case 'player_moved': {
        const rp = this.remotePlayers.get(msg.id);
        if (!rp) return;
        rp.target.position.set(msg.position.x, msg.position.y, msg.position.z);
        rp.target.rotation = msg.rotation;
        break;
      }

      case 'tick': {
        // Full state reconciliation
        for (const p of msg.players) {
          if (p.id === this.myId) continue;
          let rp = this.remotePlayers.get(p.id);
          if (!rp) { this._spawnRemote(p); rp = this.remotePlayers.get(p.id); }
          if (!rp) continue;
          rp.target.position.set(p.position.x, p.position.y, p.position.z);
          rp.target.rotation = p.rotation;
        }
        break;
      }

      case 'pong': {
        this.ping = Date.now() - msg.t;
        break;
      }
    }
  }

  _spawnRemote(playerState) {
    if (this.remotePlayers.has(playerState.id)) return;

    const bodyGeo = new THREE.CapsuleGeometry(0.4, 1.2, 4, 8);
    const bodyMat = new THREE.MeshLambertMaterial({ color: playerState.color });
    const mesh    = new THREE.Mesh(bodyGeo, bodyMat);
    mesh.castShadow = true;
    mesh.name = `remote_${playerState.id}`;

    const headGeo = new THREE.SphereGeometry(0.25, 8, 6);
    const headMat = new THREE.MeshLambertMaterial({ color: 0xffd54f });
    const head    = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.0;
    mesh.add(head);

    // Name tag (floating text via canvas texture)
    const label = this._makeLabel(playerState.name, playerState.color);
    label.position.y = 2.4;
    mesh.add(label);

    mesh.position.set(playerState.position.x, playerState.position.y, playerState.position.z);
    this.scene.add(mesh);

    const target = {
      position: new THREE.Vector3(playerState.position.x, playerState.position.y, playerState.position.z),
      rotation: playerState.rotation,
    };

    this.remotePlayers.set(playerState.id, { mesh, target, name: playerState.name, color: playerState.color });
  }

  _makeLabel(name, color) {
    const canvas  = document.createElement('canvas');
    canvas.width  = 256;
    canvas.height = 64;
    const ctx     = canvas.getContext('2d');

    // Background pill
    ctx.fillStyle = 'rgba(10,15,26,0.75)';
    ctx.beginPath();
    ctx.roundRect(4, 4, 248, 56, 28);
    ctx.fill();

    // Colored accent bar
    ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    ctx.fillRect(12, 22, 4, 20);

    // Text
    ctx.font      = 'bold 22px "Courier New", monospace';
    ctx.fillStyle = '#e0f0ff';
    ctx.textAlign = 'left';
    ctx.fillText(name.slice(0, 14), 24, 39);

    const tex  = new THREE.CanvasTexture(canvas);
    const mat  = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(2.0, 0.5, 1);
    return sprite;
  }

  _removeRemote(id) {
    const rp = this.remotePlayers.get(id);
    if (!rp) return;
    this.scene.remove(rp.mesh);
    this.remotePlayers.delete(id);
    this.onNotification(`${rp.name} left`);
  }

  // Interpolate remote player positions every frame
  interpolate() {
    for (const [, rp] of this.remotePlayers) {
      rp.mesh.position.lerp(rp.target.position, LERP_FACTOR);
      // Lerp rotation
      const curY = rp.mesh.rotation.y;
      let   tgtY = rp.target.rotation + Math.PI;
      // Shortest angle
      let   diff = ((tgtY - curY + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      rp.mesh.rotation.y = curY + diff * LERP_FACTOR;
    }
  }

  sendMove(position, rotation) {
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'move', position, rotation }));
  }

  _startPing() {
    this._pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping', t: Date.now() }));
      }
    }, 2000);
  }

  getRemoteCount() {
    return this.remotePlayers.size;
  }

  getRemotePlayers() {
    return [...this.remotePlayers.values()];
  }

  destroy() {
    clearInterval(this._pingInterval);
    clearTimeout(this._reconnectTimer);
    this.ws?.close();
    for (const [id] of this.remotePlayers) this._removeRemote(id);
  }
}
