import * as THREE from 'three';
import { query, hasComponent } from 'bitecs';
import {
  Transform,
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
  MINION_SIEGE,
  MINION_MELEE,
  TEAM_BLUE,
} from '../Components';
import { GameWorld, TURRET_TRUE_SIGHT_RANGE } from '../World';
import { EventBus } from '../../core/EventBus';

export class TurretSystem {
  private world: GameWorld;
  private bus: EventBus;
  private scene: THREE.Scene;
  private lasers = new Map<number, THREE.Line>();

  constructor(world: GameWorld, bus: EventBus, scene: THREE.Scene) {
    this.world = world;
    this.bus = bus;
    this.scene = scene;
  }

  private isTargetableByTurret(uid: number, turretTeam: number, dist: number): boolean {
    if (hasComponent(this.world.ecs, uid, StatusEffects)) {
      if (StatusEffects.untargetableTimer[uid] > 0) return false;
      if (
        StatusEffects.invisTimer[uid] > 0 &&
        dist > TURRET_TRUE_SIGHT_RANGE + Transform.radius[uid]
      ) {
        return false;
      }
    }
    if (dist <= TURRET_TRUE_SIGHT_RANGE + Transform.radius[uid]) {
      return true;
    }
    const vis = turretTeam === TEAM_BLUE ? Vision.visibleToBlue[uid] : Vision.visibleToRed[uid];
    return vis === 1;
  }

  public update(_dt: number): void {
    const units = query(this.world.ecs, [Transform, Team, UnitType, Stats, Combat]);
    const turrets: number[] = [];

    for (let i = 0; i < units.length; i++) {
      if (UnitType.kind[units[i]] === UNIT_TURRET && UnitType.state[units[i]] === STATE_ALIVE) {
        turrets.push(units[i]);
      }
    }

    // Remove lasers for destroyed turrets
    for (const [tid, line] of this.lasers.entries()) {
      if (!this.world.isAliveUnit(tid)) {
        this.scene.remove(line);
        line.geometry.dispose();
        (line.material as THREE.Material).dispose();
        this.lasers.delete(tid);
      }
    }

    for (let t = 0; t < turrets.length; t++) {
      const tid = turrets[t];
      const tTeam = Team.id[tid];
      const tx = Transform.x[tid];
      const tz = Transform.z[tid];
      const range = Combat.attackRange[tid];

      // 1. Turret Protection Rule:
      // Immediately switch onto an Enemy Champion that damages an Allied Champion inside turret range
      let championAggroTarget = -1;
      for (let i = 0; i < units.length; i++) {
        const ally = units[i];
        if (
          UnitType.state[ally] !== STATE_ALIVE ||
          Team.id[ally] !== tTeam ||
          UnitType.kind[ally] !== UNIT_CHAMPION
        ) {
          continue;
        }
        if (Combat.aggroTimer[ally] > 0 && Combat.lastAttackerEid[ally] >= 0) {
          const attacker = Combat.lastAttackerEid[ally];
          if (
            this.world.isAliveUnit(attacker) &&
            Team.id[attacker] !== tTeam &&
            UnitType.kind[attacker] === UNIT_CHAMPION
          ) {
            const distAttacker = Math.hypot(Transform.x[attacker] - tx, Transform.z[attacker] - tz);
            const distAlly = Math.hypot(Transform.x[ally] - tx, Transform.z[ally] - tz);
            if (
              distAttacker <= range + Transform.radius[attacker] &&
              distAlly <= range + Transform.radius[ally] + 1.5 &&
              this.isTargetableByTurret(attacker, tTeam, distAttacker)
            ) {
              championAggroTarget = attacker;
              break;
            }
          }
        }
      }

      if (championAggroTarget >= 0) {
        Combat.targetEid[tid] = championAggroTarget;
      } else {
        // Check if current target is still valid, targetable, and inside turret range
        let current = Combat.targetEid[tid];
        if (current >= 0) {
          const dist = Math.hypot(Transform.x[current] - tx, Transform.z[current] - tz);
          if (
            !this.world.isAliveUnit(current) ||
            Team.id[current] === tTeam ||
            dist > range + Transform.radius[current] ||
            !this.isTargetableByTurret(current, tTeam, dist)
          ) {
            current = -1;
            Combat.targetEid[tid] = -1;
          }
        }

        // Acquire new target: Minions FIRST (Siege > Melee > Caster), Champions LAST
        if (current < 0) {
          let bestEid = -1;
          let bestScore = -1;

          for (let i = 0; i < units.length; i++) {
            const uid = units[i];
            if (Team.id[uid] === tTeam || UnitType.state[uid] !== STATE_ALIVE) continue;
            const kind = UnitType.kind[uid];
            if (kind !== UNIT_MINION && kind !== UNIT_CHAMPION) continue;

            const dist = Math.hypot(Transform.x[uid] - tx, Transform.z[uid] - tz);
            if (dist > range + Transform.radius[uid]) continue;
            if (!this.isTargetableByTurret(uid, tTeam, dist)) continue;

            let priority = 0;
            if (kind === UNIT_MINION) {
              const sub = UnitType.subKind[uid];
              priority = sub === MINION_SIEGE ? 400 : sub === MINION_MELEE ? 300 : 200;
            } else {
              priority = 50; // Champions only when NO minions are inside range
            }

            const score = priority - dist * 0.5;
            if (score > bestScore) {
              bestScore = score;
              bestEid = uid;
            }
          }
          Combat.targetEid[tid] = bestEid;
        }
      }

      const target = Combat.targetEid[tid];
      if (target !== AI.lastTurretTargetEid[tid]) {
        AI.lastTurretTargetEid[tid] = target;
        AI.consecutiveHits[tid] = 0;
        if (target < 0) {
          Combat.isWindingUp[tid] = 0;
        } else {
          this.bus.emit('turretTarget', {
            turretEid: tid,
            targetEid: target,
            isChampion: UnitType.kind[target] === UNIT_CHAMPION,
          });
        }
      }
    }
  }

