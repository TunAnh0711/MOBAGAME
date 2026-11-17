import { query, hasComponent, type QueryResult } from 'bitecs';
import {
  Transform,
  Movement,
  Team,
  UnitType,
  Stats,
  StatusEffects,
  Combat,
  SkillBook,
  Projectile,
  Vision,
  AI,
  STATE_ALIVE,
  STATE_DEAD,
  UNIT_CHAMPION,
  UNIT_MINION,
  UNIT_TURRET,
  UNIT_NEXUS,
  UNIT_MONSTER,
  MINION_CASTER,
  MINION_SIEGE,
  TEAM_NEUTRAL,
  TEAM_BLUE,
  TEAM_RED,
  DMG_MAGIC,
  DMG_TRUE,
} from '../Components';
import {
  GameWorld,
  FOUNTAIN_BLUE,
  FOUNTAIN_RED,
  BUSH_ATTACK_REVEAL_TIME,
} from '../World';
import { EventBus } from '../../core/EventBus';
import { NavigationSystem } from './NavigationSystem';
import { getChampionDef } from '../../entities/ChampionDefs';

export interface DamageOptions {
  isCrit?: boolean;
  isBasicAttack?: boolean;
  isReflect?: boolean;
}

function lerpAngle(current: number, target: number, t: number): number {
  let diff = target - current;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * t;
}

function segmentPointDistSq(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  px: number,
  pz: number
): { distSq: number; t: number } {
  const vx = bx - ax;
  const vz = bz - az;
  const lenSq = vx * vx + vz * vz;
  if (lenSq <= 1e-6) {
    const dx = px - ax;
    const dz = pz - az;
    return { distSq: dx * dx + dz * dz, t: 0 };
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / lenSq));
  const cx = ax + vx * t;
  const cz = az + vz * t;
  const dx = px - cx;
  const dz = pz - cz;
  return { distSq: dx * dx + dz * dz, t };
}

export class CombatSystem {
  private world: GameWorld;
  private bus: EventBus;
  private nav: NavigationSystem;
  private attackMoveDestinations = new Map<number, { x: number; z: number }>();

  // Projectile metadata registries (no Components.ts changes needed)
  private basicAttackProjs = new Set<number>();
  private critProjs = new Set<number>();
  private markingProjs = new Set<number>();
  private explodingProjs = new Map<number, number>(); // pid -> explosionRadius
  private invulnWarnCooldown = new Map<number, number>();

  constructor(world: GameWorld, bus: EventBus, nav: NavigationSystem) {
    this.world = world;
    this.bus = bus;
    this.nav = nav;
  }

  public registerMarkingProjectile(pid: number): void {
    this.markingProjs.add(pid);
  }

  public registerExplodingProjectile(pid: number, explosionRadius: number): void {
    this.explodingProjs.set(pid, explosionRadius);
  }

