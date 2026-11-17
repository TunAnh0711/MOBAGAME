export type ChampionId = 'titan' | 'valkyrie' | 'shadow' | 'nova' | 'aurelia';
export type SkillSlot = 'Q' | 'W' | 'E' | 'R';
export type ChampionRole = 'Đỡ Đòn' | 'Đấu Sĩ' | 'Sát Thủ' | 'Xạ Thủ' | 'Pháp Sư';
export type SkillKind =
  | 'linear_projectile'
  | 'ground_aoe'
  | 'dash'
  | 'channeled_beam'
  | 'self_buff_pulse'
  | 'cone_slash'
  | 'stance_wave'
  | 'self_empower'
  | 'targeted_blink';

export const CHAMPION_IDS: readonly ChampionId[] = [
  'titan',
  'valkyrie',
  'shadow',
  'nova',
  'aurelia',
] as const;

export interface SkillDef {
  slot: SkillSlot;
  name: string;
  description: string;
  kind: SkillKind;
  isDash?: boolean;
  recastable?: boolean;
  recastName?: string;
  recastDescription?: string;
  isGlobal?: boolean;
  canCrossThinWalls?: boolean;
  cooldown: number;
  cdPerRank: number;
  manaCost: number;
  range: number;
  radius: number;
  width?: number;
  delay?: number;
  projectileSpeed?: number;
  projectileCount?: number;
  /** Damage multiplier for each projectile after the first in a multi-projectile skill. */
  projectileDamageFalloff?: number;
  piercing?: boolean;
  explodeOnFirstChamp?: boolean;
  explodeAtMaxRange?: boolean;
  baseDamage: number;
  damagePerRank: number;
  adRatio: number;
  apRatio: number;
  maxHpRatio?: number;
  executeBonusMax?: number;
  damageType: 'physical' | 'magic' | 'true';
  cdrOnHit?: number;
  resetAutoAttack?: boolean;
  stunDuration?: number;
  rootDuration?: number;
  slowAmount?: number;
  slowDuration?: number;
  knockbackDist?: number;
  shieldBase?: number;
  shieldApRatio?: number;
  shieldMaxHpRatio?: number;
  shieldDuration?: number;
  speedBuff?: number;
  asBuff?: number;
  adBuffPct?: number;
  damageReduction?: number;
  invisDuration?: number;
  untargetableDuration?: number;
  barrierDuration?: number;
  buffDuration?: number;
  coneAngleRad?: number;
  meteorCount?: number;
  healPerChampHit?: number;
  dashCdRefundPct?: number;
  empowersNextAttackCrit?: boolean;
  color: number;
  iconSymbol: string;
  iconSvg: string;
}

export interface SummonerSpellDef {
  slot: 'D' | 'F';
  name: string;
  description: string;
  cooldown: number;
  range: number;
  color: number;
  iconSymbol: string;
  iconSvg: string;
}

export interface ChampionStatBars {
  damage: number;
  toughness: number;
  mobility: number;
}

export interface ChampionDef {
  id: ChampionId;
  numericId: number;
  name: string;
  title: string;
  role: ChampionRole;
  archetype: 'tank' | 'fighter' | 'assassin' | 'marksman' | 'mage';
  suggestedLane: number; // 0=Top, 1=Mid, 2=Bot
  statBars: ChampionStatBars;
  primaryColor: number;
  accentColor: number;
  emblemSvg: string;
  maxHp: number;
  hpPerLevel: number;
  maxMp: number;
  mpPerLevel: number;
  hpRegen: number;
  mpRegen: number;
  ad: number;
  adPerLevel: number;
  ap: number;
  armor: number;
  armorPerLevel: number;
  mr: number;
  mrPerLevel: number;
  attackRange: number;
  attackSpeed: number;
  projectileSpeed: number; // 0 = melee
  moveSpeed: number;
  radius: number;
  skills: {
    Q: SkillDef;
    W: SkillDef;
    E: SkillDef;
    R: SkillDef;
  };
}

function makeSkillSvg(accent: string, inner: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" fill="none"><rect x="2" y="2" width="28" height="28" rx="6" fill="#0f172a" stroke="${accent}" stroke-width="1.8"/>${inner}</svg>`;
}

