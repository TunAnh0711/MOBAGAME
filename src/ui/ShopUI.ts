import { Movement, Stats } from '../ecs/Components';
import { GameWorld } from '../ecs/World';
import { EventBus } from '../core/EventBus';
import { isolateUIElement } from '../core/InputManager';
import {
  ITEMS_DATA,
  MAX_INVENTORY_SLOTS,
  getItemById,
  getItemIconSvg,
  getPurchasePlan,
  buyItemForEntity,
  sellItemForEntity,
  type ItemCategory,
} from '../data/ItemsData';

export class ShopUI {
  private root: HTMLDivElement;
  private world: GameWorld;
  private bus: EventBus;
  private onToggleCallback: (open: boolean) => void;

  private isOpen = false;
  private activeCategory: 'all' | ItemCategory = 'all';
  private lastRenderedGold = -1;
  private lastRenderedHp = -1;

  private goldEl!: HTMLDivElement;
  private statsStripEl!: HTMLDivElement;
  private tabsWrap!: HTMLDivElement;
  private gridEl!: HTMLDivElement;
  private invWrap!: HTMLDivElement;
  private abortCtrl = new AbortController();
  private unsubs: Array<() => void> = [];

  constructor(
    parent: HTMLElement,
    world: GameWorld,
    bus: EventBus,
    onToggle: (open: boolean) => void
  ) {
    this.world = world;
    this.bus = bus;
    this.onToggleCallback = onToggle;

    this.root = document.createElement('div');
    this.root.style.cssText =
      'position:fixed;inset:0;z-index:50;background:rgba(4,8,18,0.72);backdrop-filter:blur(5px);display:none;align-items:center;justify-content:center;padding:16px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#f8fafc;user-select:none;';
    isolateUIElement(this.root);

    const panel = document.createElement('div');
    panel.style.cssText =
      'width:min(920px,100%);max-height:90vh;display:flex;flex-direction:column;gap:12px;background:linear-gradient(180deg,rgba(12,19,35,0.98),rgba(7,12,24,0.99));border:1.5px solid rgba(250,204,21,0.55);border-radius:14px;padding:18px 22px;box-shadow:0 24px 64px rgba(0,0,0,0.88);';
    isolateUIElement(panel);

    // Header
    const header = document.createElement('div');
    header.style.cssText =
      'display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;border-bottom:1px solid rgba(148,163,184,0.22);padding-bottom:10px;';

    const title = document.createElement('div');
    title.innerHTML =
      '<span style="font-size:18px;font-weight:900;color:#fde047;letter-spacing:0.6px;">CỬA HÀNG TRANG BỊ (12 VẬT PHẨM)</span>' +
      '<span style="font-size:12px;color:#94a3b8;margin-left:10px;">(Phím P đóng/mở • Hỗ trợ Ghép Giày & Bán hoàn 70% Vàng)</span>';

    const rightHead = document.createElement('div');
    rightHead.style.cssText = 'display:flex;align-items:center;gap:12px;';

    this.goldEl = document.createElement('div');
    this.goldEl.style.cssText =
      'font-size:15px;font-weight:900;color:#fde047;padding:5px 12px;background:rgba(234,179,8,0.16);border:1px solid rgba(234,179,8,0.5);border-radius:8px;';

    const closeBtn = document.createElement('button');
    closeBtn.style.cssText =
      'padding:6px 12px;border-radius:7px;border:1px solid rgba(148,163,184,0.38);background:rgba(30,41,59,0.92);color:#e2e8f0;font-size:12px;font-weight:800;cursor:pointer;';
    closeBtn.textContent = 'Đóng [Esc / P]';
    isolateUIElement(closeBtn);
    closeBtn.onclick = () => this.close();

    rightHead.append(this.goldEl, closeBtn);
    header.append(title, rightHead);

    // Live Champion Stats Strip
    this.statsStripEl = document.createElement('div');
    this.statsStripEl.style.cssText =
      'display:flex;flex-wrap:wrap;gap:8px 14px;padding:8px 12px;border-radius:8px;background:rgba(2,6,23,0.68);border:1px solid rgba(56,189,248,0.22);font-size:11.5px;color:#cbd5e1;';

    // Category Tabs
    this.tabsWrap = document.createElement('div');
    this.tabsWrap.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;';

    // Items Grid
    this.gridEl = document.createElement('div');
    this.gridEl.style.cssText =
      'display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;overflow-y:auto;padding-right:4px;max-height:46vh;';

    // 6-Slot Inventory Footer
    const invTitle = document.createElement('div');
    invTitle.style.cssText =
      'font-size:12px;font-weight:800;color:#cbd5e1;border-top:1px solid rgba(148,163,184,0.22);padding-top:10px;';
    invTitle.textContent = 'TÚI ĐỒ HIỆN TẠI (6 Ô — Click chuột trái vào trang bị để Bán hoàn 70% Vàng):';

    this.invWrap = document.createElement('div');
    this.invWrap.style.cssText = 'display:grid;grid-template-columns:repeat(6,1fr);gap:8px;';

    panel.append(header, this.statsStripEl, this.tabsWrap, this.gridEl, invTitle, this.invWrap);
    this.root.appendChild(panel);
    parent.appendChild(this.root);

    this.bindKeys();
    this.unsubs.push(
      this.bus.on('gold', () => {
        if (this.isOpen) this.render();
      }),
      this.bus.on('itemBought', () => {
        if (this.isOpen) this.render();
      }),
      this.bus.on('itemSold', () => {
        if (this.isOpen) this.render();
      })
    );
  }

