import * as THREE from 'three';
import { query, entityExists } from 'bitecs';
import {
  Transform,
  Team,
  UnitType,
  Stats,
  StatusEffects,
  Vision,
  STATE_ALIVE,
  STATE_DEAD,
  TEAM_BLUE,
  TEAM_NEUTRAL,
  UNIT_CHAMPION,
  UNIT_MINION,
  UNIT_TURRET,
  UNIT_NEXUS,
  UNIT_MONSTER,
} from '../ecs/Components';
import { GameWorld, JUNGLE_CAMPS } from '../ecs/World';
import { getChampionData } from '../data/ChampionsData';

interface BarDom {
  root: HTMLDivElement;
  label: HTMLDivElement;
  lvBadge: HTMLDivElement;
  statusRow: HTMLDivElement;
  stunWrap: HTMLDivElement;
  stunFill: HTMLDivElement;
  stunText: HTMLDivElement;
  hpFill: HTMLDivElement;
  shieldFill: HTMLDivElement;
  ticks: HTMLDivElement;
  mpWrap: HTMLDivElement;
  mpFill: HTMLDivElement;
  kind: number;
  team: number;
  isPlayer: number;
  maxStun: number;
}

interface StatusPill {
  text: string;
  bg: string;
  border: string;
  color: string;
}

export class FloatingBars {
  private container: HTMLDivElement;
  private world: GameWorld;
  private camera: THREE.PerspectiveCamera;
  private bars = new Map<number, BarDom>();
  private projVec = new THREE.Vector3();

  constructor(parent: HTMLElement, world: GameWorld, camera: THREE.PerspectiveCamera) {
    this.world = world;
    this.camera = camera;

    this.container = document.createElement('div');
    this.container.style.cssText =
      'position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:10;';
    parent.appendChild(this.container);
  }