export const SUMMONER_SPELLS: Record<'D' | 'F', SummonerSpellDef> = {
  D: {
    slot: 'D',
    name: 'Tốc Biến (Flash)',
    description: 'Dịch chuyển tức thời tối đa 7.5m về hướng con trỏ chuột (vượt tường mỏng).',
    cooldown: 60,
    range: 7.5,
    color: 0xfacc15,
    iconSymbol: 'FL',
    iconSvg: makeSkillSvg(
      '#facc15',
      '<path d="M18 5L9 17h6l-1 10 9-12h-6l1-10z" fill="#fde047" stroke="#f59e0b" stroke-width="1.2" stroke-linejoin="round"/>'
    ),
  },
  F: {
    slot: 'F',
    name: 'Hồi Máu (Heal)',
    description: 'Hồi ngay 165 + 18xCấp máu và tăng 30% Tốc chạy trong 2 giây.',
    cooldown: 45,
    range: 0,
    color: 0x34d399,
    iconSymbol: 'HL',
    iconSvg: makeSkillSvg(
      '#34d399',
      '<path d="M13 7h6v6h6v6h-6v6h-6v-6H7v-6h6V7z" fill="#34d399" stroke="#a7f3d0" stroke-width="1.2" stroke-linejoin="round"/>'
    ),
  },
};

