import { Stats, UnitType } from '../ecs/Components';
import { GameWorld } from '../ecs/World';
import { EventBus } from '../core/EventBus';

export type ItemCategory = 'boots' | 'ad' | 'ap' | 'defense';

export interface ItemDef {
  id: string;
  name: string;
  category: ItemCategory;
  cost: number;
  buildsFrom?: string[];
  icon: string;
  iconSvg: string;
  color: string;
  shortBonus: string;
  description: string;
  ad?: number;
  ap?: number;
  hp?: number;
  mp?: number;
  armor?: number;
  mr?: number;
  attackSpeed?: number;      // e.g. 0.30 = +30% Tốc đánh
  moveSpeed?: number;        // calibrated world MS bonus (+1.35 u/s = +45 Tốc chạy display)
  moveSpeedDisplay?: number; // +45 Tốc chạy
  critChance?: number;       // e.g. 0.25 = +25% Chí mạng
  lifesteal?: number;        // e.g. 0.18 = +18% Hút máu
  magicPenFlat?: number;     // e.g. 15 = +15 Xuyên kháng phép
  magicPenPct?: number;      // e.g. 0.35 = +35% Xuyên kháng phép
  cdr?: number;              // e.g. 20 = +20 Giảm hồi chiêu (Ability Haste)
  thornReflect?: number;     // Giáp Gai: phản sát thương phép khi bị đánh thường
  healAmp?: number;          // Giáp Tâm Linh: +25% khả năng hồi phục
  warmogPassive?: boolean;   // Giáp Máu Warmog: hồi máu cực nhanh ngoài giao tranh
}

export const MAX_INVENTORY_SLOTS = 6;

function makeItemSvg(border: string, bg: string, inner: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" fill="none"><rect x="1.5" y="1.5" width="29" height="29" rx="6" fill="${bg}" stroke="${border}" stroke-width="1.8"/>${inner}</svg>`;
}

