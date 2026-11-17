import { query, type QueryResult } from 'bitecs';
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
  STATE_ALIVE,
  UNIT_CHAMPION,
  UNIT_MINION,
  UNIT_TURRET,
  UNIT_NEXUS,
  TEAM_BLUE,
  TEAM_RED,
  TEAM_NEUTRAL,
  LANE_TOP,
  LANE_MID,
  LANE_BOT,
  AI_ROLE_BOT_CHAMPION,
} from '../Components';
import {
  GameWorld,
  LANE_WAYPOINTS,
  FOUNTAIN_BLUE,
  FOUNTAIN_RED,
} from '../World';
import { NavigationSystem } from './NavigationSystem';
import { SkillSystem } from './SkillSystem';
import { EventBus } from '../../core/EventBus';
import {
  getChampionData,
  getDashSkillSlot,
  type ChampionDef,
} from '../../data/ChampionsData';
import { buyItemForEntity } from '../../data/ItemsData';

export type BotState = 'FARMING' | 'HARASSING' | 'RETREATING';

export interface TeamLaneSlot {
  champId: number;
  lane: number;
  x: number;
  z: number;
  isPlayer: boolean;
}

/**
 * Generates a balanced 5v5 roster (2 Top, 1 Mid, 2 Bot) with all 5 distinct champions
 * (0: TITAN, 1: VALKYRIE, 2: SHADOW, 3: NOVA, 4: AURELIA) and zero duplicates per team.
 */
export function build5v5TeamRoster(
  team: number,
  playerChampId: number
): TeamLaneSlot[] {
  const isBlue = team === TEAM_BLUE;
  const baseSlots: Array<{ champId: number; lane: number; x: number; z: number }> = isBlue
    ? [
        { champId: 0, lane: LANE_TOP, x: -99, z: 82 }, // TITAN (Đỡ Đòn - Top)
        { champId: 1, lane: LANE_TOP, x: -95, z: 75 }, // VALKYRIE (Đấu Sĩ - Top)
        { champId: 4, lane: LANE_MID, x: -86, z: 86 }, // AURELIA (Pháp Sư - Mid)
        { champId: 3, lane: LANE_BOT, x: -75, z: 95 }, // NOVA (Xạ Thủ - Bot)
        { champId: 2, lane: LANE_BOT, x: -82, z: 99 }, // SHADOW (Sát Thủ - Bot)
      ]
    : [
        { champId: 0, lane: LANE_TOP, x: 75, z: -95 }, // TITAN (Đỡ Đòn - Top)
        { champId: 1, lane: LANE_TOP, x: 82, z: -99 }, // VALKYRIE (Đấu Sĩ - Top)
        { champId: 4, lane: LANE_MID, x: 86, z: -86 }, // AURELIA (Pháp Sư - Mid)
        { champId: 3, lane: LANE_BOT, x: 99, z: -82 }, // NOVA (Xạ Thủ - Bot)
        { champId: 2, lane: LANE_BOT, x: 95, z: -75 }, // SHADOW (Sát Thủ - Bot)
      ];

  let playerIdx = -1;
  if (isBlue) {
    playerIdx = baseSlots.findIndex((s) => s.champId === playerChampId);
    if (playerIdx < 0) playerIdx = 1;
  }

  return baseSlots.map((s, idx) => ({
    ...s,
    isPlayer: isBlue && idx === playerIdx,
  }));
}

const ROLE_BUILD_ORDER: Record<string, string[]> = {
  tank: [
    'boots_speed',
    'thornmail',
    'boots_sorc',
    'spirit_visage',
    'warmog_armor',
    'black_cleaver',
    'zhonya_hourglass',
  ],
  fighter: [
    'boots_speed',
    'black_cleaver',
    'boots_berserker',
    'bloodthirster',
    'spirit_visage',
    'thornmail',
    'infinity_edge',
  ],
  assassin: [
    'boots_speed',
    'infinity_edge',
    'boots_berserker',
    'bloodthirster',
    'black_cleaver',
    'zhonya_hourglass',
    'thornmail',
  ],
  marksman: [
    'boots_speed',
    'boots_berserker',
    'infinity_edge',
    'bloodthirster',
    'black_cleaver',
    'thornmail',
    'spirit_visage',
  ],
  mage: [
    'boots_speed',
    'boots_sorc',
    'rabadon_cap',
    'void_staff',
    'zhonya_hourglass',
    'spirit_visage',
    'warmog_armor',
  ],
};

