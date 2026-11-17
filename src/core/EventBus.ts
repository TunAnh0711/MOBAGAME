export type SkillSlot = 'Q' | 'W' | 'E' | 'R' | 'D' | 'F';

export type SkillImpactKind =
  | 'line'
  | 'aoe'
  | 'pulse'
  | 'dash'
  | 'flash'
  | 'heal'
  | 'hit'
  | 'recall'
  | 'beam'
  | 'slow'
  | 'barrier'
  | 'meteor'
  | 'smoke'
  | 'root'
  | 'shrine';

export interface GameEvents {
  damage: {
    targetEid: number;
    sourceEid: number;
    amount: number;
    damageType: 'physical' | 'magic' | 'true';
    isCrit?: boolean;
    x: number;
    y: number;
    z: number;
  };
  heal: {
    targetEid: number;
    amount: number;
    x: number;
    y: number;
    z: number;
  };
  gold: {
    targetEid: number;
    amount: number;
    x: number;
    y: number;
    z: number;
  };
  levelup: {
    eid: number;
    level: number;
    x: number;
    y: number;
    z: number;
  };
  kill: {
    killerEid: number;
    victimEid: number;
    killerTeam: number;
    victimTeam: number;
    victimKind: number;
  };
  skillCast: {
    casterEid: number;
    slot: SkillSlot;
    originX: number;
    originZ: number;
    targetX: number;
    targetZ: number;
    radius: number;
    color: number;
  };
  skillImpact: {
    kind: SkillImpactKind;
    x: number;
    z: number;
    targetX?: number;
    targetZ?: number;
    dirX?: number;
    dirZ?: number;
    length?: number;
    width?: number;
    radius: number;
    color: number;
    duration?: number;
  };
  turretTarget: {
    turretEid: number;
    targetEid: number;
    isChampion: boolean;
  };
  speedShrine: {
    eid: number;
    shrineId: number;
    x: number;
    z: number;
  };
  clickMarker: {
    x: number;
    z: number;
    kind: 'move' | 'attack' | 'attackMove';
  };
  cameraShake: {
    intensity: number;
  };
  announcement: {
    text: string;
    color: string;
  };
  matchEnd: {
    winnerTeam: number;
  };
  itemBought: {
    buyerEid: number;
    itemId: string;
    itemName: string;
    cost: number;
  };
  itemSold: {
    sellerEid: number;
    itemId: string;
    itemName: string;
    refund: number;
  };
}

type Handler<T> = (payload: T) => void;

export class EventBus {
  private listeners = new Map<keyof GameEvents, Set<Handler<any>>>();

  on<K extends keyof GameEvents>(event: K, handler: Handler<GameEvents[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler);
    return () => {
      set?.delete(handler);
    };
  }

  emit<K extends keyof GameEvents>(event: K, payload: GameEvents[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const handler of set) {
      handler(payload);
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
