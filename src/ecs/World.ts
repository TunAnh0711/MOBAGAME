import {
  createWorld,
  addEntity,
  removeEntity,
  addComponents,
  entityExists,
  query,
  type World as BitECSWorld,
} from 'bitecs';
import * as THREE from 'three';
import {
  Transform,
  Movement,
  Team,
  UnitType,
  Stats,
  StatusEffects,
  Combat,
  SkillBook,
  AI,
  Projectile,
  SkillZone,
  Vision,
  TEAM_NEUTRAL,
  TEAM_BLUE,
  TEAM_RED,
  UNIT_CHAMPION,
  UNIT_MINION,
  UNIT_TURRET,
  UNIT_NEXUS,
  UNIT_PROJECTILE,
  UNIT_SKILL_ZONE,
  UNIT_MONSTER,
  MINION_MELEE,
  MINION_SIEGE,
  TURRET_TIER_OUTER,
  TURRET_TIER_INNER,
  TURRET_TIER_INHIB,
  TURRET_TIER_NEXUS_GUARD,
  ZONE_AOE,
  ZONE_BEAM,
  ZONE_BARRIER,
  ZONE_ROOT_TRAP,
  ZONE_MULTI_TICK,
  STATE_ALIVE,
  AI_ROLE_MINION,
  AI_ROLE_BOT_CHAMPION,
  AI_ROLE_TURRET,
  AI_ROLE_MONSTER,
  LANE_TOP,
  LANE_MID,
  LANE_BOT,
  DMG_PHYSICAL,
  DMG_MAGIC,
  DMG_TRUE,
} from './Components';
import { getChampionData, SUMMONER_SPELLS, type ChampionId } from '../data/ChampionsData';

export type GameMode = '5v5' | '1v1';

// Expanded 240x240 3-Lane Arena: X in [-120, +120] (West->East), Z in [-120, +120] (North->South)
// Camera & Minimap Orientation: Blue Base = South-West (-X, +Z), Red Base = North-East (+X, -Z)
export const MAP_HALF_SIZE = 120;
export const MAP_SIZE = MAP_HALF_SIZE * 2; // 240x240
export const LANE_COORD = 94;
export const FOUNTAIN_BLUE = { x: -106, z: 106 };
export const FOUNTAIN_RED = { x: 106, z: -106 };
export const NEXUS_BLUE_POS = { x: -94, z: 94 };
export const NEXUS_RED_POS = { x: 94, z: -94 };

export const BUSH_ATTACK_REVEAL_TIME = 1.5;
export const TURRET_TRUE_SIGHT_RANGE = 13.0;
export const PATH_GRID_SIZE = 80; // 240 / 80 = 3.0 world units per cell

export interface MapObstacle {
  x: number;
  z: number;
  radius: number;
  height: number;
  kind: 'rock' | 'turret' | 'nexus';
  eid?: number;
}

export interface BrushZone {
  id: number;
  x: number;
  z: number;
  radius: number;
}

export interface SpeedShrineDef {
  id: number;
  name: string;
  x: number;
  z: number;
  radius: number;
  speedBonus: number;
  duration: number;
  cooldown: number;
}

export interface JungleCampDef {
  id: number;
  name: string;
  x: number;
  z: number;
}

export interface Waypoint {
  x: number;
  z: number;
}

export const LANE_WAYPOINTS: Record<number, Waypoint[]> = {
  [LANE_TOP]: [
    { x: -94, z: 94 },
    { x: -94, z: 76 },
    { x: -94, z: 38 },
    { x: -94, z: 0 },
    { x: -94, z: -50 },
    { x: -92, z: -84 },
    { x: -84, z: -92 },
    { x: -50, z: -94 },
    { x: 0, z: -94 },
    { x: 38, z: -94 },
    { x: 76, z: -94 },
    { x: 94, z: -94 },
  ],
  [LANE_MID]: [
    { x: -94, z: 94 },
    { x: -78, z: 78 },
    { x: -58, z: 58 },
    { x: -34, z: 34 },
    { x: 0, z: 0 },
    { x: 34, z: -34 },
    { x: 58, z: -58 },
    { x: 78, z: -78 },
    { x: 94, z: -94 },
  ],
  [LANE_BOT]: [
    { x: -94, z: 94 },
    { x: -76, z: 94 },
    { x: -38, z: 94 },
    { x: 0, z: 94 },
    { x: 50, z: 94 },
    { x: 84, z: 92 },
    { x: 92, z: 84 },
    { x: 94, z: 50 },
    { x: 94, z: 0 },
    { x: 94, z: -38 },
    { x: 94, z: -76 },
    { x: 94, z: -94 },
  ],
};

export const JUNGLE_ROCKS: MapObstacle[] = [
  // Blue Top-Mid jungle
  { x: -68, z: 6, radius: 5.0, height: 4.5, kind: 'rock' },
  { x: -64, z: -8, radius: 4.0, height: 3.8, kind: 'rock' },
  { x: -48, z: -24, radius: 4.8, height: 4.2, kind: 'rock' },
  { x: -38, z: 12, radius: 4.2, height: 3.8, kind: 'rock' },

  // Blue Bot-Mid jungle
  { x: -6, z: 68, radius: 5.0, height: 4.5, kind: 'rock' },
  { x: 8, z: 64, radius: 4.0, height: 3.8, kind: 'rock' },
  { x: 24, z: 48, radius: 4.8, height: 4.2, kind: 'rock' },
  { x: -12, z: 38, radius: 4.2, height: 3.8, kind: 'rock' },

  // Red Top-Mid jungle
  { x: 6, z: -68, radius: 5.0, height: 4.5, kind: 'rock' },
  { x: -8, z: -64, radius: 4.0, height: 3.8, kind: 'rock' },
  { x: -24, z: -48, radius: 4.8, height: 4.2, kind: 'rock' },
  { x: 12, z: -38, radius: 4.2, height: 3.8, kind: 'rock' },

  // Red Bot-Mid jungle
  { x: 68, z: -6, radius: 5.0, height: 4.5, kind: 'rock' },
  { x: 64, z: 8, radius: 4.0, height: 3.8, kind: 'rock' },
  { x: 48, z: 24, radius: 4.8, height: 4.2, kind: 'rock' },
  { x: 38, z: -12, radius: 4.2, height: 3.8, kind: 'rock' },
];