  public update(dt: number): void {
    const units = query(this.world.ecs, [Transform, Team, UnitType, Stats, Combat]);

    for (const [eid, cd] of this.invulnWarnCooldown.entries()) {
      if (cd <= dt) this.invulnWarnCooldown.delete(eid);
      else this.invulnWarnCooldown.set(eid, cd - dt);
    }

    // 1. Fountain healing, Warmog out-of-combat regen, Champion Respawn & Timers
    for (let i = 0; i < units.length; i++) {
      const eid = units[i];

      if (
        (UnitType.kind[eid] === UNIT_CHAMPION || UnitType.kind[eid] === UNIT_MONSTER) &&
        UnitType.state[eid] === STATE_DEAD
      ) {
        UnitType.respawnTimer[eid] -= dt;
        if (UnitType.respawnTimer[eid] <= 0) {
          if (UnitType.kind[eid] === UNIT_CHAMPION) this.respawnChampion(eid);
          else this.respawnMonster(eid);
        }
        continue;
      }

      if (UnitType.state[eid] !== STATE_ALIVE) continue;

      if (Combat.attackCooldown[eid] > 0) {
        Combat.attackCooldown[eid] = Math.max(0, Combat.attackCooldown[eid] - dt);
      }
      if (Combat.aggroTimer[eid] > 0) {
        Combat.aggroTimer[eid] = Math.max(0, Combat.aggroTimer[eid] - dt);
        if (Combat.aggroTimer[eid] <= 0) Combat.lastAttackerEid[eid] = -1;
      }
      if (Combat.attackAnimTimer[eid] > 0) {
        Combat.attackAnimTimer[eid] = Math.max(0, Combat.attackAnimTimer[eid] - dt);
      }

      if (UnitType.kind[eid] === UNIT_CHAMPION) {
        Stats.outOfCombatTimer[eid] += dt;

        // Fountain Healing
        const fountain = Team.id[eid] === TEAM_BLUE ? FOUNTAIN_BLUE : FOUNTAIN_RED;
        const fdx = Transform.x[eid] - fountain.x;
        const fdz = Transform.z[eid] - fountain.z;
        if (fdx * fdx + fdz * fdz <= 13.5 * 13.5) {
          const healHp = Stats.maxHp[eid] * 0.14 * dt;
          const healMp = Stats.maxMp[eid] * 0.18 * dt;
          Stats.hp[eid] = Math.min(Stats.maxHp[eid], Stats.hp[eid] + healHp);
          Stats.mp[eid] = Math.min(Stats.maxMp[eid], Stats.mp[eid] + healMp);
        }

        // Giáp Máu Warmog: rapid HP regeneration after 5s out of combat (amplified by healAmp)
        if (
          Stats.warmogPassive[eid] > 0 &&
          Stats.outOfCombatTimer[eid] >= 5.0 &&
          Stats.hp[eid] < Stats.maxHp[eid]
        ) {
          const amp = 1 + Math.max(0, Stats.healAmp[eid]);
          const warmogRegen = Stats.maxHp[eid] * 0.05 * amp * dt;
          Stats.hp[eid] = Math.min(Stats.maxHp[eid], Stats.hp[eid] + warmogRegen);
        }
      }

      // Passive Monster HP regen when idle at camp
      if (UnitType.kind[eid] === UNIT_MONSTER && Combat.targetEid[eid] < 0) {
        Stats.hp[eid] = Math.min(Stats.maxHp[eid], Stats.hp[eid] + Stats.hpRegen[eid] * dt);
      }
    }

    // 2. Unit Attack Execution & Attack-Move Acquisition
    for (let i = 0; i < units.length; i++) {
      const eid = units[i];
      if (UnitType.state[eid] !== STATE_ALIVE) continue;
      if (UnitType.kind[eid] === UNIT_NEXUS) continue;

      if (StatusEffects.stunTimer[eid] > 0 || StatusEffects.untargetableTimer[eid] > 0) {
        Combat.isWindingUp[eid] = 0;
        continue;
      }

      const hasMove = hasComponent(this.world.ecs, eid, Movement);
      if (hasMove && Movement.isDashing[eid] === 1) {
        Combat.isWindingUp[eid] = 0;
        continue;
      }

      const isRooted = StatusEffects.rootTimer[eid] > 0;

      // Attack-Move & Idle Auto-Acquisition for Player Champion
      if (UnitType.kind[eid] === UNIT_CHAMPION && UnitType.isPlayer[eid] === 1) {
        if (Movement.attackMove[eid] === 1) {
          if (Combat.targetEid[eid] < 0 && Movement.hasTarget[eid] === 1) {
            const path = this.world.entityPaths.get(eid);
            const endPt =
              path && path.length > 0
                ? path[path.length - 1]
                : { x: Movement.targetX[eid], z: Movement.targetZ[eid] };
            this.attackMoveDestinations.set(eid, { x: endPt.x, z: endPt.z });
          }
          if (Combat.targetEid[eid] < 0) {
            const nearest = this.findNearestEnemy(eid, Combat.aggroRange[eid], units);
            if (nearest >= 0) {
              Combat.targetEid[eid] = nearest;
            } else if (Movement.hasTarget[eid] === 0 && !isRooted) {
              const dest = this.attackMoveDestinations.get(eid);
              if (dest && Math.hypot(dest.x - Transform.x[eid], dest.z - Transform.z[eid]) > 1.1) {
                this.nav.commandMoveTo(eid, dest.x, dest.z, true);
              } else {
                this.attackMoveDestinations.delete(eid);
                Movement.attackMove[eid] = 0;
              }
            }
          }
        } else {
          this.attackMoveDestinations.delete(eid);
          // When standing idle (and not explicitly stopped via 'S' where attackMove===2), auto-acquire in attack range
          if (
            Combat.targetEid[eid] < 0 &&
            Movement.attackMove[eid] === 0 &&
            Movement.hasTarget[eid] === 0 &&
            SkillBook.isRecalling[eid] === 0 &&
            Vision.inBrushId[eid] < 0
          ) {
            const nearest = this.findNearestEnemy(eid, Combat.attackRange[eid] + 1.5, units);
            if (nearest >= 0) {
              Combat.targetEid[eid] = nearest;
            }
          }
        }
      }

      const target = Combat.targetEid[eid];
      if (target < 0) {
        Combat.isWindingUp[eid] = 0;
        continue;
      }

      // Check target validity (including untargetable state like SHADOW R)
      if (
        !this.world.isAliveUnit(target) ||
        Team.id[target] === Team.id[eid] ||
        StatusEffects.untargetableTimer[target] > 0
      ) {
        Combat.targetEid[eid] = -1;
        Combat.isWindingUp[eid] = 0;
        if (
          UnitType.isPlayer[eid] === 1 &&
          Movement.attackMove[eid] === 1 &&
          !isRooted &&
          this.attackMoveDestinations.has(eid)
        ) {
          const dest = this.attackMoveDestinations.get(eid)!;
          this.nav.commandMoveTo(eid, dest.x, dest.z, true);
        }
        continue;
      }

      // Drop target if target entered fog of war / stealth brush / invisibility (unless already winding up)
      if (
        UnitType.kind[eid] === UNIT_CHAMPION &&
        (UnitType.kind[target] === UNIT_CHAMPION ||
          UnitType.kind[target] === UNIT_MINION ||
          UnitType.kind[target] === UNIT_MONSTER) &&
        Combat.isWindingUp[eid] === 0
      ) {
        if (!this.world.isVisibleToTeam(target, Team.id[eid])) {
          Combat.targetEid[eid] = -1;
          Combat.isWindingUp[eid] = 0;
          continue;
        }
      }

      const dx = Transform.x[target] - Transform.x[eid];
      const dz = Transform.z[target] - Transform.z[eid];
      const dist = Math.hypot(dx, dz);
      const effectiveRange = Combat.attackRange[eid] + Transform.radius[target];

      if (dist > effectiveRange) {
        Combat.isWindingUp[eid] = 0;
        if (hasMove && Movement.isDashing[eid] === 0) {
          if (UnitType.kind[eid] === UNIT_TURRET) {
            Combat.targetEid[eid] = -1;
          } else if (!isRooted) {
            // Rooted units cannot chase outside range, but do NOT drop target if already queued
            this.nav.commandMoveTo(
              eid,
              Transform.x[target],
              Transform.z[target],
              Movement.attackMove[eid] === 1
            );
          }
        }
        continue;
      }

      // Within range: stop moving, turn toward target, wind up, fire (Root still allows auto-attacks!)
      if (hasMove) {
        Movement.hasTarget[eid] = 0;
        Movement.vx[eid] = 0;
        Movement.vz[eid] = 0;
        this.world.entityPaths.delete(eid);
      }

      if (dist > 0.01) {
        const desiredRot = Math.atan2(dx, dz);
        Transform.rotY[eid] = lerpAngle(Transform.rotY[eid], desiredRot, Math.min(1, dt * 18));
      }

      if (Combat.isWindingUp[eid] === 1) {
        Combat.windupTimer[eid] -= dt;
        if (Combat.windupTimer[eid] <= 0) {
          Combat.isWindingUp[eid] = 0;
          if (dist > 0.01) {
            Transform.rotY[eid] = Math.atan2(dx, dz);
          }
          this.performBasicAttack(eid, target);
        }
      } else if (Combat.attackCooldown[eid] <= 0) {
        if (hasComponent(this.world.ecs, eid, SkillBook)) {
          SkillBook.isRecalling[eid] = 0;
          SkillBook.recallTimer[eid] = 0;
        }
        Combat.isWindingUp[eid] = 1;
        const as = this.getEffectiveAttackSpeed(eid);
        Combat.windupTimer[eid] = Math.min(0.18, 0.22 / as);
        Combat.attackAnimTimer[eid] = 0.28;
      }
    }

    // 3. Projectile Simulation
    this.updateProjectiles(dt, units);
  }

