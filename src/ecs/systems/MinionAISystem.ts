import { query, hasComponent, type QueryResult } from 'bitecs';
import {
  Transform,
  Movement,
  Team,
  UnitType,
  Stats,
  StatusEffects,
  Combat,
  AI,
  Vision,
  STATE_ALIVE,
  UNIT_CHAMPION,
  UNIT_MINION,
  UNIT_TURRET,
  UNIT_NEXUS,
  MINION_MELEE,
  MINION_CASTER,
  TEAM_BLUE,
  TEAM_RED,
  TEAM_NEUTRAL,
  LANE_TOP,
  LANE_MID,
  LANE_BOT,
  AI_ROLE_MINION,
  AI_ROLE_MONSTER,
} from '../Components';
import {
  GameWorld,
  LANE_WAYPOINTS,
  NEXUS_BLUE_POS,
  NEXUS_RED_POS,
  SPEED_SHRINES,
} from '../World';
import { NavigationSystem } from './NavigationSystem';
import { EventBus } from '../../core/EventBus';

export const FIRST_WAVE_DELAY = 2.0;
export const WAVE_INTERVAL = 30.0;

export class MinionAISystem {
  private world: GameWorld;
  private nav: NavigationSystem;
  private bus: EventBus;
  private nextWaveTime = FIRST_WAVE_DELAY;
  private waveNumber = 0;

  constructor(world: GameWorld, nav: NavigationSystem, bus: EventBus) {
    this.world = world;
    this.nav = nav;
    this.bus = bus;
  }

  public update(dt: number): void {
    if (this.world.matchEnded) return;

    this.nextWaveTime -= dt;
    if (this.nextWaveTime <= 1e-5) {
      this.nextWaveTime += WAVE_INTERVAL;
      this.waveNumber += 1;
      this.spawnAllWaves();
    }

    const units = query(this.world.ecs, [Transform, Team, UnitType, Stats, Combat]);
    const aiEnts = query(this.world.ecs, [Transform, Movement, Team, UnitType, Stats, Combat, AI]);

    const aliveChamps: number[] = [];
    for (let i = 0; i < units.length; i++) {
      const uid = units[i];
      if (UnitType.kind[uid] === UNIT_CHAMPION && UnitType.state[uid] === STATE_ALIVE) {
        aliveChamps.push(uid);
      }
    }

    this.updateSpeedShrines(dt, aliveChamps);

    for (let i = 0; i < aiEnts.length; i++) {
      const eid = aiEnts[i];
      if (UnitType.state[eid] !== STATE_ALIVE) continue;

      const role = AI.role[eid];
      if (role === AI_ROLE_MINION) {
        this.updateMinion(eid, dt, units, aliveChamps);
      } else if (role === AI_ROLE_MONSTER) {
        this.updateJungleMonster(eid);
      }
    }
  }

  private updateSpeedShrines(dt: number, aliveChamps: number[]): void {
    for (let s = 0; s < SPEED_SHRINES.length; s++) {
      if (this.world.speedShrineCooldowns[s] > 0) {
        this.world.speedShrineCooldowns[s] = Math.max(0, this.world.speedShrineCooldowns[s] - dt);
        continue;
      }

      const shrine = SPEED_SHRINES[s];
      for (let c = 0; c < aliveChamps.length; c++) {
        const cid = aliveChamps[c];
        const triggerR = shrine.radius + Transform.radius[cid];
        const dx = Transform.x[cid] - shrine.x;
        const dz = Transform.z[cid] - shrine.z;
        if (dx * dx + dz * dz <= triggerR * triggerR) {
          this.world.speedShrineCooldowns[s] = shrine.cooldown;
          Movement.speedMult[cid] = Math.max(Movement.speedMult[cid], 1 + shrine.speedBonus);
          Movement.speedBuffTimer[cid] = Math.max(Movement.speedBuffTimer[cid], shrine.duration);
          this.bus.emit('speedShrine', {
            eid: cid,
            shrineId: shrine.id,
            x: shrine.x,
            z: shrine.z,
          });
          this.bus.emit('skillImpact', {
            kind: 'shrine',
            x: shrine.x,
            z: shrine.z,
            radius: shrine.radius + 1.2,
            color: 0x22d3ee,
            duration: 0.55,
          });
          break;
        }
      }
    }
  }