// 18 Symmetrical Stealth Bushes: 4 Mid side-bushes, 4 River banks, 4 Top, 4 Bot, 2 Jungle
export const MAP_BRUSHES: BrushZone[] = [
  // 4 Mid side-bushes & Mid-River corners
  { id: 0, x: -16, z: -4, radius: 4.2 },
  { id: 1, x: 16, z: 4, radius: 4.2 },
  { id: 2, x: -28, z: 12, radius: 4.0 },
  { id: 3, x: 28, z: -12, radius: 4.0 },

  // 4 River bank ambush bushes (North/South of Mid + NW/SE River approaches)
  { id: 4, x: -4, z: -16, radius: 4.2 },
  { id: 5, x: 4, z: 16, radius: 4.2 },
  { id: 6, x: -58, z: -40, radius: 4.2 },
  { id: 7, x: 58, z: 40, radius: 4.2 },

  // 4 Top-Lane edges & NW corner bushes
  { id: 8, x: -105, z: -12, radius: 4.4 },
  { id: 9, x: -12, z: -105, radius: 4.4 },
  { id: 10, x: -105, z: -72, radius: 4.4 },
  { id: 11, x: -72, z: -105, radius: 4.4 },

  // 4 Bot-Lane edges & SE corner bushes
  { id: 12, x: 12, z: 105, radius: 4.4 },
  { id: 13, x: 105, z: 12, radius: 4.4 },
  { id: 14, x: 72, z: 105, radius: 4.4 },
  { id: 15, x: 105, z: 72, radius: 4.4 },

  // 2 Deep Jungle flank bushes
  { id: 16, x: -48, z: -6, radius: 4.2 },
  { id: 17, x: 48, z: 6, radius: 4.2 },
];

// 2 Interactive River Speed Shrines (+35% MS for 3s, 20s CD)
export const SPEED_SHRINES: SpeedShrineDef[] = [
  {
    id: 0,
    name: 'Bệ Tốc Độ Tây Bắc',
    x: -44,
    z: -44,
    radius: 3.2,
    speedBonus: 0.35,
    duration: 3.0,
    cooldown: 20.0,
  },
  {
    id: 1,
    name: 'Bệ Tốc Độ Đông Nam',
    x: 44,
    z: 44,
    radius: 3.2,
    speedBonus: 0.35,
    duration: 3.0,
    cooldown: 20.0,
  },
];

// 6 Neutral Jungle Camps (3 Blue side, 3 Red side)
export const JUNGLE_CAMPS: JungleCampDef[] = [
  { id: 0, name: 'Khổng Lồ Đá Tây', x: -58, z: -16 },
  { id: 1, name: 'Sói Hư Không Tây', x: -64, z: 24 },
  { id: 2, name: 'Cổ Thụ Ánh Sáng Nam', x: 16, z: 58 },
  { id: 3, name: 'Rồng Pha Lê Bắc', x: -16, z: -58 },
  { id: 4, name: 'Sói Hư Không Đông', x: 64, z: -24 },
  { id: 5, name: 'Khổng Lồ Đá Đông', x: 58, z: 16 },
];

export type TurretTier = 1 | 2 | 3 | 4; // 1: Outer, 2: Inner, 3: Inhibitor, 4: Nexus Guard

export interface TurretSpec {
  id: string;
  name: string;
  team: number;
  lane: number;
  x: number;
  z: number;
  tier: TurretTier;
}

// 11 Turrets Per Team (3 Outer + 3 Inner + 3 Inhibitor + 2 Nexus Guard) + 1 Nexus = 12 Structures/Team
export const TURRET_SPECS: TurretSpec[] = [
  // === BLUE TEAM (11 Turrets) ===
  // Blue Top (Outer -> Inner -> Inhib)
  { id: 'blue_top_t1', name: 'Trụ Ngoài Trên', team: TEAM_BLUE, lane: LANE_TOP, x: -94, z: -32, tier: TURRET_TIER_OUTER },
  { id: 'blue_top_t2', name: 'Trụ Trong Trên', team: TEAM_BLUE, lane: LANE_TOP, x: -94, z: 18, tier: TURRET_TIER_INNER },
  { id: 'blue_top_t3', name: 'Trụ Nhà Lính Trên', team: TEAM_BLUE, lane: LANE_TOP, x: -94, z: 62, tier: TURRET_TIER_INHIB },
  // Blue Mid (Outer -> Inner -> Inhib)
  { id: 'blue_mid_t1', name: 'Trụ Ngoài Giữa', team: TEAM_BLUE, lane: LANE_MID, x: -22, z: 22, tier: TURRET_TIER_OUTER },
  { id: 'blue_mid_t2', name: 'Trụ Trong Giữa', team: TEAM_BLUE, lane: LANE_MID, x: -46, z: 46, tier: TURRET_TIER_INNER },
  { id: 'blue_mid_t3', name: 'Trụ Nhà Lính Giữa', team: TEAM_BLUE, lane: LANE_MID, x: -72, z: 72, tier: TURRET_TIER_INHIB },
  // Blue Bot (Outer -> Inner -> Inhib)
  { id: 'blue_bot_t1', name: 'Trụ Ngoài Dưới', team: TEAM_BLUE, lane: LANE_BOT, x: 32, z: 94, tier: TURRET_TIER_OUTER },
  { id: 'blue_bot_t2', name: 'Trụ Trong Dưới', team: TEAM_BLUE, lane: LANE_BOT, x: -18, z: 94, tier: TURRET_TIER_INNER },
  { id: 'blue_bot_t3', name: 'Trụ Nhà Lính Dưới', team: TEAM_BLUE, lane: LANE_BOT, x: -62, z: 94, tier: TURRET_TIER_INHIB },
  // Blue Nexus Guards (2)
  { id: 'blue_nexus_g1', name: 'Trụ Bảo Vệ Chính Bắc', team: TEAM_BLUE, lane: LANE_MID, x: -90, z: 82, tier: TURRET_TIER_NEXUS_GUARD },
  { id: 'blue_nexus_g2', name: 'Trụ Bảo Vệ Chính Nam', team: TEAM_BLUE, lane: LANE_MID, x: -82, z: 90, tier: TURRET_TIER_NEXUS_GUARD },

  // === RED TEAM (11 Turrets) ===
  // Red Top (Outer -> Inner -> Inhib)
  { id: 'red_top_t1', name: 'Trụ Ngoài Trên', team: TEAM_RED, lane: LANE_TOP, x: -32, z: -94, tier: TURRET_TIER_OUTER },
  { id: 'red_top_t2', name: 'Trụ Trong Trên', team: TEAM_RED, lane: LANE_TOP, x: 18, z: -94, tier: TURRET_TIER_INNER },
  { id: 'red_top_t3', name: 'Trụ Nhà Lính Trên', team: TEAM_RED, lane: LANE_TOP, x: 62, z: -94, tier: TURRET_TIER_INHIB },
  // Red Mid (Outer -> Inner -> Inhib)
  { id: 'red_mid_t1', name: 'Trụ Ngoài Giữa', team: TEAM_RED, lane: LANE_MID, x: 22, z: -22, tier: TURRET_TIER_OUTER },
  { id: 'red_mid_t2', name: 'Trụ Trong Giữa', team: TEAM_RED, lane: LANE_MID, x: 46, z: -46, tier: TURRET_TIER_INNER },
  { id: 'red_mid_t3', name: 'Trụ Nhà Lính Giữa', team: TEAM_RED, lane: LANE_MID, x: 72, z: -72, tier: TURRET_TIER_INHIB },
  // Red Bot (Outer -> Inner -> Inhib)
  { id: 'red_bot_t1', name: 'Trụ Ngoài Dưới', team: TEAM_RED, lane: LANE_BOT, x: 94, z: 32, tier: TURRET_TIER_OUTER },
  { id: 'red_bot_t2', name: 'Trụ Trong Dưới', team: TEAM_RED, lane: LANE_BOT, x: 94, z: -18, tier: TURRET_TIER_INNER },
  { id: 'red_bot_t3', name: 'Trụ Nhà Lính Dưới', team: TEAM_RED, lane: LANE_BOT, x: 94, z: -62, tier: TURRET_TIER_INHIB },
  // Red Nexus Guards (2)
  { id: 'red_nexus_g1', name: 'Trụ Bảo Vệ Chính Bắc', team: TEAM_RED, lane: LANE_MID, x: 82, z: -90, tier: TURRET_TIER_NEXUS_GUARD },
  { id: 'red_nexus_g2', name: 'Trụ Bảo Vệ Chính Nam', team: TEAM_RED, lane: LANE_MID, x: 90, z: -82, tier: TURRET_TIER_NEXUS_GUARD },
];