  private getEffectiveAttackSpeed(eid: number): number {
    const bonus = Math.max(0, Stats.attackSpeedBonus[eid]);
    return Math.max(0.25, Stats.attackSpeed[eid] * (1 + bonus) * Stats.asBuffMult[eid]);
  }

  private triggerMarkBonusIfAny(attackerEid: number, targetEid: number): void {
    if (
      attackerEid < 0 ||
      UnitType.kind[attackerEid] !== UNIT_CHAMPION ||
      !this.world.isAliveUnit(targetEid)
    ) {
      return;
    }
    if (StatusEffects.markedByEid[targetEid] === attackerEid && StatusEffects.markTimer[targetEid] > 0) {
      StatusEffects.markedByEid[targetEid] = -1;
      StatusEffects.markTimer[targetEid] = 0;
      const markDmg = 45 + Stats.ad[attackerEid] * 0.45;
      this.applyDamage(targetEid, attackerEid, markDmg, 'physical', { isCrit: true });
      this.bus.emit('skillImpact', {
        kind: 'hit',
        x: Transform.x[targetEid],
        z: Transform.z[targetEid],
        radius: 1.5,
        color: 0xe879f9,
      });
    }
  }

  private performBasicAttack(attackerEid: number, targetEid: number): void {
    const as = this.getEffectiveAttackSpeed(attackerEid);
    Combat.attackCooldown[attackerEid] = 1.0 / as;

    // Enforce Bush Reveal (1.5s) and break Invisibility on basic attack
    if (Vision.inBrushId[attackerEid] >= 0) {
      Vision.bushRevealTimer[attackerEid] = BUSH_ATTACK_REVEAL_TIME;
    }
    if (hasComponent(this.world.ecs, attackerEid, StatusEffects)) {
      StatusEffects.invisTimer[attackerEid] = 0;
    }
    if (UnitType.kind[attackerEid] === UNIT_CHAMPION) {
      Stats.outOfCombatTimer[attackerEid] = 0;
    }

    const projSpeed = Combat.projectileSpeed[attackerEid];
    let dmg = Stats.ad[attackerEid];
    let isCrit = false;

    const targetKind = UnitType.kind[targetEid];
    const isStructure = targetKind === UNIT_TURRET || targetKind === UNIT_NEXUS;

    if (UnitType.kind[attackerEid] === UNIT_CHAMPION && !isStructure) {
      // Guaranteed crit from SHADOW E empower
      const hasShadowEmpower =
        UnitType.subKind[attackerEid] === 2 &&
        StatusEffects.empoweredStacks[attackerEid] > 0 &&
        StatusEffects.empoweredTimer[attackerEid] > 0;
      if (hasShadowEmpower) {
        isCrit = true;
        StatusEffects.empoweredStacks[attackerEid] = 0;
        StatusEffects.empoweredTimer[attackerEid] = 0;
      } else if (Stats.critChance[attackerEid] > 0 && Math.random() < Math.min(1, Stats.critChance[attackerEid])) {
        isCrit = true;
      }
      if (isCrit) {
        dmg *= 1.75;
      }
    }

    if (UnitType.kind[attackerEid] === UNIT_TURRET && targetKind === UNIT_CHAMPION) {
      const stacks = Math.min(4, AI.consecutiveHits[attackerEid]);
      dmg *= 1 + stacks * 0.25;
      AI.consecutiveHits[attackerEid] = Math.min(4, stacks + 1);
    }

    const isCasterMinion =
      UnitType.kind[attackerEid] === UNIT_MINION && UnitType.subKind[attackerEid] === MINION_CASTER;

    if (projSpeed <= 0) {
      // Melee hit
      this.applyDamage(targetEid, attackerEid, dmg, 'physical', {
        isCrit,
        isBasicAttack: true,
      });
      this.triggerMarkBonusIfAny(attackerEid, targetEid);
      this.bus.emit('skillImpact', {
        kind: 'hit',
        x: Transform.x[targetEid],
        z: Transform.z[targetEid],
        radius: isCrit ? 1.35 : 0.9,
        color: isCrit ? 0xfacc15 : Team.id[attackerEid] === TEAM_BLUE ? 0x38bdf8 : 0xf43f5e,
      });
    } else {
      const ax = Transform.x[attackerEid];
      const az = Transform.z[attackerEid];
      const tx = Transform.x[targetEid];
      const tz = Transform.z[targetEid];
      const dx = tx - ax;
      const dz = tz - az;
      const len = Math.max(0.01, Math.hypot(dx, dz));
      const spawnY = UnitType.kind[attackerEid] === UNIT_TURRET ? 6.0 : 1.3;
      const color =
        UnitType.kind[attackerEid] === UNIT_TURRET
          ? Team.id[attackerEid] === TEAM_BLUE
            ? 0x38bdf8
            : 0xf43f5e
          : isCrit
            ? 0xfacc15
            : Team.id[attackerEid] === TEAM_BLUE
              ? isCasterMinion
                ? 0x60a5fa
                : 0x7dd3fc
              : isCasterMinion
                ? 0xe879f9
                : 0xfb7185;

      const pid = this.world.spawnProjectile({
        ownerEid: attackerEid,
        targetEid,
        team: Team.id[attackerEid],
        x: ax,
        y: spawnY,
        z: az,
        dirX: dx / len,
        dirZ: dz / len,
        speed: projSpeed,
        range: 65,
        damage: dmg,
        damageType: isCasterMinion ? 'magic' : 'physical',
        hitRadius: UnitType.kind[attackerEid] === UNIT_TURRET ? 0.55 : isCrit ? 0.45 : 0.35,
        piercing: false,
        color,
        isTurretShot: UnitType.kind[attackerEid] === UNIT_TURRET,
      });
      this.basicAttackProjs.add(pid);
      if (isCrit) this.critProjs.add(pid);
    }
  }