  private spawnAllWaves(): void {
    if (this.waveNumber === 1) {
      this.bus.emit('announcement', {
        text: 'Lính đã xuất quân! (Đợt mới mỗi 30 giây)',
        color: '#e2e8f0',
      });
    }

    const activeLanes =
      this.world.gameMode === '1v1' ? [LANE_MID] : [LANE_TOP, LANE_MID, LANE_BOT];

    for (const lane of activeLanes) {
      if (this.world.blueNexusEid < 0 || this.world.isAliveUnit(this.world.blueNexusEid)) {
        this.spawnLaneWave(TEAM_BLUE, lane);
      }
      if (this.world.redNexusEid < 0 || this.world.isAliveUnit(this.world.redNexusEid)) {
        this.spawnLaneWave(TEAM_RED, lane);
      }
    }
  }

  private spawnLaneWave(team: number, lane: number): void {
    const wps = LANE_WAYPOINTS[lane] ?? LANE_WAYPOINTS[LANE_MID];
    const nexusPos = team === TEAM_BLUE ? NEXUS_BLUE_POS : NEXUS_RED_POS;
    const towardWp = team === TEAM_BLUE ? wps[1] : wps[wps.length - 2];

    const dx = towardWp.x - nexusPos.x;
    const dz = towardWp.z - nexusPos.z;
    const len = Math.max(0.01, Math.hypot(dx, dz));
    const fx = dx / len;
    const fz = dz / len;
    const px = -fz;
    const pz = fx;

    // 3 Melee Minions in front + 3 Caster Minions behind, spawned cleanly outside Nexus perimeter
    const formation = [
      { type: MINION_MELEE, fwd: 1.8, side: -1.6 },
      { type: MINION_MELEE, fwd: 1.8, side: 0 },
      { type: MINION_MELEE, fwd: 1.8, side: 1.6 },
      { type: MINION_CASTER, fwd: -0.7, side: -1.6 },
      { type: MINION_CASTER, fwd: -0.7, side: 0 },
      { type: MINION_CASTER, fwd: -0.7, side: 1.6 },
    ];

    const spawnOffsetDist = Math.min(11.5, len * 0.65);
    const basePt = {
      x: nexusPos.x + fx * spawnOffsetDist,
      z: nexusPos.z + fz * spawnOffsetDist,
    };

    for (const o of formation) {
      const sx = basePt.x + fx * o.fwd + px * o.side;
      const sz = basePt.z + fz * o.fwd + pz * o.side;
      this.world.spawnMinion(team, lane, o.type, sx, sz);
    }
  }

  private isUnitTargetableToTeam(uid: number, viewerTeam: number): boolean {
    if (hasComponent(this.world.ecs, uid, StatusEffects) && StatusEffects.untargetableTimer[uid] > 0) {
      return false;
    }
    const uKind = UnitType.kind[uid];
    if (uKind === UNIT_TURRET || uKind === UNIT_NEXUS) return true;
    const vis = viewerTeam === TEAM_BLUE ? Vision.visibleToBlue[uid] : Vision.visibleToRed[uid];
    return vis === 1;
  }