export class GameWorld {
  public ecs: BitECSWorld;
  public gameMode: GameMode = '5v5';
  public playerEid = -1;
  public blueNexusEid = -1;
  public redNexusEid = -1;
  public championEids: number[] = [];
  public matchTime = 0;
  public matchEnded = false;
  public winnerTeam = 0;
  public blueKills = 0;
  public redKills = 0;

  public obstacles: MapObstacle[] = [];
  public brushes: BrushZone[] = MAP_BRUSHES;
  public speedShrines: SpeedShrineDef[] = SPEED_SHRINES;
  public speedShrineCooldowns = new Float32Array(SPEED_SHRINES.length);
  public turretSpecsByEid = new Map<number, TurretSpec>();
  public walkGrid: Uint8Array;

  public visuals = new Map<number, THREE.Object3D>();
  public hitMeshes: THREE.Mesh[] = [];
  public hitMeshByEid = new Map<number, THREE.Mesh>();
  public projectileHits = new Map<number, Set<number>>();
  public entityPaths = new Map<number, Waypoint[]>();
  public inventories = new Map<number, string[]>();

  public pendingVisualCreate: number[] = [];
  public pendingVisualDestroy: number[] = [];

  constructor(mode: GameMode = '5v5') {
    this.ecs = createWorld();
    this.gameMode = mode;
    this.walkGrid = new Uint8Array(PATH_GRID_SIZE * PATH_GRID_SIZE);
    this.rebuildObstaclesAndGrid();
  }

  public rebuildObstaclesAndGrid(): void {
    this.obstacles = JUNGLE_ROCKS.map((r) => ({ ...r }));
    for (const t of TURRET_SPECS) {
      if (this.gameMode === '1v1' && t.lane !== LANE_MID) continue;
      this.obstacles.push({ x: t.x, z: t.z, radius: 2.25, height: 8, kind: 'turret' });
    }
    this.obstacles.push({
      x: NEXUS_BLUE_POS.x,
      z: NEXUS_BLUE_POS.z,
      radius: 3.5,
      height: 10,
      kind: 'nexus',
    });
    this.obstacles.push({
      x: NEXUS_RED_POS.x,
      z: NEXUS_RED_POS.z,
      radius: 3.5,
      height: 10,
      kind: 'nexus',
    });
    this.rebuildWalkGrid();
  }

  public isObstacleActive(obs: MapObstacle): boolean {
    if (obs.eid === undefined || obs.eid < 0) return true;
    return this.isAliveUnit(obs.eid);
  }

  public rebuildWalkGrid(): void {
    this.walkGrid.fill(0);
    const cellSize = MAP_SIZE / PATH_GRID_SIZE;
    for (let gz = 0; gz < PATH_GRID_SIZE; gz++) {
      for (let gx = 0; gx < PATH_GRID_SIZE; gx++) {
        const wx = -MAP_HALF_SIZE + (gx + 0.5) * cellSize;
        const wz = -MAP_HALF_SIZE + (gz + 0.5) * cellSize;
        if (Math.abs(wx) > MAP_HALF_SIZE - 2.5 || Math.abs(wz) > MAP_HALF_SIZE - 2.5) {
          this.walkGrid[gz * PATH_GRID_SIZE + gx] = 1;
          continue;
        }
        for (const obs of this.obstacles) {
          if (!this.isObstacleActive(obs)) continue;
          const dx = wx - obs.x;
          const dz = wz - obs.z;
          const pad = obs.kind === 'rock' ? 1.15 : 0.9;
          if (dx * dx + dz * dz <= (obs.radius + pad) * (obs.radius + pad)) {
            this.walkGrid[gz * PATH_GRID_SIZE + gx] = 1;
            break;
          }
        }
      }
    }
  }

  public worldToGrid(x: number, z: number): { gx: number; gz: number } {
    const gx = Math.max(
      0,
      Math.min(PATH_GRID_SIZE - 1, Math.floor(((x + MAP_HALF_SIZE) / MAP_SIZE) * PATH_GRID_SIZE))
    );
    const gz = Math.max(
      0,
      Math.min(PATH_GRID_SIZE - 1, Math.floor(((z + MAP_HALF_SIZE) / MAP_SIZE) * PATH_GRID_SIZE))
    );
    return { gx, gz };
  }

  public gridToWorld(gx: number, gz: number): Waypoint {
    const cellSize = MAP_SIZE / PATH_GRID_SIZE;
    return {
      x: -MAP_HALF_SIZE + (gx + 0.5) * cellSize,
      z: -MAP_HALF_SIZE + (gz + 0.5) * cellSize,
    };
  }

  public isPointWalkable(x: number, z: number, extraRadius = 0.6): boolean {
    if (Math.abs(x) > MAP_HALF_SIZE - 2.2 || Math.abs(z) > MAP_HALF_SIZE - 2.2) return false;
    for (const obs of this.obstacles) {
      if (!this.isObstacleActive(obs)) continue;
      const dx = x - obs.x;
      const dz = z - obs.z;
      const r = obs.radius + extraRadius;
      if (dx * dx + dz * dz < r * r) return false;
    }
    return true;
  }

  public findBrushAt(x: number, z: number): number {
    for (let b = 0; b < this.brushes.length; b++) {
      const brush = this.brushes[b];
      const dx = x - brush.x;
      const dz = z - brush.z;
      if (dx * dx + dz * dz <= brush.radius * brush.radius) {
        return b;
      }
    }
    return -1;
  }

  public isUnitInBrush(eid: number): boolean {
    return Vision.inBrushId[eid] >= 0;
  }

  public isSpeedShrineReady(index: number): boolean {
    return (this.speedShrineCooldowns[index] ?? 1) <= 0;
  }