  public update(): void {
    const units = query(this.world.ecs, [Transform, Team, UnitType, Stats, StatusEffects, Vision]);
    const activeEids = new Set<number>();
    const w = window.innerWidth;
    const h = window.innerHeight;
    const playerTeam = this.world.getPlayerTeam();

    for (let i = 0; i < units.length; i++) {
      const eid = units[i];
      const kind = UnitType.kind[eid];
      if (
        kind !== UNIT_CHAMPION &&
        kind !== UNIT_MINION &&
        kind !== UNIT_TURRET &&
        kind !== UNIT_NEXUS &&
        kind !== UNIT_MONSTER
      ) {
        continue;
      }

      if (UnitType.state[eid] !== STATE_ALIVE) continue;

      // Respect stealth & fog of war: hide floating bars for unseen enemies/monsters
      if (
        (kind === UNIT_CHAMPION || kind === UNIT_MINION || kind === UNIT_MONSTER) &&
        !this.world.isVisibleToPlayer(eid)
      ) {
        continue;
      }

      const vis = this.world.visuals.get(eid);
      if (
        vis &&
        !vis.visible &&
        (kind === UNIT_CHAMPION || kind === UNIT_MINION || kind === UNIT_MONSTER) &&
        Team.id[eid] !== playerTeam
      ) {
        continue;
      }

      const wx = vis ? vis.position.x : Transform.x[eid];
      const wz = vis ? vis.position.z : Transform.z[eid];
      const wy =
        kind === UNIT_NEXUS
          ? 7.8
          : kind === UNIT_TURRET
            ? 7.6
            : kind === UNIT_CHAMPION || kind === UNIT_MONSTER
              ? 3.15
              : 1.95;

      this.projVec.set(wx, wy, wz).project(this.camera);

      // Behind camera or off-screen
      if (
        this.projVec.z > 1 ||
        this.projVec.z < -1 ||
        this.projVec.x < -1.15 ||
        this.projVec.x > 1.15 ||
        this.projVec.y < -1.15 ||
        this.projVec.y > 1.15
      ) {
        continue;
      }

      activeEids.add(eid);
      const isPlayer = UnitType.isPlayer[eid];
      let bar = this.bars.get(eid);
      if (bar && (bar.kind !== kind || bar.team !== Team.id[eid] || bar.isPlayer !== isPlayer)) {
        bar.root.remove();
        this.bars.delete(eid);
        bar = undefined;
      }
      if (!bar) {
        bar = this.createBarDom(eid, kind, playerTeam);
        this.bars.set(eid, bar);
        this.container.appendChild(bar.root);
      }

      const sx = (this.projVec.x * 0.5 + 0.5) * w;
      const sy = (-this.projVec.y * 0.5 + 0.5) * h;

      bar.root.style.display = 'block';
      bar.root.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -100%)`;

      // Stun bar ("CHOANG") right above HP bar
      const stun = Math.max(0, StatusEffects.stunTimer[eid]);
      if (stun > 0) {
        if (stun > bar.maxStun) bar.maxStun = stun;
        const denom = Math.max(0.25, bar.maxStun);
        const stunPct = Math.min(100, (stun / denom) * 100);
        bar.stunWrap.style.display = 'block';
        bar.stunFill.style.width = `${stunPct.toFixed(1)}%`;
        bar.stunText.textContent = `CHOÁNG ${stun.toFixed(1)}s`;
      } else {
        bar.maxStun = 0;
        bar.stunWrap.style.display = 'none';
      }

      // Status Pills (TRÓI, LÀM CHẬM, BỊ LỘ, TÀNG HÌNH, MIỄN NHIỄM)
      const pills: StatusPill[] = [];
      const rootT = Math.max(0, StatusEffects.rootTimer[eid]);
      const slowT = Math.max(0, StatusEffects.slowTimer[eid]);
      const slowPct = StatusEffects.slowPercent[eid];
      const invisT = Math.max(0, StatusEffects.invisTimer[eid]);
      const untargT = Math.max(0, StatusEffects.untargetableTimer[eid]);
      const revealT = Math.max(0, Vision.bushRevealTimer[eid]);

      if (rootT > 0) {
        pills.push({
          text: `TRÓI ${rootT.toFixed(1)}s`,
          bg: 'rgba(88,28,135,0.92)',
          border: '#c084fc',
          color: '#f3e8ff',
        });
      }
      if (slowT > 0 && slowPct > 0.01) {
        pills.push({
          text: `LÀM CHẬM`,
          bg: 'rgba(12,74,110,0.92)',
          border: '#38bdf8',
          color: '#e0f2fe',
        });
      }
      if (untargT > 0) {
        pills.push({
          text: `VÔ ĐỊCH`,
          bg: 'rgba(113,63,18,0.92)',
          border: '#facc15',
          color: '#fef08a',
        });
      }
      if (kind === UNIT_CHAMPION) {
        if (Vision.inBrushId[eid] >= 0 && revealT > 0) {
          pills.push({
            text: `BỊ LỘ`,
            bg: 'rgba(127,29,29,0.94)',
            border: '#f87171',
            color: '#fee2e2',
          });
        } else if (invisT > 0 && Team.id[eid] === playerTeam) {
          pills.push({
            text: `TÀNG HÌNH`,
            bg: 'rgba(88,28,135,0.88)',
            border: '#a855f7',
            color: '#e9d5ff',
          });
        }
      }

      if (pills.length > 0) {
        bar.statusRow.style.display = 'flex';
        bar.statusRow.innerHTML = pills
          .map(
            (p) =>
              `<span style="padding:1px 4px;border-radius:3px;font-size:8px;font-weight:900;letter-spacing:0.2px;background:${p.bg};border:1px solid ${p.border};color:${p.color};text-shadow:0 1px 2px #000;white-space:nowrap;">${p.text}</span>`
          )
          .join('');
      } else {
        bar.statusRow.style.display = 'none';
      }

      const maxHp = Math.max(1, Stats.maxHp[eid]);
      const hp = Math.max(0, Stats.hp[eid]);
      const shield = Math.max(0, StatusEffects.shieldAmount[eid]);
      const totalBarScale = Math.max(maxHp, hp + shield);
      const hpPct = (hp / totalBarScale) * 100;
      const shieldPct = (shield / totalBarScale) * 100;

      bar.hpFill.style.width = `${hpPct.toFixed(2)}%`;
      bar.shieldFill.style.left = `${hpPct.toFixed(2)}%`;
      bar.shieldFill.style.width = `${shieldPct.toFixed(2)}%`;
      bar.shieldFill.style.display = shield > 0.5 ? 'block' : 'none';

      // Tick marks every 100 HP on Champions (250 on Turrets, 500 on Nexus)
      if (
        kind === UNIT_CHAMPION ||
        kind === UNIT_TURRET ||
        kind === UNIT_NEXUS ||
        kind === UNIT_MONSTER
      ) {
        const tickStep =
          kind === UNIT_NEXUS ? 500 : kind === UNIT_TURRET ? 250 : kind === UNIT_MONSTER ? 200 : 100;
        const pctPerTick = Math.max(3, (tickStep / totalBarScale) * 100);
        bar.ticks.style.backgroundSize = `${pctPerTick}% 100%`;
      }

      if (kind === UNIT_CHAMPION) {
        const mpPct = (Math.max(0, Stats.mp[eid]) / Math.max(1, Stats.maxMp[eid])) * 100;
        bar.mpFill.style.width = `${mpPct.toFixed(1)}%`;
        bar.lvBadge.textContent = `Lv.${Stats.level[eid]}`;
        const def = getChampionData(UnitType.subKind[eid]);
        bar.label.textContent = def.name;
      }
    }

    for (const [eid, bar] of this.bars.entries()) {
      if (!activeEids.has(eid)) {
        bar.root.style.display = 'none';
        if (
          !entityExists(this.world.ecs, eid) ||
          UnitType.kind[eid] !== bar.kind ||
          UnitType.state[eid] === STATE_DEAD
        ) {
          bar.root.remove();
          this.bars.delete(eid);
        }
      }
    }
  }

  private createBarDom(eid: number, kind: number, playerTeam: number): BarDom {
    const team = Team.id[eid];
    const isAlly = team === playerTeam;
    const isNeutral = team === TEAM_NEUTRAL;
    const isBlue = team === TEAM_BLUE;
    const isPlayer = UnitType.isPlayer[eid];

    const barWidth =
      kind === UNIT_NEXUS
        ? 122
        : kind === UNIT_TURRET
          ? 96
          : kind === UNIT_CHAMPION
            ? 90
            : kind === UNIT_MONSTER
              ? 78
              : 46;
    const hpHeight = kind === UNIT_MINION ? 5 : kind === UNIT_CHAMPION || kind === UNIT_MONSTER ? 8 : 9;

    const root = document.createElement('div');
    root.style.cssText =
      'position:absolute;left:0;top:0;will-change:transform;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;pointer-events:none;';

    const statusRow = document.createElement('div');
    statusRow.style.cssText =
      'display:none;align-items:center;justify-content:center;gap:3px;margin-bottom:2px;';

    const label = document.createElement('div');
    if (kind === UNIT_CHAMPION) {
      label.style.cssText = `font-size:10px;font-weight:800;color:${
        isPlayer === 1 ? '#fde047' : isAlly ? '#bae6fd' : '#fecdd3'
      };text-shadow:0 1px 2px #000,0 0 4px #000;text-align:center;margin-bottom:2px;white-space:nowrap;`;
    } else if (kind === UNIT_MONSTER) {
      label.style.cssText =
        'font-size:9px;font-weight:800;color:#d8b4fe;text-shadow:0 1px 2px #000;text-align:center;margin-bottom:2px;white-space:nowrap;';
      label.textContent = JUNGLE_CAMPS[UnitType.subKind[eid]]?.name ?? 'Quái Rừng';
    } else if (kind === UNIT_TURRET || kind === UNIT_NEXUS) {
      const tSpec = this.world.turretSpecsByEid.get(eid);
      label.style.cssText = `font-size:9px;font-weight:800;color:${
        isBlue ? '#7dd3fc' : '#fda4af'
      };text-shadow:0 1px 2px #000;text-align:center;margin-bottom:2px;letter-spacing:0.4px;white-space:nowrap;`;
      label.textContent = kind === UNIT_NEXUS ? 'NHÀ CHÍNH' : tSpec?.name ?? 'TRỤ';
    } else {
      label.style.display = 'none';
    }

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:3px;';