export const CHAMPIONS_DATA: ChampionDef[] = [
  {
    id: 'titan',
    numericId: 0,
    name: 'TITAN',
    title: 'Pháo Đài Thiết Giáp',
    role: 'Đỡ Đòn',
    archetype: 'tank',
    suggestedLane: 0,
    statBars: { damage: 42, toughness: 98, mobility: 62 },
    primaryColor: 0x3b82f6,
    accentColor: 0x94a3b8,
    emblemSvg:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48" fill="none"><path d="M24 4L40 10v13c0 10.5-6.8 18-16 21C14.8 41 8 33.5 8 23V10L24 4z" fill="#1e3a8a" stroke="#60a5fa" stroke-width="2.5"/><path d="M24 11v26M15 19h18" stroke="#93c5fd" stroke-width="3" stroke-linecap="round"/></svg>',
    maxHp: 750,
    hpPerLevel: 112,
    maxMp: 360,
    mpPerLevel: 35,
    hpRegen: 7.0,
    mpRegen: 3.5,
    ad: 60,
    adPerLevel: 3.8,
    ap: 20,
    armor: 46,
    armorPerLevel: 4.5,
    mr: 38,
    mrPerLevel: 2.2,
    attackRange: 2.8,
    attackSpeed: 0.78,
    projectileSpeed: 0,
    moveSpeed: 8.6,
    radius: 1.05,
    skills: {
      Q: {
        slot: 'Q',
        name: 'Khiên Xung Kích',
        description:
          '[LƯỚT] Xung phong về hướng con trỏ (6.5m), húc đẩy lùi + Làm Choáng 0.8s mục tiêu đầu tiên và tạo +100 Lá Chắn.',
        kind: 'dash',
        isDash: true,
        cooldown: 7.5,
        cdPerRank: 0.45,
        manaCost: 45,
        range: 6.5,
        radius: 1.85,
        baseDamage: 90,
        damagePerRank: 30,
        adRatio: 0.75,
        apRatio: 0,
        damageType: 'physical',
        stunDuration: 0.8,
        knockbackDist: 2.2,
        shieldBase: 100,
        shieldDuration: 2.5,
        color: 0x60a5fa,
        iconSymbol: 'DSH',
        iconSvg: makeSkillSvg(
          '#60a5fa',
          '<path d="M7 9h10l6 7-6 7H7l5-7-5-7z" fill="#3b82f6" stroke="#bfdbfe" stroke-width="1.3"/><path d="M22 10l5 6-5 6" stroke="#93c5fd" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
        ),
      },
      W: {
        slot: 'W',
        name: 'Pháo Đài Bất Hoại',
        description:
          'Kích hoạt hào quang 3s giảm 40% sát thương gánh chịu và Làm Chậm 35% kẻ địch xung quanh.',
        kind: 'self_buff_pulse',
        cooldown: 11.0,
        cdPerRank: 0.6,
        manaCost: 55,
        range: 0,
        radius: 5.5,
        baseDamage: 65,
        damagePerRank: 20,
        adRatio: 0.2,
        apRatio: 0.4,
        maxHpRatio: 0.05,
        damageType: 'magic',
        damageReduction: 0.4,
        buffDuration: 3.0,
        slowAmount: 0.35,
        slowDuration: 2.5,
        color: 0x3b82f6,
        iconSymbol: 'FRT',
        iconSvg: makeSkillSvg(
          '#3b82f6',
          '<path d="M16 6l9 3.5V17c0 5.5-3.8 9-9 10.5C10.8 26 7 22.5 7 17V9.5L16 6z" fill="#1d4ed8" stroke="#93c5fd" stroke-width="1.5"/>'
        ),
      },
      E: {
        slot: 'E',
        name: 'Địa Chấn Nghiền Nát',
        description:
          'Dậm mạnh xuống mặt đất xung quanh bản thân, gây sát thương vật lý + hất tung làm Choáng 0.6s.',
        kind: 'self_buff_pulse',
        cooldown: 9.0,
        cdPerRank: 0.5,
        manaCost: 50,
        range: 0,
        radius: 5.2,
        baseDamage: 95,
        damagePerRank: 32,
        adRatio: 0.65,
        apRatio: 0.35,
        maxHpRatio: 0.04,
        damageType: 'physical',
        stunDuration: 0.6,
        slowAmount: 0.25,
        slowDuration: 1.5,
        color: 0x93c5fd,
        iconSymbol: 'SLM',
        iconSvg: makeSkillSvg(
          '#93c5fd',
          '<circle cx="16" cy="18" r="7" stroke="#60a5fa" stroke-width="2" stroke-dasharray="3 2"/><path d="M16 6v9M11 11l5 5 5-5" stroke="#e0f2fe" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
        ),
      },
      R: {
        slot: 'R',
        name: 'Lãnh Địa Bất Khả Xâm Phạm',
        description:
          'Nhảy tới vùng chỉ định và dựng vòng tường năng lượng phát sáng (2.5s) giam giữ kẻ địch bên trong!',
        kind: 'ground_aoe',
        cooldown: 32.0,
        cdPerRank: 3.5,
        manaCost: 100,
        range: 12.5,
        radius: 5.2,
        delay: 0.35,
        baseDamage: 210,
        damagePerRank: 75,
        adRatio: 0.6,
        apRatio: 0.65,
        maxHpRatio: 0.08,
        damageType: 'magic',
        barrierDuration: 2.5,
        stunDuration: 0.4,
        color: 0x2563eb,
        iconSymbol: 'DOM',
        iconSvg: makeSkillSvg(
          '#38bdf8',
          '<circle cx="16" cy="16" r="9.5" stroke="#38bdf8" stroke-width="2.2"/><path d="M10 16h12M16 10v12" stroke="#bae6fd" stroke-width="1.8" stroke-linecap="round"/>'
        ),
      },
    },
  },
  {
    id: 'valkyrie',
    numericId: 1,
    name: 'VALKYRIE',
    title: 'Chiến Thần Thánh Kiếm',
    role: 'Đấu Sĩ',
    archetype: 'fighter',
    suggestedLane: 0,
    statBars: { damage: 82, toughness: 70, mobility: 78 },
    primaryColor: 0xf97316,
    accentColor: 0xfacc15,
    emblemSvg:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48" fill="none"><path d="M24 5l4 18 11-5-11 14v11h-8V32L9 18l11 5L24 5z" fill="#ea580c" stroke="#fde047" stroke-width="2" stroke-linejoin="round"/></svg>',
    maxHp: 620,
    hpPerLevel: 92,
    maxMp: 370,
    mpPerLevel: 38,
    hpRegen: 5.5,
    mpRegen: 3.8,
    ad: 68,
    adPerLevel: 4.5,
    ap: 20,
    armor: 36,
    armorPerLevel: 3.5,
    mr: 32,
    mrPerLevel: 1.6,
    attackRange: 3.2,
    attackSpeed: 0.92,
    projectileSpeed: 0,
    moveSpeed: 9.2,
    radius: 0.95,
    skills: {
      Q: {
        slot: 'Q',
        name: 'Tam Liên Trảm',
        description:
          'Chém hình quạt rộng phía trước gây sát thương vật lý; hồi Máu cho VALKYRIE theo mỗi Tướng địch trúng đòn!',
        kind: 'cone_slash',
        cooldown: 5.0,
        cdPerRank: 0.35,
        manaCost: 35,
        range: 5.8,
        radius: 5.8,
        coneAngleRad: Math.PI * 0.62,
        baseDamage: 95,
        damagePerRank: 35,
        adRatio: 0.9,
        apRatio: 0,
        damageType: 'physical',
        healPerChampHit: 48,
        slowAmount: 0.25,
        slowDuration: 1.2,
        color: 0xfb923c,
        iconSymbol: 'SLS',
        iconSvg: makeSkillSvg(
          '#fb923c',
          '<path d="M7 23C10 13 18 9 26 9" stroke="#fed7aa" stroke-width="2.2" stroke-linecap="round"/><path d="M9 25c4-7 10-10 17-10" stroke="#f97316" stroke-width="2" stroke-linecap="round"/><path d="M13 26c3-4 7-6 12-6" stroke="#fde047" stroke-width="1.6" stroke-linecap="round"/>'
        ),
      },
      W: {
        slot: 'W',
        name: 'Phản Đòn Kiếm Khí',
        description:
          'Vào thế phòng thủ 1s (giảm 50% sát thương), sau đó phóng sóng kiếm khí xuyên mục tiêu tầm trung.',
        kind: 'stance_wave',
        cooldown: 9.5,
        cdPerRank: 0.5,
        manaCost: 50,
        range: 13.5,
        radius: 1.45,
        delay: 1.0,
        projectileSpeed: 28,
        piercing: true,
        baseDamage: 105,
        damagePerRank: 35,
        adRatio: 0.85,
        apRatio: 0.2,
        damageType: 'physical',
        damageReduction: 0.5,
        buffDuration: 1.0,
        slowAmount: 0.3,
        slowDuration: 1.5,
        color: 0xfacc15,
        iconSymbol: 'CTR',
        iconSvg: makeSkillSvg(
          '#facc15',
          '<path d="M10 22L22 10M18 8h6v6" stroke="#fef08a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 14c0-3 2-5 5-5" stroke="#fb923c" stroke-width="1.8" stroke-linecap="round"/>'
        ),
      },
      E: {
        slot: 'E',
        name: 'Vũ Điệu Lướt Chém',
        description:
          '[LƯỚT] Lướt 7.0m về hướng con trỏ chém xuyên kẻ địch trên đường đi; trúng hoặc hạ gục Tướng địch hoàn 50% hồi chiêu!',
        kind: 'dash',
        isDash: true,
        cooldown: 8.5,
        cdPerRank: 0.5,
        manaCost: 45,
        range: 7.0,
        radius: 2.2,
        baseDamage: 85,
        damagePerRank: 28,
        adRatio: 0.75,
        apRatio: 0,
        damageType: 'physical',
        dashCdRefundPct: 0.5,
        resetAutoAttack: true,
        color: 0xf97316,
        iconSymbol: 'DSH',
        iconSvg: makeSkillSvg(
          '#f97316',
          '<path d="M6 21l9-9 4 4-9 9H6v-4z" fill="#fb923c"/><path d="M17 7l9 9-4 4-9-9 4-4z" stroke="#fde047" stroke-width="1.6"/>'
        ),
      },
      R: {
        slot: 'R',
        name: 'Thánh Kiếm Phán Quyết',
        description:
          'Cường hóa 6s (phóng đại 1.25x, +30% AD, +25% Tốc chạy). Bấm R lần 2 tung chưởng kiếm năng lượng khổng lồ!',
        kind: 'self_empower',
        recastable: true,
        recastName: 'Kiếm Khí Phán Quyết',
        recastDescription: 'Phóng luồng kiếm năng lượng khổng lồ xuyên toàn bộ kẻ địch theo hướng con trỏ.',
        cooldown: 30.0,
        cdPerRank: 3.5,
        manaCost: 90,
        range: 18.0,
        radius: 1.75,
        width: 3.5,
        delay: 0.2,
        baseDamage: 260,
        damagePerRank: 90,
        adRatio: 1.2,
        apRatio: 0,
        damageType: 'physical',
        adBuffPct: 0.3,
        speedBuff: 0.25,
        buffDuration: 6.0,
        color: 0xfde047,
        iconSymbol: 'ULT',
        iconSvg: makeSkillSvg(
          '#fde047',
          '<path d="M16 5l2.5 14h-5L16 5z" fill="#fef08a"/><path d="M11 19h10M16 19v8" stroke="#f59e0b" stroke-width="2.2" stroke-linecap="round"/>'
        ),
      },
    },
  },
  {
    id: 'shadow',
    numericId: 2,
    name: 'SHADOW',
    title: 'Bóng Ma Đoạt Mệnh',
    role: 'Sát Thủ',
    archetype: 'assassin',
    suggestedLane: 1,
    statBars: { damage: 96, toughness: 36, mobility: 96 },
    primaryColor: 0xa855f7,
    accentColor: 0xf43f5e,
    emblemSvg:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48" fill="none"><path d="M12 36L24 8l12 28-12-7-12 7z" fill="#581c87" stroke="#e879f9" stroke-width="2.2" stroke-linejoin="round"/><circle cx="24" cy="23" r="3.5" fill="#f43f5e"/></svg>',
    maxHp: 520,
    hpPerLevel: 80,
    maxMp: 350,
    mpPerLevel: 35,
    hpRegen: 4.5,
    mpRegen: 4.2,
    ad: 66,
    adPerLevel: 4.8,
    ap: 20,
    armor: 28,
    armorPerLevel: 3.0,
    mr: 30,
    mrPerLevel: 1.5,
    attackRange: 2.8,
    attackSpeed: 1.0,
    projectileSpeed: 0,
    moveSpeed: 10.4,
    radius: 0.85,
    skills: {
      Q: {
        slot: 'Q',
        name: 'Phi Tiêu Bóng Đêm',
        description:
          'Phóng 3 phi tiêu hình nón về hướng con trỏ gây sát thương vật lý (mỗi phi tiêu sau giảm 45% sát thương) và khắc Dấu Ấn Bóng Đêm (kích nổ sát thương cộng thêm).',
        kind: 'linear_projectile',
        projectileCount: 3,
        projectileDamageFalloff: 0.55,
        cooldown: 4.5,
        cdPerRank: 0.3,
        manaCost: 35,
        range: 13.5,
        radius: 0.9,
        projectileSpeed: 32,
        piercing: false,
        baseDamage: 66,
        damagePerRank: 22,
        adRatio: 0.62,
        apRatio: 0,
        damageType: 'physical',
        slowAmount: 0.25,
        slowDuration: 1.5,
        color: 0xc084fc,
        iconSymbol: 'SHR',
        iconSvg: makeSkillSvg(
          '#c084fc',
          '<path d="M16 5l2.5 8.5L27 16l-8.5 2.5L16 27l-2.5-8.5L5 16l8.5-2.5L16 5z" fill="#a855f7" stroke="#f5d0fe" stroke-width="1.2"/>'
        ),
      },
      W: {
        slot: 'W',
        name: 'Bom Khói Ẩn Thân',
        description:
          'Thả màn khói tím, lập tức Tàng Hình 1.5s và tăng +40% Tốc độ chạy (hiện hình nếu tấn công).',
        kind: 'self_buff_pulse',
        cooldown: 10.5,
        cdPerRank: 0.5,
        manaCost: 45,
        range: 0,
        radius: 4.5,
        baseDamage: 60,
        damagePerRank: 20,
        adRatio: 0.4,
        apRatio: 0.4,
        damageType: 'magic',
        invisDuration: 1.5,
        speedBuff: 0.4,
        buffDuration: 1.5,
        slowAmount: 0.3,
        slowDuration: 1.5,
        color: 0x9333ea,
        iconSymbol: 'SMK',
        iconSvg: makeSkillSvg(
          '#a855f7',
          '<circle cx="13" cy="18" r="5" fill="#7e22ce" opacity="0.85"/><circle cx="19" cy="16" r="6" fill="#9333ea" opacity="0.8"/><circle cx="16" cy="13" r="4" fill="#c084fc" opacity="0.75"/>'
        ),
      },
      E: {
        slot: 'E',
        name: 'Ảnh Bộ Đột Kích',
        description:
          '[LƯỚT] Lướt siêu tốc 8.0m (vượt tường mỏng) và cường hóa đòn đánh thường kế tiếp chắc chắn Chí Mạng!',
        kind: 'dash',
        isDash: true,
        canCrossThinWalls: true,
        cooldown: 8.0,
        cdPerRank: 0.45,
        manaCost: 45,
        range: 8.0,
        radius: 1.8,
        baseDamage: 80,
        damagePerRank: 26,
        adRatio: 0.7,
        apRatio: 0,
        damageType: 'physical',
        empowersNextAttackCrit: true,
        resetAutoAttack: true,
        color: 0xe879f9,
        iconSymbol: 'DSH',
        iconSvg: makeSkillSvg(
          '#e879f9',
          '<path d="M7 22L22 7M15 7h7v7" stroke="#f5d0fe" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 14l5 5" stroke="#f43f5e" stroke-width="2" stroke-linecap="round"/>'
        ),
      },
      R: {
        slot: 'R',
        name: 'Ám Sát Tuyệt Mệnh',
        description:
          'Biến mất 0.4s (không thể bị chọn mục tiêu) rồi hiện ra sau lưng Tướng địch gần con trỏ nhất, tung nhát chém kết liễu theo Máu đã mất!',
        kind: 'targeted_blink',
        cooldown: 28.0,
        cdPerRank: 3.5,
        manaCost: 90,
        range: 13.5,
        radius: 4.5,
        delay: 0.4,
        baseDamage: 205,
        damagePerRank: 75,
        adRatio: 1.0,
        apRatio: 0,
        executeBonusMax: 0.55,
        untargetableDuration: 0.4,
        damageType: 'physical',
        color: 0xf43f5e,
        iconSymbol: 'ASS',
        iconSvg: makeSkillSvg(
          '#f43f5e',
          '<path d="M9 9l14 14M23 9L9 23" stroke="#fda4af" stroke-width="2.5" stroke-linecap="round"/><circle cx="16" cy="16" r="4" stroke="#f43f5e" stroke-width="1.6"/>'
        ),
      },
    },
  },
  {
    id: 'nova',
    numericId: 3,
    name: 'NOVA',
    title: 'Xạ Thủ Quang Năng',
    role: 'Xạ Thủ',
    archetype: 'marksman',
    suggestedLane: 2,
    statBars: { damage: 94, toughness: 32, mobility: 72 },
    primaryColor: 0xf59e0b,
    accentColor: 0x38bdf8,
    emblemSvg:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48" fill="none"><circle cx="24" cy="24" r="14" stroke="#facc15" stroke-width="2.5"/><path d="M24 5v9M24 34v9M5 24h9M34 24h9" stroke="#38bdf8" stroke-width="2.8" stroke-linecap="round"/><circle cx="24" cy="24" r="4.5" fill="#fef08a"/></svg>',
    maxHp: 500,
    hpPerLevel: 76,
    maxMp: 380,
    mpPerLevel: 38,
    hpRegen: 4.0,
    mpRegen: 4.0,
    ad: 62,
    adPerLevel: 4.4,
    ap: 15,
    armor: 24,
    armorPerLevel: 2.8,
    mr: 28,
    mrPerLevel: 1.3,
    attackRange: 11.5,
    attackSpeed: 1.02,
    projectileSpeed: 32,
    moveSpeed: 9.0,
    radius: 0.85,
    skills: {
      Q: {
        slot: 'Q',
        name: 'Đạn Xuyên Giáp',
        description:
          'Bắn tia đạn plasma tầm xa 16m xuyên qua cả lính và tướng, gây sát thương vật lý mạnh.',
        kind: 'linear_projectile',
        cooldown: 4.5,
        cdPerRank: 0.35,
        manaCost: 40,
        range: 16.0,
        radius: 1.05,
        projectileSpeed: 36,
        piercing: true,
        baseDamage: 100,
        damagePerRank: 38,
        adRatio: 1.05,
        apRatio: 0,
        damageType: 'physical',
        color: 0x38bdf8,
        iconSymbol: 'PRC',
        iconSvg: makeSkillSvg(
          '#38bdf8',
          '<path d="M6 16h16M18 11l7 5-7 5" stroke="#7dd3fc" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'
        ),
      },
      W: {
        slot: 'W',
        name: 'Mưa Tên Lửa',
        description:
          'Bắn loạt tên lửa xuống vùng chỉ định trong 1.5s, gây sát thương liên tục và Làm Chậm 30%.',
        kind: 'ground_aoe',
        cooldown: 9.5,
        cdPerRank: 0.55,
        manaCost: 55,
        range: 14.0,
        radius: 4.0,
        delay: 0.25,
        buffDuration: 1.5,
        baseDamage: 165,
        damagePerRank: 55,
        adRatio: 0.9,
        apRatio: 0.45,
        damageType: 'physical',
        slowAmount: 0.3,
        slowDuration: 1.8,
        color: 0xf59e0b,
        iconSymbol: 'MSL',
        iconSvg: makeSkillSvg(
          '#f59e0b',
          '<path d="M10 9l-2 9M16 7l-2 11M22 9l-2 9" stroke="#fde047" stroke-width="2.2" stroke-linecap="round"/><ellipse cx="16" cy="23" rx="8" ry="2.5" stroke="#fb923c" stroke-width="1.6"/>'
        ),
      },
      E: {
        slot: 'E',
        name: 'Nhào Lộn Chiến Thuật',
        description:
          '[LƯỚT] Lướt 6.0m về hướng con trỏ để giữ vị trí và tăng +45% Tốc độ đánh trong 3s.',
        kind: 'dash',
        isDash: true,
        cooldown: 8.5,
        cdPerRank: 0.5,
        manaCost: 40,
        range: 6.0,
        radius: 1.5,
        baseDamage: 0,
        damagePerRank: 0,
        adRatio: 0,
        apRatio: 0,
        damageType: 'physical',
        asBuff: 0.45,
        buffDuration: 3.0,
        resetAutoAttack: true,
        color: 0xfacc15,
        iconSymbol: 'DSH',
        iconSvg: makeSkillSvg(
          '#facc15',
          '<path d="M8 20c4-8 10-10 16-6M21 10l4 4-5 2" stroke="#fef08a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'
        ),
      },
      R: {
        slot: 'R',
        name: 'Đại Bác Ánh Sáng Toàn Bản Đồ',
        description:
          'Tụ năng lượng 0.65s rồi khai hỏa chùm đại bác ánh sáng xuyên TOÀN BẢN ĐỒ (240m+), gây sát thương phép lên mọi Tướng trúng chiêu!',
        kind: 'channeled_beam',
        isGlobal: true,
        cooldown: 40.0,
        cdPerRank: 4.5,
        manaCost: 100,
        range: 340.0,
        radius: 1.8,
        width: 3.6,
        delay: 0.65,
        baseDamage: 235,
        damagePerRank: 80,
        adRatio: 0.8,
        apRatio: 0.5,
        damageType: 'magic',
        color: 0x38bdf8,
        iconSymbol: 'GLB',
        iconSvg: makeSkillSvg(
          '#7dd3fc',
          '<path d="M5 16h22" stroke="#ffffff" stroke-width="3" stroke-linecap="round"/><path d="M5 16h22" stroke="#38bdf8" stroke-width="6" stroke-linecap="round" opacity="0.45"/><circle cx="11" cy="16" r="4" fill="#fde047"/>'
        ),
      },
    },
  },
  {
    id: 'aurelia',
    numericId: 4,
    name: 'AURELIA',
    title: 'Nữ Thần Tinh Tú',
    role: 'Pháp Sư',
    archetype: 'mage',
    suggestedLane: 1,
    statBars: { damage: 92, toughness: 38, mobility: 68 },
    primaryColor: 0x14b8a6,
    accentColor: 0xc084fc,
    emblemSvg:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48" fill="none"><circle cx="24" cy="24" r="9" fill="#0f766e" stroke="#2dd4bf" stroke-width="2"/><ellipse cx="24" cy="24" rx="18" ry="7" transform="rotate(-25 24 24)" stroke="#c084fc" stroke-width="2"/><circle cx="38" cy="17" r="3" fill="#e879f9"/></svg>',
    maxHp: 490,
    hpPerLevel: 74,
    maxMp: 540,
    mpPerLevel: 52,
    hpRegen: 4.0,
    mpRegen: 5.8,
    ad: 48,
    adPerLevel: 2.8,
    ap: 48,
    armor: 24,
    armorPerLevel: 2.6,
    mr: 32,
    mrPerLevel: 1.5,
    attackRange: 10.5,
    attackSpeed: 0.82,
    projectileSpeed: 26,
    moveSpeed: 8.8,
    radius: 0.9,
    skills: {
      Q: {
        slot: 'Q',
        name: 'Tinh Cầu Hủy Diệt',
        description:
          'Phóng cầu tinh tú bay thẳng và phát nổ diện rộng khi chạm kẻ địch đầu tiên hoặc ở cuối tầm.',
        kind: 'linear_projectile',
        explodeAtMaxRange: true,
        cooldown: 4.2,
        cdPerRank: 0.3,
        manaCost: 45,
        range: 14.5,
        radius: 1.35,
        projectileSpeed: 26,
        piercing: false,
        baseDamage: 95,
        damagePerRank: 35,
        adRatio: 0,
        apRatio: 0.85,
        damageType: 'magic',
        color: 0x2dd4bf,
        iconSymbol: 'ORB',
        iconSvg: makeSkillSvg(
          '#2dd4bf',
          '<circle cx="16" cy="16" r="6.5" fill="#14b8a6" stroke="#99f6e4" stroke-width="1.6"/><circle cx="16" cy="16" r="2.5" fill="#ffffff"/>'
        ),
      },
      W: {
        slot: 'W',
        name: 'Vòng Trói Không Gian',
        description:
          'Đặt ấn chú không gian phát nổ sau 0.7s, gây sát thương phép và Trói Chân (Root) 1.2s.',
        kind: 'ground_aoe',
        cooldown: 9.5,
        cdPerRank: 0.5,
        manaCost: 60,
        range: 13.0,
        radius: 3.6,
        delay: 0.7,
        baseDamage: 105,
        damagePerRank: 35,
        adRatio: 0,
        apRatio: 0.75,
        damageType: 'magic',
        rootDuration: 1.2,
        slowAmount: 0.3,
        slowDuration: 1.0,
        color: 0xa855f7,
        iconSymbol: 'RUT',
        iconSvg: makeSkillSvg(
          '#a855f7',
          '<polygon points="16,6 25,16 16,26 7,16" stroke="#e9d5ff" stroke-width="1.8" fill="#7e22ce" fill-opacity="0.45"/><circle cx="16" cy="16" r="3" fill="#f5d0fe"/>'
        ),
      },
      E: {
        slot: 'E',
        name: 'Dịch Chuyển Tinh Vân',
        description:
          '[LƯỚT] Lướt/dịch chuyển 6.5m về hướng con trỏ và thả ra 3 cầu lửa tự truy đuổi kẻ địch gần nhất (mỗi cầu sau giảm 50% sát thương)!',
        kind: 'dash',
        isDash: true,
        canCrossThinWalls: true,
        projectileCount: 3,
        projectileDamageFalloff: 0.5,
        cooldown: 10.0,
        cdPerRank: 0.5,
        manaCost: 55,
        range: 6.5,
        radius: 1.8,
        baseDamage: 44,
        damagePerRank: 16,
        adRatio: 0,
        apRatio: 0.28,
        damageType: 'magic',
        color: 0x38bdf8,
        iconSymbol: 'DSH',
        iconSvg: makeSkillSvg(
          '#38bdf8',
          '<circle cx="10" cy="21" r="2.5" fill="#c084fc"/><circle cx="15" cy="12" r="2.5" fill="#2dd4bf"/><circle cx="22" cy="19" r="2.5" fill="#e879f9"/><path d="M9 22l12-12" stroke="#7dd3fc" stroke-width="2" stroke-linecap="round"/>'
        ),
      },
      R: {
        slot: 'R',
        name: 'Bão Thiên Thạch',
        description:
          'Triệu hồi 4 thiên thạch liên tiếp giáng xuống vùng bán kính 5.0m trong 1.5s, gây sát thương phép khổng lồ!',
        kind: 'ground_aoe',
        meteorCount: 4,
        buffDuration: 1.5,
        cooldown: 32.0,
        cdPerRank: 3.5,
        manaCost: 100,
        range: 15.0,
        radius: 5.0,
        delay: 0.35,
        baseDamage: 340,
        damagePerRank: 110,
        adRatio: 0,
        apRatio: 1.25,
        damageType: 'magic',
        slowAmount: 0.35,
        slowDuration: 1.8,
        color: 0xf43f5e,
        iconSymbol: 'MTR',
        iconSvg: makeSkillSvg(
          '#f43f5e',
          '<path d="M22 6l-9 9M25 13l-8 8M15 8l-7 7" stroke="#fda4af" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="17" r="3.5" fill="#f97316"/><circle cx="18" cy="21" r="3" fill="#e11d48"/>'
        ),
      },
    },
  },
];