  public getPlayerTeam(): number {
    if (this.playerEid >= 0 && entityExists(this.ecs, this.playerEid)) {
      return Team.id[this.playerEid];
    }
    return TEAM_BLUE;
  }

  public isVisibleToTeam(eid: number, viewerTeam: number): boolean {
    const kind = UnitType.kind[eid];
    if (kind === UNIT_TURRET || kind === UNIT_NEXUS) return true;
    return viewerTeam === TEAM_BLUE
      ? Vision.visibleToBlue[eid] === 1
      : Vision.visibleToRed[eid] === 1;
  }

  public isVisibleToPlayer(eid: number): boolean {
    return this.isVisibleToTeam(eid, this.getPlayerTeam());
  }

  public getLocalOpacityForUnit(eid: number): number {
    const pTeam = this.getPlayerTeam();
    if (Team.id[eid] !== pTeam) {
      return this.isVisibleToTeam(eid, pTeam) ? 1.0 : 0.0;
    }
    if (StatusEffects.invisTimer[eid] > 0) return 0.35;
    if (Vision.inBrushId[eid] >= 0) return 0.45;
    return 1.0;
  }

  public getTurretTier(eid: number): number {
    if (UnitType.kind[eid] !== UNIT_TURRET) return 0;
    return UnitType.subKind[eid];
  }

  public isStructureVulnerable(eid: number): boolean {
    if (!this.isAliveUnit(eid)) return false;
    const kind = UnitType.kind[eid];
    const team = Team.id[eid];
    if (kind !== UNIT_TURRET && kind !== UNIT_NEXUS) return true;

    const turrets = query(this.ecs, [Team, UnitType, AI]);
    if (kind === UNIT_NEXUS) {
      for (let i = 0; i < turrets.length; i++) {
        const tid = turrets[i];
        if (
          Team.id[tid] === team &&
          UnitType.kind[tid] === UNIT_TURRET &&
          UnitType.subKind[tid] === TURRET_TIER_NEXUS_GUARD &&
          UnitType.state[tid] === STATE_ALIVE
        ) {
          return false;
        }
      }
      return true;
    }

    const tier = UnitType.subKind[eid];
    const lane = AI.lane[eid];
    if (tier <= TURRET_TIER_OUTER) return true;

    if (tier === TURRET_TIER_NEXUS_GUARD) {
      let hasAnyInhibDown = false;
      let hasAnyInhib = false;
      for (let i = 0; i < turrets.length; i++) {
        const tid = turrets[i];
        if (
          Team.id[tid] === team &&
          UnitType.kind[tid] === UNIT_TURRET &&
          UnitType.subKind[tid] === TURRET_TIER_INHIB
        ) {
          hasAnyInhib = true;
          if (UnitType.state[tid] !== STATE_ALIVE) {
            hasAnyInhibDown = true;
            break;
          }
        }
      }
      return !hasAnyInhib || hasAnyInhibDown;
    }

    const reqTier = tier - 1;
    for (let i = 0; i < turrets.length; i++) {
      const tid = turrets[i];
      if (
        Team.id[tid] === team &&
        UnitType.kind[tid] === UNIT_TURRET &&
        AI.lane[tid] === lane &&
        UnitType.subKind[tid] === reqTier &&
        UnitType.state[tid] === STATE_ALIVE
      ) {
        return false;
      }
    }
    return true;
  }

  public snapshotTransforms(): void {
    const ents = query(this.ecs, [Transform]);
    for (let i = 0; i < ents.length; i++) {
      const eid = ents[i];
      Transform.prevX[eid] = Transform.x[eid];
      Transform.prevY[eid] = Transform.y[eid];
      Transform.prevZ[eid] = Transform.z[eid];
      Transform.prevRotY[eid] = Transform.rotY[eid];
    }
  }

  private initSharedUnitFields(eid: number, x: number, z: number): void {
    Stats.critChance[eid] = 0;
    Stats.magicPenFlat[eid] = 0;
    Stats.magicPenPct[eid] = 0;
    Stats.lifesteal[eid] = 0;
    Stats.cdr[eid] = 0;
    Stats.damageReduction[eid] = 0;
    Stats.thornReflect[eid] = 0;
    Stats.healAmp[eid] = 0;
    Stats.warmogPassive[eid] = 0;
    Stats.outOfCombatTimer[eid] = 0;
    Stats.shield[eid] = 0;
    Stats.shieldTimer[eid] = 0;
    Stats.attackSpeedBonus[eid] = 0;
    Stats.moveSpeedBonus[eid] = 0;

    StatusEffects.slowPercent[eid] = 0;
    StatusEffects.slowTimer[eid] = 0;
    StatusEffects.stunTimer[eid] = 0;
    StatusEffects.rootTimer[eid] = 0;
    StatusEffects.shieldAmount[eid] = 0;
    StatusEffects.shieldTimer[eid] = 0;
    StatusEffects.invisTimer[eid] = 0;
    StatusEffects.untargetableTimer[eid] = 0;
    StatusEffects.empoweredTimer[eid] = 0;
    StatusEffects.empoweredStacks[eid] = 0;
    StatusEffects.wStanceTimer[eid] = 0;
    StatusEffects.markedByEid[eid] = -1;
    StatusEffects.markTimer[eid] = 0;

    const brushId = this.findBrushAt(x, z);
    Vision.inBrushId[eid] = brushId;
    Vision.bushRevealTimer[eid] = 0;
    UnitType.inBrush[eid] = brushId >= 0 ? 1 : 0;
  }