export class BotAISystem {
  private world: GameWorld;
  private nav: NavigationSystem;
  private skills: SkillSystem;
  private bus: EventBus;
  private botStates = new Map<number, BotState>();
  private botLowHpRetreat = new Set<number>();
  private botShopTimers = new Map<number, number>();

  constructor(world: GameWorld, nav: NavigationSystem, skills: SkillSystem, bus: EventBus) {
    this.world = world;
    this.nav = nav;
    this.skills = skills;
    this.bus = bus;
  }

  public update(dt: number): void {
    if (this.world.matchEnded) return;

    const units = query(this.world.ecs, [Transform, Team, UnitType, Stats, Combat]);
    const aiEnts = query(this.world.ecs, [Transform, Movement, Team, UnitType, Stats, Combat, AI]);

    for (let i = 0; i < aiEnts.length; i++) {
      const eid = aiEnts[i];
      if (AI.role[eid] !== AI_ROLE_BOT_CHAMPION) continue;

      if (UnitType.state[eid] !== STATE_ALIVE) {
        const lane = AI.lane[eid];
        const wps = LANE_WAYPOINTS[lane] ?? LANE_WAYPOINTS[LANE_MID];
        AI.waypointIndex[eid] =
          Team.id[eid] === TEAM_BLUE ? 1 : Math.max(0, wps.length - 2);
        this.botLowHpRetreat.delete(eid);
        continue;
      }

      this.updateBot(eid, dt, units);
    }
  }

  private tryAutoUpgradeSkills(eid: number): void {
    while (SkillBook.skillPoints[eid] > 0) {
      if (
        Stats.level[eid] >= 6 &&
        this.skills.upgradeSkill(eid, 'R')
      ) {
        continue;
      }
      if (this.skills.upgradeSkill(eid, 'Q')) continue;
      if (this.skills.upgradeSkill(eid, 'E')) continue;
      if (this.skills.upgradeSkill(eid, 'W')) continue;
      if (this.skills.upgradeSkill(eid, 'R')) continue;
      break;
    }
  }

  private tryAutoShop(eid: number, dt: number): void {
    let t = (this.botShopTimers.get(eid) ?? 5.0) - dt;
    if (t > 0) {
      this.botShopTimers.set(eid, t);
      return;
    }
    this.botShopTimers.set(eid, 7.5);

    const def = getChampionData(UnitType.subKind[eid]);
    const build = ROLE_BUILD_ORDER[def.archetype] ?? ROLE_BUILD_ORDER.fighter;
    const inv = this.world.inventories.get(eid) ?? [];

    const hasUpgradedBoots =
      inv.includes('boots_sorc') || inv.includes('boots_berserker');

    for (const itemId of build) {
      if (inv.includes(itemId)) continue;
      if (itemId === 'boots_speed' && hasUpgradedBoots) continue;
      if (buyItemForEntity(this.world, this.bus, eid, itemId)) {
        break;
      }
    }
  }

