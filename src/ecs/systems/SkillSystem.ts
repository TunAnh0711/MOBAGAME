import { query, hasComponent } from 'bitecs';
import {
  Transform,
  Movement,
  Team,
  UnitType,
  Stats,
  StatusEffects,
  Combat,
  SkillBook,
  SkillZone,
  Vision,
  STATE_ALIVE,
  UNIT_CHAMPION,
  UNIT_MINION,
  UNIT_MONSTER,
  TEAM_BLUE,
  TEAM_NEUTRAL,
  DMG_PHYSICAL,
  DMG_TRUE,
  ZONE_AOE,
  ZONE_BEAM,
  ZONE_BARRIER,
  ZONE_ROOT_TRAP,
  ZONE_MULTI_TICK,
} from '../Components';
import {
  GameWorld,
  FOUNTAIN_BLUE,
  FOUNTAIN_RED,
  MAP_HALF_SIZE,
  BUSH_ATTACK_REVEAL_TIME,
} from '../World';
import { EventBus, SkillSlot } from '../../core/EventBus';
import { CombatSystem } from './CombatSystem';
import { getChampionData, SUMMONER_SPELLS } from '../../data/ChampionsData';

interface ChannelState {
  timer: number;
  zoneEid: number;
}

interface PendingStanceWave {
  dirX: number;
  dirZ: number;
  damage: number;
  range: number;
  radius: number;
  speed: number;
  slowAmount: number;
  slowDuration: number;
  color: number;
}

interface PendingShadowAssassinate {
  timer: number;
  targetEid: number;
  fallbackX: number;
  fallbackZ: number;
  damage: number;
  executeBonusMax: number;
  color: number;
}

interface TitanFortressState {
  timer: number;
  pulseAccumulator: number;
  radius: number;
  slowAmount: number;
  slowDuration: number;
  color: number;
}

function computeCdrMultiplier(cdrVal: number): number {
  if (cdrVal <= 0) return 1;
  if (cdrVal >= 1) {
    // Ability Haste formula (e.g. +20 AH -> 100 / 120)
    return Math.max(0.45, 100 / (100 + cdrVal));
  }
  return 1 - Math.min(0.45, cdrVal);
}

export class SkillSystem {
  private world: GameWorld;
  private bus: EventBus;
  private combat: CombatSystem;
  private channelingR = new Map<number, ChannelState>();

  // Per-champion active ability states
  private valkyrieBonusAd = new Map<number, number>();
  private valkyriePendingWave = new Map<number, PendingStanceWave>();
  private activeSkillDr = new Map<number, { amount: number; timer: number }>();
  private titanFortress = new Map<number, TitanFortressState>();
  private shadowPendingUlt = new Map<number, PendingShadowAssassinate>();

  constructor(world: GameWorld, bus: EventBus, combat: CombatSystem) {
    this.world = world;
    this.bus = bus;
    this.combat = combat;
  }

  public isChanneling(eid: number): boolean {
    return this.channelingR.has(eid) || this.shadowPendingUlt.has(eid);
  }

  public isRecastReady(eid: number, slot: SkillSlot): boolean {
    return slot === 'R' && UnitType.subKind[eid] === 1 && SkillBook.rRecastTimer[eid] > 0;
  }

  private setSkillDamageReduction(eid: number, amount: number, duration: number): void {
    const prev = this.activeSkillDr.get(eid);
    if (prev) {
      Stats.damageReduction[eid] = Math.max(0, Stats.damageReduction[eid] - prev.amount);
    }
    const clamped = Math.max(0, Math.min(0.7, amount));
    Stats.damageReduction[eid] += clamped;
    this.activeSkillDr.set(eid, { amount: clamped, timer: duration });
  }

  private clearSkillDamageReduction(eid: number): void {
    const prev = this.activeSkillDr.get(eid);
    if (prev) {
      Stats.damageReduction[eid] = Math.max(0, Stats.damageReduction[eid] - prev.amount);
      this.activeSkillDr.delete(eid);
    }
  }

  private clearValkyrieEmpowerBonus(eid: number): void {
    const bonus = this.valkyrieBonusAd.get(eid);
    if (bonus !== undefined) {
      Stats.ad[eid] = Math.max(10, Stats.ad[eid] - bonus);
      this.valkyrieBonusAd.delete(eid);
    }
  }