export const CHAMPION_BY_ID: Record<ChampionId, ChampionDef> = {
  titan: CHAMPIONS_DATA[0],
  valkyrie: CHAMPIONS_DATA[1],
  shadow: CHAMPIONS_DATA[2],
  nova: CHAMPIONS_DATA[3],
  aurelia: CHAMPIONS_DATA[4],
};

export function getChampionData(id: number | ChampionId): ChampionDef {
  if (typeof id === 'string') {
    return CHAMPION_BY_ID[id] ?? CHAMPIONS_DATA[0];
  }
  return CHAMPIONS_DATA[id] ?? CHAMPIONS_DATA[0];
}

export function getChampionIndex(id: number | ChampionId): number {
  return getChampionData(id).numericId;
}

export function getChampionId(id: number | ChampionId): ChampionId {
  return getChampionData(id).id;
}

export function getDashSkillSlot(def: ChampionDef): SkillSlot {
  if (def.skills.Q.isDash) return 'Q';
  if (def.skills.W.isDash) return 'W';
  if (def.skills.E.isDash) return 'E';
  if (def.skills.R.isDash) return 'R';
  return 'E';
}

export function getSkillIconSvg(
  skill: Pick<SkillDef, 'iconSvg'>,
  size = 32
): string {
  return skill.iconSvg.replace(/width="32" height="32"/, `width="${size}" height="${size}"`);
}

export function getChampionEmblemSvg(
  champ: Pick<ChampionDef, 'emblemSvg'>,
  size = 48
): string {
  return champ.emblemSvg.replace(/width="48" height="48"/, `width="${size}" height="${size}"`);
}
