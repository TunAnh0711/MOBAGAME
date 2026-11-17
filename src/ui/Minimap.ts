import { query } from 'bitecs';
import {
  Transform,
  Team,
  UnitType,
  Combat,
  SkillBook,
  Vision,
  STATE_ALIVE,
  TEAM_BLUE,
  TEAM_RED,
  LANE_TOP,
  LANE_MID,
  LANE_BOT,
  TURRET_TIER_INHIB,
  TURRET_TIER_NEXUS_GUARD,
  UNIT_CHAMPION,
  UNIT_MINION,
  UNIT_TURRET,
  UNIT_NEXUS,
  UNIT_MONSTER,
} from '../ecs/Components';
import {
  GameWorld,
  MAP_HALF_SIZE,
  MAP_SIZE,
  LANE_WAYPOINTS,
  JUNGLE_ROCKS,
  MAP_BRUSHES,
  JUNGLE_CAMPS,
  SPEED_SHRINES,
  NEXUS_BLUE_POS,
  NEXUS_RED_POS,
} from '../ecs/World';
import {
  FogOfWarSystem,
  FOW_GRID_SIZE,
  FOW_EXPLORED,
  FOW_VISIBLE,
} from '../ecs/systems/FogOfWarSystem';
import { CameraController } from '../core/CameraController';
import { NavigationSystem } from '../ecs/systems/NavigationSystem';
import { EventBus } from '../core/EventBus';
import { isolateUIElement } from '../core/InputManager';

export class Minimap {
  private wrapper: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private staticBg: HTMLCanvasElement;
  private fogCanvas: HTMLCanvasElement;
  private fogCtx: CanvasRenderingContext2D;
  private fogImageData: ImageData;

  private size = 220;
  private world: GameWorld;
  private fog: FogOfWarSystem;
  private cameraCtrl: CameraController;
  private nav: NavigationSystem;
  private bus: EventBus;
  private isDraggingLeft = false;
  private lastPointerDownAt = -1;
  private abortCtrl = new AbortController();

  constructor(
    parent: HTMLElement,
    world: GameWorld,
    fog: FogOfWarSystem,
    cameraCtrl: CameraController,
    nav: NavigationSystem,
    bus: EventBus
  ) {
    this.world = world;
    this.fog = fog;
    this.cameraCtrl = cameraCtrl;
    this.nav = nav;
    this.bus = bus;

    this.size = this.computeResponsiveSize();
    const margin = window.innerWidth < 880 ? 8 : 12;

    this.wrapper = document.createElement('div');
    this.wrapper.style.cssText = `position:fixed;right:${margin}px;bottom:${margin}px;z-index:30;border-radius:10px;padding:4px;background:rgba(10,16,28,0.94);border:1.5px solid rgba(56,189,248,0.48);box-shadow:0 8px 28px rgba(0,0,0,0.72);user-select:none;backdrop-filter:blur(6px);pointer-events:auto;`;

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.size;
    this.canvas.height = this.size;
    this.canvas.style.cssText = 'display:block;border-radius:6px;cursor:crosshair;';
    this.ctx = this.canvas.getContext('2d')!;

    this.wrapper.appendChild(this.canvas);
    parent.appendChild(this.wrapper);

    this.staticBg = document.createElement('canvas');
    this.staticBg.width = this.size;
    this.staticBg.height = this.size;
    this.bakeStaticMap();

    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width = FOW_GRID_SIZE;
    this.fogCanvas.height = FOW_GRID_SIZE;
    this.fogCtx = this.fogCanvas.getContext('2d')!;
    this.fogImageData = this.fogCtx.createImageData(FOW_GRID_SIZE, FOW_GRID_SIZE);

    this.bindEvents();
    isolateUIElement(this.canvas);
    isolateUIElement(this.wrapper);
  }