  public spawnChampion(
    champId: number | ChampionId,
    team: number,
    x: number,
    z: number,
    lane: number = LANE_MID,
    isPlayer = false
  ): number {
    const def = getChampionData(champId);
    const wps = LANE_WAYPOINTS[lane] ?? LANE_WAYPOINTS[LANE_MID];
    const eid = addEntity(this.ecs);
    addComponents(
      this.ecs,
      eid,
      Transform,
      Movement,
      Team,
      UnitType,
      Stats,
      StatusEffects,
      Combat,
      SkillBook,
      Vision
    );
    if (!isPlayer) {
      addComponents(this.ecs, eid, AI);
      AI.role[eid] = AI_ROLE_BOT_CHAMPION;
      AI.lane[eid] = lane;
      AI.waypointIndex[eid] = team === TEAM_BLUE ? 1 : Math.max(0, wps.length - 2);
      AI.thinkTimer[eid] = 0;
      AI.consecutiveHits[eid] = 0;
      AI.lastTurretTargetEid[eid] = -1;
    }

    Transform.x[eid] = x;
    Transform.prevX[eid] = x;
    Transform.y[eid] = 0;
    Transform.prevY[eid] = 0;
    Transform.z[eid] = z;
    Transform.prevZ[eid] = z;
    const initRot = team === TEAM_BLUE ? Math.PI * 0.75 : -Math.PI * 0.25;
    Transform.rotY[eid] = initRot;
    Transform.prevRotY[eid] = initRot;
    Transform.radius[eid] = def.radius;

    Movement.vx[eid] = 0;
    Movement.vz[eid] = 0;
    Movement.targetX[eid] = x;
    Movement.targetZ[eid] = z;
    Movement.hasTarget[eid] = 0;
    Movement.baseSpeed[eid] = def.moveSpeed;
    Movement.speedMult[eid] = 1;
    Movement.speedBuffTimer[eid] = 0;
    Movement.isDashing[eid] = 0;
    Movement.dashEndX[eid] = x;
    Movement.dashEndZ[eid] = z;
    Movement.dashSpeed[eid] = 0;
    Movement.attackMove[eid] = 0;

    Team.id[eid] = team;
    UnitType.kind[eid] = UNIT_CHAMPION;
    UnitType.subKind[eid] = def.numericId;
    UnitType.state[eid] = STATE_ALIVE;
    UnitType.respawnTimer[eid] = 0;
    UnitType.spawnX[eid] = x;
    UnitType.spawnZ[eid] = z;
    UnitType.isPlayer[eid] = isPlayer ? 1 : 0;

    Stats.hp[eid] = def.maxHp;
    Stats.maxHp[eid] = def.maxHp;
    Stats.mp[eid] = def.maxMp;
    Stats.maxMp[eid] = def.maxMp;
    Stats.hpRegen[eid] = def.hpRegen;
    Stats.mpRegen[eid] = def.mpRegen;
    Stats.ad[eid] = def.ad;
    Stats.ap[eid] = def.ap;
    Stats.armor[eid] = def.armor;
    Stats.mr[eid] = def.mr;
    Stats.attackSpeed[eid] = def.attackSpeed;
    Stats.asBuffMult[eid] = 1;
    Stats.asBuffTimer[eid] = 0;
    Stats.level[eid] = 1;
    Stats.xp[eid] = 0;
    Stats.xpToNext[eid] = 280;
    Stats.gold[eid] = 500;
    Stats.kills[eid] = 0;
    Stats.deaths[eid] = 0;
    Stats.assists[eid] = 0;
    Stats.cs[eid] = 0;

    Combat.targetEid[eid] = -1;
    Combat.attackRange[eid] = def.attackRange;
    Combat.attackCooldown[eid] = 0;
    Combat.windupTimer[eid] = 0;
    Combat.isWindingUp[eid] = 0;
    Combat.projectileSpeed[eid] = def.projectileSpeed;
    Combat.lastAttackerEid[eid] = -1;
    Combat.aggroTimer[eid] = 0;
    Combat.aggroRange[eid] = 13.5;
    Combat.attackAnimTimer[eid] = 0;

    SkillBook.qCd[eid] = 0;
    SkillBook.qMaxCd[eid] = def.skills.Q.cooldown;
    SkillBook.wCd[eid] = 0;
    SkillBook.wMaxCd[eid] = def.skills.W.cooldown;
    SkillBook.eCd[eid] = 0;
    SkillBook.eMaxCd[eid] = def.skills.E.cooldown;
    SkillBook.rCd[eid] = 0;
    SkillBook.rMaxCd[eid] = def.skills.R.cooldown;
    SkillBook.dCd[eid] = 0;
    SkillBook.dMaxCd[eid] = SUMMONER_SPELLS.D.cooldown;
    SkillBook.fCd[eid] = 0;
    SkillBook.fMaxCd[eid] = SUMMONER_SPELLS.F.cooldown;
    SkillBook.qLevel[eid] = 1;
    SkillBook.wLevel[eid] = 1;
    SkillBook.eLevel[eid] = 1;
    SkillBook.rLevel[eid] = 1;
    SkillBook.skillPoints[eid] = 0;
    SkillBook.recallTimer[eid] = 0;
    SkillBook.isRecalling[eid] = 0;
    SkillBook.rRecastTimer[eid] = 0;

    Vision.range[eid] = 23.0;
    Vision.visibleToBlue[eid] = team === TEAM_BLUE ? 1 : 0;
    Vision.visibleToRed[eid] = team === TEAM_RED ? 1 : 0;

    this.initSharedUnitFields(eid, x, z);

    this.inventories.set(eid, []);
    this.championEids.push(eid);

    if (isPlayer) {
      this.playerEid = eid;
    }
    this.pendingVisualCreate.push(eid);
    return eid;
  }

  public spawnMinion(
    team: number,
    lane: number,
    minionType: number,
    x: number,
    z: number
  ): number {
    const wps = LANE_WAYPOINTS[lane] ?? LANE_WAYPOINTS[LANE_MID];
    const eid = addEntity(this.ecs);
    addComponents(
      this.ecs,
      eid,
      Transform,
      Movement,
      Team,
      UnitType,
      Stats,
      StatusEffects,
      Combat,
      AI,
      Vision
    );

    const isMelee = minionType === MINION_MELEE;
    const isSiege = minionType === MINION_SIEGE;
    const hp = isSiege ? 660 : isMelee ? 430 : 250;
    const ad = isSiege ? 36 : isMelee ? 18 : 26;
    const range = isSiege ? 8.5 : isMelee ? 2.2 : 8.0;
    const projSpeed = isMelee ? 0 : 19;
    const radius = isSiege ? 0.85 : isMelee ? 0.62 : 0.55;
    const initRot = team === TEAM_BLUE ? Math.PI * 0.75 : -Math.PI * 0.25;

    Transform.x[eid] = x;
    Transform.prevX[eid] = x;
    Transform.y[eid] = 0;
    Transform.prevY[eid] = 0;
    Transform.z[eid] = z;
    Transform.prevZ[eid] = z;
    Transform.rotY[eid] = initRot;
    Transform.prevRotY[eid] = initRot;
    Transform.radius[eid] = radius;

    Movement.vx[eid] = 0;
    Movement.vz[eid] = 0;
    Movement.targetX[eid] = x;
    Movement.targetZ[eid] = z;
    Movement.hasTarget[eid] = 0;
    Movement.baseSpeed[eid] = 6.4;
    Movement.speedMult[eid] = 1;
    Movement.speedBuffTimer[eid] = 0;
    Movement.isDashing[eid] = 0;
    Movement.dashEndX[eid] = x;
    Movement.dashEndZ[eid] = z;
    Movement.dashSpeed[eid] = 0;
    Movement.attackMove[eid] = 1;

    Team.id[eid] = team;
    UnitType.kind[eid] = UNIT_MINION;
    UnitType.subKind[eid] = minionType;
    UnitType.state[eid] = STATE_ALIVE;
    UnitType.respawnTimer[eid] = 0;
    UnitType.spawnX[eid] = x;
    UnitType.spawnZ[eid] = z;
    UnitType.isPlayer[eid] = 0;

    Stats.hp[eid] = hp;
    Stats.maxHp[eid] = hp;
    Stats.mp[eid] = 0;
    Stats.maxMp[eid] = 0;
    Stats.hpRegen[eid] = 0;
    Stats.mpRegen[eid] = 0;
    Stats.ad[eid] = ad;
    Stats.ap[eid] = 0;
    Stats.armor[eid] = isSiege ? 20 : isMelee ? 12 : 4;
    Stats.mr[eid] = 6;
    Stats.attackSpeed[eid] = isSiege ? 0.75 : 0.9;
    Stats.asBuffMult[eid] = 1;
    Stats.asBuffTimer[eid] = 0;
    Stats.level[eid] = 1;
    Stats.xp[eid] = 0;
    Stats.xpToNext[eid] = 0;
    Stats.gold[eid] = 0;
    Stats.kills[eid] = 0;
    Stats.deaths[eid] = 0;
    Stats.assists[eid] = 0;
    Stats.cs[eid] = 0;

    Combat.targetEid[eid] = -1;
    Combat.attackRange[eid] = range;
    Combat.attackCooldown[eid] = 0;
    Combat.windupTimer[eid] = 0;
    Combat.isWindingUp[eid] = 0;
    Combat.projectileSpeed[eid] = projSpeed;
    Combat.lastAttackerEid[eid] = -1;
    Combat.aggroTimer[eid] = 0;
    Combat.aggroRange[eid] = 11.0;
    Combat.attackAnimTimer[eid] = 0;

    AI.role[eid] = AI_ROLE_MINION;
    AI.lane[eid] = lane;
    AI.waypointIndex[eid] = team === TEAM_BLUE ? 1 : Math.max(0, wps.length - 2);
    AI.thinkTimer[eid] = 0;
    AI.consecutiveHits[eid] = 0;
    AI.lastTurretTargetEid[eid] = -1;

    Vision.range[eid] = 14.0;
    Vision.visibleToBlue[eid] = team === TEAM_BLUE ? 1 : 0;
    Vision.visibleToRed[eid] = team === TEAM_RED ? 1 : 0;

    this.initSharedUnitFields(eid, x, z);

    this.pendingVisualCreate.push(eid);
    return eid;
  }