  private findSafeRetreatPoint(
    eid: number,
    myTeam: number,
    mx: number,
    mz: number,
    units: QueryResult
  ): { x: number; z: number } {
    const fountain = myTeam === TEAM_BLUE ? FOUNTAIN_BLUE : FOUNTAIN_RED;
    const myLane = AI.lane[eid];
    let bestTurret = -1;
    let bestDist = Infinity;

    for (let i = 0; i < units.length; i++) {
      const uid = units[i];
      if (
        UnitType.state[uid] === STATE_ALIVE &&
        Team.id[uid] === myTeam &&
        UnitType.kind[uid] === UNIT_TURRET &&
        AI.lane[uid] === myLane
      ) {
        const d = Math.hypot(Transform.x[uid] - mx, Transform.z[uid] - mz);
        const distToFountain = Math.hypot(
          Transform.x[uid] - fountain.x,
          Transform.z[uid] - fountain.z
        );
        const myDistToFountain = Math.hypot(mx - fountain.x, mz - fountain.z);
        // Pick closest allied turret that is closer to our fountain than we are
        if (distToFountain <= myDistToFountain + 12 && d < bestDist) {
          bestDist = d;
          bestTurret = uid;
        }
      }
    }

    if (bestTurret >= 0 && bestDist > 10) {
      const tx = Transform.x[bestTurret];
      const tz = Transform.z[bestTurret];
      const dx = fountain.x - tx;
      const dz = fountain.z - tz;
      const len = Math.max(0.1, Math.hypot(dx, dz));
      return {
        x: tx + (dx / len) * 4.5,
        z: tz + (dz / len) * 4.5,
      };
    }

    return fountain;
  }