  private detonateAoEOrb(
    x: number,
    z: number,
    radius: number,
    owner: number,
    team: number,
    damage: number,
    dmgType: 'physical' | 'magic' | 'true',
    color: number,
    units: QueryResult
  ): void {
    for (let u = 0; u < units.length; u++) {
      const uid = units[u];
      if (Team.id[uid] === team || UnitType.state[uid] !== STATE_ALIVE) continue;
      const dist = Math.hypot(Transform.x[uid] - x, Transform.z[uid] - z);
      if (dist <= radius + Transform.radius[uid]) {
        this.applyDamage(uid, owner, damage, dmgType);
      }
    }
    this.bus.emit('skillImpact', {
      kind: 'aoe',
      x,
      z,
      radius,
      color,
    });
  }

  private updateProjectiles(dt: number, units: QueryResult): void {
    const projs = query(this.world.ecs, [Transform, Team, Projectile]);
    const toDestroy: number[] = [];

    for (let i = 0; i < projs.length; i++) {
      const pid = projs[i];
      const target = Projectile.targetEid[pid];
      const speed = Projectile.speed[pid];
      const step = speed * dt;
      const dmgType =
        Projectile.damageType[pid] === DMG_MAGIC
          ? 'magic'
          : Projectile.damageType[pid] === DMG_TRUE
            ? 'true'
            : 'physical';

      if (target >= 0) {
        // Homing basic-attack / turret / AURELIA E homing fireball
        if (!this.world.isAliveUnit(target) || StatusEffects.untargetableTimer[target] > 0) {
          toDestroy.push(pid);
          continue;
        }
        const tx = Transform.x[target];
        const ty = UnitType.kind[target] === UNIT_TURRET ? 3.5 : 1.1;
        const tz = Transform.z[target];

        const dx = tx - Transform.x[pid];
        const dy = ty - Transform.y[pid];
        const dz = tz - Transform.z[pid];
        const distXZ = Math.hypot(dx, dz);

        if (distXZ <= step + Transform.radius[target] * 0.65) {
          const isBasic = this.basicAttackProjs.has(pid);
          const isCrit = this.critProjs.has(pid);
          const owner = Projectile.ownerEid[pid];
          this.applyDamage(target, owner, Projectile.damage[pid], dmgType, {
            isCrit,
            isBasicAttack: isBasic,
          });
          if (isBasic) {
            this.triggerMarkBonusIfAny(owner, target);
          }
          this.bus.emit('skillImpact', {
            kind: 'hit',
            x: tx,
            z: tz,
            radius: Projectile.isTurretShot[pid] === 1 ? 1.3 : isCrit ? 1.15 : 0.75,
            color: Projectile.color[pid],
          });
          toDestroy.push(pid);
          continue;
        }

        const totalDist = Math.max(0.01, Math.hypot(dx, dy, dz));
        Transform.x[pid] += (dx / totalDist) * step;
        Transform.y[pid] += (dy / totalDist) * step;
        Transform.z[pid] += (dz / totalDist) * step;
        Transform.rotY[pid] = Math.atan2(dx, dz);
      } else {
        // Linear Skillshot projectile
        const prevX = Transform.x[pid];
        const prevZ = Transform.z[pid];
        const nextX = prevX + Projectile.dirX[pid] * step;
        const nextZ = prevZ + Projectile.dirZ[pid] * step;
        Transform.x[pid] = nextX;
        Transform.z[pid] = nextZ;
        Projectile.remainingRange[pid] -= step;

        const hitSet = this.world.projectileHits.get(pid);
        const pTeam = Team.id[pid];
        const pRadius = Projectile.hitRadius[pid];
        const isPiercing = Projectile.piercing[pid] === 1;
        const explodeRad = this.explodingProjs.get(pid);
        const isMarking = this.markingProjs.has(pid);

        const candidates: Array<{ uid: number; t: number }> = [];
        for (let u = 0; u < units.length; u++) {
          const uid = units[u];
          if (Team.id[uid] === pTeam || UnitType.state[uid] !== STATE_ALIVE) continue;
          if (StatusEffects.untargetableTimer[uid] > 0) continue;
          if (hitSet && hitSet.has(uid)) continue;

          const hitDist = pRadius + Transform.radius[uid];
          const res = segmentPointDistSq(
            prevX,
            prevZ,
            nextX,
            nextZ,
            Transform.x[uid],
            Transform.z[uid]
          );
          if (res.distSq <= hitDist * hitDist) {
            candidates.push({ uid, t: res.t });
          }
        }

        if (candidates.length > 1) {
          candidates.sort((a, b) => a.t - b.t);
        }

        let shouldStop = false;
        const owner = Projectile.ownerEid[pid];

        for (let c = 0; c < candidates.length; c++) {
          const uid = candidates[c].uid;
          if (hitSet) hitSet.add(uid);

          if (explodeRad && explodeRad > 0) {
            // AURELIA Q: Exploding Arcane Orb deals AoE damage around first impact
            this.detonateAoEOrb(
              Transform.x[uid],
              Transform.z[uid],
              explodeRad,
              owner,
              pTeam,
              Projectile.damage[pid],
              dmgType,
              Projectile.color[pid],
              units
            );
            shouldStop = true;
            break;
          }

          // SHADOW Q: Check existing mark before applying/refreshing mark
          if (isMarking && owner >= 0 && this.world.isAliveUnit(owner)) {
            if (StatusEffects.markedByEid[uid] === owner && StatusEffects.markTimer[uid] > 0) {
              const burstDmg = 40 + Stats.ad[owner] * 0.4;
              this.applyDamage(uid, owner, burstDmg, 'physical', { isCrit: true });
              StatusEffects.markedByEid[uid] = -1;
              StatusEffects.markTimer[uid] = 0;
            } else {
              StatusEffects.markedByEid[uid] = owner;
              StatusEffects.markTimer[uid] = 4.0;
            }
          }

          this.applyDamage(uid, owner, Projectile.damage[pid], dmgType);

          if (Projectile.slowAmount[pid] > 0 && this.world.isAliveUnit(uid)) {
            StatusEffects.slowPercent[uid] = Math.max(
              StatusEffects.slowPercent[uid],
              Projectile.slowAmount[pid]
            );
            StatusEffects.slowTimer[uid] = Math.max(
              StatusEffects.slowTimer[uid],
              Projectile.slowDuration[pid] || 1.5
            );
          }

          const cdr = Projectile.reduceCooldownOnHit[pid];
          if (
            cdr > 0 &&
            owner >= 0 &&
            this.world.isAliveUnit(owner) &&
            hasComponent(this.world.ecs, owner, SkillBook)
          ) {
            if (SkillBook.wCd[owner] > 0) SkillBook.wCd[owner] = Math.max(0, SkillBook.wCd[owner] - cdr);
            if (SkillBook.eCd[owner] > 0) SkillBook.eCd[owner] = Math.max(0, SkillBook.eCd[owner] - cdr);
            if (SkillBook.rCd[owner] > 0) SkillBook.rCd[owner] = Math.max(0, SkillBook.rCd[owner] - cdr);
          }

          const impactX = Transform.x[uid];
          const impactZ = Transform.z[uid];
          const stopHere =
            !isPiercing ||
            (Projectile.explodeOnFirstChamp[pid] === 1 && UnitType.kind[uid] === UNIT_CHAMPION);

          if (stopHere) {
            this.bus.emit('skillImpact', {
              kind: 'aoe',
              x: impactX,
              z: impactZ,
              radius: Math.max(1.8, pRadius * 1.9),
              color: Projectile.color[pid],
            });
          }
          this.bus.emit('skillImpact', {
            kind: 'hit',
            x: impactX,
            z: impactZ,
            radius: stopHere ? 1.4 : 1.1,
            color: Projectile.color[pid],
          });

          if (stopHere) {
            shouldStop = true;
            break;
          }
        }

        if (!shouldStop && Projectile.remainingRange[pid] <= 0) {
          // AURELIA Q explodes at max range if it hit nothing on the way!
          if (explodeRad && explodeRad > 0) {
            this.detonateAoEOrb(
              nextX,
              nextZ,
              explodeRad,
              owner,
              pTeam,
              Projectile.damage[pid],
              dmgType,
              Projectile.color[pid],
              units
            );
          }
          shouldStop = true;
        }

        if (shouldStop) {
          toDestroy.push(pid);
        }
      }
    }

    for (let i = 0; i < toDestroy.length; i++) {
      const pid = toDestroy[i];
      this.basicAttackProjs.delete(pid);
      this.critProjs.delete(pid);
      this.markingProjs.delete(pid);
      this.explodingProjs.delete(pid);
      this.world.destroyEntity(pid);
    }
  }