  public update(dt: number): void {
    // 0. Update R channeling locks
    for (const [eid, ch] of this.channelingR.entries()) {
      if (!this.world.isAliveUnit(eid)) {
        if (ch.zoneEid >= 0 && SkillZone.triggered[ch.zoneEid] === 0) {
          this.world.destroyEntity(ch.zoneEid);
        }
        this.channelingR.delete(eid);
        continue;
      }

      ch.timer -= dt;
      Movement.hasTarget[eid] = 0;
      Movement.vx[eid] = 0;
      Movement.vz[eid] = 0;
      Combat.isWindingUp[eid] = 0;
      this.world.entityPaths.delete(eid);

      if (ch.timer <= 0) {
        this.channelingR.delete(eid);
      }
    }

    // 0b. Update SHADOW R 0.4s untargetable vanish -> reappear behind target execute
    for (const [eid, ult] of this.shadowPendingUlt.entries()) {
      if (!this.world.isAliveUnit(eid)) {
        this.shadowPendingUlt.delete(eid);
        continue;
      }

      ult.timer -= dt;
      Movement.hasTarget[eid] = 0;
      Movement.vx[eid] = 0;
      Movement.vz[eid] = 0;
      Combat.isWindingUp[eid] = 0;
      this.world.entityPaths.delete(eid);

      if (ult.timer <= 0) {
        this.shadowPendingUlt.delete(eid);
        StatusEffects.untargetableTimer[eid] = 0;
        this.executeShadowAssassinateLanding(eid, ult);
      }
    }

    // 0c. Update River Speed Shrines (+35% MS for 3s, 20s cooldown)
    const shrines = this.world.speedShrines;
    const shrineCds = this.world.speedShrineCooldowns;
    for (let s = 0; s < shrines.length; s++) {
      if (shrineCds[s] > 0) {
        shrineCds[s] = Math.max(0, shrineCds[s] - dt);
      }
    }

    const champs = query(this.world.ecs, [Transform, Movement, Team, UnitType, Stats, SkillBook]);
    const allUnits = query(this.world.ecs, [Transform, Team, UnitType, Stats]);

    // 1. Update Champion timers, regen, buffs, CC, stances, and Recall
    for (let i = 0; i < champs.length; i++) {
      const eid = champs[i];
      if (UnitType.state[eid] !== STATE_ALIVE) {
        this.clearValkyrieEmpowerBonus(eid);
        this.clearSkillDamageReduction(eid);
        this.valkyriePendingWave.delete(eid);
        this.titanFortress.delete(eid);
        this.shadowPendingUlt.delete(eid);
        continue;
      }

      if (SkillBook.qCd[eid] > 0) SkillBook.qCd[eid] = Math.max(0, SkillBook.qCd[eid] - dt);
      if (SkillBook.wCd[eid] > 0) SkillBook.wCd[eid] = Math.max(0, SkillBook.wCd[eid] - dt);
      if (SkillBook.eCd[eid] > 0) SkillBook.eCd[eid] = Math.max(0, SkillBook.eCd[eid] - dt);
      if (SkillBook.rCd[eid] > 0) SkillBook.rCd[eid] = Math.max(0, SkillBook.rCd[eid] - dt);
      if (SkillBook.dCd[eid] > 0) SkillBook.dCd[eid] = Math.max(0, SkillBook.dCd[eid] - dt);
      if (SkillBook.fCd[eid] > 0) SkillBook.fCd[eid] = Math.max(0, SkillBook.fCd[eid] - dt);

      // VALKYRIE R2 recast window countdown
      if (SkillBook.rRecastTimer[eid] > 0) {
        SkillBook.rRecastTimer[eid] = Math.max(0, SkillBook.rRecastTimer[eid] - dt);
        if (SkillBook.rRecastTimer[eid] <= 0 && SkillBook.rCd[eid] <= 0) {
          SkillBook.rCd[eid] = SkillBook.rMaxCd[eid];
        }
      }

      if (StatusEffects.stunTimer[eid] > 0) {
        StatusEffects.stunTimer[eid] = Math.max(0, StatusEffects.stunTimer[eid] - dt);
      }
      if (StatusEffects.rootTimer[eid] > 0) {
        StatusEffects.rootTimer[eid] = Math.max(0, StatusEffects.rootTimer[eid] - dt);
      }
      if (StatusEffects.slowTimer[eid] > 0) {
        StatusEffects.slowTimer[eid] = Math.max(0, StatusEffects.slowTimer[eid] - dt);
        if (StatusEffects.slowTimer[eid] <= 0) StatusEffects.slowPercent[eid] = 0;
      }
      if (StatusEffects.invisTimer[eid] > 0) {
        StatusEffects.invisTimer[eid] = Math.max(0, StatusEffects.invisTimer[eid] - dt);
      }
      if (StatusEffects.untargetableTimer[eid] > 0) {
        StatusEffects.untargetableTimer[eid] = Math.max(0, StatusEffects.untargetableTimer[eid] - dt);
      }
      if (StatusEffects.markTimer[eid] > 0) {
        StatusEffects.markTimer[eid] = Math.max(0, StatusEffects.markTimer[eid] - dt);
        if (StatusEffects.markTimer[eid] <= 0) StatusEffects.markedByEid[eid] = -1;
      }

      // Empowered state (VALKYRIE R 6s transform or SHADOW E crit stack)
      if (StatusEffects.empoweredTimer[eid] > 0) {
        StatusEffects.empoweredTimer[eid] = Math.max(0, StatusEffects.empoweredTimer[eid] - dt);
        if (StatusEffects.empoweredTimer[eid] <= 0) {
          StatusEffects.empoweredStacks[eid] = 0;
          this.clearValkyrieEmpowerBonus(eid);
        }
      }

      // Skill Damage Reduction timer (TITAN W 3s / VALKYRIE W 1s)
      const drEntry = this.activeSkillDr.get(eid);
      if (drEntry) {
        drEntry.timer -= dt;
        if (drEntry.timer <= 0) {
          this.clearSkillDamageReduction(eid);
        }
      }

      // VALKYRIE W 1.0s defensive stance -> fires piercing sword wave when stance finishes!
      if (StatusEffects.wStanceTimer[eid] > 0) {
        StatusEffects.wStanceTimer[eid] = Math.max(0, StatusEffects.wStanceTimer[eid] - dt);
        if (StatusEffects.wStanceTimer[eid] <= 0) {
          const wave = this.valkyriePendingWave.get(eid);
          if (wave) {
            this.valkyriePendingWave.delete(eid);
            this.fireValkyrieSwordWave(eid, wave);
          }
        }
      }

      // TITAN W 3.0s Fortress slow aura around self
      const fort = this.titanFortress.get(eid);
      if (fort) {
        fort.timer -= dt;
        fort.pulseAccumulator += dt;
        if (fort.pulseAccumulator >= 0.35) {
          fort.pulseAccumulator = 0;
          const cx = Transform.x[eid];
          const cz = Transform.z[eid];
          const myTeam = Team.id[eid];
          for (let u = 0; u < allUnits.length; u++) {
            const uid = allUnits[u];
            if (Team.id[uid] === myTeam || UnitType.state[uid] !== STATE_ALIVE) continue;
            if (Math.hypot(Transform.x[uid] - cx, Transform.z[uid] - cz) <= fort.radius + Transform.radius[uid]) {
              StatusEffects.slowPercent[uid] = Math.max(StatusEffects.slowPercent[uid], fort.slowAmount);
              StatusEffects.slowTimer[uid] = Math.max(StatusEffects.slowTimer[uid], fort.slowDuration);
            }
          }
        }
        if (fort.timer <= 0) {
          this.titanFortress.delete(eid);
        }
      }

      if (Movement.speedBuffTimer[eid] > 0) {
        Movement.speedBuffTimer[eid] = Math.max(0, Movement.speedBuffTimer[eid] - dt);
        if (Movement.speedBuffTimer[eid] <= 0) Movement.speedMult[eid] = 1;
      }

      if (Stats.asBuffTimer[eid] > 0) {
        Stats.asBuffTimer[eid] = Math.max(0, Stats.asBuffTimer[eid] - dt);
        if (Stats.asBuffTimer[eid] <= 0) Stats.asBuffMult[eid] = 1;
      }

      if (StatusEffects.shieldTimer[eid] > 0) {
        StatusEffects.shieldTimer[eid] = Math.max(0, StatusEffects.shieldTimer[eid] - dt);
        if (StatusEffects.shieldTimer[eid] <= 0) StatusEffects.shieldAmount[eid] = 0;
      } else if (StatusEffects.shieldAmount[eid] > 0) {
        StatusEffects.shieldAmount[eid] = 0;
      }

      // Passive HP/MP regen (HP regen amplified by Giáp Tâm Linh healAmp)
      const healAmp = 1 + Math.max(0, Stats.healAmp[eid]);
      Stats.hp[eid] = Math.min(Stats.maxHp[eid], Stats.hp[eid] + Stats.hpRegen[eid] * healAmp * dt);
      Stats.mp[eid] = Math.min(Stats.maxMp[eid], Stats.mp[eid] + Stats.mpRegen[eid] * dt);

      // Step on River Speed Shrine check
      for (let s = 0; s < shrines.length; s++) {
        if (shrineCds[s] > 0) continue;
        const sh = shrines[s];
        const sdx = Transform.x[eid] - sh.x;
        const sdz = Transform.z[eid] - sh.z;
        if (sdx * sdx + sdz * sdz <= sh.radius * sh.radius) {
          shrineCds[s] = sh.cooldown;
          Movement.speedMult[eid] = Math.max(Movement.speedMult[eid], 1 + sh.speedBonus);
          Movement.speedBuffTimer[eid] = Math.max(Movement.speedBuffTimer[eid], sh.duration);
          this.bus.emit('speedShrine', { eid, shrineId: sh.id, x: sh.x, z: sh.z });
          this.bus.emit('skillImpact', {
            kind: 'shrine',
            x: sh.x,
            z: sh.z,
            radius: sh.radius * 1.35,
            color: 0x2dd4bf,
          });
        }
      }

      // Recall channeling
      if (SkillBook.isRecalling[eid] === 1) {
        if (
          Movement.hasTarget[eid] === 1 ||
          Movement.isDashing[eid] === 1 ||
          StatusEffects.stunTimer[eid] > 0 ||
          this.isChanneling(eid)
        ) {
          SkillBook.isRecalling[eid] = 0;
          SkillBook.recallTimer[eid] = 0;
        } else {
          SkillBook.recallTimer[eid] -= dt;
          if (SkillBook.recallTimer[eid] <= 0) {
            SkillBook.isRecalling[eid] = 0;
            SkillBook.recallTimer[eid] = 0;
            Combat.targetEid[eid] = -1;
            Combat.isWindingUp[eid] = 0;
            const fountain = Team.id[eid] === TEAM_BLUE ? FOUNTAIN_BLUE : FOUNTAIN_RED;
            Transform.x[eid] = fountain.x;
            Transform.prevX[eid] = fountain.x;
            Transform.z[eid] = fountain.z;
            Transform.prevZ[eid] = fountain.z;
            this.world.entityPaths.delete(eid);
            this.bus.emit('skillImpact', {
              kind: 'recall',
              x: fountain.x,
              z: fountain.z,
              radius: 2.5,
              color: 0x38bdf8,
            });
          }
        }
      }
    }

    // Update non-champion status timers
    for (let i = 0; i < allUnits.length; i++) {
      const eid = allUnits[i];
      if (UnitType.kind[eid] === UNIT_CHAMPION || UnitType.state[eid] !== STATE_ALIVE) continue;
      if (StatusEffects.stunTimer[eid] > 0) {
        StatusEffects.stunTimer[eid] = Math.max(0, StatusEffects.stunTimer[eid] - dt);
      }
      if (StatusEffects.rootTimer[eid] > 0) {
        StatusEffects.rootTimer[eid] = Math.max(0, StatusEffects.rootTimer[eid] - dt);
      }
      if (StatusEffects.slowTimer[eid] > 0) {
        StatusEffects.slowTimer[eid] = Math.max(0, StatusEffects.slowTimer[eid] - dt);
        if (StatusEffects.slowTimer[eid] <= 0) StatusEffects.slowPercent[eid] = 0;
      }
      if (StatusEffects.shieldTimer[eid] > 0) {
        StatusEffects.shieldTimer[eid] = Math.max(0, StatusEffects.shieldTimer[eid] - dt);
        if (StatusEffects.shieldTimer[eid] <= 0) StatusEffects.shieldAmount[eid] = 0;
      }
      if (StatusEffects.markTimer[eid] > 0) {
        StatusEffects.markTimer[eid] = Math.max(0, StatusEffects.markTimer[eid] - dt);
        if (StatusEffects.markTimer[eid] <= 0) StatusEffects.markedByEid[eid] = -1;
      }
    }

    // 2. Update Skill Zones (AoE, Beams, TITAN R Barrier, AURELIA W Root Trap, NOVA W / AURELIA R Multi-Tick)
    this.updateSkillZones(dt, allUnits);
  }