  private updateBot(eid: number, dt: number, units: QueryResult): void {
    this.tryAutoUpgradeSkills(eid);
    this.tryAutoShop(eid, dt);

    AI.thinkTimer[eid] -= dt;
    if (AI.thinkTimer[eid] > 0) return;
    AI.thinkTimer[eid] = 0.22;

    if (
      StatusEffects.stunTimer[eid] > 0 ||
      StatusEffects.untargetableTimer[eid] > 0 ||
      Movement.isDashing[eid] === 1 ||
      this.skills.isChanneling(eid)
    ) {
      return;
    }

    const myTeam = Team.id[eid];
    const mx = Transform.x[eid];
    const mz = Transform.z[eid];
    const hpRatio = Stats.hp[eid] / Math.max(1, Stats.maxHp[eid]);
    const fountain = myTeam === TEAM_BLUE ? FOUNTAIN_BLUE : FOUNTAIN_RED;
    const def = getChampionData(UnitType.subKind[eid]);
    const dashSlot = getDashSkillSlot(def);

    // Check enemy turret proximity & targeting
    let nearEnemyTurret = -1;
    let alliedMinionsUnderTurret = 0;
    let targetedByEnemyTurret = false;

    for (let i = 0; i < units.length; i++) {
      const uid = units[i];
      if (UnitType.state[uid] !== STATE_ALIVE) continue;
      if (
        Team.id[uid] !== myTeam &&
        Team.id[uid] !== TEAM_NEUTRAL &&
        UnitType.kind[uid] === UNIT_TURRET
      ) {
        const d = Math.hypot(Transform.x[uid] - mx, Transform.z[uid] - mz);
        if (Combat.targetEid[uid] === eid) {
          targetedByEnemyTurret = true;
          nearEnemyTurret = uid;
          break;
        }
        if (d < Combat.attackRange[uid] + 3.0) {
          nearEnemyTurret = uid;
        }
      }
    }

    if (nearEnemyTurret >= 0) {
      const tx = Transform.x[nearEnemyTurret];
      const tz = Transform.z[nearEnemyTurret];
      for (let i = 0; i < units.length; i++) {
        const uid = units[i];
        if (
          UnitType.state[uid] === STATE_ALIVE &&
          Team.id[uid] === myTeam &&
          UnitType.kind[uid] === UNIT_MINION
        ) {
          if (Math.hypot(Transform.x[uid] - tx, Transform.z[uid] - tz) < 14.5) {
            alliedMinionsUnderTurret++;
          }
        }
      }
    }

    // State 1: RETREATING (HP < 30% or targeted by enemy turret or unsafe turret dive)
    if (hpRatio < 0.3) {
      this.botLowHpRetreat.add(eid);
    } else if (hpRatio >= 0.8) {
      this.botLowHpRetreat.delete(eid);
    }

    const unsafeTurret =
      nearEnemyTurret >= 0 && (targetedByEnemyTurret || alliedMinionsUnderTurret < 2);

    if (this.botLowHpRetreat.has(eid) || unsafeTurret) {
      this.botStates.set(eid, 'RETREATING');
      Combat.targetEid[eid] = -1;
      Combat.isWindingUp[eid] = 0;

      if (hpRatio < 0.35) {
        this.skills.castSkill(eid, 'F', mx, mz);
      }

      // SHADOW uses W smoke bomb to turn invisible when retreating
      if (def.id === 'shadow' && hpRatio < 0.45) {
        this.skills.castSkill(eid, 'W', mx, mz);
      }
      // TITAN uses W fortress damage reduction when retreating at low HP
      if (def.id === 'titan' && hpRatio < 0.45) {
        this.skills.castSkill(eid, 'W', mx, mz);
      }

      const retreatPt = this.findSafeRetreatPoint(eid, myTeam, mx, mz, units);
      const rdx = retreatPt.x - mx;
      const rdz = retreatPt.z - mz;
      const rdist = Math.max(0.1, Math.hypot(rdx, rdz));

      // Defensive Dash toward allied turret / fountain when < 30% HP or escaping turret
      if (StatusEffects.rootTimer[eid] <= 0) {
        this.skills.castSkill(
          eid,
          dashSlot,
          mx + (rdx / rdist) * 8.0,
          mz + (rdz / rdist) * 8.0
        );
      }

      if (nearEnemyTurret >= 0 && !this.botLowHpRetreat.has(eid)) {
        const tx = Transform.x[nearEnemyTurret];
        const tz = Transform.z[nearEnemyTurret];
        const ax = mx - tx;
        const az = mz - tz;
        const alen = Math.max(0.1, Math.hypot(ax, az));
        const safeX = tx + (ax / alen) * (Combat.attackRange[nearEnemyTurret] + 4.5);
        const safeZ = tz + (az / alen) * (Combat.attackRange[nearEnemyTurret] + 4.5);
        this.nav.commandMoveTo(eid, safeX, safeZ, false);
      } else {
        this.nav.commandMoveTo(eid, fountain.x, fountain.z, false);
      }
      return;
    }

    // Heal at fountain if hurt
    if (Math.hypot(mx - fountain.x, mz - fountain.z) < 13 && hpRatio < 0.85) {
      this.botStates.set(eid, 'RETREATING');
      Combat.targetEid[eid] = -1;
      Movement.hasTarget[eid] = 0;
      return;
    }

    // Scan visible enemy targets near bot
    let bestChamp = -1;
    let bestChampDist = 18.0;
    let lowHpSnipeChamp = -1;
    let bestMinion = -1;
    let bestMinionScore = -1e9;
    let bestStruct = -1;
    let bestStructDist = 18.5;

    for (let i = 0; i < units.length; i++) {
      const uid = units[i];
      const uTeam = Team.id[uid];
      if (uTeam === myTeam || uTeam === TEAM_NEUTRAL || UnitType.state[uid] !== STATE_ALIVE) {
        continue;
      }
      if (StatusEffects.untargetableTimer[uid] > 0) continue;
      if (!this.world.isVisibleToTeam(uid, myTeam)) continue;

      const uKind = UnitType.kind[uid];
      const d = Math.hypot(Transform.x[uid] - mx, Transform.z[uid] - mz);

      if (uKind === UNIT_CHAMPION) {
        if (d < bestChampDist) {
          bestChampDist = d;
          bestChamp = uid;
        }
        if (
          def.id === 'nova' &&
          d < 55.0 &&
          Stats.hp[uid] / Math.max(1, Stats.maxHp[uid]) < 0.42
        ) {
          lowHpSnipeChamp = uid;
        }
      } else if (uKind === UNIT_MINION && d < 16.5) {
        const lowBonus = Stats.hp[uid] < 105 ? 220 : 0;
        const score = lowBonus - d;
        if (score > bestMinionScore) {
          bestMinionScore = score;
          bestMinion = uid;
        }
      } else if (
        (uKind === UNIT_TURRET || uKind === UNIT_NEXUS) &&
        d < bestStructDist &&
        this.world.isStructureVulnerable(uid)
      ) {
        bestStructDist = d;
        bestStruct = uid;
      }
    }

    // NOVA Global Ultimate snipe on low-HP visible enemy champion
    if (def.id === 'nova' && lowHpSnipeChamp >= 0 && bestChamp < 0) {
      this.skills.castSkill(
        eid,
        'R',
        Transform.x[lowHpSnipeChamp],
        Transform.z[lowHpSnipeChamp]
      );
    }

    // State 2: HARASSING / CHAMPION-SPECIFIC COMBO TRADING
    if (bestChamp >= 0) {
      this.botStates.set(eid, 'HARASSING');
      this.executeChampionCombo(eid, def, bestChamp, bestChampDist, hpRatio, mx, mz);
      Combat.targetEid[eid] = bestChamp;
      return;
    }

    // State 3: FARMING / PUSHING
    this.botStates.set(eid, 'FARMING');
    if (bestMinion >= 0) {
      const mDist = Math.hypot(Transform.x[bestMinion] - mx, Transform.z[bestMinion] - mz);
      if (
        mDist < Math.min(12.0, def.skills.Q.range) &&
        Stats.mp[eid] > Stats.maxMp[eid] * 0.58 &&
        !def.skills.Q.isDash
      ) {
        this.skills.castSkill(eid, 'Q', Transform.x[bestMinion], Transform.z[bestMinion]);
      }
      Combat.targetEid[eid] = bestMinion;
      return;
    }

    if (
      bestStruct >= 0 &&
      (UnitType.kind[bestStruct] === UNIT_NEXUS || alliedMinionsUnderTurret >= 2)
    ) {
      Combat.targetEid[eid] = bestStruct;
      return;
    }

    // Advance along assigned lane waypoints
    Combat.targetEid[eid] = -1;
    const lane = AI.lane[eid];
    const wps = LANE_WAYPOINTS[lane] ?? LANE_WAYPOINTS[LANE_MID];
    let wpIdx = AI.waypointIndex[eid];
    const wp = wps[wpIdx];
    if (wp) {
      if (Math.hypot(wp.x - mx, wp.z - mz) < 7.5) {
        if (myTeam === TEAM_BLUE && wpIdx < wps.length - 1) wpIdx++;
        else if (myTeam === TEAM_RED && wpIdx > 0) wpIdx--;
        AI.waypointIndex[eid] = wpIdx;
      }
      const nextWp = wps[AI.waypointIndex[eid]];
      this.nav.commandMoveTo(eid, nextWp.x, nextWp.z, true);
    }
  }

