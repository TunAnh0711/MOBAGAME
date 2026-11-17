export const MAX_ENTITIES = 4096;

export const TEAM_NEUTRAL = 0;
export const TEAM_BLUE = 1;
export const TEAM_RED = 2;

export const UNIT_CHAMPION = 1;
export const UNIT_MINION = 2;
export const UNIT_TURRET = 3;
export const UNIT_NEXUS = 4;
export const UNIT_PROJECTILE = 5;
export const UNIT_SKILL_ZONE = 6;
export const UNIT_MONSTER = 7;

export const MINION_MELEE = 1;
export const MINION_CASTER = 2;
export const MINION_SIEGE = 3;

export const TURRET_TIER_OUTER = 1;
export const TURRET_TIER_INNER = 2;
export const TURRET_TIER_INHIB = 3;
export const TURRET_TIER_NEXUS_GUARD = 4;

export const ZONE_AOE = 0;
export const ZONE_BEAM = 1;
export const ZONE_BARRIER = 2;
export const ZONE_ROOT_TRAP = 3;
export const ZONE_MULTI_TICK = 4;

export const STATE_DEAD = 0;
export const STATE_ALIVE = 1;

export const LANE_TOP = 0;
export const LANE_MID = 1;
export const LANE_BOT = 2;

export const AI_ROLE_MINION = 0;
export const AI_ROLE_BOT_CHAMPION = 1;
export const AI_ROLE_TURRET = 2;
export const AI_ROLE_MONSTER = 3;

export const DMG_PHYSICAL = 0;
export const DMG_MAGIC = 1;
export const DMG_TRUE = 2;

// Shared TypedArray backing stores so legacy and expanded field names never desync
const sharedShieldAmount = new Float32Array(MAX_ENTITIES);
const sharedShieldTimer = new Float32Array(MAX_ENTITIES);
const sharedSlowAmount = new Float32Array(MAX_ENTITIES);
const sharedWarmogPassive = new Uint8Array(MAX_ENTITIES);

export const Transform = {
  x: new Float32Array(MAX_ENTITIES),
  y: new Float32Array(MAX_ENTITIES),
  z: new Float32Array(MAX_ENTITIES),
  prevX: new Float32Array(MAX_ENTITIES),
  prevY: new Float32Array(MAX_ENTITIES),
  prevZ: new Float32Array(MAX_ENTITIES),
  rotY: new Float32Array(MAX_ENTITIES),
  prevRotY: new Float32Array(MAX_ENTITIES),
  radius: new Float32Array(MAX_ENTITIES),
};

export const Movement = {
  vx: new Float32Array(MAX_ENTITIES),
  vz: new Float32Array(MAX_ENTITIES),
  targetX: new Float32Array(MAX_ENTITIES),
  targetZ: new Float32Array(MAX_ENTITIES),
  hasTarget: new Uint8Array(MAX_ENTITIES),
  baseSpeed: new Float32Array(MAX_ENTITIES),
  speedMult: new Float32Array(MAX_ENTITIES),
  speedBuffTimer: new Float32Array(MAX_ENTITIES),
  isDashing: new Uint8Array(MAX_ENTITIES),
  dashEndX: new Float32Array(MAX_ENTITIES),
  dashEndZ: new Float32Array(MAX_ENTITIES),
  dashSpeed: new Float32Array(MAX_ENTITIES),
  attackMove: new Uint8Array(MAX_ENTITIES),
};

export const Team = {
  id: new Uint8Array(MAX_ENTITIES),
};

export const UnitType = {
  kind: new Uint8Array(MAX_ENTITIES),
  subKind: new Uint8Array(MAX_ENTITIES), // Champion index (0-4) or MINION_* or TURRET_TIER_*
  state: new Uint8Array(MAX_ENTITIES),
  respawnTimer: new Float32Array(MAX_ENTITIES),
  spawnX: new Float32Array(MAX_ENTITIES),
  spawnZ: new Float32Array(MAX_ENTITIES),
  inBrush: new Uint8Array(MAX_ENTITIES),
  isPlayer: new Uint8Array(MAX_ENTITIES),
};