  private updateSkillZones(dt: number, units: ArrayLike<number>): void {
    const zones = query(this.world.ecs, [Transform, SkillZone]);
    const expiredZones: number[] = [];

    for (let i = 0; i < zones.length; i++) {
      const zid = zones[i];
      SkillZone.delayTimer[zid] -= dt;
      SkillZone.durationTimer[zid] -= dt;

      const zx = Transform.x[zid];
      const zz = Transform.z[zid];
      const zTeam = SkillZone.team[zid];
      const owner = SkillZone.ownerEid[zid];
      const dmg = SkillZone.damage[zid];
      const dmgType =
        SkillZone.damageType[zid] === DMG_TRUE
          ? 'true'
          : SkillZone.damageType[zid] === DMG_PHYSICAL
            ? 'physical'
            : 'magic';
      const isBeam = SkillZone.isBeam[zid] === 1;
      const zKind = SkillZone.zoneKind[zid];

      // Multi-tick Bombardment (NOVA W Missile Rain / AURELIA R 4 Meteors)
      if (zKind === ZONE_MULTI_TICK && SkillZone.ticksRemaining[zid] > 0) {
        SkillZone.tickTimer[zid] -= dt;
        if (SkillZone.tickTimer[zid] <= 0) {
          SkillZone.triggered[zid] = 1;
          SkillZone.ticksRemaining[zid] -= 1;
          SkillZone.tickTimer[zid] += Math.max(0.15, SkillZone.tickInterval[zid]);

          const rad = SkillZone.radius[zid];
          const slowPct = SkillZone.slowPercent[zid];
          const slowDur = SkillZone.slowDuration[zid];

          for (let u = 0; u < units.length; u++) {
            const uid = units[u];
            if (Team.id[uid] === zTeam || UnitType.state[uid] !== STATE_ALIVE) continue;
            if (StatusEffects.untargetableTimer[uid] > 0) continue;
            const dist = Math.hypot(Transform.x[uid] - zx, Transform.z[uid] - zz);
            if (dist <= rad + Transform.radius[uid]) {
              this.combat.applyDamage(uid, owner, dmg, dmgType);
              if (slowPct > 0 && this.world.isAliveUnit(uid)) {
                StatusEffects.slowPercent[uid] = Math.max(StatusEffects.slowPercent[uid], slowPct);
                StatusEffects.slowTimer[uid] = Math.max(StatusEffects.slowTimer[uid], slowDur);
              }
            }
          }

          // Scatter slight visual offset for missiles/meteors inside the circle
          const jitterAngle = (SkillZone.ticksRemaining[zid] * 2.1) % (Math.PI * 2);
          const jitterR = rad >= 4.5 ? 1.2 : 0.75;
          this.bus.emit('skillImpact', {
            kind: 'meteor',
            x: zx + Math.cos(jitterAngle) * jitterR,
            z: zz + Math.sin(jitterAngle) * jitterR,
            radius: rad * 0.78,
            color: SkillZone.color[zid],
          });

          const player = this.world.playerEid;
          if (player >= 0 && Math.hypot(Transform.x[player] - zx, Transform.z[player] - zz) < 32) {
            this.bus.emit('cameraShake', { intensity: rad >= 4.5 ? 0.28 : 0.14 });
          }
        }

        if (SkillZone.durationTimer[zid] <= 0) {
          expiredZones.push(zid);
        }
        continue;
      }

      // Ground AoE pre-detonation slow
      if (!isBeam && SkillZone.triggered[zid] === 0 && SkillZone.slowPercent[zid] > 0) {
        const rad = SkillZone.radius[zid];
        const slowPct = SkillZone.slowPercent[zid];
        for (let u = 0; u < units.length; u++) {
          const uid = units[u];
          if (Team.id[uid] === zTeam || UnitType.state[uid] !== STATE_ALIVE) continue;
          const dist = Math.hypot(Transform.x[uid] - zx, Transform.z[uid] - zz);
          if (dist <= rad + Transform.radius[uid]) {
            StatusEffects.slowPercent[uid] = Math.max(StatusEffects.slowPercent[uid], slowPct);
            StatusEffects.slowTimer[uid] = Math.max(StatusEffects.slowTimer[uid], 0.25);
          }
        }
      }

      if (SkillZone.triggered[zid] === 0 && SkillZone.delayTimer[zid] <= 0) {
        SkillZone.triggered[zid] = 1;
        const stun = SkillZone.stunDuration[zid];
        const root = SkillZone.rootDuration[zid];
        const slowPct = SkillZone.slowPercent[zid];
        const slowDur = SkillZone.slowDuration[zid];

        if (isBeam) {
          const dirX = SkillZone.dirX[zid];
          const dirZ = SkillZone.dirZ[zid];
          const perpX = -dirZ;
          const perpZ = dirX;
          const length = SkillZone.beamLength[zid];
          const width = SkillZone.beamWidth[zid];
          const halfW = width * 0.5;

          for (let u = 0; u < units.length; u++) {
            const uid = units[u];
            if (Team.id[uid] === zTeam || UnitType.state[uid] !== STATE_ALIVE) continue;
            if (StatusEffects.untargetableTimer[uid] > 0) continue;
            const vx = Transform.x[uid] - zx;
            const vz = Transform.z[uid] - zz;
            const along = vx * dirX + vz * dirZ;
            const across = Math.abs(vx * perpX + vz * perpZ);
            const r = Transform.radius[uid];

            if (along >= -r && along <= length + r && across <= halfW + r) {
              this.combat.applyDamage(uid, owner, dmg, dmgType);
              if (stun > 0 && this.world.isAliveUnit(uid)) {
                StatusEffects.stunTimer[uid] = Math.max(StatusEffects.stunTimer[uid], stun);
                Combat.isWindingUp[uid] = 0;
              }
              if (slowPct > 0 && this.world.isAliveUnit(uid)) {
                StatusEffects.slowPercent[uid] = Math.max(StatusEffects.slowPercent[uid], slowPct);
                StatusEffects.slowTimer[uid] = Math.max(StatusEffects.slowTimer[uid], slowDur);
              }
            }
          }

          this.bus.emit('skillImpact', {
            kind: 'beam',
            x: zx,
            z: zz,
            targetX: zx + dirX * length,
            targetZ: zz + dirZ * length,
            dirX,
            dirZ,
            length,
            width,
            radius: halfW,
            color: SkillZone.color[zid],
          });

          const player = this.world.playerEid;
          if (player >= 0) {
            const distToPlayer = Math.hypot(Transform.x[player] - zx, Transform.z[player] - zz);
            if (owner === player || distToPlayer < 45 || SkillZone.isGlobal[zid] === 1) {
              this.bus.emit('cameraShake', { intensity: owner === player ? 0.6 : 0.32 });
            }
          }
        } else {
          // Ground AoE / TITAN R Barrier / AURELIA W Root Trap detonation
          const rad = SkillZone.radius[zid];
          const execBonus = SkillZone.executeBonusMax[zid];

          for (let u = 0; u < units.length; u++) {
            const uid = units[u];
            if (Team.id[uid] === zTeam || UnitType.state[uid] !== STATE_ALIVE) continue;
            if (StatusEffects.untargetableTimer[uid] > 0) continue;
            const dist = Math.hypot(Transform.x[uid] - zx, Transform.z[uid] - zz);
            if (dist <= rad + Transform.radius[uid]) {
              let finalDmg = dmg;
              if (execBonus > 0) {
                const missingRatio = 1 - Stats.hp[uid] / Math.max(1, Stats.maxHp[uid]);
                finalDmg *= 1 + execBonus * Math.max(0, Math.min(1, missingRatio));
              }
              this.combat.applyDamage(uid, owner, finalDmg, dmgType);
              if (stun > 0 && this.world.isAliveUnit(uid)) {
                StatusEffects.stunTimer[uid] = Math.max(StatusEffects.stunTimer[uid], stun);
                Combat.isWindingUp[uid] = 0;
                if (hasComponent(this.world.ecs, uid, SkillBook)) {
                  SkillBook.isRecalling[uid] = 0;
                  SkillBook.recallTimer[uid] = 0;
                }
              }
              if (root > 0 && this.world.isAliveUnit(uid)) {
                StatusEffects.rootTimer[uid] = Math.max(StatusEffects.rootTimer[uid], root);
                Movement.hasTarget[uid] = 0;
                Movement.isDashing[uid] = 0;
                Movement.vx[uid] = 0;
                Movement.vz[uid] = 0;
                this.world.entityPaths.delete(uid);
              }
              if (slowPct > 0 && this.world.isAliveUnit(uid)) {
                StatusEffects.slowPercent[uid] = Math.max(StatusEffects.slowPercent[uid], slowPct);
                StatusEffects.slowTimer[uid] = Math.max(StatusEffects.slowTimer[uid], slowDur);
              }
            }
          }

          this.bus.emit('skillImpact', {
            kind:
              SkillZone.isBarrier[zid] === 1
                ? 'barrier'
                : root > 0
                  ? 'root'
                  : 'aoe',
            x: zx,
            z: zz,
            radius: rad,
            color: SkillZone.color[zid],
            duration: SkillZone.durationTimer[zid],
          });

          const player = this.world.playerEid;
          if (player >= 0) {
            const distToPlayer = Math.hypot(Transform.x[player] - zx, Transform.z[player] - zz);
            if (distToPlayer < 32) {
              this.bus.emit('cameraShake', { intensity: owner === player ? 0.38 : 0.2 });
            }
          }
        }
      }

      if (SkillZone.durationTimer[zid] <= 0) {
        expiredZones.push(zid);
      }
    }

    for (let i = 0; i < expiredZones.length; i++) {
      this.world.destroyEntity(expiredZones[i]);
    }
  }

  private fireValkyrieSwordWave(eid: number, wave: PendingStanceWave): void {
    if (!this.world.isAliveUnit(eid)) return;
    const cx = Transform.x[eid];
    const cz = Transform.z[eid];
    const team = Team.id[eid];
    Transform.rotY[eid] = Math.atan2(wave.dirX, wave.dirZ);
    Combat.attackAnimTimer[eid] = 0.25;

    this.world.spawnProjectile({
      ownerEid: eid,
      targetEid: -1,
      team,
      x: cx + wave.dirX * 1.1,
      y: 1.25,
      z: cz + wave.dirZ * 1.1,
      dirX: wave.dirX,
      dirZ: wave.dirZ,
      speed: wave.speed,
      range: wave.range,
      damage: wave.damage,
      damageType: 'physical',
      hitRadius: wave.radius,
      piercing: true,
      color: wave.color,
      slowAmount: wave.slowAmount,
      slowDuration: wave.slowDuration,
    });

    this.bus.emit('skillImpact', {
      kind: 'pulse',
      x: cx + wave.dirX * 1.5,
      z: cz + wave.dirZ * 1.5,
      radius: 2.2,
      color: wave.color,
    });
  }