export const ITEMS_DATA: ItemDef[] = [
  // ======================== 1-3: GIÀY (BOOTS) ========================
  {
    id: 'boots_speed',
    name: 'Giày Tốc Độ',
    category: 'boots',
    cost: 300,
    icon: 'GTD',
    color: '#38bdf8',
    iconSvg: makeItemSvg(
      '#38bdf8',
      '#0c192c',
      '<path d="M10 8h6l1 7 7 3v5H8v-5l2-10z" fill="#0284c7" stroke="#bae6fd" stroke-width="1.5" stroke-linejoin="round"/><path d="M7 23h17" stroke="#fde047" stroke-width="2" stroke-linecap="round"/>'
    ),
    shortBonus: '+45 Tốc chạy',
    description: 'Giày cơ bản tăng +45 Tốc độ di chuyển. Có thể nâng cấp lên Giày Pháp Sư hoặc Giày Cuồng Nộ.',
    moveSpeed: 1.35,
    moveSpeedDisplay: 45,
  },
  {
    id: 'boots_sorc',
    name: 'Giày Pháp Sư',
    category: 'boots',
    cost: 1050,
    buildsFrom: ['boots_speed'],
    icon: 'GPS',
    color: '#a855f7',
    iconSvg: makeItemSvg(
      '#c084fc',
      '#1e1035',
      '<path d="M10 8h6l1 7 7 3v5H8v-5l2-10z" fill="#9333ea" stroke="#f3e8ff" stroke-width="1.5" stroke-linejoin="round"/><path d="M21 6l3 3-3 3-3-3 3-3z" fill="#38bdf8"/><path d="M7 23h17" stroke="#e879f9" stroke-width="2" stroke-linecap="round"/>'
    ),
    shortBonus: '+15 Xuyên kháng phép • +45 Tốc chạy',
    description: 'Ghép từ Giày Tốc Độ. Tăng +15 Xuyên kháng phép cố định và +45 Tốc chạy.',
    magicPenFlat: 15,
    moveSpeed: 1.35,
    moveSpeedDisplay: 45,
  },
  {
    id: 'boots_berserker',
    name: 'Giày Cuồng Nộ',
    category: 'boots',
    cost: 1050,
    buildsFrom: ['boots_speed'],
    icon: 'GCN',
    color: '#f97316',
    iconSvg: makeItemSvg(
      '#fb923c',
      '#2a1208',
      '<path d="M10 8h6l1 7 7 3v5H8v-5l2-10z" fill="#ea580c" stroke="#ffedd5" stroke-width="1.5" stroke-linejoin="round"/><path d="M19 6l5 2-3 4 4 1-6 4" stroke="#fde047" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 23h17" stroke="#fde047" stroke-width="2" stroke-linecap="round"/>'
    ),
    shortBonus: '+30% Tốc đánh • +45 Tốc chạy',
    description: 'Ghép từ Giày Tốc Độ. Tăng +30% Tốc độ đánh và +45 Tốc chạy.',
    attackSpeed: 0.3,
    moveSpeed: 1.35,
    moveSpeedDisplay: 45,
  },

  // ======================== 4-6: CÔNG VẬT LÝ (AD) ========================
  {
    id: 'infinity_edge',
    name: 'Kiếm Vô Cực',
    category: 'ad',
    cost: 1650,
    icon: 'KVC',
    color: '#facc15',
    iconSvg: makeItemSvg(
      '#facc15',
      '#261c06',
      '<path d="M24 6L11 19l-3-1-2 4 4 4 4-2-1-3L26 8l-2-2z" fill="#eab308" stroke="#fef08a" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 17l6 6" stroke="#ca8a04" stroke-width="2" stroke-linecap="round"/>'
    ),
    shortBonus: '+65 Công vật lý • +25% Chí mạng',
    description: 'Đại kiếm huyền thoại tăng +65 Công vật lý (AD) và +25% Tỉ lệ chí mạng.',
    ad: 65,
    critChance: 0.25,
  },
  {
    id: 'bloodthirster',
    name: 'Huyết Kiếm',
    category: 'ad',
    cost: 1550,
    icon: 'HK',
    color: '#ef4444',
    iconSvg: makeItemSvg(
      '#f87171',
      '#280a0e',
      '<path d="M23 6L10 19l-2 5 5-2L26 9l-3-3z" fill="#dc2626" stroke="#fecaca" stroke-width="1.5" stroke-linejoin="round"/><circle cx="21" cy="21" r="3.5" fill="#ef4444" stroke="#fca5a5" stroke-width="1.2"/>'
    ),
    shortBonus: '+55 Công vật lý • +18% Hút máu',
    description: 'Thanh kiếm khát máu tăng +55 Công vật lý (AD) và +18% Hút máu vật lý.',
    ad: 55,
    lifesteal: 0.18,
  },
  {
    id: 'black_cleaver',
    name: 'Rìu Đen',
    category: 'ad',
    cost: 1500,
    icon: 'RD',
    color: '#f97316',
    iconSvg: makeItemSvg(
      '#fb923c',
      '#23120b',
      '<path d="M8 24L22 10" stroke="#cbd5e1" stroke-width="2.4" stroke-linecap="round"/><path d="M15 8c6-2 10 2 9 8-3 2-7 1-10-2l1-6z" fill="#b91c1c" stroke="#fca5a5" stroke-width="1.5" stroke-linejoin="round"/>'
    ),
    shortBonus: '+45 Công vật lý • +300 Máu • +20 Giảm hồi chiêu',
    description: 'Chiến rìu hạng nặng cho Đấu Sĩ: +45 Công vật lý, +300 Máu và +20 Điểm Giảm hồi chiêu.',
    ad: 45,
    hp: 300,
    cdr: 20,
  },

  // ======================== 7-9: SỨC MẠNH PHÉP (AP) ========================
  {
    id: 'rabadon_cap',
    name: 'Mũ Phù Thủy',
    category: 'ap',
    cost: 1700,
    icon: 'MPT',
    color: '#c084fc',
    iconSvg: makeItemSvg(
      '#c084fc',
      '#1e0b36',
      '<path d="M6 22l5-14 7 5 4-6 3 15H6z" fill="#9333ea" stroke="#e9d5ff" stroke-width="1.5" stroke-linejoin="round"/><path d="M4 22h24" stroke="#fde047" stroke-width="2.2" stroke-linecap="round"/>'
    ),
    shortBonus: '+110 Sức mạnh phép',
    description: 'Bảo vật tối thượng của Pháp Sư, gia tăng trực tiếp +110 Sức mạnh phép thuật (AP).',
    ap: 110,
  },
  {
    id: 'void_staff',
    name: 'Trượng Hư Vô',
    category: 'ap',
    cost: 1450,
    icon: 'THV',
    color: '#818cf8',
    iconSvg: makeItemSvg(
      '#818cf8',
      '#0f1338',
      '<path d="M8 24L21 11" stroke="#a5b4fc" stroke-width="2.4" stroke-linecap="round"/><circle cx="22" cy="10" r="4.5" fill="#6366f1" stroke="#e0e7ff" stroke-width="1.5"/><path d="M22 5v10M17 10h10" stroke="#38bdf8" stroke-width="1.2"/>'
    ),
    shortBonus: '+70 Sức mạnh phép • +35% Xuyên kháng phép',
    description: 'Quyền trượng xuyên phá mọi lớp kháng phép: +70 AP và +35% Xuyên kháng phép.',
    ap: 70,
    magicPenPct: 0.35,
  },
  {
    id: 'zhonya_hourglass',
    name: 'Đồng Hồ Cát',
    category: 'ap',
    cost: 1500,
    icon: 'DHC',
    color: '#fbbf24',
    iconSvg: makeItemSvg(
      '#fbbf24',
      '#241a07',
      '<path d="M10 7h12l-4 9 4 9H10l4-9-4-9z" fill="#d97706" stroke="#fef08a" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 7h14M9 25h14" stroke="#fde047" stroke-width="2.2" stroke-linecap="round"/>'
    ),
    shortBonus: '+65 Sức mạnh phép • +40 Giáp',
    description: 'Trang bị công thủ toàn diện cho Pháp Sư: +65 Sức mạnh phép thuật và +40 Giáp.',
    ap: 65,
    armor: 40,
  },

  // ======================== 10-12: PHÒNG THỦ (DEFENSE) ========================
  {
    id: 'thornmail',
    name: 'Giáp Gai',
    category: 'defense',
    cost: 1400,
    icon: 'GG',
    color: '#f43f5e',
    iconSvg: makeItemSvg(
      '#fb7185',
      '#250d17',
      '<path d="M16 6l9 4v7c0 5.5-3.8 9-9 10.5C10.8 26 7 22.5 7 17v-7l9-4z" fill="#be123c" stroke="#fecdd3" stroke-width="1.5"/><path d="M5 12l3 2M27 12l-3 2M5 19l3-1M27 19l-3-1M16 3v3" stroke="#fda4af" stroke-width="2" stroke-linecap="round"/>'
    ),
    shortBonus: '+70 Giáp • +250 Máu • Nội tại Phản sát thương',
    description: 'Tăng +70 Giáp và +250 Máu. Nội tại: Phản lại sát thương phép lên kẻ địch đánh thường vào bạn.',
    armor: 70,
    hp: 250,
    thornReflect: 0.22,
  },
  {
    id: 'spirit_visage',
    name: 'Giáp Tâm Linh',
    category: 'defense',
    cost: 1450,
    icon: 'GTL',
    color: '#10b981',
    iconSvg: makeItemSvg(
      '#34d399',
      '#06241b',
      '<path d="M16 6l9 4v7c0 5.5-3.8 9-9 10.5C10.8 26 7 22.5 7 17v-7l9-4z" fill="#047857" stroke="#a7f3d0" stroke-width="1.5"/><path d="M16 11v10M11 16h10" stroke="#6ee7b7" stroke-width="2.4" stroke-linecap="round"/>'
    ),
    shortBonus: '+450 Máu • +50 Kháng phép • +25% Hồi phục',
    description: 'Tăng +450 Máu và +50 Kháng phép. Nội tại: Tăng 25% hiệu quả mọi nguồn Hồi máu và Hút máu.',
    hp: 450,
    mr: 50,
    healAmp: 0.25,
  },
  {
    id: 'warmog_armor',
    name: 'Giáp Máu Warmog',
    category: 'defense',
    cost: 1550,
    icon: 'GMW',
    color: '#22c55e',
    iconSvg: makeItemSvg(
      '#4ade80',
      '#082612',
      '<path d="M16 25s-9-5.2-9-11.5C7 9.8 10 7 13 7c1.8 0 3 1.2 3 2.5C16 8.2 17.2 7 19 7c3 0 6 2.8 6 6.5C25 19.8 16 25 16 25z" fill="#15803d" stroke="#bbf7d0" stroke-width="1.6"/>'
    ),
    shortBonus: '+800 Máu • Hồi máu cực nhanh ngoài giao tranh',
    description: 'Tăng +800 Máu tối đa. Nội tại Trái Tim Warmog: Hồi 5% Máu tối đa mỗi giây khi rời giao tranh 5s.',
    hp: 800,
    warmogPassive: true,
  },
];