  public spawnJungleMonster(campId: number, x: number, z: number): number {
    const eid = addEntity(this.ecs);
    addComponents(
      this.ecs,
      eid,
      Transform,
      Movement,
      Team,
      UnitType,
      Stats,
      StatusEffects,
      Combat,
      AI,
      Vision
    );

    Transform.x[eid] = x;
    Transform.prevX[eid] = x;
    Transform.y[eid] = 0;
    Transform.prevY[eid] = 0;
    Transform.z[eid] = z;
    Transform.prevZ[eid] = z;
    Transform.rotY[eid] = 0;
    Transform.prevRotY[eid] = 0;
    Transform.radius[eid] = 1.25;

    Movement.vx[eid] = 0;
    Movement.vz[eid] = 0;
    Movement.targetX[eid] = x;
    Movement.targetZ[eid] = z;
    Movement.hasTarget[eid] = 0;
    Movement.baseSpeed[eid] = 5.6;
    Movement.speedMult[eid] = 1;
    Movement.speedBuffTimer[eid] = 0;
    Movement.isDashing[eid] = 0;
    Movement.dashEndX[eid] = x;
    Movement.dashEndZ[eid] = z;
    Movement.dashSpeed[eid] = 0;
    Movement.attackMove[eid] = 0;

    Team.id[eid] = TEAM_NEUTRAL;
    UnitType.kind[eid] = UNIT_MONSTER;
    UnitType.subKind[eid] = campId;
    UnitType.state[eid] = STATE_ALIVE;
    UnitType.respawnTimer[eid] = 0;
    UnitType.spawnX[eid] = x;
    UnitType.spawnZ[eid] = z;
    UnitType.isPlayer[eid] = 0;

    Stats.hp[eid] = 950;
    Stats.maxHp[eid] = 950;
    Stats.mp[eid] = 0;
    Stats.maxMp[eid] = 0;
    Stats.hpRegen[eid] = 4;
    Stats.mpRegen[eid] = 0;
    Stats.ad[eid] = 44;
    Stats.ap[eid] = 0;
    Stats.armor[eid] = 24;
    Stats.mr[eid] = 20;
    Stats.attackSpeed[eid] = 0.72;
    Stats.asBuffMult[eid] = 1;
    Stats.asBuffTimer[eid] = 0;
    Stats.level[eid] = 3;
    Stats.xp[eid] = 0;
    Stats.xpToNext[eid] = 0;
    Stats.gold[eid] = 0;
    Stats.kills[eid] = 0;
    Stats.deaths[eid] = 0;
    Stats.assists[eid] = 0;
    Stats.cs[eid] = 0;

    Combat.targetEid[eid] = -1;
    Combat.attackRange[eid] = 3.2;
    Combat.attackCooldown[eid] = 0;
    Combat.windupTimer[eid] = 0;
    Combat.isWindingUp[eid] = 0;
    Combat.projectileSpeed[eid] = 0;
    Combat.lastAttackerEid[eid] = -1;
    Combat.aggroTimer[eid] = 0;
    Combat.aggroRange[eid] = 9.0;
    Combat.attackAnimTimer[eid] = 0;

    AI.role[eid] = AI_ROLE_MONSTER;
    AI.lane[eid] = campId;
    AI.waypointIndex[eid] = 0;
    AI.thinkTimer[eid] = 0;
    AI.consecutiveHits[eid] = 0;
    AI.lastTurretTargetEid[eid] = -1;

    Vision.range[eid] = 8.0;
    Vision.visibleToBlue[eid] = 0;
    Vision.visibleToRed[eid] = 0;

    this.initSharedUnitFields(eid, x, z);

    this.pendingVisualCreate.push(eid);
    return eid;
  }

