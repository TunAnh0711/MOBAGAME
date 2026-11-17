import {
  CHAMPIONS_DATA,
  getChampionEmblemSvg,
  getSkillIconSvg,
  getDashSkillSlot,
  type ChampionDef,
  type ChampionId,
} from '../data/ChampionsData';
import type { GameMode } from '../ecs/World';
import { isolateUIElement } from '../core/InputManager';

export interface MatchStartConfig {
  mode: GameMode;
  championId: number;
  championKey: ChampionId;
}

const LANE_LABEL: Record<number, string> = {
  0: 'Đường Trên (Top)',
  1: 'Đường Giữa (Mid)',
  2: 'Đường Dưới (Bot)',
};

export class ChampionSelectUI {
  private root: HTMLDivElement;
  private selectedMode: GameMode = '5v5';
  private selectedChampIdx = 1; // Default VALKYRIE (Đấu Sĩ)

  private mode5v5Btn!: HTMLButtonElement;
  private mode1v1Btn!: HTMLButtonElement;
  private cardsWrap!: HTMLDivElement;
  private detailWrap!: HTMLDivElement;
  private cardEls: HTMLButtonElement[] = [];

  constructor(parent: HTMLElement, onStart: (cfg: MatchStartConfig) => void) {
    this.root = document.createElement('div');
    this.root.style.cssText =
      'position:fixed;inset:0;z-index:60;background:radial-gradient(circle at 50% 20%,rgba(14,26,52,0.94),rgba(4,8,18,0.98));backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#f8fafc;user-select:none;overflow-y:auto;';
    isolateUIElement(this.root);

    const panel = document.createElement('div');
    panel.style.cssText =
      'width:min(1040px,100%);max-height:95vh;overflow-y:auto;background:linear-gradient(180deg,rgba(12,19,36,0.96),rgba(7,12,24,0.98));border:1.5px solid rgba(56,189,248,0.45);border-radius:16px;padding:20px 24px;box-shadow:0 24px 64px rgba(0,0,0,0.88);display:flex;flex-direction:column;gap:16px;';
    isolateUIElement(panel);

    // Header + Mode Selector
    const header = document.createElement('div');
    header.style.cssText =
      'display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px;border-bottom:1px solid rgba(148,163,184,0.22);padding-bottom:12px;';

    const titleBox = document.createElement('div');
    titleBox.innerHTML =
      '<div style="font-size:23px;font-weight:900;letter-spacing:1.2px;background:linear-gradient(90deg,#38bdf8,#facc15);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">AETHER RIFT 3D — SẢNH CHỌN TƯỚNG</div>' +
      '<div style="font-size:12px;color:#94a3b8;margin-top:3px;">Đấu trường MOBA 3D 240x240 • 3 Đường • 11 Trụ & Nhà Chính mỗi đội • Bụi Cỏ Tàng Hình • 5 Tướng 20 Kỹ Năng</div>';

    const modeBox = document.createElement('div');
    modeBox.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;';

    this.mode5v5Btn = document.createElement('button');
    this.mode5v5Btn.innerHTML = '5v5 Đấu Trường Cổ Điển';
    isolateUIElement(this.mode5v5Btn);
    this.mode5v5Btn.onclick = () => this.setMode('5v5');

    this.mode1v1Btn = document.createElement('button');
    this.mode1v1Btn.innerHTML = '1v1 Solo Đường Giữa';
    isolateUIElement(this.mode1v1Btn);
    this.mode1v1Btn.onclick = () => this.setMode('1v1');

    modeBox.append(this.mode5v5Btn, this.mode1v1Btn);
    header.append(titleBox, modeBox);

    // 5 Champion Cards Grid
    this.cardsWrap = document.createElement('div');
    this.cardsWrap.style.cssText =
      'display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;';

    for (const champ of CHAMPIONS_DATA) {
      const card = this.createChampCard(champ);
      this.cardEls.push(card);
      this.cardsWrap.appendChild(card);
    }

    // Selected Champion Detailed Overview (3 Stat Bars + 4 Skills Q/W/E/R + Dash Highlight)
    this.detailWrap = document.createElement('div');
    this.detailWrap.style.cssText =
      'background:rgba(8,14,26,0.9);border:1px solid rgba(56,189,248,0.3);border-radius:12px;padding:16px;';

    // Footer CTA
    const footer = document.createElement('div');
    footer.style.cssText =
      'display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;padding-top:2px;';

    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:12px;color:#94a3b8;line-height:1.45;';
    hint.innerHTML =
      'Điều khiển: <b style="color:#e2e8f0;">Chuột phải</b> Di chuyển / Đánh • <b style="color:#fde047;">Q W E R</b> Kỹ năng (Hoặc click chuột trái vào ô chiêu) • <b style="color:#fde047;">P</b> Cửa hàng • <b style="color:#38bdf8;">Tab</b> Bảng điểm';

    const startBtn = document.createElement('button');
    startBtn.id = 'moba-start-match-btn';
    startBtn.style.cssText =
      'padding:13px 36px;border-radius:10px;border:1px solid rgba(125,211,252,0.5);background:linear-gradient(135deg,#0284c7,#2563eb);color:#fff;font-size:16px;font-weight:900;letter-spacing:1px;cursor:pointer;box-shadow:0 8px 26px rgba(37,99,235,0.55);transition:transform 0.12s ease;';
    startBtn.textContent = 'VÀO TRẬN';
    isolateUIElement(startBtn);
    startBtn.onmouseenter = () => {
      startBtn.style.transform = 'translateY(-1px)';
    };
    startBtn.onmouseleave = () => {
      startBtn.style.transform = 'none';
    };
    startBtn.onclick = () => {
      const champ = CHAMPIONS_DATA.find((c) => c.numericId === this.selectedChampIdx) ?? CHAMPIONS_DATA[0];
      this.hide();
      onStart({
        mode: this.selectedMode,
        championId: champ.numericId,
        championKey: champ.id,
      });
    };

    footer.append(hint, startBtn);
    panel.append(header, this.cardsWrap, this.detailWrap, footer);
    this.root.appendChild(panel);
    parent.appendChild(this.root);

    this.refreshUI();
  }