export const ITEM_BY_ID = new Map<string, ItemDef>(ITEMS_DATA.map((i) => [i.id, i]));

export function getItemById(id: string): ItemDef | undefined {
  return ITEM_BY_ID.get(id);
}

export function getItemIconSvg(itemOrId: ItemDef | string, size = 24): string {
  const item = typeof itemOrId === 'string' ? getItemById(itemOrId) : itemOrId;
  if (!item) return '';
  return item.iconSvg.replace(/width="32" height="32"/, `width="${size}" height="${size}"`);
}

/**
 * Computes effective gold cost and consumed component indices when upgrading via `buildsFrom` (Ghép đồ).
 */
export function getPurchasePlan(
  item: ItemDef,
  inventory: string[]
): { effectiveCost: number; consumedIndices: number[] } {
  let effectiveCost = item.cost;
  const consumedIndices: number[] = [];

  if (item.buildsFrom && item.buildsFrom.length > 0) {
    const used = new Set<number>();
    for (const compId of item.buildsFrom) {
      const idx = inventory.findIndex((id, i) => id === compId && !used.has(i));
      if (idx >= 0) {
        used.add(idx);
        consumedIndices.push(idx);
        const compDef = getItemById(compId);
        if (compDef) {
          effectiveCost = Math.max(0, effectiveCost - compDef.cost);
        }
      }
    }
  }

  return { effectiveCost, consumedIndices };
}