  public spawnTurret(spec: TurretSpec): number {
    const eid = addEntity(this.ecs);
    addComponents(
      this.ecs,
      eid,
      Transform,
      Team,
      UnitType,
      Stats,
      StatusEffects,
      Combat,
      AI,
      Vision
    );

    const initRot = spec.team === TEAM_BLUE ? 0 : Math.PI;
    Transform.x[eid] = spec.x;
    Transform.prevX[eid] = spec.x;
    Transform.y[eid] = 0;
    Transform.prevY[eid] = 0;
    Transform.z[eid] = spec.z;
    Transform.prevZ[eid] = spec.z;
    Transform.rotY[eid] = initRot;
    Transform.prevRotY[eid] = initRot;
    Transform.radius[eid] = 2.25;

    Team.id[eid] = spec.team;
    UnitType.kind[eid] = UNIT_TURRET;
    UnitType.subKind[eid] = spec.tier;
    UnitType.state[eid] = STATE_ALIVE;
    UnitType.respawnTimer[eid] = 0;
    UnitType.spawnX[eid] = spec.x;
    UnitType.spawnZ[eid] = spec.z;
    UnitType.isPlayer[eid] = 0;

    const hp =
      spec.tier === TURRET_TIER_NEXUS_GUARD
        ? 3400
        : spec.tier === TURRET_TIER_INHIB
          ? 3000
          : spec.tier === TURRET_TIER_INNER
            ? 2600
            : 2150;
    const ad =
      spec.tier === TURRET_TIER_NEXUS_GUARD
        ? 155
        : spec.tier === TURRET_TIER_INHIB
          ? 140
          : spec.tier === TURRET_TIER_INNER
            ? 125
            : 105;
    const res = spec.tier >= TURRET_TIER_INHIB ? 55 : spec.tier === TURRET_TIER_INNER ? 48 : 42;

    Stats.hp[eid] = hp;
    Stats.maxHp[eid] = hp;
    Stats.mp[eid] = 0;
    Stats.maxMp[eid] = 0;
    Stats.hpRegen[eid] = spec.tier === TURRET_TIER_NEXUS_GUARD ? 3 : 0;
    Stats.mpRegen[eid] = 0;
    Stats.ad[eid] = ad;
    Stats.ap[eid] = 0;
    Stats.armor[eid] = res;
    Stats.mr[eid] = res;
    Stats.attackSpeed[eid] = 0.85;
    Stats.asBuffMult[eid] = 1;
    Stats.asBuffTimer[eid] = 0;
    Stats.level[eid] = spec.tier;
    Stats.xp[eid] = 0;
    Stats.xpToNext[eid] = 0;
    Stats.gold[eid] = 0;
    Stats.kills[eid] = 0;
    Stats.deaths[eid] = 0;
    Stats.assists[eid] = 0;
    Stats.cs[eid] = 0;

    Combat.targetEid[eid] = -1;
    Combat.attackRange[eid] = 15.0;
    Combat.attackCooldown[eid] = 0;
    Combat.windupTimer[eid] = 0;
    Combat.isWindingUp[eid] = 0;
    Combat.projectileSpeed[eid] = 27;
    Combat.lastAttackerEid[eid] = -1;
    Combat.aggroTimer[eid] = 0;
    Combat.aggroRange[eid] = 15.0;
    Combat.attackAnimTimer[eid] = 0;

    AI.role[eid] = AI_ROLE_TURRET;
    AI.lane[eid] = spec.lane;
    AI.waypointIndex[eid] = 0;
    AI.thinkTimer[eid] = 0;
    AI.consecutiveHits[eid] = 0;
    AI.lastTurretTargetEid[eid] = -1;

    Vision.range[eid] = 18.5;
    Vision.visibleToBlue[eid] = 1;
    Vision.visibleToRed[eid] = 1;

    this.initSharedUnitFields(eid, spec.x, spec.z);
    this.turretSpecsByEid.set(eid, spec);

    for (const obs of this.obstacles) {
      if (obs.kind === 'turret' && Math.hypot(obs.x - spec.x, obs.z - spec.z) < 0.5) {
        obs.eid = eid;
        break;
      }
    }

    this.pendingVisualCreate.push(eid);
    return eid;
  }

  public spawnNexus(team: number, x: number, z: number): number {
    const eid = addEntity(this.ecs);
    addComponents(
      this.ecs,
      eid,
      Transform,
      Team,
      UnitType,
      Stats,
      StatusEffects,
      Combat,
      Vision
    );

    const initRot = team === TEAM_BLUE ? 0 : Math.PI;
    Transform.x[eid] = x;
    Transform.prevX[eid] = x;
    Transform.y[eid] = 0;
    Transform.prevY[eid] = 0;
    Transform.z[eid] = z;
    Transform.prevZ[eid] = z;
    Transform.rotY[eid] = initRot;
    Transform.prevRotY[eid] = initRot;
    Transform.radius[eid] = 3.5;

    Team.id[eid] = team;
    UnitType.kind[eid] = UNIT_NEXUS;
    UnitType.subKind[eid] = 0;
    UnitType.state[eid] = STATE_ALIVE;
    UnitType.respawnTimer[eid] = 0;
    UnitType.spawnX[eid] = x;
    UnitType.spawnZ[eid] = z;
    UnitType.isPlayer[eid] = 0;

    Stats.hp[eid] = 4800;
    Stats.maxHp[eid] = 4800;
    Stats.mp[eid] = 0;
    Stats.maxMp[eid] = 0;
    Stats.hpRegen[eid] = 6;
    Stats.mpRegen[eid] = 0;
    Stats.ad[eid] = 0;
    Stats.ap[eid] = 0;
    Stats.armor[eid] = 45;
    Stats.mr[eid] = 45;
    Stats.attackSpeed[eid] = 0;
    Stats.asBuffMult[eid] = 1;
    Stats.asBuffTimer[eid] = 0;
    Stats.level[eid] = 18;
    Stats.xp[eid] = 0;
    Stats.xpToNext[eid] = 0;
    Stats.gold[eid] = 0;
    Stats.kills[eid] = 0;
    Stats.deaths[eid] = 0;
    Stats.assists[eid] = 0;
    Stats.cs[eid] = 0;

    Combat.targetEid[eid] = -1;
    Combat.attackRange[eid] = 0;
    Combat.attackCooldown[eid] = 0;
    Combat.windupTimer[eid] = 0;
    Combat.isWindingUp[eid] = 0;
    Combat.projectileSpeed[eid] = 0;
    Combat.lastAttackerEid[eid] = -1;
    Combat.aggroTimer[eid] = 0;
    Combat.aggroRange[eid] = 0;
    Combat.attackAnimTimer[eid] = 0;

    Vision.range[eid] = 24.0;
    Vision.visibleToBlue[eid] = 1;
    Vision.visibleToRed[eid] = 1;

    this.initSharedUnitFields(eid, x, z);

    if (team === TEAM_BLUE) this.blueNexusEid = eid;
    else this.redNexusEid = eid;

    for (const obs of this.obstacles) {
      if (obs.kind === 'nexus' && Math.hypot(obs.x - x, obs.z - z) < 0.5) {
        obs.eid = eid;
        break;
      }
    }

    this.pendingVisualCreate.push(eid);
    return eid;
  }