  public applyDamage(
    targetEid: number,
    sourceEid: number,
    rawAmount: number,
    damageType: 'physical' | 'magic' | 'true',
    options?: DamageOptions
  ): void {
    if (!this.world.isAliveUnit(targetEid)) return;
    if (this.world.matchEnded) return;
    if (StatusEffects.untargetableTimer[targetEid] > 0) return;

    const targetKind = UnitType.kind[targetEid];
    if (
      (targetKind === UNIT_TURRET || targetKind === UNIT_NEXUS) &&
      !this.world.isStructureVulnerable(targetEid)
    ) {
      if (sourceEid === this.world.playerEid && !this.invulnWarnCooldown.has(targetEid)) {
        this.invulnWarnCooldown.set(targetEid, 2.5);
        this.bus.emit('announcement', {
          text:
            targetKind === UNIT_NEXUS
              ? 'Hãy phá hủy cả 2 Trụ Bảo Vệ Nhà Chính trước!'
              : 'Hãy phá hủy Trụ tuyến ngoài trước!',
          color: '#fbbf24',
        });
      }
      return;
    }

    // Track Combat engagement for Warmog passive
    if (!options?.isReflect) {
      if (targetKind === UNIT_CHAMPION) {
        Stats.outOfCombatTimer[targetEid] = 0;
      }
      if (sourceEid >= 0 && UnitType.kind[sourceEid] === UNIT_CHAMPION) {
        Stats.outOfCombatTimer[sourceEid] = 0;
      }
    }

    let finalDamage = rawAmount;
    if (damageType === 'physical') {
      const effArmor = Math.max(0, Stats.armor[targetEid]);
      finalDamage = rawAmount * (100 / (100 + effArmor));
    } else if (damageType === 'magic') {
      let effMr = Math.max(0, Stats.mr[targetEid]);
      if (sourceEid >= 0 && this.world.isAliveUnit(sourceEid)) {
        const penPct = Math.max(0, Math.min(0.8, Stats.magicPenPct[sourceEid]));
        const penFlat = Math.max(0, Stats.magicPenFlat[sourceEid]);
        effMr = Math.max(0, effMr * (1 - penPct) - penFlat);
      }
      finalDamage = rawAmount * (100 / (100 + effMr));
    }

    // Damage Reduction (e.g., TITAN W 40%, VALKYRIE W 50%)
    if (damageType !== 'true' && Stats.damageReduction[targetEid] > 0) {
      const dr = Math.max(0, Math.min(0.75, Stats.damageReduction[targetEid]));
      finalDamage *= 1 - dr;
    }

    const rounded = Math.max(1, Math.round(finalDamage));

    // Shield absorption first
    let hpDamage = rounded;
    if (StatusEffects.shieldAmount[targetEid] > 0) {
      const absorbed = Math.min(StatusEffects.shieldAmount[targetEid], hpDamage);
      StatusEffects.shieldAmount[targetEid] -= absorbed;
      hpDamage -= absorbed;
      if (StatusEffects.shieldAmount[targetEid] <= 0.01) {
        StatusEffects.shieldAmount[targetEid] = 0;
        StatusEffects.shieldTimer[targetEid] = 0;
      }
    }

    Stats.hp[targetEid] = Math.max(0, Stats.hp[targetEid] - hpDamage);

    // Lifesteal healing on physical damage against non-structures (amplified by healAmp)
    if (
      sourceEid >= 0 &&
      this.world.isAliveUnit(sourceEid) &&
      damageType === 'physical' &&
      Stats.lifesteal[sourceEid] > 0 &&
      targetKind !== UNIT_TURRET &&
      targetKind !== UNIT_NEXUS
    ) {
      const amp = 1 + Math.max(0, Stats.healAmp[sourceEid]);
      const heal = Math.round(rounded * Stats.lifesteal[sourceEid] * amp);
      if (heal > 0) {
        Stats.hp[sourceEid] = Math.min(Stats.maxHp[sourceEid], Stats.hp[sourceEid] + heal);
        if (sourceEid === this.world.playerEid && heal >= 6) {
          this.bus.emit('heal', {
            targetEid: sourceEid,
            amount: heal,
            x: Transform.x[sourceEid],
            y: 2.3,
            z: Transform.z[sourceEid],
          });
        }
      }
    }

    // Giáp Gai (Thornmail) reflect magic damage back to basic attackers
    if (
      options?.isBasicAttack &&
      !options?.isReflect &&
      Stats.thornReflect[targetEid] > 0 &&
      sourceEid >= 0 &&
      sourceEid !== targetEid &&
      this.world.isAliveUnit(sourceEid) &&
      UnitType.kind[sourceEid] !== UNIT_TURRET &&
      UnitType.kind[sourceEid] !== UNIT_NEXUS
    ) {
      const refVal = Stats.thornReflect[targetEid];
      const baseReflect = refVal <= 1.0 ? rawAmount * refVal : refVal;
      const reflectRaw = Math.max(12, Math.round(baseReflect + Stats.armor[targetEid] * 0.15));
      this.applyDamage(sourceEid, targetEid, reflectRaw, 'magic', {
        isBasicAttack: false,
        isReflect: true,
      });
    }

    // Neutral Jungle Monster aggro retaliation
    if (
      targetKind === UNIT_MONSTER &&
      sourceEid >= 0 &&
      UnitType.kind[sourceEid] === UNIT_CHAMPION &&
      Combat.targetEid[targetEid] < 0
    ) {
      Combat.targetEid[targetEid] = sourceEid;
    }

    // Cancel recall on damage from champion/turret
    if (
      sourceEid >= 0 &&
      hasComponent(this.world.ecs, targetEid, SkillBook) &&
      (UnitType.kind[sourceEid] === UNIT_CHAMPION || UnitType.kind[sourceEid] === UNIT_TURRET)
    ) {
      SkillBook.isRecalling[targetEid] = 0;
      SkillBook.recallTimer[targetEid] = 0;
    }

    // Track Aggro for Minion & Turret protection rules
    if (sourceEid >= 0 && UnitType.kind[sourceEid] === UNIT_CHAMPION && !options?.isReflect) {
      Combat.lastAttackerEid[targetEid] = sourceEid;
      Combat.aggroTimer[targetEid] = 3.0;
    }

    // Emit floating damage event if visible to player team or player caused it
    if (
      this.world.isVisibleToPlayer(targetEid) ||
      Team.id[targetEid] === this.world.getPlayerTeam() ||
      sourceEid === this.world.playerEid
    ) {
      this.bus.emit('damage', {
        targetEid,
        sourceEid,
        amount: rounded,
        damageType,
        isCrit: Boolean(options?.isCrit) || rounded >= 220,
        x: Transform.x[targetEid],
        y: targetKind === UNIT_TURRET ? 6.5 : 2.3,
        z: Transform.z[targetEid],
      });
    }

    if (Stats.hp[targetEid] <= 0) {
      this.handleDeath(targetEid, sourceEid);
    }
  }