  private renderMiniBar(label: string, val: number, color: string): string {
    const pct = Math.max(5, Math.min(100, val));
    return `
      <div style="display:flex;align-items:center;gap:6px;font-size:10px;color:#cbd5e1;">
        <span style="width:62px;color:#94a3b8;font-weight:700;">${label}</span>
        <div style="flex:1;height:5px;background:#090d16;border-radius:99px;overflow:hidden;border:1px solid rgba(148,163,184,0.18);">
          <div style="width:${pct}%;height:100%;background:${color};border-radius:99px;"></div>
        </div>
      </div>
    `;
  }

  private createChampCard(champ: ChampionDef): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.dataset.champId = `${champ.numericId}`;
    btn.dataset.champKey = champ.id;
    btn.style.cssText =
      'text-align:left;padding:12px;border-radius:11px;border:1.5px solid rgba(148,163,184,0.26);background:rgba(15,23,42,0.88);color:#f8fafc;cursor:pointer;display:flex;flex-direction:column;gap:8px;transition:border-color 0.15s,background 0.15s,box-shadow 0.15s;';
    isolateUIElement(btn);

    const hex = `#${champ.primaryColor.toString(16).padStart(6, '0')}`;
    const dashSlot = getDashSkillSlot(champ);

    btn.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;">
        <div style="width:42px;height:42px;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:10px;background:rgba(2,6,23,0.7);border:1px solid ${hex}66;">
          ${getChampionEmblemSvg(champ, 36)}
        </div>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:4px;">
            <span style="font-size:15px;font-weight:900;color:${hex};letter-spacing:0.4px;">${champ.name}</span>
            <span style="font-size:10px;font-weight:800;padding:2px 7px;border-radius:99px;background:rgba(56,189,248,0.14);border:1px solid rgba(56,189,248,0.35);color:#bae6fd;">${champ.role}</span>
          </div>
          <div style="font-size:11px;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${champ.title}</div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:3px;padding-top:2px;">
        ${this.renderMiniBar('Sát thương', champ.statBars.damage, '#fb923c')}
        ${this.renderMiniBar('Chống chịu', champ.statBars.toughness, '#34d399')}
        ${this.renderMiniBar('Cơ động', champ.statBars.mobility, '#38bdf8')}
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:10px;color:#cbd5e1;padding-top:2px;border-top:1px solid rgba(148,163,184,0.14);">
        <span>${champ.projectileSpeed > 0 ? 'Đánh xa' : 'Cận chiến'} • HP ${champ.maxHp}</span>
        <span style="color:#22d3ee;font-weight:800;">LƯỚT [${dashSlot}]</span>
      </div>
    `;

    btn.onclick = () => {
      this.selectedChampIdx = champ.numericId;
      this.refreshUI();
    };
    return btn;
  }

  private setMode(mode: GameMode): void {
    this.selectedMode = mode;
    this.refreshUI();
  }

  private renderDetailStatBar(label: string, val: number, color: string): string {
    const pct = Math.max(5, Math.min(100, val));
    return `
      <div style="display:flex;flex-direction:column;gap:4px;">
        <div style="display:flex;justify-content:space-between;font-size:11px;font-weight:800;">
          <span style="color:#cbd5e1;">${label}</span>
          <span style="color:${color};">${pct} / 100</span>
        </div>
        <div style="width:100%;height:8px;background:#050811;border-radius:99px;overflow:hidden;border:1px solid rgba(148,163,184,0.25);">
          <div style="width:${pct}%;height:100%;background:${color};border-radius:99px;"></div>
        </div>
      </div>
    `;
  }

  private refreshUI(): void {
    const activeStyle =
      'padding:8px 15px;border-radius:8px;border:1.5px solid #38bdf8;background:rgba(14,165,233,0.26);color:#f8fafc;font-size:12px;font-weight:800;cursor:pointer;box-shadow:0 0 14px rgba(56,189,248,0.28);';
    const inactiveStyle =
      'padding:8px 15px;border-radius:8px;border:1px solid rgba(148,163,184,0.3);background:rgba(15,23,42,0.82);color:#94a3b8;font-size:12px;font-weight:700;cursor:pointer;';

    this.mode5v5Btn.style.cssText = this.selectedMode === '5v5' ? activeStyle : inactiveStyle;
    this.mode1v1Btn.style.cssText = this.selectedMode === '1v1' ? activeStyle : inactiveStyle;

    for (let i = 0; i < this.cardEls.length; i++) {
      const el = this.cardEls[i];
      const champ = CHAMPIONS_DATA[i];
      const selected = champ.numericId === this.selectedChampIdx;
      const hex = `#${champ.primaryColor.toString(16).padStart(6, '0')}`;
      el.style.borderColor = selected ? hex : 'rgba(148,163,184,0.24)';
      el.style.background = selected ? 'rgba(30,41,59,0.96)' : 'rgba(15,23,42,0.78)';
      el.style.boxShadow = selected ? `0 0 20px ${hex}44` : 'none';
    }

    const c = CHAMPIONS_DATA.find((x) => x.numericId === this.selectedChampIdx) ?? CHAMPIONS_DATA[0];
    const hex = `#${c.primaryColor.toString(16).padStart(6, '0')}`;
    const dashSlot = getDashSkillSlot(c);
    const skillList = [c.skills.Q, c.skills.W, c.skills.E, c.skills.R];

    this.detailWrap.innerHTML = `
      <div style="display:grid;grid-template-columns:minmax(240px,1fr) 2.2fr;gap:16px;align-items:start;">
        <div style="display:flex;flex-direction:column;gap:10px;padding:12px;border-radius:10px;background:rgba(15,23,42,0.78);border:1px solid rgba(148,163,184,0.2);">
          <div style="display:flex;align-items:center;gap:12px;">
            <div style="width:52px;height:52px;border-radius:12px;background:rgba(2,6,23,0.85);border:1.5px solid ${hex};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
              ${getChampionEmblemSvg(c, 44)}
            </div>
            <div>
              <div style="font-size:19px;font-weight:900;color:${hex};">${c.name}</div>
              <div style="font-size:12px;color:#cbd5e1;font-weight:700;">${c.title} • <span style="color:#fde047;">${c.role}</span></div>
              <div style="font-size:11px;color:#94a3b8;margin-top:2px;">Đường đề xuất: <b style="color:#38bdf8;">${LANE_LABEL[c.suggestedLane]}</b></div>
            </div>
          </div>

          <div style="display:flex;flex-direction:column;gap:7px;padding:8px 0;border-top:1px solid rgba(148,163,184,0.16);border-bottom:1px solid rgba(148,163,184,0.16);">
            ${this.renderDetailStatBar('Sát thương (Damage)', c.statBars.damage, 'linear-gradient(90deg,#f97316,#fb923c)')}
            ${this.renderDetailStatBar('Chống chịu (Toughness)', c.statBars.toughness, 'linear-gradient(90deg,#059669,#34d399)')}
            ${this.renderDetailStatBar('Cơ động (Mobility)', c.statBars.mobility, 'linear-gradient(90deg,#0284c7,#38bdf8)')}
          </div>

          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;font-size:11px;color:#cbd5e1;">
            <div style="background:rgba(2,6,23,0.6);padding:5px 7px;border-radius:6px;">Máu: <b style="color:#4ade80;">${c.maxHp}</b></div>
            <div style="background:rgba(2,6,23,0.6);padding:5px 7px;border-radius:6px;">MP: <b style="color:#38bdf8;">${c.maxMp}</b></div>
            <div style="background:rgba(2,6,23,0.6);padding:5px 7px;border-radius:6px;">AD: <b style="color:#fb923c;">${c.ad}</b></div>
            <div style="background:rgba(2,6,23,0.6);padding:5px 7px;border-radius:6px;">Giáp: <b style="color:#cbd5e1;">${c.armor}</b></div>
            <div style="background:rgba(2,6,23,0.6);padding:5px 7px;border-radius:6px;">KP: <b style="color:#c084fc;">${c.mr}</b></div>
            <div style="background:rgba(2,6,23,0.6);padding:5px 7px;border-radius:6px;">Tầm: <b style="color:#fde047;">${c.attackRange}m</b></div>
          </div>

          <div style="font-size:11px;color:#22d3ee;font-weight:800;background:rgba(6,182,212,0.12);border:1px solid rgba(34,211,238,0.35);padding:6px 9px;border-radius:7px;">
            Kỹ năng Lướt cơ động: Phím [${dashSlot}] — ${c.skills[dashSlot].name}
          </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;">
          ${skillList
            .map((sk) => {
              const isDash = Boolean(sk.isDash);
              const borderCol = isDash ? 'rgba(34,211,238,0.55)' : 'rgba(148,163,184,0.22)';
              const bgCol = isDash ? 'rgba(8,35,56,0.75)' : 'rgba(15,23,42,0.85)';
              return `
                <div style="padding:10px 12px;border-radius:9px;background:${bgCol};border:1.5px solid ${borderCol};display:flex;flex-direction:column;gap:6px;">
                  <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
                    <div style="display:flex;align-items:center;gap:8px;min-width:0;">
                      <div style="width:30px;height:30px;flex-shrink:0;display:flex;align-items:center;justify-content:center;">
                        ${getSkillIconSvg(sk, 30)}
                      </div>
                      <div style="min-width:0;">
                        <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;">
                          <span style="font-size:12.5px;font-weight:900;color:#fde047;">[${sk.slot}] ${sk.name}</span>
                          ${
                            isDash
                              ? '<span style="font-size:9.5px;font-weight:900;padding:1px 6px;border-radius:99px;background:#06b6d4;color:#020617;">LƯỚT / DASH</span>'
                              : ''
                          }
                          ${
                            sk.recastable
                              ? '<span style="font-size:9.5px;font-weight:900;padding:1px 6px;border-radius:99px;background:#f59e0b;color:#020617;">TÁI KÍCH HOẠT</span>'
                              : ''
                          }
                        </div>
                        <div style="font-size:10px;color:#7dd3fc;font-weight:700;">
                          ${sk.manaCost} MP • Hồi chiêu ${sk.cooldown}s • Tầm ${sk.isGlobal ? 'Toàn Bản Đồ' : `${sk.range}m`}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div style="font-size:11px;color:#cbd5e1;line-height:1.45;">${sk.description}</div>
                </div>
              `;
            })
            .join('')}
        </div>
      </div>
    `;
  }

  public show(): void {
    this.root.style.display = 'flex';
  }

  public hide(): void {
    this.root.style.display = 'none';
  }

  public isVisible(): boolean {
    return this.root.style.display !== 'none';
  }

  public dispose(): void {
    this.root.remove();
  }
}