  public spawnProjectile(params: {
    ownerEid: number;
    targetEid: number;
    team: number;
    x: number;
    y: number;
    z: number;
    dirX: number;
    dirZ: number;
    speed: number;
    range: number;
    damage: number;
    damageType: 'physical' | 'magic' | 'true';
    hitRadius: number;
    piercing: boolean;
    explodeOnFirstChamp?: boolean;
    color: number;
    isTurretShot?: boolean;
    reduceCooldownOnHit?: number;
    slowAmount?: number;
    slowDuration?: number;
  }): number {
    const eid = addEntity(this.ecs);
    addComponents(this.ecs, eid, Transform, Team, UnitType, Projectile);

    Transform.x[eid] = params.x;
    Transform.prevX[eid] = params.x;
    Transform.y[eid] = params.y;
    Transform.prevY[eid] = params.y;
    Transform.z[eid] = params.z;
    Transform.prevZ[eid] = params.z;
    const rotY = Math.atan2(params.dirX, params.dirZ);
    Transform.rotY[eid] = rotY;
    Transform.prevRotY[eid] = rotY;
    Transform.radius[eid] = params.hitRadius;

    Team.id[eid] = params.team;
    UnitType.kind[eid] = UNIT_PROJECTILE;
    UnitType.subKind[eid] = 0;
    UnitType.state[eid] = STATE_ALIVE;
    UnitType.inBrush[eid] = 0;
    UnitType.isPlayer[eid] = 0;

    Projectile.ownerEid[eid] = params.ownerEid;
    Projectile.targetEid[eid] = params.targetEid;
    Projectile.dirX[eid] = params.dirX;
    Projectile.dirZ[eid] = params.dirZ;
    Projectile.speed[eid] = params.speed;
    Projectile.remainingRange[eid] = params.range;
    Projectile.damage[eid] = params.damage;
    Projectile.damageType[eid] =
      params.damageType === 'magic'
        ? DMG_MAGIC
        : params.damageType === 'true'
          ? DMG_TRUE
          : DMG_PHYSICAL;
    Projectile.hitRadius[eid] = params.hitRadius;
    Projectile.piercing[eid] = params.piercing ? 1 : 0;
    Projectile.explodeOnFirstChamp[eid] = params.explodeOnFirstChamp ? 1 : 0;
    Projectile.color[eid] = params.color;
    Projectile.isTurretShot[eid] = params.isTurretShot ? 1 : 0;
    Projectile.reduceCooldownOnHit[eid] = params.reduceCooldownOnHit ?? 0;
    Projectile.slowAmount[eid] = params.slowAmount ?? 0;
    Projectile.slowDuration[eid] = params.slowDuration ?? 0;

    if (params.piercing) {
      this.projectileHits.set(eid, new Set());
    }

    this.pendingVisualCreate.push(eid);
    return eid;
  }

  public spawnSkillZone(params: {
    ownerEid: number;
    team: number;
    x: number;
    z: number;
    delay: number;
    radius: number;
    damage: number;
    damageType?: 'physical' | 'magic' | 'true';
    stunDuration: number;
    rootDuration?: number;
    color: number;
    slowPercent?: number;
    slowDuration?: number;
    executeBonusMax?: number;
    duration?: number;
    isBeam?: boolean;
    dirX?: number;
    dirZ?: number;
    beamLength?: number;
    beamWidth?: number;
    zoneKind?: number;
    isBarrier?: boolean;
    barrierRadius?: number;
    tickInterval?: number;
    ticksRemaining?: number;
    isGlobal?: boolean;
  }): number {
    const eid = addEntity(this.ecs);
    addComponents(this.ecs, eid, Transform, Team, UnitType, SkillZone);

    const dirX = params.dirX ?? 0;
    const dirZ = params.dirZ ?? 1;
    const rotY = params.isBeam ? Math.atan2(dirX, dirZ) : 0;
    const inferredKind =
      params.zoneKind ??
      (params.isBarrier
        ? ZONE_BARRIER
        : params.isBeam
          ? ZONE_BEAM
          : params.ticksRemaining && params.ticksRemaining > 1
            ? ZONE_MULTI_TICK
            : params.rootDuration && params.rootDuration > 0
              ? ZONE_ROOT_TRAP
              : ZONE_AOE);

    Transform.x[eid] = params.x;
    Transform.prevX[eid] = params.x;
    Transform.y[eid] = 0.05;
    Transform.prevY[eid] = 0.05;
    Transform.z[eid] = params.z;
    Transform.prevZ[eid] = params.z;
    Transform.rotY[eid] = rotY;
    Transform.prevRotY[eid] = rotY;
    Transform.radius[eid] = params.radius;

    Team.id[eid] = params.team;
    UnitType.kind[eid] = UNIT_SKILL_ZONE;
    UnitType.subKind[eid] = inferredKind;
    UnitType.state[eid] = STATE_ALIVE;
    UnitType.inBrush[eid] = 0;
    UnitType.isPlayer[eid] = 0;

    SkillZone.ownerEid[eid] = params.ownerEid;
    SkillZone.team[eid] = params.team;
    SkillZone.zoneKind[eid] = inferredKind;
    SkillZone.delayTimer[eid] = params.delay;
    SkillZone.totalDelay[eid] = params.delay;
    SkillZone.durationTimer[eid] = params.duration ?? params.delay + 0.55;
    SkillZone.radius[eid] = params.radius;
    SkillZone.damage[eid] = params.damage;
    SkillZone.damageType[eid] =
      params.damageType === 'true'
        ? DMG_TRUE
        : params.damageType === 'physical'
          ? DMG_PHYSICAL
          : DMG_MAGIC;
    SkillZone.stunDuration[eid] = params.stunDuration;
    SkillZone.rootDuration[eid] = params.rootDuration ?? 0;
    SkillZone.triggered[eid] = 0;
    SkillZone.color[eid] = params.color;
    SkillZone.slowPercent[eid] = params.slowPercent ?? 0;
    SkillZone.slowDuration[eid] = params.slowDuration ?? 2.0;
    SkillZone.executeBonusMax[eid] = params.executeBonusMax ?? 0;
    SkillZone.isBeam[eid] = params.isBeam ? 1 : 0;
    SkillZone.dirX[eid] = dirX;
    SkillZone.dirZ[eid] = dirZ;
    SkillZone.beamLength[eid] = params.beamLength ?? 0;
    SkillZone.beamWidth[eid] = params.beamWidth ?? 0;
    SkillZone.isBarrier[eid] = params.isBarrier ? 1 : 0;
    SkillZone.barrierRadius[eid] = params.barrierRadius ?? (params.isBarrier ? params.radius : 0);
    SkillZone.tickInterval[eid] = params.tickInterval ?? 0;
    SkillZone.tickTimer[eid] = params.delay;
    SkillZone.ticksRemaining[eid] = params.ticksRemaining ?? 1;
    SkillZone.isGlobal[eid] = params.isGlobal ? 1 : 0;

    this.pendingVisualCreate.push(eid);
    return eid;
  }

  public destroyEntity(eid: number): void {
    if (!entityExists(this.ecs, eid)) return;
    UnitType.kind[eid] = 0;
    UnitType.state[eid] = 0;
    this.projectileHits.delete(eid);
    this.entityPaths.delete(eid);
    this.turretSpecsByEid.delete(eid);
    this.pendingVisualDestroy.push(eid);
    removeEntity(this.ecs, eid);
  }

  public isAliveUnit(eid: number): boolean {
    if (eid < 0 || !entityExists(this.ecs, eid)) return false;
    return UnitType.state[eid] === STATE_ALIVE && Stats.hp[eid] > 0;
  }
}