  private handleDeath(victimEid: number, killerEid: number): void {
    const vKind = UnitType.kind[victimEid];
    const vTeam = Team.id[victimEid];
    const vx = Transform.x[victimEid];
    const vz = Transform.z[victimEid];
    const kTeam =
      killerEid >= 0 && killerEid !== victimEid
        ? Team.id[killerEid]
        : vTeam === TEAM_BLUE
          ? TEAM_RED
          : TEAM_BLUE;

    UnitType.state[victimEid] = STATE_DEAD;
    Combat.targetEid[victimEid] = -1;
    Combat.isWindingUp[victimEid] = 0;
    Movement.hasTarget[victimEid] = 0;
    Movement.isDashing[victimEid] = 0;
    Movement.attackMove[victimEid] = 0;
    this.attackMoveDestinations.delete(victimEid);

    StatusEffects.stunTimer[victimEid] = 0;
    StatusEffects.rootTimer[victimEid] = 0;
    StatusEffects.slowTimer[victimEid] = 0;
    StatusEffects.slowPercent[victimEid] = 0;
    StatusEffects.shieldAmount[victimEid] = 0;
    StatusEffects.shieldTimer[victimEid] = 0;
    StatusEffects.invisTimer[victimEid] = 0;
    StatusEffects.untargetableTimer[victimEid] = 0;
    StatusEffects.empoweredTimer[victimEid] = 0;
    StatusEffects.empoweredStacks[victimEid] = 0;
    StatusEffects.wStanceTimer[victimEid] = 0;
    StatusEffects.markedByEid[victimEid] = -1;
    StatusEffects.markTimer[victimEid] = 0;
    Vision.bushRevealTimer[victimEid] = 0;

    this.bus.emit('kill', {
      killerEid,
      victimEid,
      killerTeam: kTeam,
      victimTeam: vTeam,
      victimKind: vKind,
    });

    this.bus.emit('skillImpact', {
      kind: 'aoe',
      x: vx,
      z: vz,
      radius: vKind === UNIT_TURRET ? 4.5 : vKind === UNIT_CHAMPION ? 2.8 : 1.4,
      color: vTeam === TEAM_BLUE ? 0x38bdf8 : 0xf43f5e,
    });

    // Distribute XP to nearby enemy champions
    const champs = query(this.world.ecs, [Transform, Team, UnitType, Stats]);
    const xpReward =
      vKind === UNIT_CHAMPION
        ? 180 + Stats.level[victimEid] * 35
        : vKind === UNIT_TURRET
          ? 160
          : UnitType.subKind[victimEid] === MINION_SIEGE
            ? 78
            : 46;

    if (vKind !== UNIT_MONSTER) {
      for (let i = 0; i < champs.length; i++) {
        const cid = champs[i];
        if (UnitType.kind[cid] !== UNIT_CHAMPION || UnitType.state[cid] !== STATE_ALIVE) continue;
        if (Team.id[cid] === vTeam) continue;
        const dist = Math.hypot(Transform.x[cid] - vx, Transform.z[cid] - vz);
        if (dist <= 22 || vKind === UNIT_TURRET) {
          this.grantXp(cid, xpReward);
        }
      }
    }

    if (vKind === UNIT_MINION) {
      if (killerEid >= 0 && UnitType.kind[killerEid] === UNIT_CHAMPION) {
        const gold = 20;
        Stats.gold[killerEid] += gold;
        Stats.cs[killerEid] += 1;
        if (killerEid === this.world.playerEid) {
          this.bus.emit('gold', {
            targetEid: killerEid,
            amount: gold,
            x: vx,
            y: 1.8,
            z: vz,
          });
        }
      }
      this.world.destroyEntity(victimEid);
    } else if (vKind === UNIT_MONSTER) {
      UnitType.respawnTimer[victimEid] = 35.0;
      if (killerEid >= 0 && UnitType.kind[killerEid] === UNIT_CHAMPION) {
        const gold = 85;
        Stats.gold[killerEid] += gold;
        Stats.cs[killerEid] += 2;
        const healAmt = Math.round(120 * (1 + Math.max(0, Stats.healAmp[killerEid])));
        Stats.hp[killerEid] = Math.min(Stats.maxHp[killerEid], Stats.hp[killerEid] + healAmt);
        this.grantXp(killerEid, 120);
        if (killerEid === this.world.playerEid) {
          this.bus.emit('gold', {
            targetEid: killerEid,
            amount: gold,
            x: vx,
            y: 2.2,
            z: vz,
          });
          this.bus.emit('heal', {
            targetEid: killerEid,
            amount: healAmt,
            x: Transform.x[killerEid],
            y: 2.3,
            z: Transform.z[killerEid],
          });
        }
      }
    } else if (vKind === UNIT_CHAMPION) {
      Stats.deaths[victimEid] += 1;
      UnitType.respawnTimer[victimEid] = 5.0 + Stats.level[victimEid] * 1.4;
      if (kTeam === TEAM_BLUE) this.world.blueKills += 1;
      else this.world.redKills += 1;

      if (killerEid >= 0 && UnitType.kind[killerEid] === UNIT_CHAMPION) {
        Stats.kills[killerEid] += 1;
        Stats.gold[killerEid] += 300;
        if (killerEid === this.world.playerEid) {
          this.bus.emit('gold', {
            targetEid: killerEid,
            amount: 300,
            x: vx,
            y: 2.5,
            z: vz,
          });
        }
      }

      const vDef = getChampionDef(UnitType.subKind[victimEid]);
      const kName =
        killerEid >= 0 && UnitType.kind[killerEid] === UNIT_CHAMPION
          ? getChampionDef(UnitType.subKind[killerEid]).name
          : 'Trụ / Lính';
      this.bus.emit('announcement', {
        text: `${kName} đã hạ gục ${vDef.name}!`,
        color: kTeam === TEAM_BLUE ? '#38bdf8' : '#f43f5e',
      });
    } else if (vKind === UNIT_TURRET) {
      for (let i = 0; i < champs.length; i++) {
        const cid = champs[i];
        if (UnitType.kind[cid] === UNIT_CHAMPION && Team.id[cid] === kTeam) {
          Stats.gold[cid] += 150;
          if (cid === this.world.playerEid) {
            this.bus.emit('gold', {
              targetEid: cid,
              amount: 150,
              x: vx,
              y: 4.5,
              z: vz,
            });
          }
        }
      }
      this.world.obstacles = this.world.obstacles.filter(
        (o) => !(o.kind === 'turret' && Math.hypot(o.x - vx, o.z - vz) < 1.0)
      );
      this.world.rebuildWalkGrid();
      this.bus.emit('cameraShake', { intensity: 0.45 });
      this.bus.emit('announcement', {
        text: `${vTeam === TEAM_RED ? 'Trụ Đỏ' : 'Trụ Xanh'} đã bị phá hủy!`,
        color: kTeam === TEAM_BLUE ? '#38bdf8' : '#f43f5e',
      });
      this.world.destroyEntity(victimEid);
    } else if (vKind === UNIT_NEXUS) {
      this.world.matchEnded = true;
      this.world.winnerTeam = kTeam;
      this.bus.emit('cameraShake', { intensity: 0.9 });
      this.bus.emit('matchEnd', { winnerTeam: kTeam });
    }
  }