  private bindKeys(): void {
    const signal = this.abortCtrl.signal;
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.repeat) return;
        const activeTag = document.activeElement?.tagName;
        if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;

        if (e.code === 'KeyP' || e.key.toUpperCase() === 'P') {
          if (this.world.playerEid >= 0 && !this.world.matchEnded) {
            e.preventDefault();
            this.toggle();
          }
        } else if (e.key === 'Escape' && this.isOpen) {
          e.preventDefault();
          this.close();
        }
      },
      { signal }
    );
  }

  public toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  public open(): void {
    this.isOpen = true;
    this.root.style.display = 'flex';
    this.onToggleCallback(true);
    this.render();
  }

  public close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.style.display = 'none';
    this.onToggleCallback(false);
  }

  public isShopOpen(): boolean {
    return this.isOpen;
  }

  public update(): void {
    if (!this.isOpen) return;
    const pid = this.world.playerEid;
    if (pid < 0) return;
    const curGold = Math.floor(Stats.gold[pid]);
    const curHp = Math.floor(Stats.hp[pid]);
    if (curGold !== this.lastRenderedGold || curHp !== this.lastRenderedHp) {
      this.render();
    }
  }

  public render(): void {
    if (!this.isOpen) return;
    const pid = this.world.playerEid;
    if (pid < 0) return;

    const gold = Math.round(Stats.gold[pid]);
    this.lastRenderedGold = Math.floor(Stats.gold[pid]);
    this.lastRenderedHp = Math.floor(Stats.hp[pid]);
    this.goldEl.textContent = `Vàng: ${gold}g`;

    // Live Champion Stats Strip
    const effAs = (
      Stats.attackSpeed[pid] *
      (1 + Math.max(0, Stats.attackSpeedBonus[pid])) *
      Stats.asBuffMult[pid]
    ).toFixed(2);
    const effMs = Math.round(
      (Movement.baseSpeed[pid] + Stats.moveSpeedBonus[pid]) * 38
    );
    const critPct = Math.round(Stats.critChance[pid] * 100);
    const lifePct = Math.round(Stats.lifesteal[pid] * 100);
    const mpenFlat = Math.round(Stats.magicPenFlat[pid]);
    const mpenPct = Math.round(Stats.magicPenPct[pid] * 100);
    const ah = Math.round(Stats.cdr[pid]);

    this.statsStripEl.innerHTML = `
      <span>Máu: <b style="color:#4ade80;">${Math.round(Stats.hp[pid])}/${Math.round(Stats.maxHp[pid])}</b></span>
      <span>AD: <b style="color:#fb923c;">${Math.round(Stats.ad[pid])}</b></span>
      <span>AP: <b style="color:#c084fc;">${Math.round(Stats.ap[pid])}</b></span>
      <span>Giáp: <b style="color:#cbd5e1;">${Math.round(Stats.armor[pid])}</b></span>
      <span>Kháng phép: <b style="color:#93c5fd;">${Math.round(Stats.mr[pid])}</b></span>
      <span>Tốc đánh: <b style="color:#fde047;">${effAs}</b></span>
      <span>Tốc chạy: <b style="color:#38bdf8;">${effMs}</b></span>
      <span>Chí mạng: <b style="color:#facc15;">${critPct}%</b></span>
      <span>Hút máu: <b style="color:#f87171;">${lifePct}%</b></span>
      <span>Xuyên phép: <b style="color:#a855f7;">${mpenFlat} | ${mpenPct}%</b></span>
      <span>Giảm hồi chiêu: <b style="color:#22d3ee;">+${ah}</b></span>
    `;

    const inv = this.world.inventories.get(pid) ?? [];

    // Tabs
    const cats: Array<{ id: 'all' | ItemCategory; label: string }> = [
      { id: 'all', label: 'Tất cả (12)' },
      { id: 'boots', label: 'Giày (3)' },
      { id: 'ad', label: 'Công Vật Lý (3)' },
      { id: 'ap', label: 'Phép Thuật (3)' },
      { id: 'defense', label: 'Phòng Thủ (3)' },
    ];
    this.tabsWrap.innerHTML = '';
    for (const c of cats) {
      const btn = document.createElement('button');
      const active = this.activeCategory === c.id;
      btn.style.cssText = `padding:6px 13px;border-radius:7px;border:1px solid ${
        active ? '#facc15' : 'rgba(148,163,184,0.28)'
      };background:${
        active ? 'rgba(234,179,8,0.22)' : 'rgba(15,23,42,0.85)'
      };color:${active ? '#fde047' : '#cbd5e1'};font-size:12px;font-weight:800;cursor:pointer;`;
      btn.textContent = c.label;
      isolateUIElement(btn);
      btn.onclick = () => {
        this.activeCategory = c.id;
        this.render();
      };
      this.tabsWrap.appendChild(btn);
    }

    // Items Grid
    this.gridEl.innerHTML = '';
    const list =
      this.activeCategory === 'all'
        ? ITEMS_DATA
        : ITEMS_DATA.filter((it) => it.category === this.activeCategory);

    for (const item of list) {
      const plan = getPurchasePlan(item, inv);
      const slotsLeft = MAX_INVENTORY_SLOTS - (inv.length - plan.consumedIndices.length);
      const canAfford = gold >= plan.effectiveCost && slotsLeft >= 1;
      const hasDiscount = plan.effectiveCost < item.cost;

      const card = document.createElement('div');
      card.style.cssText = `padding:10px 12px;border-radius:10px;background:rgba(15,23,42,0.92);border:1px solid ${
        hasDiscount ? 'rgba(250,204,21,0.55)' : 'rgba(56,189,248,0.25)'
      };display:flex;flex-direction:column;justify-content:space-between;gap:8px;`;
      isolateUIElement(card);

      const recipeNames =
        item.buildsFrom
          ?.map((id) => getItemById(id)?.name ?? id)
          .join(' + ') ?? '';

      const topBox = document.createElement('div');
      topBox.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <div style="display:flex;align-items:center;gap:9px;min-width:0;">
            <div style="width:34px;height:34px;flex-shrink:0;display:flex;align-items:center;justify-content:center;">
              ${getItemIconSvg(item, 34)}
            </div>
            <div style="min-width:0;">
              <div style="font-size:13.5px;font-weight:900;color:#f8fafc;">${item.name}</div>
              <div style="font-size:11px;font-weight:700;color:${item.color};">${item.shortBonus}</div>
            </div>
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <div style="font-size:13px;font-weight:900;color:${
              canAfford ? '#fde047' : '#f87171'
            };">${plan.effectiveCost}g</div>
            ${
              hasDiscount
                ? `<div style="font-size:10px;color:#94a3b8;"><s>${item.cost}g</s></div>`
                : ''
            }
          </div>
        </div>
        <div style="font-size:10.5px;color:#94a3b8;margin-top:6px;line-height:1.38;">${item.description}</div>
        ${
          recipeNames
            ? `<div style="font-size:10px;color:#fbbf24;font-weight:700;margin-top:4px;">Ghép từ: ${recipeNames}</div>`
            : ''
        }
      `;

      const buyBtn = document.createElement('button');
      buyBtn.style.cssText = `padding:7px 10px;border-radius:7px;border:none;font-size:11.5px;font-weight:800;cursor:${
        canAfford ? 'pointer' : 'not-allowed'
      };background:${
        canAfford
          ? hasDiscount
            ? 'linear-gradient(90deg,#d97706,#eab308)'
            : 'linear-gradient(90deg,#0284c7,#2563eb)'
          : 'rgba(30,41,59,0.85)'
      };color:${canAfford ? '#fff' : '#64748b'};`;
      buyBtn.textContent =
        slotsLeft < 1
          ? 'Túi đầy (6/6)'
          : canAfford
            ? hasDiscount
              ? `GHÉP ĐỒ (${plan.effectiveCost}g)`
              : `MUA NGAY (${plan.effectiveCost}g)`
            : `Thiếu Vàng (${plan.effectiveCost}g)`;
      buyBtn.disabled = !canAfford;
      isolateUIElement(buyBtn);
      buyBtn.onclick = () => {
        if (buyItemForEntity(this.world, this.bus, pid, item.id)) {
          this.render();
        }
      };

      card.append(topBox, buyBtn);
      this.gridEl.appendChild(card);
    }

    // 6-Slot Inventory
    this.invWrap.innerHTML = '';
    for (let s = 0; s < MAX_INVENTORY_SLOTS; s++) {
      const itemId = inv[s];
      const item = itemId ? getItemById(itemId) : undefined;
      const slotBtn = document.createElement('button');
      slotBtn.style.cssText = `height:62px;border-radius:8px;border:1px solid ${
        item ? 'rgba(250,204,21,0.6)' : 'rgba(51,65,85,0.85)'
      };background:${
        item ? 'rgba(30,41,59,0.94)' : 'rgba(15,23,42,0.62)'
      };color:#f8fafc;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;cursor:${
        item ? 'pointer' : 'default'
      };padding:4px;`;
      isolateUIElement(slotBtn);

      if (item) {
        const refund = Math.round(item.cost * 0.7);
        slotBtn.title = `${item.name} (${item.shortBonus}) — Click để bán (+${refund}g)`;
        slotBtn.innerHTML = `
          <div style="display:flex;align-items:center;gap:5px;">
            ${getItemIconSvg(item, 24)}
            <span style="font-size:10.5px;font-weight:800;color:#e2e8f0;max-width:78px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${item.name}</span>
          </div>
          <span style="font-size:9.5px;color:#fde047;font-weight:800;">Bán +${refund}g</span>
        `;
        slotBtn.onclick = () => {
          if (sellItemForEntity(this.world, pid, s, this.bus)) {
            this.render();
          }
        };
      } else {
        slotBtn.innerHTML = `<span style="font-size:10px;color:#475569;font-weight:700;">Ô ${s + 1} Trống</span>`;
      }
      this.invWrap.appendChild(slotBtn);
    }
  }

  public dispose(): void {
    this.abortCtrl.abort();
    for (const u of this.unsubs) u();
    this.unsubs.length = 0;
    this.root.remove();
  }
}