    const lvBadge = document.createElement('div');
    if (kind === UNIT_CHAMPION) {
      lvBadge.style.cssText = `min-width:29px;height:15px;padding:0 3px;border-radius:3px;background:rgba(9,13,22,0.94);border:1px solid ${
        isPlayer === 1 ? '#facc15' : isAlly ? '#38bdf8' : '#f43f5e'
      };color:${
        isPlayer === 1 ? '#fde047' : isAlly ? '#bae6fd' : '#fecdd3'
      };font-size:9px;font-weight:900;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 1px 4px rgba(0,0,0,0.85);`;
      lvBadge.textContent = `Lv.${Stats.level[eid]}`;
    } else {
      lvBadge.style.display = 'none';
    }

    const barsCol = document.createElement('div');
    barsCol.style.cssText = `width:${barWidth}px;display:flex;flex-direction:column;`;

    // Stun bar right above HP bar
    const stunWrap = document.createElement('div');
    stunWrap.style.cssText =
      'position:relative;width:100%;height:11px;margin-bottom:2px;background:rgba(9,13,22,0.94);border:1px solid #facc15;border-radius:2px;overflow:hidden;display:none;box-shadow:0 1px 4px rgba(0,0,0,0.85);';
    const stunFill = document.createElement('div');
    stunFill.style.cssText =
      'height:100%;width:100%;background:linear-gradient(90deg,#f59e0b,#fde047);';
    const stunText = document.createElement('div');
    stunText.style.cssText =
      'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:900;letter-spacing:0.4px;color:#ffffff;text-shadow:0 1px 2px #000,0 0 3px #000;white-space:nowrap;';
    stunWrap.append(stunFill, stunText);