  private computeResponsiveSize(): number {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w >= 1120 && h >= 680) return 220;
    if (w >= 880) return 172;
    return Math.max(122, Math.min(148, Math.floor(w * 0.19)));
  }

  public getOuterSize(): number {
    return this.size + 11;
  }

  private handleResize = (): void => {
    const margin = window.innerWidth < 880 ? '8px' : '12px';
    this.wrapper.style.right = margin;
    this.wrapper.style.bottom = margin;
    const nextSize = this.computeResponsiveSize();
    if (nextSize === this.size) return;
    this.size = nextSize;
    this.canvas.width = this.size;
    this.canvas.height = this.size;
    this.staticBg.width = this.size;
    this.staticBg.height = this.size;
    this.bakeStaticMap();
  };

  private worldToPx(wx: number, wz: number): { x: number; y: number } {
    return {
      x: ((wx + MAP_HALF_SIZE) / MAP_SIZE) * this.size,
      y: ((wz + MAP_HALF_SIZE) / MAP_SIZE) * this.size,
    };
  }

  private pxToWorld(px: number, py: number): { x: number; z: number } {
    const rawX = (px / this.size) * MAP_SIZE - MAP_HALF_SIZE;
    const rawZ = (py / this.size) * MAP_SIZE - MAP_HALF_SIZE;
    const clampBound = MAP_HALF_SIZE - 2.5;
    return {
      x: Math.max(-clampBound, Math.min(clampBound, rawX)),
      z: Math.max(-clampBound, Math.min(clampBound, rawZ)),
    };
  }

  private bakeStaticMap(): void {
    const c = this.staticBg.getContext('2d')!;
    const s = this.size;

    // 1. Emerald Jungle Base (240x240)
    c.fillStyle = '#0c1f1a';
    c.fillRect(0, 0, s, s);

    // Subtle coordinate grid lines
    c.strokeStyle = 'rgba(56, 189, 248, 0.06)';
    c.lineWidth = 1;
    for (let k = 1; k < 4; k++) {
      const pos = (s * k) / 4;
      c.beginPath();
      c.moveTo(pos, 0);
      c.lineTo(pos, s);
      c.stroke();
      c.beginPath();
      c.moveTo(0, pos);
      c.lineTo(s, pos);
      c.stroke();
    }

    // 2. Diagonal River along x = z (NW -> (0,0) -> SE)
    const r0 = this.worldToPx(-114, -114);
    const r1 = this.worldToPx(114, 114);
    c.strokeStyle = '#0c4a6e';
    c.lineWidth = Math.max(8, (15 / MAP_SIZE) * s);
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(r0.x, r0.y);
    c.lineTo(r1.x, r1.y);
    c.stroke();

    c.strokeStyle = 'rgba(56, 189, 248, 0.28)';
    c.lineWidth = Math.max(3, (5.5 / MAP_SIZE) * s);
    c.beginPath();
    c.moveTo(r0.x, r0.y);
    c.lineTo(r1.x, r1.y);
    c.stroke();

    // 3. Base Platforms (Blue SW (-94,94), Red NE (94,-94))
    const blueBase = this.worldToPx(NEXUS_BLUE_POS.x, NEXUS_BLUE_POS.z);
    const redBase = this.worldToPx(NEXUS_RED_POS.x, NEXUS_RED_POS.z);
    const baseR = (26 / MAP_SIZE) * s;

    c.fillStyle = 'rgba(14, 165, 233, 0.30)';
    c.beginPath();
    c.arc(blueBase.x, blueBase.y, baseR, 0, Math.PI * 2);
    c.fill();

    c.fillStyle = 'rgba(244, 63, 94, 0.30)';
    c.beginPath();
    c.arc(redBase.x, redBase.y, baseR, 0, Math.PI * 2);
    c.fill();

    // 4. 3 Lanes (Top, Mid, Bot) traced directly from LANE_WAYPOINTS
    const laneW = Math.max(7, (12 / MAP_SIZE) * s);
    c.strokeStyle = '#334155';
    c.lineWidth = laneW;
    c.lineCap = 'round';
    c.lineJoin = 'round';

    for (const laneId of [LANE_TOP, LANE_MID, LANE_BOT]) {
      const wps = LANE_WAYPOINTS[laneId];
      if (!wps || wps.length < 2) continue;
      c.beginPath();
      for (let i = 0; i < wps.length; i++) {
        const pt = this.worldToPx(wps[i].x, wps[i].z);
        if (i === 0) c.moveTo(pt.x, pt.y);
        else c.lineTo(pt.x, pt.y);
      }
      c.stroke();
    }

    // 5. Neutral Jungle Camp markers
    for (const camp of JUNGLE_CAMPS) {
      const p = this.worldToPx(camp.x, camp.z);
      c.fillStyle = 'rgba(168, 85, 247, 0.42)';
      c.beginPath();
      c.arc(p.x, p.y, 3.8, 0, Math.PI * 2);
      c.fill();
    }

    // 6. 18 Stealth Bushes
    for (const b of MAP_BRUSHES) {
      const p = this.worldToPx(b.x, b.z);
      const pr = Math.max(2.8, (b.radius / MAP_SIZE) * s);
      c.fillStyle = 'rgba(22, 163, 74, 0.85)';
      c.beginPath();
      c.arc(p.x, p.y, pr, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = 'rgba(74, 222, 128, 0.45)';
      c.lineWidth = 0.8;
      c.stroke();
    }

    // 7. Jungle Stone Walls / Rocks
    for (const r of JUNGLE_ROCKS) {
      const p = this.worldToPx(r.x, r.z);
      const pr = Math.max(3.2, (r.radius / MAP_SIZE) * s);
      c.fillStyle = '#1e293b';
      c.beginPath();
      c.arc(p.x, p.y, pr, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = '#475569';
      c.lineWidth = 1;
      c.stroke();
    }
  }

  private handleCanvasPress(clientX: number, clientY: number, button: number): void {
    const rect = this.canvas.getBoundingClientRect();
    const px = Math.max(0, Math.min(this.size, clientX - rect.left));
    const py = Math.max(0, Math.min(this.size, clientY - rect.top));
    const wPos = this.pxToWorld(px, py);

    if (button === 0) {
      this.isDraggingLeft = true;
      this.cameraCtrl.isLocked = false;
      this.cameraCtrl.panTo(wPos.x, wPos.z);
    } else if (button === 2) {
      const pid = this.world.playerEid;
      if (pid >= 0 && this.world.isAliveUnit(pid) && !this.world.matchEnded) {
        Combat.targetEid[pid] = -1;
        Combat.isWindingUp[pid] = 0;
        SkillBook.isRecalling[pid] = 0;
        SkillBook.recallTimer[pid] = 0;
        this.nav.commandMoveTo(pid, wPos.x, wPos.z, false);
        this.bus.emit('clickMarker', { x: wPos.x, z: wPos.z, kind: 'move' });
      }
    }
  }

  private bindEvents(): void {
    const signal = this.abortCtrl.signal;
    window.addEventListener('resize', this.handleResize, { signal });

    this.canvas.addEventListener(
      'pointerdown',
      (e) => {
        this.lastPointerDownAt = performance.now();
        this.handleCanvasPress(e.clientX, e.clientY, e.button);
      },
      { signal }
    );

    this.canvas.addEventListener(
      'mousedown',
      (e) => {
        if (performance.now() - this.lastPointerDownAt < 50) return;
        this.handleCanvasPress(e.clientX, e.clientY, e.button);
      },
      { signal }
    );

    window.addEventListener(
      'mousemove',
      (e) => {
        if (!this.isDraggingLeft) return;
        const rect = this.canvas.getBoundingClientRect();
        const px = Math.max(0, Math.min(this.size, e.clientX - rect.left));
        const py = Math.max(0, Math.min(this.size, e.clientY - rect.top));
        const wPos = this.pxToWorld(px, py);
        this.cameraCtrl.panTo(wPos.x, wPos.z);
      },
      { signal }
    );

    window.addEventListener(
      'mouseup',
      (e) => {
        if (e.button === 0) this.isDraggingLeft = false;
      },
      { signal }
    );

    window.addEventListener(
      'pointerup',
      (e) => {
        if (e.button === 0) this.isDraggingLeft = false;
      },
      { signal }
    );

    window.addEventListener(
      'blur',
      () => {
        this.isDraggingLeft = false;
      },
      { signal }
    );
  }

  public update(): void {
    const ctx = this.ctx;
    ctx.drawImage(this.staticBg, 0, 0);

    const playerTeam = this.world.getPlayerTeam();
    const grid = playerTeam === TEAM_RED ? this.fog.redGrid : this.fog.blueGrid;

    // 1. Fog of War shroud (0 = Unexplored, 128 = Explored, 255 = Visible)
    const data = this.fogImageData.data;
    for (let i = 0; i < grid.length; i++) {
      const p = i * 4;
      const val = grid[i];
      data[p] = 4;
      data[p + 1] = 8;
      data[p + 2] = 16;
      data[p + 3] = val >= FOW_VISIBLE ? 0 : val >= FOW_EXPLORED ? 118 : 212;
    }
    this.fogCtx.putImageData(this.fogImageData, 0, 0);
    ctx.drawImage(this.fogCanvas, 0, 0, this.size, this.size);

    // 2. Speed Shrines (NW & SE River)
    for (let i = 0; i < SPEED_SHRINES.length; i++) {
      const sh = SPEED_SHRINES[i];
      const p = this.worldToPx(sh.x, sh.z);
      const ready = this.world.isSpeedShrineReady(i);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.6, 0, Math.PI * 2);
      ctx.fillStyle = ready ? '#22d3ee' : 'rgba(51, 65, 85, 0.75)';
      ctx.fill();
      ctx.strokeStyle = ready ? '#cffafe' : '#64748b';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    const units = query(this.world.ecs, [Transform, Team, UnitType, Vision]);

    // 3. Structures (11 Turrets + 1 Nexus per team), Minions, and Jungle Monsters
    for (let i = 0; i < units.length; i++) {
      const eid = units[i];
      if (UnitType.state[eid] !== STATE_ALIVE) continue;
      const kind = UnitType.kind[eid];
      const isBlue = Team.id[eid] === TEAM_BLUE;
      const p = this.worldToPx(Transform.x[eid], Transform.z[eid]);

      if (kind === UNIT_TURRET) {
        const tier = UnitType.subKind[eid];
        const half = tier >= TURRET_TIER_NEXUS_GUARD ? 3.8 : tier === TURRET_TIER_INHIB ? 3.4 : 3.0;
        ctx.fillStyle = isBlue ? '#38bdf8' : '#f43f5e';
        ctx.strokeStyle = '#090d16';
        ctx.lineWidth = 1;
        ctx.fillRect(p.x - half, p.y - half, half * 2, half * 2);
        ctx.strokeRect(p.x - half, p.y - half, half * 2, half * 2);
      } else if (kind === UNIT_NEXUS) {
        ctx.fillStyle = isBlue ? '#0ea5e9' : '#e11d48';
        ctx.strokeStyle = '#f8fafc';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - 5.8);
        ctx.lineTo(p.x + 5.8, p.y);
        ctx.lineTo(p.x, p.y + 5.8);
        ctx.lineTo(p.x - 5.8, p.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (kind === UNIT_MINION) {
        if (!this.world.isVisibleToPlayer(eid)) continue;
        ctx.fillStyle = isBlue ? '#7dd3fc' : '#fda4af';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.9, 0, Math.PI * 2);
        ctx.fill();
      } else if (kind === UNIT_MONSTER) {
        const vis = this.world.isVisibleToPlayer(eid);
        ctx.fillStyle = vis ? '#c084fc' : 'rgba(168, 85, 247, 0.45)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 4. Visible Champions on top (respecting bush stealth & invisibility)
    for (let i = 0; i < units.length; i++) {
      const eid = units[i];
      if (UnitType.kind[eid] !== UNIT_CHAMPION || UnitType.state[eid] !== STATE_ALIVE) continue;
      if (!this.world.isVisibleToPlayer(eid)) continue;

      const isBlue = Team.id[eid] === TEAM_BLUE;
      const isPlayer = UnitType.isPlayer[eid] === 1;
      const p = this.worldToPx(Transform.x[eid], Transform.z[eid]);

      ctx.beginPath();
      ctx.arc(p.x, p.y, isPlayer ? 5.2 : 4.2, 0, Math.PI * 2);
      ctx.fillStyle = isPlayer ? '#22c55e' : isBlue ? '#38bdf8' : '#ef4444';
      ctx.fill();
      ctx.lineWidth = isPlayer ? 1.8 : 1.2;
      ctx.strokeStyle = isPlayer ? '#facc15' : '#ffffff';
      ctx.stroke();
    }

    // 5. White Camera Viewport Frustum Rectangle
    const bounds = this.cameraCtrl.getViewportGroundBounds();
    if (bounds.length === 4) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let i = 0; i < bounds.length; i++) {
        const pt = this.worldToPx(bounds[i].x, bounds[i].z);
        if (i === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }

  public dispose(): void {
    this.abortCtrl.abort();
    this.wrapper.remove();
  }
}