export const Stats = {
  hp: new Float32Array(MAX_ENTITIES),
  maxHp: new Float32Array(MAX_ENTITIES),
  mp: new Float32Array(MAX_ENTITIES),
  maxMp: new Float32Array(MAX_ENTITIES),
  hpRegen: new Float32Array(MAX_ENTITIES),
  mpRegen: new Float32Array(MAX_ENTITIES),
  ad: new Float32Array(MAX_ENTITIES),
  ap: new Float32Array(MAX_ENTITIES),
  armor: new Float32Array(MAX_ENTITIES),
  mr: new Float32Array(MAX_ENTITIES),
  attackSpeed: new Float32Array(MAX_ENTITIES),
  asBuffMult: new Float32Array(MAX_ENTITIES),
  asBuffTimer: new Float32Array(MAX_ENTITIES),
  level: new Uint8Array(MAX_ENTITIES),
  xp: new Float32Array(MAX_ENTITIES),
  xpToNext: new Float32Array(MAX_ENTITIES),
  gold: new Float32Array(MAX_ENTITIES),
  kills: new Uint16Array(MAX_ENTITIES),
  deaths: new Uint16Array(MAX_ENTITIES),
  assists: new Uint16Array(MAX_ENTITIES),
  cs: new Uint16Array(MAX_ENTITIES),
  critChance: new Float32Array(MAX_ENTITIES),
  magicPenFlat: new Float32Array(MAX_ENTITIES),
  magicPenPct: new Float32Array(MAX_ENTITIES),
  lifesteal: new Float32Array(MAX_ENTITIES),
  cdr: new Float32Array(MAX_ENTITIES),
  damageReduction: new Float32Array(MAX_ENTITIES),
  thornReflect: new Float32Array(MAX_ENTITIES),
  healAmp: new Float32Array(MAX_ENTITIES),
  warmogPassive: sharedWarmogPassive,
  hasWarmog: sharedWarmogPassive,
  outOfCombatTimer: new Float32Array(MAX_ENTITIES),
  shield: sharedShieldAmount,
  shieldTimer: sharedShieldTimer,
  attackSpeedBonus: new Float32Array(MAX_ENTITIES),
  moveSpeedBonus: new Float32Array(MAX_ENTITIES),
};

export const StatusEffects = {
  slowPercent: sharedSlowAmount,
  slowAmount: sharedSlowAmount,
  slowTimer: new Float32Array(MAX_ENTITIES),
  stunTimer: new Float32Array(MAX_ENTITIES),
  rootTimer: new Float32Array(MAX_ENTITIES),
  shieldAmount: sharedShieldAmount,
  shieldTimer: sharedShieldTimer,
  invisTimer: new Float32Array(MAX_ENTITIES),
  untargetableTimer: new Float32Array(MAX_ENTITIES),
  empoweredTimer: new Float32Array(MAX_ENTITIES),
  empoweredStacks: new Uint8Array(MAX_ENTITIES),
  wStanceTimer: new Float32Array(MAX_ENTITIES),
  markedByEid: new Int32Array(MAX_ENTITIES),
  markTimer: new Float32Array(MAX_ENTITIES),
};

export const Combat = {
  targetEid: new Int32Array(MAX_ENTITIES),
  attackRange: new Float32Array(MAX_ENTITIES),
  attackCooldown: new Float32Array(MAX_ENTITIES),
  windupTimer: new Float32Array(MAX_ENTITIES),
  isWindingUp: new Uint8Array(MAX_ENTITIES),
  projectileSpeed: new Float32Array(MAX_ENTITIES),
  lastAttackerEid: new Int32Array(MAX_ENTITIES),
  aggroTimer: new Float32Array(MAX_ENTITIES),
  aggroRange: new Float32Array(MAX_ENTITIES),
  attackAnimTimer: new Float32Array(MAX_ENTITIES),
};