  private executeShadowAssassinateLanding(eid: number, ult: PendingShadowAssassinate): void {
    const myTeam = Team.id[eid];
    let landX = ult.fallbackX;
    let landZ = ult.fallbackZ;
    let mainVictim = ult.targetEid;

    if (mainVictim >= 0 && this.world.isAliveUnit(mainVictim)) {
      const tx = Transform.x[mainVictim];
      const tz = Transform.z[mainVictim];
      // Appear behind the target (opposite target's facing direction)
      const behindDist = Transform.radius[mainVictim] + Transform.radius[eid] + 0.55;
      const behindX = tx - Math.sin(Transform.rotY[mainVictim]) * behindDist;
      const behindZ = tz - Math.cos(Transform.rotY[mainVictim]) * behindDist;
      const candidate = this.findSafePointNear(behindX, behindZ, tx, tz, Transform.radius[eid]);
      landX = candidate.x;
      landZ = candidate.z;
    } else {
      mainVictim = -1;
    }

    Transform.x[eid] = landX;
    Transform.prevX[eid] = landX;
    Transform.z[eid] = landZ;
    Transform.prevZ[eid] = landZ;

    if (mainVictim >= 0 && this.world.isAliveUnit(mainVictim)) {
      const dx = Transform.x[mainVictim] - landX;
      const dz = Transform.z[mainVictim] - landZ;
      Transform.rotY[eid] = Math.atan2(dx, dz);
      Transform.prevRotY[eid] = Transform.rotY[eid];

      const missingRatio = Math.max(
        0,
        Math.min(1, 1 - Stats.hp[mainVictim] / Math.max(1, Stats.maxHp[mainVictim]))
      );
      const execDmg = ult.damage * (1 + ult.executeBonusMax * missingRatio);

      // Detonate mark if present
      if (
        StatusEffects.markedByEid[mainVictim] === eid &&
        StatusEffects.markTimer[mainVictim] > 0
      ) {
        StatusEffects.markedByEid[mainVictim] = -1;
        StatusEffects.markTimer[mainVictim] = 0;
        this.combat.applyDamage(mainVictim, eid, 55 + Stats.ad[eid] * 0.5, 'physical', {
          isCrit: true,
        });
      }

      this.combat.applyDamage(mainVictim, eid, execDmg, 'physical', { isCrit: true });
      if (this.world.isAliveUnit(mainVictim)) {
        Combat.targetEid[eid] = mainVictim;
      }
    } else {
      // Fallback AoE slash around landing if target died during 0.4s vanish
      const units = query(this.world.ecs, [Transform, Team, UnitType, Stats]);
      for (let i = 0; i < units.length; i++) {
        const uid = units[i];
        if (Team.id[uid] === myTeam || UnitType.state[uid] !== STATE_ALIVE) continue;
        if (Math.hypot(Transform.x[uid] - landX, Transform.z[uid] - landZ) <= 3.5) {
          const missingRatio = Math.max(
            0,
            Math.min(1, 1 - Stats.hp[uid] / Math.max(1, Stats.maxHp[uid]))
          );
          const execDmg = ult.damage * (1 + ult.executeBonusMax * missingRatio);
          this.combat.applyDamage(uid, eid, execDmg, 'physical', { isCrit: true });
        }
      }
    }

    Combat.attackAnimTimer[eid] = 0.3;
    this.bus.emit('skillImpact', {
      kind: 'aoe',
      x: landX,
      z: landZ,
      radius: 3.2,
      color: ult.color,
    });
    this.bus.emit('cameraShake', { intensity: 0.45 });
  }

  private findSafePointNear(
    preferX: number,
    preferZ: number,
    anchorX: number,
    anchorZ: number,
    radius: number
  ): { x: number; z: number } {
    const clamp = (v: number) => Math.max(-MAP_HALF_SIZE + 2.5, Math.min(MAP_HALF_SIZE - 2.5, v));
    const px = clamp(preferX);
    const pz = clamp(preferZ);
    if (this.world.isPointWalkable(px, pz, radius)) {
      return { x: px, z: pz };
    }
    for (let k = 0; k < 8; k++) {
      const ang = (k / 8) * Math.PI * 2;
      const tx = clamp(anchorX + Math.cos(ang) * 2.2);
      const tz = clamp(anchorZ + Math.sin(ang) * 2.2);
      if (this.world.isPointWalkable(tx, tz, radius)) {
        return { x: tx, z: tz };
      }
    }
    return { x: clamp(anchorX), z: clamp(anchorZ) };
  }

  private computeDashDestination(
    cx: number,
    cz: number,
    dirX: number,
    dirZ: number,
    maxDist: number,
    radius: number,
    canCrossThinWalls: boolean
  ): { x: number; z: number } {
    let endX = cx;
    let endZ = cz;
    const steps = 16;
    for (let s = 1; s <= steps; s++) {
      const tx = Math.max(
        -MAP_HALF_SIZE + 2.2,
        Math.min(MAP_HALF_SIZE - 2.2, cx + dirX * (maxDist * (s / steps)))
      );
      const tz = Math.max(
        -MAP_HALF_SIZE + 2.2,
        Math.min(MAP_HALF_SIZE - 2.2, cz + dirZ * (maxDist * (s / steps)))
      );
      if (this.world.isPointWalkable(tx, tz, radius)) {
        endX = tx;
        endZ = tz;
      } else if (!canCrossThinWalls) {
        break;
      }
    }
    return { x: endX, z: endZ };
  }

  public startRecall(eid: number): boolean {
    if (
      !this.world.isAliveUnit(eid) ||
      StatusEffects.stunTimer[eid] > 0 ||
      this.isChanneling(eid)
    ) {
      return false;
    }
    Movement.hasTarget[eid] = 0;
    Movement.vx[eid] = 0;
    Movement.vz[eid] = 0;
    Combat.targetEid[eid] = -1;
    Combat.isWindingUp[eid] = 0;
    this.world.entityPaths.delete(eid);
    SkillBook.isRecalling[eid] = 1;
    SkillBook.recallTimer[eid] = 3.5;
    return true;
  }

  public upgradeSkill(eid: number, slot: 'Q' | 'W' | 'E' | 'R'): boolean {
    if (SkillBook.skillPoints[eid] <= 0) return false;
    const def = getChampionData(UnitType.subKind[eid]);
    const sk = def.skills[slot];
    if (slot === 'Q' && SkillBook.qLevel[eid] < 5) {
      SkillBook.qLevel[eid] += 1;
      SkillBook.qMaxCd[eid] = Math.max(1.2, sk.cooldown - (SkillBook.qLevel[eid] - 1) * sk.cdPerRank);
      SkillBook.skillPoints[eid] -= 1;
      return true;
    }
    if (slot === 'W' && SkillBook.wLevel[eid] < 5) {
      SkillBook.wLevel[eid] += 1;
      SkillBook.wMaxCd[eid] = Math.max(1.2, sk.cooldown - (SkillBook.wLevel[eid] - 1) * sk.cdPerRank);
      SkillBook.skillPoints[eid] -= 1;
      return true;
    }
    if (slot === 'E' && SkillBook.eLevel[eid] < 5) {
      SkillBook.eLevel[eid] += 1;
      SkillBook.eMaxCd[eid] = Math.max(1.2, sk.cooldown - (SkillBook.eLevel[eid] - 1) * sk.cdPerRank);
      SkillBook.skillPoints[eid] -= 1;
      return true;
    }
    if (slot === 'R' && SkillBook.rLevel[eid] < 3) {
      SkillBook.rLevel[eid] += 1;
      SkillBook.rMaxCd[eid] = Math.max(1.2, sk.cooldown - (SkillBook.rLevel[eid] - 1) * sk.cdPerRank);
      SkillBook.skillPoints[eid] -= 1;
      return true;
    }
    return false;
  }