function applyPrimaryStatDelta(eid: number, item: ItemDef, sign: 1 | -1): void {
  if (item.ad) Stats.ad[eid] = Math.max(1, Stats.ad[eid] + item.ad * sign);
  if (item.ap) Stats.ap[eid] = Math.max(0, Stats.ap[eid] + item.ap * sign);
  if (item.armor) Stats.armor[eid] = Math.max(0, Stats.armor[eid] + item.armor * sign);
  if (item.mr) Stats.mr[eid] = Math.max(0, Stats.mr[eid] + item.mr * sign);

  if (item.hp) {
    Stats.maxHp[eid] = Math.max(100, Stats.maxHp[eid] + item.hp * sign);
    if (sign > 0) {
      Stats.hp[eid] = Math.min(Stats.maxHp[eid], Stats.hp[eid] + item.hp);
    } else {
      Stats.hp[eid] = Math.min(Stats.maxHp[eid], Stats.hp[eid]);
    }
  }

  if (item.mp) {
    Stats.maxMp[eid] = Math.max(50, Stats.maxMp[eid] + item.mp * sign);
    if (sign > 0) {
      Stats.mp[eid] = Math.min(Stats.maxMp[eid], Stats.mp[eid] + item.mp);
    } else {
      Stats.mp[eid] = Math.min(Stats.maxMp[eid], Stats.mp[eid]);
    }
  }
}

/**
 * Recomputes all bonus/passive item fields on `Stats` from the entity's current 6-slot inventory.
 */