export const SkillBook = {
  qCd: new Float32Array(MAX_ENTITIES),
  qMaxCd: new Float32Array(MAX_ENTITIES),
  wCd: new Float32Array(MAX_ENTITIES),
  wMaxCd: new Float32Array(MAX_ENTITIES),
  eCd: new Float32Array(MAX_ENTITIES),
  eMaxCd: new Float32Array(MAX_ENTITIES),
  rCd: new Float32Array(MAX_ENTITIES),
  rMaxCd: new Float32Array(MAX_ENTITIES),
  dCd: new Float32Array(MAX_ENTITIES),
  dMaxCd: new Float32Array(MAX_ENTITIES),
  fCd: new Float32Array(MAX_ENTITIES),
  fMaxCd: new Float32Array(MAX_ENTITIES),
  qLevel: new Uint8Array(MAX_ENTITIES),
  wLevel: new Uint8Array(MAX_ENTITIES),
  eLevel: new Uint8Array(MAX_ENTITIES),
  rLevel: new Uint8Array(MAX_ENTITIES),
  skillPoints: new Uint8Array(MAX_ENTITIES),
  recallTimer: new Float32Array(MAX_ENTITIES),
  isRecalling: new Uint8Array(MAX_ENTITIES),
  rRecastTimer: new Float32Array(MAX_ENTITIES),
};

export const AI = {
  lane: new Uint8Array(MAX_ENTITIES),
  waypointIndex: new Uint8Array(MAX_ENTITIES),
  role: new Uint8Array(MAX_ENTITIES),
  thinkTimer: new Float32Array(MAX_ENTITIES),
  consecutiveHits: new Uint8Array(MAX_ENTITIES),
  lastTurretTargetEid: new Int32Array(MAX_ENTITIES),
};

export const Projectile = {
  ownerEid: new Int32Array(MAX_ENTITIES),
  targetEid: new Int32Array(MAX_ENTITIES),
  dirX: new Float32Array(MAX_ENTITIES),
  dirZ: new Float32Array(MAX_ENTITIES),
  speed: new Float32Array(MAX_ENTITIES),
  remainingRange: new Float32Array(MAX_ENTITIES),
  damage: new Float32Array(MAX_ENTITIES),
  damageType: new Uint8Array(MAX_ENTITIES),
  hitRadius: new Float32Array(MAX_ENTITIES),
  piercing: new Uint8Array(MAX_ENTITIES),
  explodeOnFirstChamp: new Uint8Array(MAX_ENTITIES),
  color: new Uint32Array(MAX_ENTITIES),
  isTurretShot: new Uint8Array(MAX_ENTITIES),
  reduceCooldownOnHit: new Float32Array(MAX_ENTITIES),
  slowAmount: new Float32Array(MAX_ENTITIES),
  slowDuration: new Float32Array(MAX_ENTITIES),
};

export const SkillZone = {
  ownerEid: new Int32Array(MAX_ENTITIES),
  team: new Uint8Array(MAX_ENTITIES),
  zoneKind: new Uint8Array(MAX_ENTITIES),
  delayTimer: new Float32Array(MAX_ENTITIES),
  totalDelay: new Float32Array(MAX_ENTITIES),
  durationTimer: new Float32Array(MAX_ENTITIES),
  radius: new Float32Array(MAX_ENTITIES),
  damage: new Float32Array(MAX_ENTITIES),
  damageType: new Uint8Array(MAX_ENTITIES),
  stunDuration: new Float32Array(MAX_ENTITIES),
  rootDuration: new Float32Array(MAX_ENTITIES),
  triggered: new Uint8Array(MAX_ENTITIES),
  color: new Uint32Array(MAX_ENTITIES),
  slowPercent: new Float32Array(MAX_ENTITIES),
  slowDuration: new Float32Array(MAX_ENTITIES),
  executeBonusMax: new Float32Array(MAX_ENTITIES),
  isBeam: new Uint8Array(MAX_ENTITIES),
  dirX: new Float32Array(MAX_ENTITIES),
  dirZ: new Float32Array(MAX_ENTITIES),
  beamLength: new Float32Array(MAX_ENTITIES),
  beamWidth: new Float32Array(MAX_ENTITIES),
  isBarrier: new Uint8Array(MAX_ENTITIES),
  barrierRadius: new Float32Array(MAX_ENTITIES),
  tickInterval: new Float32Array(MAX_ENTITIES),
  tickTimer: new Float32Array(MAX_ENTITIES),
  ticksRemaining: new Uint8Array(MAX_ENTITIES),
  isGlobal: new Uint8Array(MAX_ENTITIES),
};

export const Vision = {
  range: new Float32Array(MAX_ENTITIES),
  visibleToBlue: new Uint8Array(MAX_ENTITIES),
  visibleToRed: new Uint8Array(MAX_ENTITIES),
  inBrushId: new Int16Array(MAX_ENTITIES),
  bushRevealTimer: new Float32Array(MAX_ENTITIES),
};