  public castSkill(casterEid: number, slot: SkillSlot, targetX: number, targetZ: number): boolean {
    if (!this.world.isAliveUnit(casterEid)) return false;
    if (
      StatusEffects.stunTimer[casterEid] > 0 ||
      StatusEffects.untargetableTimer[casterEid] > 0 ||
      Movement.isDashing[casterEid] === 1 ||
      this.isChanneling(casterEid)
    ) {
      return false;
    }

    const isRooted = StatusEffects.rootTimer[casterEid] > 0;
    const cx = Transform.x[casterEid];
    const cz = Transform.z[casterEid];
    const team = Team.id[casterEid];

    SkillBook.isRecalling[casterEid] = 0;
    SkillBook.recallTimer[casterEid] = 0;

    // Summoner Spell D: Flash (blocked while rooted)
    if (slot === 'D') {
      if (isRooted || SkillBook.dCd[casterEid] > 0) return false;
      const spec = SUMMONER_SPELLS.D;
      const dx = targetX - cx;
      const dz = targetZ - cz;
      const dist = Math.hypot(dx, dz);
      const len = Math.min(spec.range, dist > 0.05 ? dist : spec.range);
      const nx = dist > 0.05 ? dx / dist : Math.sin(Transform.rotY[casterEid]);
      const nz = dist > 0.05 ? dz / dist : Math.cos(Transform.rotY[casterEid]);

      const dest = this.computeDashDestination(
        cx,
        cz,
        nx,
        nz,
        len,
        Transform.radius[casterEid],
        true
      );

      this.bus.emit('skillImpact', { kind: 'flash', x: cx, z: cz, radius: 1.6, color: spec.color });
      Transform.x[casterEid] = dest.x;
      Transform.prevX[casterEid] = dest.x;
      Transform.z[casterEid] = dest.z;
      Transform.prevZ[casterEid] = dest.z;
      Transform.rotY[casterEid] = Math.atan2(nx, nz);
      Movement.hasTarget[casterEid] = 0;
      Movement.vx[casterEid] = 0;
      Movement.vz[casterEid] = 0;
      Combat.isWindingUp[casterEid] = 0;
      this.world.entityPaths.delete(casterEid);

      SkillBook.dCd[casterEid] = spec.cooldown;
      SkillBook.dMaxCd[casterEid] = spec.cooldown;
      this.bus.emit('skillImpact', {
        kind: 'flash',
        x: dest.x,
        z: dest.z,
        radius: 2.1,
        color: spec.color,
      });
      return true;
    }

    // Summoner Spell F: Heal (amplified by healAmp)
    if (slot === 'F') {
      if (SkillBook.fCd[casterEid] > 0) return false;
      const spec = SUMMONER_SPELLS.F;
      const amp = 1 + Math.max(0, Stats.healAmp[casterEid]);
      const healAmount = Math.round((165 + 18 * Stats.level[casterEid]) * amp);
      Stats.hp[casterEid] = Math.min(Stats.maxHp[casterEid], Stats.hp[casterEid] + healAmount);
      Movement.speedMult[casterEid] = Math.max(Movement.speedMult[casterEid], 1.3);
      Movement.speedBuffTimer[casterEid] = Math.max(Movement.speedBuffTimer[casterEid], 2.0);
      SkillBook.fCd[casterEid] = spec.cooldown;
      SkillBook.fMaxCd[casterEid] = spec.cooldown;

      this.bus.emit('heal', { targetEid: casterEid, amount: healAmount, x: cx, y: 2.3, z: cz });
      this.bus.emit('skillImpact', { kind: 'heal', x: cx, z: cz, radius: 2.5, color: spec.color });
      return true;
    }

    // Champion Q, W, E, R skills
    const def = getChampionData(UnitType.subKind[casterEid]);
    const skill = def.skills[slot];

    // Root prevents movement/dash/blink skills ONLY (allowing ranged/melee attacks and casts)
    if (
      isRooted &&
      (skill.isDash ||
        skill.kind === 'dash' ||
        skill.kind === 'targeted_blink' ||
        (def.id === 'titan' && slot === 'R'))
    ) {
      return false;
    }

    const rank =
      slot === 'Q'
        ? SkillBook.qLevel[casterEid]
        : slot === 'W'
          ? SkillBook.wLevel[casterEid]
          : slot === 'E'
            ? SkillBook.eLevel[casterEid]
            : SkillBook.rLevel[casterEid];
    if (rank <= 0) return false;

    const isValkyrieR2 =
      def.id === 'valkyrie' && slot === 'R' && SkillBook.rRecastTimer[casterEid] > 0;

    const currentCd =
      slot === 'Q'
        ? SkillBook.qCd[casterEid]
        : slot === 'W'
          ? SkillBook.wCd[casterEid]
          : slot === 'E'
            ? SkillBook.eCd[casterEid]
            : SkillBook.rCd[casterEid];
    if (!isValkyrieR2 && currentCd > 0) return false;

    const manaCost = isValkyrieR2 ? 0 : skill.manaCost;
    if (Stats.mp[casterEid] < manaCost) return false;
    Stats.mp[casterEid] -= manaCost;

    // Enforce Bush Reveal (1.5s) and break stealth on offensive skill casts (except SHADOW W smoke)
    const isShadowSmoke = def.id === 'shadow' && slot === 'W';
    if (!isShadowSmoke) {
      if (Vision.inBrushId[casterEid] >= 0) {
        Vision.bushRevealTimer[casterEid] = BUSH_ATTACK_REVEAL_TIME;
      }
      StatusEffects.invisTimer[casterEid] = 0;
      Stats.outOfCombatTimer[casterEid] = 0;
    }

    const cdrMult = computeCdrMultiplier(Stats.cdr[casterEid]);
    const totalCd = Math.max(1.0, (skill.cooldown - (rank - 1) * skill.cdPerRank) * cdrMult);

    if (slot === 'Q') {
      SkillBook.qCd[casterEid] = totalCd;
      SkillBook.qMaxCd[casterEid] = totalCd;
    } else if (slot === 'W') {
      SkillBook.wCd[casterEid] = totalCd;
      SkillBook.wMaxCd[casterEid] = totalCd;
    } else if (slot === 'E') {
      SkillBook.eCd[casterEid] = totalCd;
      SkillBook.eMaxCd[casterEid] = totalCd;
    } else if (slot === 'R') {
      if (def.id === 'valkyrie' && !isValkyrieR2) {
        // VALKYRIE R1: keep rCd = 0 during 6s recast window so R2 can be cast freely!
        SkillBook.rCd[casterEid] = 0;
        SkillBook.rMaxCd[casterEid] = totalCd;
        SkillBook.rRecastTimer[casterEid] = skill.buffDuration ?? 6.0;
      } else {
        SkillBook.rRecastTimer[casterEid] = 0;
        SkillBook.rCd[casterEid] = totalCd;
        SkillBook.rMaxCd[casterEid] = totalCd;
      }
    }

    const totalDamage =
      skill.baseDamage +
      (rank - 1) * skill.damagePerRank +
      Stats.ad[casterEid] * skill.adRatio +
      Stats.ap[casterEid] * skill.apRatio +
      Stats.maxHp[casterEid] * (skill.maxHpRatio ?? 0);

    const dx = targetX - cx;
    const dz = targetZ - cz;
    const dist = Math.hypot(dx, dz);
    const dirX = dist > 0.01 ? dx / dist : Math.sin(Transform.rotY[casterEid]);
    const dirZ = dist > 0.01 ? dz / dist : Math.cos(Transform.rotY[casterEid]);

    // === SPECIALIZED 20-SKILL EXECUTION ===

    // 1. VALKYRIE R1: 6s Empower (1.25x scale, +30% AD, +25% MS)
    if (def.id === 'valkyrie' && slot === 'R' && !isValkyrieR2) {
      const dur = skill.buffDuration ?? 6.0;
      this.clearValkyrieEmpowerBonus(casterEid);
      const bonusAd = Math.round(Stats.ad[casterEid] * (skill.adBuffPct ?? 0.3));
      Stats.ad[casterEid] += bonusAd;
      this.valkyrieBonusAd.set(casterEid, bonusAd);

      StatusEffects.empoweredTimer[casterEid] = dur;
      Movement.speedMult[casterEid] = Math.max(
        Movement.speedMult[casterEid],
        1 + (skill.speedBuff ?? 0.25)
      );
      Movement.speedBuffTimer[casterEid] = Math.max(Movement.speedBuffTimer[casterEid], dur);

      this.bus.emit('skillImpact', {
        kind: 'pulse',
        x: cx,
        z: cz,
        radius: 3.8,
        color: skill.color,
      });
      this.bus.emit('skillCast', {
        casterEid,
        slot,
        originX: cx,
        originZ: cz,
        targetX: cx,
        targetZ: cz,
        radius: 3.8,
        color: skill.color,
      });
      return true;
    }

    // 2. VALKYRIE R2: Giant Sword Energy Beam
    if (isValkyrieR2) {
      const beamLen = skill.range;
      const beamWid = skill.width ?? 3.5;
      const delay = skill.delay ?? 0.18;

      Transform.rotY[casterEid] = Math.atan2(dirX, dirZ);
      Movement.hasTarget[casterEid] = 0;
      Movement.vx[casterEid] = 0;
      Movement.vz[casterEid] = 0;
      Combat.isWindingUp[casterEid] = 0;
      Combat.attackAnimTimer[casterEid] = 0.32;
      this.world.entityPaths.delete(casterEid);

      const zoneEid = this.world.spawnSkillZone({
        ownerEid: casterEid,
        team,
        x: cx,
        z: cz,
        delay,
        duration: delay + 0.45,
        radius: beamWid * 0.5,
        damage: totalDamage,
        damageType: 'physical',
        stunDuration: 0,
        slowPercent: 0.35,
        slowDuration: 1.5,
        color: skill.color,
        isBeam: true,
        zoneKind: ZONE_BEAM,
        dirX,
        dirZ,
        beamLength: beamLen,
        beamWidth: beamWid,
      });
      this.channelingR.set(casterEid, { timer: delay, zoneEid });

      this.bus.emit('skillCast', {
        casterEid,
        slot,
        originX: cx,
        originZ: cz,
        targetX: cx + dirX * beamLen,
        targetZ: cz + dirZ * beamLen,
        radius: beamWid * 0.5,
        color: skill.color,
      });
      return true;
    }

    // 3. VALKYRIE Q: Tam Liên Trảm (Frontal Cone Slash + Heal per enemy champion hit)
    if (skill.kind === 'cone_slash') {
      Transform.rotY[casterEid] = Math.atan2(dirX, dirZ);
      Combat.attackAnimTimer[casterEid] = 0.3;

      const coneCos = Math.cos((skill.coneAngleRad ?? Math.PI * 0.62) * 0.5);
      const units = query(this.world.ecs, [Transform, Team, UnitType, Stats]);
      let champsHit = 0;

      for (let i = 0; i < units.length; i++) {
        const uid = units[i];
        if (Team.id[uid] === team || UnitType.state[uid] !== STATE_ALIVE) continue;
        if (StatusEffects.untargetableTimer[uid] > 0) continue;

        const ux = Transform.x[uid] - cx;
        const uz = Transform.z[uid] - cz;
        const udist = Math.hypot(ux, uz);
        if (udist > skill.range + Transform.radius[uid]) continue;

        const dot = udist > 0.05 ? (ux * dirX + uz * dirZ) / udist : 1;
        if (dot >= coneCos || udist <= 1.8) {
          if (UnitType.kind[uid] === UNIT_CHAMPION) {
            champsHit += 1;
          }
          this.combat.applyDamage(uid, casterEid, totalDamage, skill.damageType);
          if (skill.slowAmount && this.world.isAliveUnit(uid)) {
            StatusEffects.slowPercent[uid] = Math.max(StatusEffects.slowPercent[uid], skill.slowAmount);
            StatusEffects.slowTimer[uid] = Math.max(
              StatusEffects.slowTimer[uid],
              skill.slowDuration ?? 1.2
            );
          }
        }
      }

      if (champsHit > 0 && skill.healPerChampHit) {
        const amp = 1 + Math.max(0, Stats.healAmp[casterEid]);
        const healPerChamp =
          skill.healPerChampHit + (rank - 1) * 14 + Stats.ad[casterEid] * 0.15;
        const totalHeal = Math.round(champsHit * healPerChamp * amp);
        Stats.hp[casterEid] = Math.min(Stats.maxHp[casterEid], Stats.hp[casterEid] + totalHeal);
        this.bus.emit('heal', {
          targetEid: casterEid,
          amount: totalHeal,
          x: cx,
          y: 2.3,
          z: cz,
        });
      }

      this.bus.emit('skillImpact', {
        kind: 'pulse',
        x: cx + dirX * (skill.range * 0.48),
        z: cz + dirZ * (skill.range * 0.48),
        radius: skill.range * 0.65,
        color: skill.color,
      });
      this.bus.emit('skillCast', {
        casterEid,
        slot,
        originX: cx,
        originZ: cz,
        targetX: cx + dirX * skill.range,
        targetZ: cz + dirZ * skill.range,
        radius: skill.radius,
        color: skill.color,
      });
      return true;
    }

    // 4. VALKYRIE W: Phản Đòn Kiếm Khí (1s defensive stance -> piercing sword wave)
    if (skill.kind === 'stance_wave') {
      const stanceDur = skill.delay ?? 1.0;
      Transform.rotY[casterEid] = Math.atan2(dirX, dirZ);
      StatusEffects.wStanceTimer[casterEid] = stanceDur;
      this.setSkillDamageReduction(casterEid, skill.damageReduction ?? 0.5, stanceDur);

      this.valkyriePendingWave.set(casterEid, {
        dirX,
        dirZ,
        damage: totalDamage,
        range: skill.range,
        radius: skill.radius,
        speed: skill.projectileSpeed ?? 28,
        slowAmount: skill.slowAmount ?? 0.3,
        slowDuration: skill.slowDuration ?? 1.5,
        color: skill.color,
      });

      this.bus.emit('skillImpact', {
        kind: 'pulse',
        x: cx,
        z: cz,
        radius: 2.4,
        color: skill.color,
      });
      this.bus.emit('skillCast', {
        casterEid,
        slot,
        originX: cx,
        originZ: cz,
        targetX: cx + dirX * skill.range,
        targetZ: cz + dirZ * skill.range,
        radius: skill.radius,
        color: skill.color,
      });
      return true;
    }

    // 5. SHADOW R: Ám Sát Tuyệt Mệnh (0.4s untargetable vanish -> reappear behind enemy champ -> execute)
    if (skill.kind === 'targeted_blink') {
      const units = query(this.world.ecs, [Transform, Team, UnitType, Stats]);
      const clampX = Math.max(-MAP_HALF_SIZE + 2.5, Math.min(MAP_HALF_SIZE - 2.5, cx + dirX * Math.min(dist, skill.range)));
      const clampZ = Math.max(-MAP_HALF_SIZE + 2.5, Math.min(MAP_HALF_SIZE - 2.5, cz + dirZ * Math.min(dist, skill.range)));

      let bestTarget = -1;
      let bestCursorDist = Infinity;

      // Prioritize enemy champions within 16m of SHADOW (closest to cursor)
      for (let i = 0; i < units.length; i++) {
        const uid = units[i];
        if (Team.id[uid] === team || Team.id[uid] === TEAM_NEUTRAL || UnitType.state[uid] !== STATE_ALIVE) {
          continue;
        }
        if (UnitType.kind[uid] !== UNIT_CHAMPION || StatusEffects.untargetableTimer[uid] > 0) {
          continue;
        }
        const distFromCaster = Math.hypot(Transform.x[uid] - cx, Transform.z[uid] - cz);
        if (distFromCaster > skill.range + 3.0) continue;
        const distToCursor = Math.hypot(Transform.x[uid] - targetX, Transform.z[uid] - targetZ);
        if (distToCursor < bestCursorDist) {
          bestCursorDist = distToCursor;
          bestTarget = uid;
        }
      }

      // Fallback to nearest enemy unit if no enemy champion is in range
      if (bestTarget < 0) {
        for (let i = 0; i < units.length; i++) {
          const uid = units[i];
          if (Team.id[uid] === team || Team.id[uid] === TEAM_NEUTRAL || UnitType.state[uid] !== STATE_ALIVE) {
            continue;
          }
          if (UnitType.kind[uid] !== UNIT_MINION && UnitType.kind[uid] !== UNIT_MONSTER) continue;
          const distFromCaster = Math.hypot(Transform.x[uid] - cx, Transform.z[uid] - cz);
          if (distFromCaster > skill.range + 2.0) continue;
          const distToCursor = Math.hypot(Transform.x[uid] - targetX, Transform.z[uid] - targetZ);
          if (distToCursor < bestCursorDist) {
            bestCursorDist = distToCursor;
            bestTarget = uid;
          }
        }
      }

      const vanishDur = skill.untargetableDuration ?? 0.4;
      StatusEffects.untargetableTimer[casterEid] = vanishDur;
      Movement.hasTarget[casterEid] = 0;
      Movement.vx[casterEid] = 0;
      Movement.vz[casterEid] = 0;
      Combat.isWindingUp[casterEid] = 0;
      this.world.entityPaths.delete(casterEid);

      this.shadowPendingUlt.set(casterEid, {
        timer: vanishDur,
        targetEid: bestTarget,
        fallbackX: clampX,
        fallbackZ: clampZ,
        damage: totalDamage,
        executeBonusMax: skill.executeBonusMax ?? 0.6,
        color: skill.color,
      });

      this.bus.emit('skillImpact', {
        kind: 'smoke',
        x: cx,
        z: cz,
        radius: 2.2,
        color: 0x9333ea,
      });
      this.bus.emit('skillCast', {
        casterEid,
        slot,
        originX: cx,
        originZ: cz,
        targetX: bestTarget >= 0 ? Transform.x[bestTarget] : clampX,
        targetZ: bestTarget >= 0 ? Transform.z[bestTarget] : clampZ,
        radius: skill.radius,
        color: skill.color,
      });
      return true;
    }

    // 6. Linear Projectiles (SHADOW Q 3-shuriken cone, NOVA Q piercing bolt, AURELIA Q exploding orb)
    if (skill.kind === 'linear_projectile') {
      Transform.rotY[casterEid] = Math.atan2(dirX, dirZ);
      Combat.attackAnimTimer[casterEid] = 0.25;

      const count = skill.projectileCount ?? 1;
      const baseAngle = Math.atan2(dirX, dirZ);
      const spread = 0.22;
      const falloff = skill.projectileDamageFalloff ?? 1;

      for (let k = 0; k < count; k++) {
        const offset = count > 1 ? (k - (count - 1) * 0.5) * spread : 0;
        const pDirX = Math.sin(baseAngle + offset);
        const pDirZ = Math.cos(baseAngle + offset);
        const projDamage = Math.round(totalDamage * Math.pow(falloff, k));

        const pid = this.world.spawnProjectile({
          ownerEid: casterEid,
          targetEid: -1,
          team,
          x: cx + pDirX * 1.0,
          y: 1.25,
          z: cz + pDirZ * 1.0,
          dirX: pDirX,
          dirZ: pDirZ,
          speed: skill.projectileSpeed ?? 28,
          range: skill.range,
          damage: projDamage,
          damageType: skill.damageType,
          hitRadius: skill.radius,
          piercing: skill.piercing ?? false,
          explodeOnFirstChamp: skill.explodeOnFirstChamp ?? false,
          color: skill.color,
          reduceCooldownOnHit: skill.cdrOnHit ?? 0,
          slowAmount: skill.slowAmount ?? 0,
          slowDuration: skill.slowDuration ?? 0,
        });

        if (def.id === 'shadow' && slot === 'Q') {
          this.combat.registerMarkingProjectile(pid);
        }
        if (skill.explodeAtMaxRange) {
          this.combat.registerExplodingProjectile(pid, 3.2);
        }
      }

      this.bus.emit('skillCast', {
        casterEid,
        slot,
        originX: cx,
        originZ: cz,
        targetX: cx + dirX * skill.range,
        targetZ: cz + dirZ * skill.range,
        radius: skill.radius,
        color: skill.color,
      });
      return true;
    }

    // 7. Self Buff / Pulse (TITAN W Fortress, TITAN E Ground Slam, SHADOW W Smoke Invis)
    if (skill.kind === 'self_buff_pulse') {
      const dur = skill.buffDuration ?? 3.0;
      if (skill.shieldBase || skill.shieldMaxHpRatio || skill.shieldApRatio) {
        const shieldAmt =
          (skill.shieldBase ?? 0) +
          Stats.maxHp[casterEid] * (skill.shieldMaxHpRatio ?? 0) +
          Stats.ap[casterEid] * (skill.shieldApRatio ?? 0);
        const sDur = skill.shieldDuration ?? dur;
        StatusEffects.shieldAmount[casterEid] = Math.max(
          StatusEffects.shieldAmount[casterEid],
          shieldAmt
        );
        StatusEffects.shieldTimer[casterEid] = Math.max(StatusEffects.shieldTimer[casterEid], sDur);
      }
      if (skill.damageReduction) {
        this.setSkillDamageReduction(casterEid, skill.damageReduction, dur);
        StatusEffects.wStanceTimer[casterEid] = Math.max(StatusEffects.wStanceTimer[casterEid], dur);
      }
      if (skill.invisDuration) {
        StatusEffects.invisTimer[casterEid] = Math.max(
          StatusEffects.invisTimer[casterEid],
          skill.invisDuration
        );
      }
      if (skill.speedBuff) {
        Movement.speedMult[casterEid] = Math.max(
          Movement.speedMult[casterEid],
          1 + skill.speedBuff
        );
        Movement.speedBuffTimer[casterEid] = Math.max(Movement.speedBuffTimer[casterEid], dur);
      }
      if (skill.asBuff) {
        Stats.asBuffMult[casterEid] = Math.max(Stats.asBuffMult[casterEid], 1 + skill.asBuff);
        Stats.asBuffTimer[casterEid] = Math.max(Stats.asBuffTimer[casterEid], dur);
      }

      if (def.id === 'titan' && slot === 'W') {
        this.titanFortress.set(casterEid, {
          timer: dur,
          pulseAccumulator: 0,
          radius: skill.radius,
          slowAmount: skill.slowAmount ?? 0.35,
          slowDuration: skill.slowDuration ?? 2.5,
          color: skill.color,
        });
      }

      const units = query(this.world.ecs, [Transform, Team, UnitType, Stats]);
      for (let i = 0; i < units.length; i++) {
        const uid = units[i];
        if (Team.id[uid] === team || UnitType.state[uid] !== STATE_ALIVE) continue;
        if (StatusEffects.untargetableTimer[uid] > 0) continue;
        const udist = Math.hypot(Transform.x[uid] - cx, Transform.z[uid] - cz);
        if (udist <= skill.radius + Transform.radius[uid]) {
          this.combat.applyDamage(uid, casterEid, totalDamage, skill.damageType);
          if (skill.stunDuration && this.world.isAliveUnit(uid)) {
            StatusEffects.stunTimer[uid] = Math.max(
              StatusEffects.stunTimer[uid],
              skill.stunDuration
            );
            Combat.isWindingUp[uid] = 0;
          }
          if (skill.slowAmount && this.world.isAliveUnit(uid)) {
            StatusEffects.slowPercent[uid] = Math.max(
              StatusEffects.slowPercent[uid],
              skill.slowAmount
            );
            StatusEffects.slowTimer[uid] = Math.max(
              StatusEffects.slowTimer[uid],
              skill.slowDuration ?? 2.0
            );
          }
        }
      }

      if (skill.stunDuration && skill.stunDuration >= 0.5) {
        this.bus.emit('cameraShake', { intensity: 0.25 });
      }

      this.bus.emit('skillImpact', {
        kind: isShadowSmoke ? 'smoke' : 'pulse',
        x: cx,
        z: cz,
        radius: skill.radius,
        color: skill.color,
      });
      this.bus.emit('skillCast', {
        casterEid,
        slot,
        originX: cx,
        originZ: cz,
        targetX: cx,
        targetZ: cz,
        radius: skill.radius,
        color: skill.color,
      });
      return true;
    }

    // 8. Ground AoE (TITAN R Leap + Barrier Wall, NOVA W Missile Rain, AURELIA W Root Trap, AURELIA R 4 Meteors)
    if (skill.kind === 'ground_aoe') {
      const castDist = Math.min(skill.range, dist);
      const wx = Math.max(-MAP_HALF_SIZE + 2.5, Math.min(MAP_HALF_SIZE - 2.5, cx + dirX * castDist));
      const wz = Math.max(-MAP_HALF_SIZE + 2.5, Math.min(MAP_HALF_SIZE - 2.5, cz + dirZ * castDist));
      Transform.rotY[casterEid] = Math.atan2(dirX, dirZ);
      Combat.attackAnimTimer[casterEid] = 0.28;

      // TITAN R: Leap to target zone and create 2.5s circular barrier wall!
      if (def.id === 'titan' && slot === 'R') {
        const leapDest = this.computeDashDestination(
          cx,
          cz,
          dirX,
          dirZ,
          castDist,
          Transform.radius[casterEid],
          true
        );
        Movement.isDashing[casterEid] = 1;
        Movement.dashEndX[casterEid] = leapDest.x;
        Movement.dashEndZ[casterEid] = leapDest.z;
        Movement.dashSpeed[casterEid] = 36;
        Movement.hasTarget[casterEid] = 0;
        this.world.entityPaths.delete(casterEid);

        const delay = skill.delay ?? 0.35;
        const barDur = skill.barrierDuration ?? 2.5;
        this.world.spawnSkillZone({
          ownerEid: casterEid,
          team,
          x: leapDest.x,
          z: leapDest.z,
          delay,
          duration: delay + barDur,
          radius: skill.radius,
          damage: totalDamage,
          damageType: skill.damageType,
          stunDuration: skill.stunDuration ?? 0.4,
          color: skill.color,
          zoneKind: ZONE_BARRIER,
          isBarrier: true,
          barrierRadius: skill.radius,
        });

        this.bus.emit('skillCast', {
          casterEid,
          slot,
          originX: cx,
          originZ: cz,
          targetX: leapDest.x,
          targetZ: leapDest.z,
          radius: skill.radius,
          color: skill.color,
        });
        return true;
      }

      // NOVA W (1.5s Missile Bombardment, 5 ticks) or AURELIA R (4 Meteors over 1.5s)
      if ((def.id === 'nova' && slot === 'W') || (def.id === 'aurelia' && slot === 'R')) {
        const ticks = skill.meteorCount ?? 5;
        const totalWindow = skill.buffDuration ?? 1.5;
        const tickInterval = totalWindow / Math.max(1, ticks);
        const delay = skill.delay ?? 0.28;

        this.world.spawnSkillZone({
          ownerEid: casterEid,
          team,
          x: wx,
          z: wz,
          delay,
          duration: delay + totalWindow + 0.25,
          radius: skill.radius,
          damage: totalDamage / ticks,
          damageType: skill.damageType,
          stunDuration: 0,
          slowPercent: skill.slowAmount ?? 0.3,
          slowDuration: skill.slowDuration ?? 1.8,
          color: skill.color,
          zoneKind: ZONE_MULTI_TICK,
          tickInterval,
          ticksRemaining: ticks,
        });

        this.bus.emit('skillCast', {
          casterEid,
          slot,
          originX: cx,
          originZ: cz,
          targetX: wx,
          targetZ: wz,
          radius: skill.radius,
          color: skill.color,
        });
        return true;
      }

      // AURELIA W (0.7s Rune Trap -> 1.2s Root) or standard delayed Ground AoE
      const delay = skill.delay ?? 0.7;
      const rootDur = skill.rootDuration ?? 0;
      this.world.spawnSkillZone({
        ownerEid: casterEid,
        team,
        x: wx,
        z: wz,
        delay,
        duration: delay + 0.45,
        radius: skill.radius,
        damage: totalDamage,
        damageType: skill.damageType,
        stunDuration: skill.stunDuration ?? 0,
        rootDuration: rootDur,
        color: skill.color,
        slowPercent: skill.slowAmount ?? 0,
        slowDuration: skill.slowDuration ?? 1.5,
        executeBonusMax: skill.executeBonusMax ?? 0,
        zoneKind: rootDur > 0 ? ZONE_ROOT_TRAP : ZONE_AOE,
      });

      this.bus.emit('skillCast', {
        casterEid,
        slot,
        originX: cx,
        originZ: cz,
        targetX: wx,
        targetZ: wz,
        radius: skill.radius,
        color: skill.color,
      });
      return true;
    }

    // 9. Dash Skills (TITAN Q, VALKYRIE E, SHADOW E, NOVA E, AURELIA E)
    if (skill.kind === 'dash') {
      const dashLen = Math.min(skill.range, dist > 0.25 ? dist : skill.range);
      const dest = this.computeDashDestination(
        cx,
        cz,
        dirX,
        dirZ,
        dashLen,
        Transform.radius[casterEid],
        Boolean(skill.canCrossThinWalls)
      );
      let endX = dest.x;
      let endZ = dest.z;

      Transform.rotY[casterEid] = Math.atan2(dirX, dirZ);
      Combat.isWindingUp[casterEid] = 0;

      if (skill.resetAutoAttack) {
        Combat.attackCooldown[casterEid] = 0;
      }

      if (skill.shieldBase || skill.shieldApRatio || skill.shieldMaxHpRatio) {
        const shieldAmt =
          (skill.shieldBase ?? 0) +
          Stats.ap[casterEid] * (skill.shieldApRatio ?? 0) +
          Stats.maxHp[casterEid] * (skill.shieldMaxHpRatio ?? 0);
        const shieldDur = skill.shieldDuration ?? 2.5;
        StatusEffects.shieldAmount[casterEid] = Math.max(
          StatusEffects.shieldAmount[casterEid],
          shieldAmt
        );
        StatusEffects.shieldTimer[casterEid] = Math.max(
          StatusEffects.shieldTimer[casterEid],
          shieldDur
        );
      }

      if (skill.asBuff) {
        const dur = skill.buffDuration ?? 3.0;
        Stats.asBuffMult[casterEid] = Math.max(Stats.asBuffMult[casterEid], 1 + skill.asBuff);
        Stats.asBuffTimer[casterEid] = Math.max(Stats.asBuffTimer[casterEid], dur);
      }

      if (skill.empowersNextAttackCrit) {
        StatusEffects.empoweredTimer[casterEid] = Math.max(
          StatusEffects.empoweredTimer[casterEid],
          4.0
        );
        StatusEffects.empoweredStacks[casterEid] = 1;
      }

      const units = query(this.world.ecs, [Transform, Team, UnitType, Stats]);

      if (def.id === 'titan' && slot === 'Q') {
        // TITAN Q: Dash + Knockback & Stun 0.8s FIRST enemy hit!
        const segDx = endX - cx;
        const segDz = endZ - cz;
        const segLenSq = Math.max(0.01, segDx * segDx + segDz * segDz);
        let firstEnemy = -1;
        let firstProj = 2.0;

        for (let i = 0; i < units.length; i++) {
          const uid = units[i];
          if (Team.id[uid] === team || UnitType.state[uid] !== STATE_ALIVE) continue;
          if (StatusEffects.untargetableTimer[uid] > 0) continue;
          const ux = Transform.x[uid] - cx;
          const uz = Transform.z[uid] - cz;
          const proj = Math.max(0, Math.min(1, (ux * segDx + uz * segDz) / segLenSq));
          const closestX = cx + segDx * proj;
          const closestZ = cz + segDz * proj;
          const hitDist = Math.hypot(Transform.x[uid] - closestX, Transform.z[uid] - closestZ);
          if (hitDist <= skill.radius + Transform.radius[uid] && proj < firstProj) {
            firstProj = proj;
            firstEnemy = uid;
          }
        }

        if (firstEnemy >= 0) {
          const ex = Transform.x[firstEnemy];
          const ez = Transform.z[firstEnemy];
          endX = cx + segDx * Math.max(0, firstProj - 0.12);
          endZ = cz + segDz * Math.max(0, firstProj - 0.12);

          this.combat.applyDamage(firstEnemy, casterEid, totalDamage, skill.damageType);
          if (this.world.isAliveUnit(firstEnemy)) {
            StatusEffects.stunTimer[firstEnemy] = Math.max(
              StatusEffects.stunTimer[firstEnemy],
              skill.stunDuration ?? 0.8
            );
            Combat.isWindingUp[firstEnemy] = 0;

            // Knockback first enemy hit
            const kb = skill.knockbackDist ?? 2.2;
            const kbDest = this.computeDashDestination(
              ex,
              ez,
              dirX,
              dirZ,
              kb,
              Transform.radius[firstEnemy],
              false
            );
            Transform.x[firstEnemy] = kbDest.x;
            Transform.z[firstEnemy] = kbDest.z;
            Movement.hasTarget[firstEnemy] = 0;
            Movement.isDashing[firstEnemy] = 0;
            Movement.vx[firstEnemy] = 0;
            Movement.vz[firstEnemy] = 0;
            this.world.entityPaths.delete(firstEnemy);
          }
        }
      } else if (def.id === 'aurelia' && slot === 'E') {
        // AURELIA E: Dash leaving 3 homing fireballs that strike nearest enemies!
        const candidates: Array<{ uid: number; score: number }> = [];
        for (let i = 0; i < units.length; i++) {
          const uid = units[i];
          if (Team.id[uid] === team || Team.id[uid] === TEAM_NEUTRAL || UnitType.state[uid] !== STATE_ALIVE) {
            continue;
          }
          if (StatusEffects.untargetableTimer[uid] > 0) continue;
          const d = Math.hypot(Transform.x[uid] - endX, Transform.z[uid] - endZ);
          if (d <= 13.5) {
            const champPriority = UnitType.kind[uid] === UNIT_CHAMPION ? -100 : 0;
            candidates.push({ uid, score: champPriority + d });
          }
        }
        candidates.sort((a, b) => a.score - b.score);

        const fbCount = skill.projectileCount ?? 3;
        const fbFalloff = skill.projectileDamageFalloff ?? 1;
        for (let f = 0; f < fbCount; f++) {
          const ang = (f / fbCount) * Math.PI * 2;
          const spawnX = cx + Math.cos(ang) * 0.9;
          const spawnZ = cz + Math.sin(ang) * 0.9;
          const fireballDamage = Math.round(totalDamage * Math.pow(fbFalloff, f));
          const chosenUid =
            candidates.length > 0 ? candidates[f % candidates.length].uid : -1;

          if (chosenUid >= 0) {
            this.world.spawnProjectile({
              ownerEid: casterEid,
              targetEid: chosenUid,
              team,
              x: spawnX,
              y: 1.45,
              z: spawnZ,
              dirX,
              dirZ,
              speed: 25,
              range: 25,
              damage: fireballDamage,
              damageType: 'magic',
              hitRadius: 0.45,
              piercing: false,
              color: 0xe879f9,
            });
          } else {
            // Fire outward in a 3-star fan if no enemy is nearby
            const fDirX = Math.sin(Transform.rotY[casterEid] + (f - 1) * 0.28);
            const fDirZ = Math.cos(Transform.rotY[casterEid] + (f - 1) * 0.28);
            this.world.spawnProjectile({
              ownerEid: casterEid,
              targetEid: -1,
              team,
              x: spawnX,
              y: 1.45,
              z: spawnZ,
              dirX: fDirX,
              dirZ: fDirZ,
              speed: 25,
              range: 10.5,
              damage: fireballDamage,
              damageType: 'magic',
              hitRadius: 0.75,
              piercing: false,
              color: 0xe879f9,
            });
          }
        }
      } else if (totalDamage > 0) {
        // VALKYRIE E / SHADOW E: Slash all enemies along the dash path
        const segDx = endX - cx;
        const segDz = endZ - cz;
        const segLenSq = Math.max(0.01, segDx * segDx + segDz * segDz);
        let hitEnemyChamp = false;

        for (let i = 0; i < units.length; i++) {
          const uid = units[i];
          if (Team.id[uid] === team || UnitType.state[uid] !== STATE_ALIVE) continue;
          if (StatusEffects.untargetableTimer[uid] > 0) continue;
          const ux = Transform.x[uid] - cx;
          const uz = Transform.z[uid] - cz;
          const proj = Math.max(0, Math.min(1, (ux * segDx + uz * segDz) / segLenSq));
          const closestX = cx + segDx * proj;
          const closestZ = cz + segDz * proj;
          const hitDist = Math.hypot(Transform.x[uid] - closestX, Transform.z[uid] - closestZ);
          if (hitDist <= skill.radius + Transform.radius[uid]) {
            if (UnitType.kind[uid] === UNIT_CHAMPION) {
              hitEnemyChamp = true;
            }
            this.combat.applyDamage(uid, casterEid, totalDamage, skill.damageType);
            if (skill.stunDuration && this.world.isAliveUnit(uid)) {
              StatusEffects.stunTimer[uid] = Math.max(
                StatusEffects.stunTimer[uid],
                skill.stunDuration
              );
              Combat.isWindingUp[uid] = 0;
            }
          }
        }

        // VALKYRIE E: Refund 50% of E cooldown on hitting/killing an enemy champion!
        if (hitEnemyChamp && skill.dashCdRefundPct && slot === 'E') {
          SkillBook.eCd[casterEid] *= 1 - skill.dashCdRefundPct;
        }
      }

      Movement.isDashing[casterEid] = 1;
      Movement.dashEndX[casterEid] = endX;
      Movement.dashEndZ[casterEid] = endZ;
      Movement.dashSpeed[casterEid] = def.id === 'shadow' ? 42 : 33;
      Movement.hasTarget[casterEid] = 0;
      Movement.attackMove[casterEid] = 0;
      this.world.entityPaths.delete(casterEid);

      this.bus.emit('skillImpact', {
        kind: 'dash',
        x: cx,
        z: cz,
        targetX: endX,
        targetZ: endZ,
        radius: skill.radius,
        color: skill.color,
      });
      this.bus.emit('skillCast', {
        casterEid,
        slot,
        originX: cx,
        originZ: cz,
        targetX: endX,
        targetZ: endZ,
        radius: skill.radius,
        color: skill.color,
      });
      return true;
    }

    // 10. Channeled Beam (NOVA R Global 240+ Piercing Mega Energy Beam)
    if (skill.kind === 'channeled_beam') {
      const delay = skill.delay ?? 0.5;
      const beamLength = skill.range;
      const beamWidth = skill.width ?? 3.6;

      Transform.rotY[casterEid] = Math.atan2(dirX, dirZ);
      Movement.hasTarget[casterEid] = 0;
      Movement.vx[casterEid] = 0;
      Movement.vz[casterEid] = 0;
      Movement.attackMove[casterEid] = 0;
      Combat.isWindingUp[casterEid] = 0;
      Combat.attackAnimTimer[casterEid] = delay;
      this.world.entityPaths.delete(casterEid);

      const zoneEid = this.world.spawnSkillZone({
        ownerEid: casterEid,
        team,
        x: cx,
        z: cz,
        delay,
        duration: delay + 0.55,
        radius: beamWidth * 0.5,
        damage: totalDamage,
        damageType: skill.damageType,
        stunDuration: skill.stunDuration ?? 0,
        slowPercent: skill.slowAmount ?? 0,
        slowDuration: skill.slowDuration ?? 1.5,
        color: skill.color,
        isBeam: true,
        zoneKind: ZONE_BEAM,
        dirX,
        dirZ,
        beamLength,
        beamWidth,
        isGlobal: Boolean(skill.isGlobal),
      });

      this.channelingR.set(casterEid, { timer: delay, zoneEid });

      this.bus.emit('skillCast', {
        casterEid,
        slot,
        originX: cx,
        originZ: cz,
        targetX: cx + dirX * beamLength,
        targetZ: cz + dirZ * beamLength,
        radius: beamWidth * 0.5,
        color: skill.color,
      });
      return true;
    }

    return true;
  }
}