  private updateMinion(eid: number, dt: number, units: QueryResult, aliveChamps: number[]): void {
    const myTeam = Team.id[eid];
    const mx = Transform.x[eid];
    const mz = Transform.z[eid];
    const aggroR = Combat.aggroRange[eid];

    // MOBA Call-For-Help Aggro: Enemy Champion hitting nearby Allied Champion
    let immediateChampAggro = -1;
    let immediateChampDistSq = (aggroR + 1.5) * (aggroR + 1.5);
    const allyHelpRangeSq = (aggroR + 3.0) * (aggroR + 3.0);

    for (let c = 0; c < aliveChamps.length; c++) {
      const ally = aliveChamps[c];
      if (Team.id[ally] !== myTeam || Combat.aggroTimer[ally] <= 0) continue;

      const allyDx = Transform.x[ally] - mx;
      const allyDz = Transform.z[ally] - mz;
      if (allyDx * allyDx + allyDz * allyDz > allyHelpRangeSq) continue;

      const attacker = Combat.lastAttackerEid[ally];
      if (
        attacker >= 0 &&
        this.world.isAliveUnit(attacker) &&
        Team.id[attacker] !== myTeam &&
        UnitType.kind[attacker] === UNIT_CHAMPION &&
        this.isUnitTargetableToTeam(attacker, myTeam)
      ) {
        const adx = Transform.x[attacker] - mx;
        const adz = Transform.z[attacker] - mz;
        const dSq = adx * adx + adz * adz;
        if (dSq <= immediateChampDistSq) {
          immediateChampDistSq = dSq;
          immediateChampAggro = attacker;
        }
      }
    }

    if (immediateChampAggro >= 0) {
      if (Combat.targetEid[eid] !== immediateChampAggro) {
        Combat.targetEid[eid] = immediateChampAggro;
        Combat.isWindingUp[eid] = 0;
      }
      AI.thinkTimer[eid] = 0.2;
      return;
    }

    const curTarget = Combat.targetEid[eid];
    if (curTarget >= 0) {
      if (!this.world.isAliveUnit(curTarget) || !this.isUnitTargetableToTeam(curTarget, myTeam)) {
        Combat.targetEid[eid] = -1;
        Combat.isWindingUp[eid] = 0;
      } else {
        const leash = aggroR + 4.0 + Transform.radius[curTarget];
        const cdx = Transform.x[curTarget] - mx;
        const cdz = Transform.z[curTarget] - mz;
        if (cdx * cdx + cdz * cdz > leash * leash) {
          Combat.targetEid[eid] = -1;
          Combat.isWindingUp[eid] = 0;
        }
      }
    }

    AI.thinkTimer[eid] -= dt;
    if (AI.thinkTimer[eid] > 0 && Combat.targetEid[eid] >= 0) {
      return;
    }
    AI.thinkTimer[eid] = 0.2;

    let bestMinion = -1;
    let bestMinionDist = aggroR * aggroR;
    let bestStruct = -1;
    let bestStructDist = (aggroR + 2.5) * (aggroR + 2.5);
    let bestChamp = -1;
    let bestChampDist = (aggroR - 1.0) * (aggroR - 1.0);

    for (let i = 0; i < units.length; i++) {
      const uid = units[i];
      const uTeam = Team.id[uid];
      if (uTeam === myTeam || uTeam === TEAM_NEUTRAL || UnitType.state[uid] !== STATE_ALIVE) {
        continue;
      }
      if (!this.isUnitTargetableToTeam(uid, myTeam)) continue;

      const uKind = UnitType.kind[uid];
      const dx = Transform.x[uid] - mx;
      const dz = Transform.z[uid] - mz;
      const dSq = dx * dx + dz * dz;

      if (uKind === UNIT_MINION && dSq < bestMinionDist) {
        bestMinionDist = dSq;
        bestMinion = uid;
      } else if ((uKind === UNIT_TURRET || uKind === UNIT_NEXUS) && dSq < bestStructDist) {
        bestStructDist = dSq;
        bestStruct = uid;
      } else if (uKind === UNIT_CHAMPION && dSq < bestChampDist) {
        bestChampDist = dSq;
        bestChamp = uid;
      }
    }

    const chosenTarget =
      bestMinion >= 0 ? bestMinion : bestStruct >= 0 ? bestStruct : bestChamp;

    if (chosenTarget >= 0) {
      Combat.targetEid[eid] = chosenTarget;
      return;
    }

    Combat.targetEid[eid] = -1;

    const lane = AI.lane[eid];
    const wps = LANE_WAYPOINTS[lane] ?? LANE_WAYPOINTS[LANE_MID];
    let wpIdx = AI.waypointIndex[eid];
    const wp = wps[wpIdx];
    if (!wp) return;

    if (Math.hypot(wp.x - mx, wp.z - mz) < 4.5) {
      if (myTeam === TEAM_BLUE && wpIdx < wps.length - 1) wpIdx++;
      else if (myTeam === TEAM_RED && wpIdx > 0) wpIdx--;
      AI.waypointIndex[eid] = wpIdx;
    }

    const nextWp = wps[AI.waypointIndex[eid]];
    this.nav.commandMoveTo(eid, nextWp.x, nextWp.z, true);
  }

  private updateJungleMonster(eid: number): void {
    const sx = UnitType.spawnX[eid];
    const sz = UnitType.spawnZ[eid];
    const distFromHome = Math.hypot(Transform.x[eid] - sx, Transform.z[eid] - sz);

    const target = Combat.targetEid[eid];
    if (target >= 0) {
      const untargetable =
        hasComponent(this.world.ecs, target, StatusEffects) &&
        StatusEffects.untargetableTimer[target] > 0;
      if (!this.world.isAliveUnit(target) || untargetable || distFromHome > 15.0) {
        Combat.targetEid[eid] = -1;
        Combat.isWindingUp[eid] = 0;
        this.nav.commandMoveTo(eid, sx, sz, false);
        return;
      }
    } else if (distFromHome > 1.2 && Movement.hasTarget[eid] === 0) {
      this.nav.commandMoveTo(eid, sx, sz, false);
    }
  }
}