  /**
   * Called each render frame so glowing turret laser sights smoothly track interpolated unit positions.
   */
  public updateLaserVisuals(time: number): void {
    const units = query(this.world.ecs, [Transform, Team, UnitType, Combat]);
    for (let i = 0; i < units.length; i++) {
      const tid = units[i];
      if (UnitType.kind[tid] !== UNIT_TURRET || UnitType.state[tid] !== STATE_ALIVE) continue;

      const target = Combat.targetEid[tid];
      let line = this.lasers.get(tid);

      if (target < 0 || !this.world.isAliveUnit(target)) {
        if (line) line.visible = false;
        continue;
      }

      if (!line) {
        const geom = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(),
          new THREE.Vector3(),
        ]);
        const mat = new THREE.LineBasicMaterial({
          color: 0xff1e38,
          transparent: true,
          opacity: 0.9,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        line = new THREE.Line(geom, mat);
        line.frustumCulled = false;
        line.renderOrder = 18;
        this.scene.add(line);
        this.lasers.set(tid, line);
      }

      const targetVisual = this.world.visuals.get(target);
      const tx = targetVisual ? targetVisual.position.x : Transform.x[target];
      const tz = targetVisual ? targetVisual.position.z : Transform.z[target];
      const targetY = UnitType.kind[target] === UNIT_CHAMPION ? 1.35 : 0.9;

      const posAttr = line.geometry.getAttribute('position') as THREE.BufferAttribute;
      posAttr.setXYZ(0, Transform.x[tid], 6.2, Transform.z[tid]);
      posAttr.setXYZ(1, tx, targetY, tz);
      posAttr.needsUpdate = true;

      const mat = line.material as THREE.LineBasicMaterial;
      const isTargetChamp = UnitType.kind[target] === UNIT_CHAMPION;
      const isPlayer = target === this.world.playerEid || UnitType.isPlayer[target] === 1;

      if (isPlayer) {
        const heatBoost = Math.min(0.25, AI.consecutiveHits[tid] * 0.06);
        const pulse = 0.65 + 0.35 * Math.sin(time * 18.0);
        mat.color.setHex(0xff112b);
        mat.opacity = Math.min(1.0, pulse + heatBoost);
      } else if (isTargetChamp) {
        const pulse = 0.6 + 0.35 * Math.sin(time * 14.0);
        mat.color.setHex(0xf43f5e);
        mat.opacity = pulse;
      } else {
        mat.color.setHex(Team.id[tid] === TEAM_BLUE ? 0x38bdf8 : 0xf59e0b);
        mat.opacity = 0.55;
      }
      line.visible = true;
    }
  }

  public dispose(): void {
    for (const line of this.lasers.values()) {
      this.scene.remove(line);
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    }
    this.lasers.clear();
  }
}