  public grantXp(eid: number, amount: number): void {
    if (Stats.level[eid] >= 18) return;
    Stats.xp[eid] += amount;
    while (Stats.xp[eid] >= Stats.xpToNext[eid] && Stats.level[eid] < 18) {
      Stats.xp[eid] -= Stats.xpToNext[eid];
      Stats.level[eid] += 1;
      Stats.xpToNext[eid] = Math.round(Stats.xpToNext[eid] * 1.24 + 60);
      SkillBook.skillPoints[eid] += 1;

      const def = getChampionDef(UnitType.subKind[eid]);
      Stats.maxHp[eid] += def.hpPerLevel;
      Stats.hp[eid] += def.hpPerLevel;
      Stats.maxMp[eid] += def.mpPerLevel;
      Stats.mp[eid] += def.mpPerLevel;
      Stats.ad[eid] += def.adPerLevel;
      Stats.armor[eid] += def.armorPerLevel;
      Stats.mr[eid] += def.mrPerLevel;

      this.bus.emit('levelup', {
        eid,
        level: Stats.level[eid],
        x: Transform.x[eid],
        y: 0.1,
        z: Transform.z[eid],
      });

      // Auto-upgrade skills for AI bots
      if (UnitType.isPlayer[eid] === 0 && SkillBook.skillPoints[eid] > 0) {
        if (SkillBook.rLevel[eid] < 3 && Stats.level[eid] % 5 === 0) {
          SkillBook.rLevel[eid] += 1;
        } else if (SkillBook.qLevel[eid] < 5) {
          SkillBook.qLevel[eid] += 1;
        } else if (SkillBook.wLevel[eid] < 5) {
          SkillBook.wLevel[eid] += 1;
        } else if (SkillBook.eLevel[eid] < 5) {
          SkillBook.eLevel[eid] += 1;
        }
        SkillBook.skillPoints[eid] = 0;
      }
    }
  }