    const hpWrap = document.createElement('div');
    hpWrap.style.cssText = `position:relative;width:100%;height:${hpHeight}px;background:rgba(9,13,22,0.9);border:1px solid ${
      isPlayer === 1 ? 'rgba(250,204,21,0.88)' : 'rgba(15,23,42,0.96)'
    };border-radius:2px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.75);`;

    const hpBg =
      kind === UNIT_MONSTER || isNeutral
        ? 'linear-gradient(180deg,#c084fc 0%,#9333ea 60%,#7e22ce 100%)'
        : isPlayer === 1
          ? 'linear-gradient(180deg,#4ade80 0%,#22c55e 55%,#16a34a 100%)'
          : isAlly
            ? 'linear-gradient(180deg,#38bdf8 0%,#0ea5e9 60%,#0284c7 100%)'
            : 'linear-gradient(180deg,#f87171 0%,#ef4444 55%,#dc2626 100%)';

    const hpFill = document.createElement('div');
    hpFill.style.cssText = `position:absolute;left:0;top:0;bottom:0;background:${hpBg};transition:width 0.05s linear;`;

    const shieldFill = document.createElement('div');
    shieldFill.style.cssText =
      'position:absolute;top:0;bottom:0;background:linear-gradient(180deg,#ffffff 0%,#e2e8f0 100%);box-shadow:0 0 5px rgba(255,255,255,0.85);display:none;';

    const ticks = document.createElement('div');
    if (kind !== UNIT_MINION) {
      ticks.style.cssText =
        'position:absolute;inset:0;background-image:linear-gradient(to right,transparent calc(100% - 1.5px),rgba(0,0,0,0.82) 100%);pointer-events:none;';
    }

    hpWrap.append(hpFill, shieldFill, ticks);

    const mpWrap = document.createElement('div');
    const mpFill = document.createElement('div');
    if (kind === UNIT_CHAMPION) {
      mpWrap.style.cssText =
        'width:100%;height:3.5px;background:rgba(9,13,22,0.92);border:1px solid rgba(15,23,42,0.92);border-top:none;border-radius:0 0 2px 2px;overflow:hidden;';
      mpFill.style.cssText =
        'height:100%;background:linear-gradient(90deg,#0284c7,#38bdf8);';
      mpWrap.appendChild(mpFill);
    } else {
      mpWrap.style.display = 'none';
    }

    barsCol.append(stunWrap, hpWrap, mpWrap);
    row.append(lvBadge, barsCol);
    root.append(statusRow, label, row);

    return {
      root,
      label,
      lvBadge,
      statusRow,
      stunWrap,
      stunFill,
      stunText,
      hpFill,
      shieldFill,
      ticks,
      mpWrap,
      mpFill,
      kind,
      team,
      isPlayer,
      maxStun: 0,
    };
  }

  public clear(): void {
    for (const bar of this.bars.values()) {
      bar.root.remove();
    }
    this.bars.clear();
  }

  public dispose(): void {
    this.clear();
    this.container.remove();
  }
}