export function recalculateItemStats(world: GameWorld, eid: number): void {
  const inv = world.inventories.get(eid) ?? [];

  let critChance = 0;
  let magicPenFlat = 0;
  let magicPenPct = 0;
  let lifesteal = 0;
  let cdr = 0;
  let thornReflect = 0;
  let healAmp = 0;
  let warmog = 0;
  let attackSpeedBonus = 0;
  let moveSpeedBonus = 0;

  for (let i = 0; i < inv.length; i++) {
    const it = getItemById(inv[i]);
    if (!it) continue;
    if (it.critChance) critChance += it.critChance;
    if (it.magicPenFlat) magicPenFlat += it.magicPenFlat;
    if (it.magicPenPct) magicPenPct = Math.max(magicPenPct, it.magicPenPct);
    if (it.lifesteal) lifesteal += it.lifesteal;
    if (it.cdr) cdr += it.cdr;
    if (it.thornReflect) thornReflect = Math.max(thornReflect, it.thornReflect);
    if (it.healAmp) healAmp = Math.max(healAmp, it.healAmp);
    if (it.warmogPassive) warmog = 1;
    if (it.attackSpeed) attackSpeedBonus += it.attackSpeed;
    if (it.moveSpeed) moveSpeedBonus = Math.max(moveSpeedBonus, it.moveSpeed);
  }

  Stats.critChance[eid] = Math.min(1.0, critChance);
  Stats.magicPenFlat[eid] = magicPenFlat;
  Stats.magicPenPct[eid] = Math.min(0.75, magicPenPct);
  Stats.lifesteal[eid] = Math.min(0.8, lifesteal);
  Stats.cdr[eid] = cdr;
  Stats.thornReflect[eid] = thornReflect;
  Stats.healAmp[eid] = healAmp;
  Stats.warmogPassive[eid] = warmog;
  Stats.attackSpeedBonus[eid] = attackSpeedBonus;
  Stats.moveSpeedBonus[eid] = moveSpeedBonus;
}

export function buyItemForEntity(
  world: GameWorld,
  bus: EventBus,
  eid: number,
  itemId: string
): boolean {
  const item = getItemById(itemId);
  if (!item || !world.isAliveUnit(eid)) return false;

  let inv = world.inventories.get(eid);
  if (!inv) {
    inv = [];
    world.inventories.set(eid, inv);
  }

  const { effectiveCost, consumedIndices } = getPurchasePlan(item, inv);
  if (Stats.gold[eid] < effectiveCost) return false;

  const finalSlotCount = inv.length - consumedIndices.length + 1;
  if (finalSlotCount > MAX_INVENTORY_SLOTS) return false;

  Stats.gold[eid] -= effectiveCost;

  // Remove consumed component items (in reverse index order) and revert their primary stats
  const sortedConsumed = [...consumedIndices].sort((a, b) => b - a);
  for (const idx of sortedConsumed) {
    const compId = inv[idx];
    const comp = getItemById(compId);
    if (comp) applyPrimaryStatDelta(eid, comp, -1);
    inv.splice(idx, 1);
  }

  // Add new item & apply stats
  inv.push(item.id);
  applyPrimaryStatDelta(eid, item, 1);
  recalculateItemStats(world, eid);

  bus.emit('itemBought', {
    buyerEid: eid,
    itemId: item.id,
    itemName: item.name,
    cost: effectiveCost,
  });

  if (UnitType.isPlayer[eid] === 1) {
    bus.emit('announcement', {
      text:
        consumedIndices.length > 0
          ? `Đã ghép ${item.name} (-${effectiveCost}g)!`
          : `Đã mua ${item.name} (-${effectiveCost}g)!`,
      color: '#facc15',
    });
  }

  return true;
}

export function sellItemForEntity(
  world: GameWorld,
  eid: number,
  slotIndex: number,
  bus?: EventBus
): boolean {
  const inv = world.inventories.get(eid);
  if (!inv || slotIndex < 0 || slotIndex >= inv.length) return false;

  const itemId = inv[slotIndex];
  const item = getItemById(itemId);
  if (!item) return false;

  inv.splice(slotIndex, 1);
  applyPrimaryStatDelta(eid, item, -1);
  recalculateItemStats(world, eid);

  const refund = Math.round(item.cost * 0.7);
  Stats.gold[eid] += refund;

  if (bus) {
    bus.emit('itemSold', {
      sellerEid: eid,
      itemId: item.id,
      itemName: item.name,
      refund,
    });
  }

  return true;
}