  private executeChampionCombo(
    eid: number,
    def: ChampionDef,
    targetEid: number,
    dist: number,
    hpRatio: number,
    mx: number,
    mz: number
  ): void {
    const tx = Transform.x[targetEid];
    const tz = Transform.z[targetEid];
    const targetHpRatio = Stats.hp[targetEid] / Math.max(1, Stats.maxHp[targetEid]);
    const leadX = tx + Movement.vx[targetEid] * 0.25;
    const leadZ = tz + Movement.vz[targetEid] * 0.25;
    const canDash = StatusEffects.rootTimer[eid] <= 0;

    switch (def.id) {
      case 'titan': {
        // Q is Dash + Stun + Shield
        if (canDash && dist <= def.skills.Q.range + 0.5 && hpRatio > 0.35) {
          this.skills.castSkill(eid, 'Q', tx, tz);
        }
        // W: 40% DR fortress + AoE slow
        if (dist <= 5.5) {
          this.skills.castSkill(eid, 'W', tx, tz);
        }
        // E: Ground slam AoE stun
        if (dist <= 4.8) {
          this.skills.castSkill(eid, 'E', tx, tz);
        }
        // R: Circular barrier arena trap
        if (dist <= def.skills.R.range && (targetHpRatio < 0.72 || dist < 6.5)) {
          this.skills.castSkill(eid, 'R', tx, tz);
        }
        break;
      }

      case 'valkyrie': {
        // R2 Recast: fire giant sword beam if R1 is active!
        if (this.skills.isRecastReady(eid, 'R') && dist <= 16.0) {
          this.skills.castSkill(eid, 'R', leadX, leadZ);
        } else if (dist <= 9.5 && hpRatio > 0.35) {
          // R1: Empower (1.25x scale + 30% AD + 25% MS)
          this.skills.castSkill(eid, 'R', tx, tz);
        }
        // E is Dash slash (50% CD refund on champ hit/kill)
        if (
          canDash &&
          ((dist > 2.8 && dist <= def.skills.E.range + 0.5 && hpRatio > 0.4) ||
            (targetHpRatio < 0.45 && dist <= def.skills.E.range + 1.0))
        ) {
          this.skills.castSkill(eid, 'E', tx, tz);
        }
        // Q: Cone slash + heal
        if (dist <= def.skills.Q.range) {
          this.skills.castSkill(eid, 'Q', tx, tz);
        }
        // W: 1s defensive stance + piercing wave
        if (dist <= def.skills.W.range - 0.5) {
          this.skills.castSkill(eid, 'W', leadX, leadZ);
        }
        break;
      }

      case 'shadow': {
        // Q: 3-shuriken cone mark
        if (dist <= def.skills.Q.range - 0.5) {
          this.skills.castSkill(eid, 'Q', leadX, leadZ);
        }
        // E: Ultra-fast dash + guaranteed Crit next basic attack
        if (canDash && dist <= def.skills.E.range + 0.5 && hpRatio > 0.38) {
          this.skills.castSkill(eid, 'E', tx, tz);
        }
        // R: Vanish 0.4s -> reappear behind target execute
        if (dist <= def.skills.R.range && targetHpRatio < 0.65) {
          this.skills.castSkill(eid, 'R', tx, tz);
        }
        // W: Smoke bomb invisibility + 40% MS burst
        if (dist <= 6.5 || hpRatio < 0.6) {
          this.skills.castSkill(eid, 'W', tx, tz);
        }
        break;
      }

      case 'nova': {
        // W: Missile bombardment slow
        if (dist <= def.skills.W.range) {
          this.skills.castSkill(eid, 'W', leadX, leadZ);
        }
        // Q: Long piercing energy bolt
        if (dist <= def.skills.Q.range - 0.5) {
          this.skills.castSkill(eid, 'Q', leadX, leadZ);
        }
        // E: Tactical Roll Dash (+45% AS) — kite back if enemy close, or dash in to finish
        if (canDash) {
          if (dist < 5.0 && hpRatio < 0.75) {
            const kx = mx - (tx - mx);
            const kz = mz - (tz - mz);
            this.skills.castSkill(eid, 'E', kx, kz);
          } else if (targetHpRatio < 0.4 && dist <= 12.0 && hpRatio > 0.5) {
            this.skills.castSkill(eid, 'E', tx, tz);
          }
        }
        // R: Global mega beam when enemy < 50% HP
        if (targetHpRatio < 0.5) {
          this.skills.castSkill(eid, 'R', leadX, leadZ);
        }
        break;
      }

      case 'aurelia': {
        // W: 0.7s delayed Rune Trap -> 1.2s Root
        if (dist <= def.skills.W.range) {
          this.skills.castSkill(eid, 'W', leadX, leadZ);
        }
        // Q: Exploding Arcane Orb
        if (dist <= def.skills.Q.range - 0.5) {
          this.skills.castSkill(eid, 'Q', leadX, leadZ);
        }
        // E: Nebula Dash + 3 homing fireballs
        if (canDash) {
          if (dist < 5.2 && hpRatio < 0.7) {
            const kx = mx - (tx - mx);
            const kz = mz - (tz - mz);
            this.skills.castSkill(eid, 'E', kx, kz);
          } else if (dist <= 9.5 && hpRatio > 0.45) {
            this.skills.castSkill(eid, 'E', tx, tz);
          }
        }
        // R: 4-Meteor Storm
        if (
          dist <= def.skills.R.range &&
          (targetHpRatio < 0.68 ||
            StatusEffects.rootTimer[targetEid] > 0 ||
            StatusEffects.stunTimer[targetEid] > 0)
        ) {
          this.skills.castSkill(eid, 'R', leadX, leadZ);
        }
        break;
      }
    }
  }
}