  private respawnMonster(eid: number): void {
    const sx = UnitType.spawnX[eid];
    const sz = UnitType.spawnZ[eid];
    Transform.x[eid] = sx;
    Transform.prevX[eid] = sx;
    Transform.z[eid] = sz;
    Transform.prevZ[eid] = sz;
    Movement.hasTarget[eid] = 0;
    Combat.targetEid[eid] = -1;
    Combat.isWindingUp[eid] = 0;
    Stats.hp[eid] = Stats.maxHp[eid];
    StatusEffects.stunTimer[eid] = 0;
    StatusEffects.rootTimer[eid] = 0;
    StatusEffects.slowTimer[eid] = 0;
    StatusEffects.slowPercent[eid] = 0;
    UnitType.state[eid] = STATE_ALIVE;
  }

  private respawnChampion(eid: number): void {
    const fountain = Team.id[eid] === TEAM_BLUE ? FOUNTAIN_BLUE : FOUNTAIN_RED;
    const rx = fountain.x;
    const rz = fountain.z;

    Transform.x[eid] = rx;
    Transform.prevX[eid] = rx;
    Transform.z[eid] = rz;
    Transform.prevZ[eid] = rz;
    Movement.hasTarget[eid] = 0;
    Movement.isDashing[eid] = 0;
    Movement.attackMove[eid] = 0;
    Movement.speedMult[eid] = 1;
    Movement.speedBuffTimer[eid] = 0;
    Combat.targetEid[eid] = -1;
    Combat.isWindingUp[eid] = 0;
    Stats.hp[eid] = Stats.maxHp[eid];
    Stats.mp[eid] = Stats.maxMp[eid];
    Stats.asBuffMult[eid] = 1;
    Stats.asBuffTimer[eid] = 0;
    Stats.outOfCombatTimer[eid] = 5.0;
    StatusEffects.shieldAmount[eid] = 0;
    StatusEffects.shieldTimer[eid] = 0;
    StatusEffects.stunTimer[eid] = 0;
    StatusEffects.rootTimer[eid] = 0;
    StatusEffects.slowTimer[eid] = 0;
    StatusEffects.slowPercent[eid] = 0;
    StatusEffects.invisTimer[eid] = 0;
    StatusEffects.untargetableTimer[eid] = 0;
    StatusEffects.empoweredTimer[eid] = 0;
    StatusEffects.empoweredStacks[eid] = 0;
    StatusEffects.wStanceTimer[eid] = 0;
    StatusEffects.markedByEid[eid] = -1;
    StatusEffects.markTimer[eid] = 0;
    Vision.bushRevealTimer[eid] = 0;
    SkillBook.isRecalling[eid] = 0;
    SkillBook.recallTimer[eid] = 0;
    SkillBook.rRecastTimer[eid] = 0;
    UnitType.state[eid] = STATE_ALIVE;
  }

  private findNearestEnemy(eid: number, maxRange: number, units: QueryResult): number {
    const myTeam = Team.id[eid];
    const mx = Transform.x[eid];
    const mz = Transform.z[eid];
    let bestEid = -1;
    let bestDistSq = maxRange * maxRange;

    for (let i = 0; i < units.length; i++) {
      const other = units[i];
      if (
        other === eid ||
        Team.id[other] === myTeam ||
        Team.id[other] === TEAM_NEUTRAL ||
        UnitType.state[other] !== STATE_ALIVE ||
        StatusEffects.untargetableTimer[other] > 0
      ) {
        continue;
      }
      const oKind = UnitType.kind[other];
      if ((oKind === UNIT_TURRET || oKind === UNIT_NEXUS) && !this.world.isStructureVulnerable(other)) {
        continue;
      }
      if (oKind === UNIT_CHAMPION || oKind === UNIT_MINION || oKind === UNIT_MONSTER) {
        if (!this.world.isVisibleToTeam(other, myTeam)) continue;
      }
      const dx = Transform.x[other] - mx;
      const dz = Transform.z[other] - mz;
      const dSq = dx * dx + dz * dz;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestEid = other;
      }
    }
    return bestEid;
  }
}
