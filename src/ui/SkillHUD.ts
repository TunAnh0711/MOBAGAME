import {
  Stats,
  StatusEffects,
  SkillBook,
  UnitType,
  Movement,
  Vision,
  STATE_DEAD,
  TEAM_BLUE,
} from '../ecs/Components';
import { GameWorld } from '../ecs/World';
import {
  getChampionData,
  getChampionEmblemSvg,
  getSkillIconSvg,
  SUMMONER_SPELLS,
} from '../data/ChampionsData';
import { getItemById, getItemIconSvg, MAX_INVENTORY_SLOTS } from '../data/ItemsData';
import { InputManager, isolateUIElement } from '../core/InputManager';
import { SkillSystem } from '../ecs/systems/SkillSystem';
import { CameraController } from '../core/CameraController';
import { EventBus, SkillSlot } from '../core/EventBus';

interface SlotDom {
  btn: HTMLButtonElement;
  iconBox: HTMLDivElement;
  cdMask: HTMLDivElement;
  cdText: HTMLDivElement;
  oomMask: HTMLDivElement;
  manaCost: HTMLDivElement;
  dashBadge: HTMLDivElement;
  recastBadge: HTMLDivElement;
  rankWrap: HTMLDivElement;
  plusBtn: HTMLDivElement;
}

const RECALL_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="22" height="22" fill="none"><rect x="2" y="2" width="28" height="28" rx="6" fill="#0f172a" stroke="#38bdf8" stroke-width="1.8"/><circle cx="16" cy="16" r="8" stroke="#38bdf8" stroke-width="2" stroke-dasharray="5 3"/><circle cx="16" cy="16" r="3.5" fill="#7dd3fc"/></svg>';

function computeCdrFraction(cdrRaw: number): number {
  if (cdrRaw <= 0) return 0;
  if (cdrRaw >= 1) {
    return Math.min(0.55, cdrRaw / (100 + cdrRaw));
  }
  return Math.min(0.45, cdrRaw);
}

export class SkillHUD {
  private root: HTMLDivElement;
  private world: GameWorld;
  private input: InputManager;
  private skills: SkillSystem;
  private cameraCtrl: CameraController;
  private onRestart: () => void;
  private onReturnToLobby: () => void;
  private onOpenShop: () => void;
  private onToggleScoreboard?: () => void;

  private topBar!: HTMLDivElement;
  private helpWrap!: HTMLDivElement;
  private helpBtn!: HTMLButtonElement;
  private topScoreBlue!: HTMLSpanElement;
  private topScoreRed!: HTMLSpanElement;
  private topClock!: HTMLSpanElement;
  private topStats!: HTMLSpanElement;
  private topFpsMode!: HTMLSpanElement;
  private camBadge!: HTMLButtonElement;
  private scoreboardBtn!: HTMLButtonElement;
  private topShopBtn!: HTMLButtonElement;
  private lobbyMenuBtn!: HTMLButtonElement;
  private dock!: HTMLDivElement;
  private helpPanel!: HTMLDivElement;
  private helpOpen = false;

  private announcementEl!: HTMLDivElement;
  private announcementTimer = 0;

  private recallBarWrap!: HTMLDivElement;
  private recallBarFill!: HTMLDivElement;
  private recallBarText!: HTMLDivElement;

  private stealthBadgeWrap!: HTMLDivElement;

  private portraitCircle!: HTMLDivElement;
  private portraitEmblem!: HTMLDivElement;
  private lastChampSubKind = -1;
  private levelBadge!: HTMLDivElement;
  private champNameEl!: HTMLDivElement;
  private xpFill!: HTMLDivElement;
  private goldShopBtn!: HTMLButtonElement;

  private adStatEl!: HTMLDivElement;
  private apStatEl!: HTMLDivElement;
  private armorStatEl!: HTMLDivElement;
  private mrStatEl!: HTMLDivElement;
  private asStatEl!: HTMLDivElement;
  private msStatEl!: HTMLDivElement;
  private lsStatEl!: HTMLDivElement;
  private critStatEl!: HTMLDivElement;
  private cdrStatEl!: HTMLDivElement;
  private invSlotEls: HTMLButtonElement[] = [];

  private hpFill!: HTMLDivElement;
  private hpShieldFill!: HTMLDivElement;
  private hpText!: HTMLDivElement;
  private hpRegenText!: HTMLDivElement;
  private mpFill!: HTMLDivElement;
  private mpText!: HTMLDivElement;
  private mpRegenText!: HTMLDivElement;
  private tooltip!: HTMLDivElement;

  private respawnBanner!: HTMLDivElement;
  private matchEndModal!: HTMLDivElement;

  private slots: Record<SkillSlot | 'B', SlotDom> = {} as Record<SkillSlot | 'B', SlotDom>;
  private hoveredSlot: SkillSlot | 'B' | null = null;
  private smoothedFps = 60;
  private unsubs: Array<() => void> = [];

  constructor(
    parent: HTMLElement,
    world: GameWorld,
    input: InputManager,
    skills: SkillSystem,
    cameraCtrl: CameraController,
    bus: EventBus,
    onOpenShop: () => void,
    onRestart: () => void,
    onReturnToLobby: () => void,
    onToggleScoreboard?: () => void
  ) {
    this.world = world;
    this.input = input;
    this.skills = skills;
    this.cameraCtrl = cameraCtrl;
    this.onOpenShop = onOpenShop;
    this.onRestart = onRestart;
    this.onReturnToLobby = onReturnToLobby;
    this.onToggleScoreboard = onToggleScoreboard;

    this.root = document.createElement('div');
    this.root.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:25;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#f8fafc;user-select:none;';
    parent.appendChild(this.root);

    this.buildTopBar();
    this.buildAnnouncement();
    this.buildBottomDock();
    this.buildModals();

    this.unsubs.push(
      bus.on('announcement', (ev) => {
        this.showAnnouncement(ev.text, ev.color);
      })
    );

    this.unsubs.push(
      bus.on('turretTarget', (ev) => {
        if (ev.targetEid === this.world.playerEid) {
          this.showAnnouncement('CẢNH BÁO: TRỤ ĐỊCH ĐANG NHẮM BẮN BẠN!', '#ef4444');
        }
      })
    );

    this.unsubs.push(
      bus.on('matchEnd', (ev) => {
        this.showMatchEnd(ev.winnerTeam === TEAM_BLUE);
      })
    );

    window.addEventListener('resize', this.applyResponsiveLayout);
    window.addEventListener('keydown', this.handleHelpKey);
    this.applyResponsiveLayout();
    requestAnimationFrame(() => this.applyResponsiveLayout());
  }

  private handleHelpKey = (e: KeyboardEvent): void => {
    const activeTag = document.activeElement?.tagName;
    if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;
    if (e.key.toUpperCase() === 'H') {
      this.helpOpen = !this.helpOpen;
      this.helpPanel.style.display = this.helpOpen ? 'block' : 'none';
    }
  };

  private computeMinimapOuterReserve(w: number, h: number): { outer: number; margin: number } {
    const size =
      w >= 1120 && h >= 680
        ? 220
        : w >= 880
          ? 172
          : Math.max(122, Math.min(148, Math.floor(w * 0.19)));
    const margin = w < 880 ? 8 : 12;
    return { outer: size + 11, margin };
  }

  private applyResponsiveLayout = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const { outer: mmOuter, margin: mmMargin } = this.computeMinimapOuterReserve(w, h);
    const minimapLeft = w - mmMargin - mmOuter;

    // 1. Top Bar vs Top-Left Help Button
    const helpRight = 10 + (this.helpBtn ? Math.max(115, this.helpBtn.offsetWidth) : 126);
    const topNaturalW = Math.max(620, this.topBar.offsetWidth || 720);
    const topAvail = Math.max(220, w - helpRight - 28);
    const topScale = Math.min(1, topAvail / topNaturalW);
    const topScaledW = topNaturalW * topScale;
    const idealTopCenter = w * 0.5;
    const minTopCenter = helpRight + 10 + topScaledW * 0.5;
    const maxTopCenter = w - 10 - topScaledW * 0.5;
    const topCenter = Math.max(minTopCenter, Math.min(maxTopCenter, idealTopCenter));

    this.topBar.style.left = `${topCenter.toFixed(1)}px`;
    this.topBar.style.transform = `translateX(-50%) scale(${topScale.toFixed(3)})`;
    this.topBar.style.transformOrigin = 'top center';

    // 2. Bottom Dock vs Minimap
    const dockNaturalW = Math.max(710, this.dock.offsetWidth || 770);
    const dockNaturalH = Math.max(122, this.dock.offsetHeight || 132);
    const maxAllowedRight = minimapLeft - 12;
    const leftMargin = w < 880 ? 8 : 12;
    const dockAvail = Math.max(260, maxAllowedRight - leftMargin);
    const dockScale = Math.min(1, dockAvail / dockNaturalW);
    const scaledDockW = dockNaturalW * dockScale;

    let dockCenter = w * 0.5;
    if (dockCenter + scaledDockW * 0.5 > maxAllowedRight) {
      dockCenter = maxAllowedRight - scaledDockW * 0.5;
    }
    dockCenter = Math.max(leftMargin + scaledDockW * 0.5, dockCenter);

    const bottomMargin = w < 880 ? 8 : 12;
    this.dock.style.bottom = `${bottomMargin}px`;
    this.dock.style.left = `${dockCenter.toFixed(1)}px`;
    this.dock.style.transform = `translateX(-50%) scale(${dockScale.toFixed(3)})`;
    this.dock.style.transformOrigin = 'bottom center';

    const aboveDockBottom = Math.round(bottomMargin + dockNaturalH * dockScale + 10);
    this.recallBarWrap.style.bottom = `${aboveDockBottom}px`;
    this.recallBarWrap.style.left = `${dockCenter.toFixed(1)}px`;

    this.stealthBadgeWrap.style.bottom = `${aboveDockBottom + 36}px`;
    this.stealthBadgeWrap.style.left = `${dockCenter.toFixed(1)}px`;

    this.tooltip.style.bottom = `${aboveDockBottom}px`;
    const clampedTooltipX = Math.max(175, Math.min(w - 175, dockCenter));
    this.tooltip.style.left = `${clampedTooltipX.toFixed(1)}px`;

    const topBarBottom = Math.round(10 + 40 * topScale + 12);
    this.announcementEl.style.top = `${topBarBottom}px`;
  };

  private buildTopBar(): void {
    this.topBar = document.createElement('div');
    this.topBar.style.cssText =
      'position:absolute;top:10px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:8px;padding:6px 12px;background:linear-gradient(180deg,rgba(15,23,42,0.94),rgba(7,11,22,0.96));border:1px solid rgba(56,189,248,0.45);border-radius:10px;backdrop-filter:blur(8px);box-shadow:0 6px 22px rgba(0,0,0,0.65),inset 0 1px 0 rgba(255,255,255,0.08);pointer-events:auto;white-space:nowrap;';
    isolateUIElement(this.topBar);

    this.topScoreBlue = document.createElement('span');
    this.topScoreBlue.style.cssText = 'font-weight:900;font-size:16px;color:#38bdf8;';
    this.topScoreBlue.textContent = '0';

    const vs = document.createElement('span');
    vs.style.cssText = 'color:#64748b;font-weight:800;font-size:10.5px;letter-spacing:0.5px;';
    vs.textContent = 'VS';

    this.topScoreRed = document.createElement('span');
    this.topScoreRed.style.cssText = 'font-weight:900;font-size:16px;color:#f43f5e;';
    this.topScoreRed.textContent = '0';

    const sep1 = this.createTopSep();

    this.topClock = document.createElement('span');
    this.topClock.style.cssText =
      'font-weight:900;font-size:13.5px;color:#e2e8f0;min-width:42px;text-align:center;font-variant-numeric:tabular-nums;';
    this.topClock.textContent = '00:00';

    const sep2 = this.createTopSep();

    this.topStats = document.createElement('span');
    this.topStats.style.cssText =
      'font-size:11.5px;font-weight:800;color:#cbd5e1;font-variant-numeric:tabular-nums;';
    this.topStats.textContent = 'K/D/A 0/0/0 • CS 0 • 500g';

    const sep3 = this.createTopSep();

    this.topFpsMode = document.createElement('span');
    this.topFpsMode.style.cssText =
      'padding:2px 7px;border-radius:5px;background:rgba(15,23,42,0.9);border:1px solid rgba(56,189,248,0.3);color:#7dd3fc;font-size:10.5px;font-weight:800;font-variant-numeric:tabular-nums;';
    this.topFpsMode.textContent = '5v5 • 60 FPS';

    this.camBadge = document.createElement('button');
    this.camBadge.style.cssText =
      'padding:4px 8px;border-radius:6px;border:1px solid rgba(148,163,184,0.38);background:rgba(30,41,59,0.88);color:#cbd5e1;font-size:11px;font-weight:800;cursor:pointer;';
    this.camBadge.textContent = 'Cam Tự Do (Y)';
    isolateUIElement(this.camBadge);
    this.camBadge.onclick = () => {
      this.cameraCtrl.toggleLock();
    };

    this.scoreboardBtn = document.createElement('button');
    this.scoreboardBtn.id = 'moba-top-scoreboard-btn';
    this.scoreboardBtn.style.cssText =
      'padding:4px 9px;border-radius:6px;border:1px solid rgba(56,189,248,0.48);background:rgba(14,165,233,0.18);color:#bae6fd;font-size:11px;font-weight:800;cursor:pointer;';
    this.scoreboardBtn.textContent = 'Bảng Điểm [Tab]';
    isolateUIElement(this.scoreboardBtn);
    this.scoreboardBtn.onclick = () => {
      if (this.onToggleScoreboard) {
        this.onToggleScoreboard();
      } else {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab' }));
      }
    };

    this.topShopBtn = document.createElement('button');
    this.topShopBtn.id = 'moba-top-shop-btn';
    this.topShopBtn.style.cssText =
      'padding:4px 9px;border-radius:6px;border:1px solid rgba(250,204,21,0.55);background:rgba(234,179,8,0.18);color:#fde047;font-size:11px;font-weight:800;cursor:pointer;';
    this.topShopBtn.textContent = 'Cửa Hàng [P]';
    isolateUIElement(this.topShopBtn);
    this.topShopBtn.onclick = () => {
      this.onOpenShop();
    };

    this.lobbyMenuBtn = document.createElement('button');
    this.lobbyMenuBtn.id = 'moba-return-lobby-btn';
    this.lobbyMenuBtn.style.cssText =
      'padding:4px 10px;border-radius:6px;border:1px solid rgba(244,63,94,0.65);background:linear-gradient(180deg,rgba(225,29,72,0.32),rgba(159,18,57,0.38));color:#fecdd3;font-size:11px;font-weight:900;cursor:pointer;box-shadow:0 2px 8px rgba(225,29,72,0.28);';
    this.lobbyMenuBtn.textContent = 'Đổi Tướng / Về Menu';
    isolateUIElement(this.lobbyMenuBtn);
    this.lobbyMenuBtn.onclick = () => {
      this.onReturnToLobby();
    };

    this.topBar.append(
      this.topScoreBlue,
      vs,
      this.topScoreRed,
      sep1,
      this.topClock,
      sep2,
      this.topStats,
      sep3,
      this.topFpsMode,
      this.camBadge,
      this.scoreboardBtn,
      this.topShopBtn,
      this.lobbyMenuBtn
    );
    this.root.appendChild(this.topBar);

    this.helpWrap = document.createElement('div');
    this.helpWrap.style.cssText = 'position:absolute;top:10px;left:10px;pointer-events:auto;';
    isolateUIElement(this.helpWrap);

    this.helpBtn = document.createElement('button');
    this.helpBtn.style.cssText =
      'padding:6px 10px;border-radius:8px;background:linear-gradient(180deg,rgba(15,23,42,0.92),rgba(7,11,22,0.94));border:1px solid rgba(56,189,248,0.42);color:#38bdf8;font-size:11px;font-weight:800;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,0.5);white-space:nowrap;';
    this.helpBtn.textContent = '? Điều khiển (H)';
    isolateUIElement(this.helpBtn);

    this.helpPanel = document.createElement('div');
    this.helpPanel.style.cssText =
      'margin-top:6px;padding:9px 12px;background:rgba(9,14,26,0.96);border:1px solid rgba(56,189,248,0.38);border-radius:8px;font-size:11px;line-height:1.55;color:#cbd5e1;display:none;box-shadow:0 8px 26px rgba(0,0,0,0.75);min-width:264px;backdrop-filter:blur(8px);';
    isolateUIElement(this.helpPanel);
    this.helpPanel.innerHTML =
      '<div style="font-weight:800;color:#38bdf8;margin-bottom:4px;">HƯỚNG DẪN MOBA 5v5</div>' +
      '<div><b>Chuột phải</b>: Di chuyển / Tấn công mục tiêu</div>' +
      '<div><b>Q / W / E / R</b>: Tung chiêu nhanh (hoặc Click chọn trên HUD)</div>' +
      '<div><b>D / F</b>: Tốc Biến / Hồi Máu &nbsp;•&nbsp; <b>B</b>: Biến Về</div>' +
      '<div><b>P</b>: Cửa hàng Trang bị &nbsp;•&nbsp; <b>Tab</b>: Bảng điểm</div>' +
      '<div><b>A + Chuột trái</b>: Attack-Move &nbsp;•&nbsp; <b>S</b>: Dừng</div>' +
      '<div><b>Space / Y</b>: Khóa Camera &nbsp;•&nbsp; <b>1-4</b>: Nâng chiêu</div>';

    this.helpBtn.onclick = () => {
      this.helpOpen = !this.helpOpen;
      this.helpPanel.style.display = this.helpOpen ? 'block' : 'none';
    };

    this.helpWrap.append(this.helpBtn, this.helpPanel);
    this.root.appendChild(this.helpWrap);
  }

  private createTopSep(): HTMLDivElement {
    const sep = document.createElement('div');
    sep.style.cssText = 'width:1px;height:16px;background:rgba(148,163,184,0.28);';
    return sep;
  }

  private buildAnnouncement(): void {
    this.announcementEl = document.createElement('div');
    this.announcementEl.style.cssText =
      'position:absolute;top:64px;left:50%;transform:translateX(-50%);padding:6px 18px;border-radius:8px;background:rgba(9,13,22,0.92);border:1px solid rgba(250,204,21,0.38);font-size:14px;font-weight:800;letter-spacing:0.4px;opacity:0;transition:opacity 0.22s ease;text-shadow:0 2px 4px #000;white-space:nowrap;pointer-events:none;';
    this.root.appendChild(this.announcementEl);
  }

  private showAnnouncement(text: string, color: string): void {
    this.announcementEl.textContent = text;
    this.announcementEl.style.color = color;
    this.announcementEl.style.opacity = '1';
    this.announcementTimer = 2.6;
  }

  private buildBottomDock(): void {
    this.stealthBadgeWrap = document.createElement('div');
    this.stealthBadgeWrap.style.cssText =
      'position:absolute;bottom:188px;left:50%;transform:translateX(-50%);padding:4px 12px;border-radius:999px;background:rgba(6,78,59,0.92);border:1.5px solid #34d399;color:#a7f3d0;font-size:11px;font-weight:900;letter-spacing:0.3px;display:none;align-items:center;gap:6px;box-shadow:0 4px 16px rgba(0,0,0,0.65);pointer-events:none;white-space:nowrap;';
    this.root.appendChild(this.stealthBadgeWrap);

    this.recallBarWrap = document.createElement('div');
    this.recallBarWrap.style.cssText =
      'position:absolute;bottom:152px;left:50%;transform:translateX(-50%);width:224px;padding:5px 9px;background:rgba(9,14,26,0.94);border:1px solid rgba(56,189,248,0.65);border-radius:7px;display:none;text-align:center;box-shadow:0 6px 20px rgba(0,0,0,0.7);pointer-events:none;';
    this.recallBarText = document.createElement('div');
    this.recallBarText.style.cssText =
      'font-size:11px;font-weight:800;color:#7dd3fc;margin-bottom:3px;';
    this.recallBarText.textContent = 'ĐANG BIẾN VỀ BỆ ĐÁ CỔ...';
    const rTrack = document.createElement('div');
    rTrack.style.cssText =
      'width:100%;height:6px;background:#020617;border-radius:3px;overflow:hidden;';
    this.recallBarFill = document.createElement('div');
    this.recallBarFill.style.cssText =
      'width:0%;height:100%;background:linear-gradient(90deg,#0284c7,#38bdf8);';
    rTrack.appendChild(this.recallBarFill);
    this.recallBarWrap.append(this.recallBarText, rTrack);
    this.root.appendChild(this.recallBarWrap);

    this.tooltip = document.createElement('div');
    this.tooltip.style.cssText =
      'position:absolute;bottom:152px;left:50%;transform:translateX(-50%);width:328px;max-width:calc(100vw - 24px);padding:10px 13px;background:linear-gradient(180deg,rgba(12,19,34,0.97),rgba(6,10,19,0.98));border:1.5px solid rgba(250,204,21,0.48);border-radius:9px;font-size:12px;line-height:1.45;display:none;box-shadow:0 10px 28px rgba(0,0,0,0.85),inset 0 1px 0 rgba(255,255,255,0.08);backdrop-filter:blur(8px);pointer-events:none;';
    this.root.appendChild(this.tooltip);

    // Main Dock (protected by .moba-ui-interactive)
    this.dock = document.createElement('div');
    this.dock.style.cssText =
      'position:absolute;bottom:12px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:11px;padding:9px 13px;background:linear-gradient(180deg,rgba(15,23,42,0.94) 0%,rgba(7,11,22,0.97) 100%);border:1.5px solid rgba(56,189,248,0.48);border-radius:12px;backdrop-filter:blur(10px);box-shadow:0 12px 36px rgba(0,0,0,0.84),inset 0 1px 0 rgba(255,255,255,0.09);pointer-events:auto;';
    isolateUIElement(this.dock);

    // === 1. Left Column: Portrait, Level, XP, & 9-Stat Readout ===
    const leftGroup = document.createElement('div');
    leftGroup.style.cssText =
      'display:flex;align-items:center;gap:9px;padding-right:10px;border-right:1px solid rgba(148,163,184,0.22);flex-shrink:0;';

    const portraitWrap = document.createElement('div');
    portraitWrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:3px;';

    this.portraitCircle = document.createElement('div');
    this.portraitCircle.style.cssText =
      'position:relative;width:52px;height:52px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#1e293b,#090d16 78%);border:2px solid #facc15;display:flex;align-items:center;justify-content:center;box-shadow:0 0 14px rgba(56,189,248,0.32),inset 0 0 8px rgba(0,0,0,0.65);flex-shrink:0;';

    this.portraitEmblem = document.createElement('div');
    this.portraitEmblem.style.cssText =
      'width:38px;height:38px;display:flex;align-items:center;justify-content:center;';

    this.levelBadge = document.createElement('div');
    this.levelBadge.style.cssText =
      'position:absolute;bottom:-4px;right:-4px;width:21px;height:21px;border-radius:50%;background:#090d16;border:1.5px solid #facc15;color:#fde047;font-size:10.5px;font-weight:900;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.85);';
    this.levelBadge.textContent = '1';
    this.portraitCircle.append(this.portraitEmblem, this.levelBadge);

    this.champNameEl = document.createElement('div');
    this.champNameEl.style.cssText =
      'font-size:9.5px;font-weight:900;color:#fde047;letter-spacing:0.3px;';
    this.champNameEl.textContent = 'TITAN';

    const xpTrack = document.createElement('div');
    xpTrack.style.cssText =
      'width:52px;height:4px;background:#020617;border:1px solid rgba(168,85,247,0.38);border-radius:2px;overflow:hidden;';
    this.xpFill = document.createElement('div');
    this.xpFill.style.cssText =
      'width:0%;height:100%;background:linear-gradient(90deg,#9333ea,#c084fc);';
    xpTrack.appendChild(this.xpFill);

    portraitWrap.append(this.portraitCircle, this.champNameEl, xpTrack);

    // Compact 9-Stat Readout (3x3 grid)
    const statsPanel = document.createElement('div');
    statsPanel.style.cssText =
      'display:grid;grid-template-columns:repeat(3,auto);gap:3px 9px;font-size:10px;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap;';

    this.adStatEl = document.createElement('div');
    this.adStatEl.style.color = '#fb923c';
    this.adStatEl.title = 'Công Vật Lý (AD)';

    this.apStatEl = document.createElement('div');
    this.apStatEl.style.color = '#c084fc';
    this.apStatEl.title = 'Sức Mạnh Phép (AP)';

    this.asStatEl = document.createElement('div');
    this.asStatEl.style.color = '#fde047';
    this.asStatEl.title = 'Tốc Độ Đánh';

    this.armorStatEl = document.createElement('div');
    this.armorStatEl.style.color = '#94a3b8';
    this.armorStatEl.title = 'Giáp Vật Lý';

    this.mrStatEl = document.createElement('div');
    this.mrStatEl.style.color = '#67e8f9';
    this.mrStatEl.title = 'Kháng Phép';

    this.msStatEl = document.createElement('div');
    this.msStatEl.style.color = '#34d399';
    this.msStatEl.title = 'Tốc Độ Chạy';

    this.critStatEl = document.createElement('div');
    this.critStatEl.style.color = '#f87171';
    this.critStatEl.title = 'Tỉ Lệ Chí Mạng';

    this.lsStatEl = document.createElement('div');
    this.lsStatEl.style.color = '#fb7185';
    this.lsStatEl.title = 'Hút Máu';

    this.cdrStatEl = document.createElement('div');
    this.cdrStatEl.style.color = '#93c5fd';
    this.cdrStatEl.title = 'Giảm Hồi Chiêu';

    statsPanel.append(
      this.adStatEl,
      this.apStatEl,
      this.asStatEl,
      this.armorStatEl,
      this.mrStatEl,
      this.msStatEl,
      this.critStatEl,
      this.lsStatEl,
      this.cdrStatEl
    );
    leftGroup.append(portraitWrap, statsPanel);

    // === 2. Center Column: Skill Slots + Large HP/MP Bars ===
    const centerCol = document.createElement('div');
    centerCol.style.cssText = 'display:flex;flex-direction:column;gap:8px;flex-shrink:0;';

    const skillRow = document.createElement('div');
    skillRow.style.cssText = 'display:flex;align-items:center;gap:6px;padding-top:5px;';

    const qwer: Array<'Q' | 'W' | 'E' | 'R'> = ['Q', 'W', 'E', 'R'];
    for (const s of qwer) {
      const dom = this.createSkillSlot(s, 50, true);
      this.slots[s] = dom;
      skillRow.appendChild(dom.btn);
    }

    const divider = document.createElement('div');
    divider.style.cssText = 'width:1px;height:40px;background:rgba(148,163,184,0.28);margin:0 2px;';
    skillRow.appendChild(divider);

    const dfb: Array<'D' | 'F' | 'B'> = ['D', 'F', 'B'];
    for (const s of dfb) {
      const dom = this.createSkillSlot(s, 40, false);
      this.slots[s] = dom;
      skillRow.appendChild(dom.btn);
    }

    const barsWrap = document.createElement('div');
    barsWrap.style.cssText = 'display:flex;flex-direction:column;gap:4px;margin-top:2px;';

    const hpTrack = document.createElement('div');
    hpTrack.style.cssText =
      'position:relative;width:100%;height:18px;background:#070b14;border:1px solid rgba(71,85,105,0.92);border-radius:4px;overflow:hidden;box-shadow:inset 0 1px 3px rgba(0,0,0,0.8);';
    this.hpFill = document.createElement('div');
    this.hpFill.style.cssText =
      'position:absolute;left:0;top:0;bottom:0;width:100%;background:linear-gradient(90deg,#16a34a,#22c55e);transition:width 0.06s linear;';
    this.hpShieldFill = document.createElement('div');
    this.hpShieldFill.style.cssText =
      'position:absolute;top:0;bottom:0;background:linear-gradient(180deg,#ffffff,#cbd5e1);opacity:0.9;display:none;';
    this.hpText = document.createElement('div');
    this.hpText.style.cssText =
      'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#ffffff;text-shadow:0 1px 2px #000;';
    this.hpRegenText = document.createElement('div');
    this.hpRegenText.style.cssText =
      'position:absolute;right:6px;top:0;bottom:0;display:flex;align-items:center;font-size:9.5px;font-weight:700;color:#bbf7d0;text-shadow:0 1px 2px #000;';
    hpTrack.append(this.hpFill, this.hpShieldFill, this.hpText, this.hpRegenText);

    const mpTrack = document.createElement('div');
    mpTrack.style.cssText =
      'position:relative;width:100%;height:14px;background:#070b14;border:1px solid rgba(71,85,105,0.92);border-radius:4px;overflow:hidden;box-shadow:inset 0 1px 3px rgba(0,0,0,0.8);';
    this.mpFill = document.createElement('div');
    this.mpFill.style.cssText =
      'position:absolute;left:0;top:0;bottom:0;width:100%;background:linear-gradient(90deg,#0284c7,#38bdf8);transition:width 0.06s linear;';
    this.mpText = document.createElement('div');
    this.mpText.style.cssText =
      'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:#ffffff;text-shadow:0 1px 2px #000;';
    this.mpRegenText = document.createElement('div');
    this.mpRegenText.style.cssText =
      'position:absolute;right:6px;top:0;bottom:0;display:flex;align-items:center;font-size:9.5px;font-weight:700;color:#bae6fd;text-shadow:0 1px 2px #000;';
    mpTrack.append(this.mpFill, this.mpText, this.mpRegenText);

    barsWrap.append(hpTrack, mpTrack);
    centerCol.append(skillRow, barsWrap);

    // === 3. Right Column: 6-Slot Inventory + Gold Shop Button (P) ===
    const bagCol = document.createElement('div');
    bagCol.style.cssText =
      'display:flex;flex-direction:column;gap:5px;padding-left:10px;border-left:1px solid rgba(148,163,184,0.22);flex-shrink:0;';

    const invGrid = document.createElement('div');
    invGrid.style.cssText = 'display:grid;grid-template-columns:repeat(3,32px);gap:4px;';
    for (let s = 0; s < MAX_INVENTORY_SLOTS; s++) {
      const slotEl = document.createElement('button');
      slotEl.style.cssText =
        'width:32px;height:32px;border-radius:6px;border:1px solid rgba(71,85,105,0.85);background:rgba(15,23,42,0.88);color:#f8fafc;display:flex;align-items:center;justify-content:center;padding:0;cursor:pointer;';
      isolateUIElement(slotEl);
      slotEl.onclick = () => this.onOpenShop();
      this.invSlotEls.push(slotEl);
      invGrid.appendChild(slotEl);
    }

    this.goldShopBtn = document.createElement('button');
    this.goldShopBtn.id = 'moba-open-shop-btn';
    this.goldShopBtn.style.cssText =
      'padding:4px 8px;border-radius:6px;border:1px solid rgba(250,204,21,0.68);background:linear-gradient(180deg,rgba(234,179,8,0.24),rgba(161,98,7,0.26));color:#fde047;font-size:11px;font-weight:900;cursor:pointer;text-align:center;';
    this.goldShopBtn.textContent = '500g • Cửa Hàng [P]';
    isolateUIElement(this.goldShopBtn);
    this.goldShopBtn.onclick = () => this.onOpenShop();

    bagCol.append(invGrid, this.goldShopBtn);

    this.dock.append(leftGroup, centerCol, bagCol);
    this.root.appendChild(this.dock);
  }

  private createSkillSlot(slot: SkillSlot | 'B', size: number, isMain: boolean): SlotDom {
    const btn = document.createElement('button');
    btn.dataset.skillSlot = slot;
    btn.style.cssText = `position:relative;width:${size}px;height:${size}px;border-radius:8px;background:linear-gradient(145deg,#1e293b,#0f172a);border:1.5px solid rgba(56,189,248,0.55);color:#f8fafc;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;overflow:visible;box-shadow:inset 0 1px 0 rgba(255,255,255,0.12),0 3px 10px rgba(0,0,0,0.6);`;
    isolateUIElement(btn);

    const iconBox = document.createElement('div');
    iconBox.style.cssText =
      'width:100%;height:100%;display:flex;align-items:center;justify-content:center;pointer-events:none;';
    if (slot === 'B') {
      iconBox.innerHTML = RECALL_SVG;
    } else if (slot === 'D' || slot === 'F') {
      iconBox.innerHTML = getSkillIconSvg(SUMMONER_SPELLS[slot], 24);
    } else {
      iconBox.innerHTML = getSkillIconSvg(getChampionData(0).skills[slot], isMain ? 30 : 24);
    }

    const hotkey = document.createElement('div');
    hotkey.style.cssText =
      'position:absolute;top:2px;left:4px;font-size:9.5px;font-weight:900;color:#fde047;text-shadow:0 1px 2px #000;z-index:3;pointer-events:none;';
    hotkey.textContent = slot;

    const dashBadge = document.createElement('div');
    dashBadge.style.cssText =
      'position:absolute;top:2px;right:2px;padding:0 3px;border-radius:3px;background:rgba(8,145,178,0.92);border:1px solid #22d3ee;color:#ecfeff;font-size:7px;font-weight:900;letter-spacing:0.2px;display:none;z-index:3;pointer-events:none;';
    dashBadge.textContent = 'LƯỚT';

    const recastBadge = document.createElement('div');
    recastBadge.style.cssText =
      'position:absolute;top:-11px;left:50%;transform:translateX(-50%);padding:1px 5px;border-radius:4px;background:linear-gradient(90deg,#f59e0b,#eab308);border:1px solid #fef08a;color:#090d16;font-size:8px;font-weight:900;display:none;white-space:nowrap;z-index:5;pointer-events:none;box-shadow:0 2px 6px rgba(0,0,0,0.75);';
    recastBadge.textContent = 'R2';

    const manaCost = document.createElement('div');
    manaCost.style.cssText =
      'position:absolute;bottom:2px;right:4px;font-size:9px;font-weight:800;color:#7dd3fc;text-shadow:0 1px 2px #000;z-index:3;pointer-events:none;';

    const oomMask = document.createElement('div');
    oomMask.style.cssText =
      'position:absolute;inset:0;border-radius:7px;background:rgba(10,30,88,0.78);display:none;flex-direction:column;align-items:center;justify-content:center;pointer-events:none;text-align:center;padding:2px;z-index:1;';
    oomMask.innerHTML =
      '<span style="font-size:7.5px;line-height:1.08;font-weight:800;color:#93c5fd;text-shadow:0 1px 2px #000;">Thiếu<br>MP</span>';

    const cdMask = document.createElement('div');
    cdMask.style.cssText =
      'position:absolute;inset:0;border-radius:7px;background:rgba(2,6,23,0.78);display:none;align-items:center;justify-content:center;pointer-events:none;z-index:2;';
    const cdText = document.createElement('div');
    cdText.style.cssText =
      'font-size:13.5px;font-weight:900;color:#f8fafc;text-shadow:0 2px 4px #000,0 0 6px #000;';
    cdMask.appendChild(cdText);

    const rankWrap = document.createElement('div');
    rankWrap.style.cssText =
      'position:absolute;bottom:-6px;left:50%;transform:translateX(-50%);display:flex;gap:2px;pointer-events:none;';

    const plusBtn = document.createElement('div');
    plusBtn.style.cssText =
      'position:absolute;top:-15px;left:50%;transform:translateX(-50%);width:22px;height:14px;border-radius:4px;background:#eab308;color:#0f172a;font-size:11px;font-weight:900;display:none;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,0.65);z-index:4;';
    plusBtn.textContent = '+';
    isolateUIElement(plusBtn);
    plusBtn.onclick = () => {
      if (slot === 'Q' || slot === 'W' || slot === 'E' || slot === 'R') {
        const pid = this.world.playerEid;
        if (pid >= 0) this.skills.upgradeSkill(pid, slot);
      }
    };

    btn.append(
      iconBox,
      hotkey,
      dashBadge,
      recastBadge,
      manaCost,
      oomMask,
      cdMask,
      rankWrap,
      plusBtn
    );

    btn.onclick = () => {
      this.input.triggerSlotFromUI(slot);
    };

    btn.onmouseenter = () => {
      this.hoveredSlot = slot;
      if (slot !== 'B') {
        this.input.hoveredSkillSlot = slot;
      }
      this.showTooltip(slot);
    };
    btn.onmouseleave = () => {
      if (this.hoveredSlot === slot) {
        this.hoveredSlot = null;
      }
      if (slot !== 'B' && this.input.hoveredSkillSlot === slot) {
        this.input.hoveredSkillSlot = null;
      }
      this.tooltip.style.display = 'none';
    };

    return {
      btn,
      iconBox,
      cdMask,
      cdText,
      oomMask,
      manaCost,
      dashBadge,
      recastBadge,
      rankWrap,
      plusBtn,
    };
  }

  private showTooltip(slot: SkillSlot | 'B'): void {
    const pid = this.world.playerEid;
    if (pid < 0) return;

    if (slot === 'B') {
      this.tooltip.innerHTML =
        '<div style="font-weight:800;color:#38bdf8;margin-bottom:4px;">[B] Biến Về (Recall)</div>' +
        '<div style="color:#cbd5e1;">Vận sức 3.5 giây để dịch chuyển về Bệ Đá Cổ hồi đầy Máu và Năng lượng.</div>';
    } else if (slot === 'D' || slot === 'F') {
      const sp = SUMMONER_SPELLS[slot];
      const rangeLine = sp.range > 0 ? ` &nbsp;•&nbsp; Tầm: ${sp.range}m` : '';
      this.tooltip.innerHTML =
        `<div style="font-weight:800;color:#facc15;margin-bottom:4px;">[${slot}] ${sp.name}</div>` +
        `<div style="color:#cbd5e1;margin-bottom:5px;">${sp.description}</div>` +
        `<div style="color:#94a3b8;font-size:11px;">Hồi chiêu: ${sp.cooldown}s${rangeLine}</div>`;
    } else {
      const def = getChampionData(UnitType.subKind[pid]);
      const sk = def.skills[slot];
      const isRecastActive = this.skills.isRecastReady(pid, slot);
      const rank =
        slot === 'Q'
          ? SkillBook.qLevel[pid]
          : slot === 'W'
            ? SkillBook.wLevel[pid]
            : slot === 'E'
              ? SkillBook.eLevel[pid]
              : SkillBook.rLevel[pid];
      const maxRank = slot === 'R' ? 3 : 5;
      const cdrMult = 1 - computeCdrFraction(Stats.cdr[pid]);
      const effectiveCd = Math.max(
        1.0,
        (sk.cooldown - Math.max(0, rank - 1) * sk.cdPerRank) * cdrMult
      );
      const liveDmg =
        sk.baseDamage > 0
          ? Math.round(
              sk.baseDamage +
                Math.max(0, rank - 1) * sk.damagePerRank +
                Stats.ad[pid] * sk.adRatio +
                Stats.ap[pid] * sk.apRatio +
                Stats.maxHp[pid] * (sk.maxHpRatio ?? 0)
            )
          : 0;
      const liveShield = sk.shieldBase
        ? Math.round(
            sk.shieldBase +
              Stats.ap[pid] * (sk.shieldApRatio ?? 0) +
              Stats.maxHp[pid] * (sk.shieldMaxHpRatio ?? 0)
          )
        : 0;
      const cost = isRecastActive ? 0 : sk.manaCost;
      const enoughMana = Stats.mp[pid] >= cost;

      const dashTag =
        sk.isDash || sk.kind === 'dash'
          ? `<span style="padding:1px 5px;border-radius:4px;background:rgba(8,145,178,0.35);border:1px solid #22d3ee;color:#67e8f9;font-size:9.5px;font-weight:900;margin-left:6px;">KỸ NĂNG LƯỚT</span>`
          : '';

      const titleName = isRecastActive && sk.recastName ? `${sk.recastName} (Tái kích hoạt)` : sk.name;
      const descText = isRecastActive && sk.recastDescription ? sk.recastDescription : sk.description;

      const scalingLine =
        liveDmg > 0
          ? `<div style="color:#c084fc;font-size:11px;font-weight:700;margin-bottom:3px;">Sát thương ước tính: ${liveDmg} (${sk.damageType === 'physical' ? 'Vật lý' : sk.damageType === 'true' ? 'Chuẩn' : 'Phép'})</div>`
          : liveShield > 0
            ? `<div style="color:#e2e8f0;font-size:11px;font-weight:700;margin-bottom:3px;">Lá chắn hiện tại: ${liveShield}</div>`
            : '';
      const oomLine = !enoughMana
        ? `<div style="color:#60a5fa;font-size:11px;font-weight:800;margin-top:4px;">Không đủ Năng lượng (cần ${cost} MP)</div>`
        : '';

      this.tooltip.innerHTML =
        `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">` +
        `<span style="font-weight:800;color:#38bdf8;">[${slot}] ${titleName}${dashTag}</span>` +
        `<span style="font-size:10.5px;color:#facc15;font-weight:700;">Cấp ${rank}/${maxRank}</span>` +
        `</div>` +
        `<div style="color:#cbd5e1;margin-bottom:5px;">${descText}</div>` +
        scalingLine +
        `<div style="color:#7dd3fc;font-size:11px;">Năng lượng: ${cost} &nbsp;•&nbsp; Hồi chiêu: ${effectiveCd.toFixed(1)}s &nbsp;•&nbsp; Tầm: ${sk.range}m</div>` +
        oomLine;
    }
    this.tooltip.style.display = 'block';
  }

  private buildModals(): void {
    this.respawnBanner = document.createElement('div');
    this.respawnBanner.style.cssText =
      'position:absolute;top:42%;left:50%;transform:translate(-50%,-50%);padding:14px 28px;border-radius:10px;background:rgba(9,14,26,0.94);border:1.5px solid #ef4444;color:#fca5a5;font-size:19px;font-weight:800;display:none;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,0.82);pointer-events:none;';
    this.root.appendChild(this.respawnBanner);

    this.matchEndModal = document.createElement('div');
    this.matchEndModal.style.cssText =
      'position:fixed;inset:0;background:rgba(2,6,23,0.84);display:none;align-items:center;justify-content:center;pointer-events:auto;backdrop-filter:blur(5px);';
    isolateUIElement(this.matchEndModal);
    this.root.appendChild(this.matchEndModal);
  }

  private showMatchEnd(isVictory: boolean): void {
    const pid = this.world.playerEid;
    const k = pid >= 0 ? Stats.kills[pid] : 0;
    const d = pid >= 0 ? Stats.deaths[pid] : 0;
    const a = pid >= 0 ? Stats.assists[pid] : 0;
    const cs = pid >= 0 ? Stats.cs[pid] : 0;
    const mins = Math.floor(this.world.matchTime / 60);
    const secs = Math.floor(this.world.matchTime % 60);

    this.matchEndModal.innerHTML = `
      <div class="moba-ui-interactive" style="padding:32px 44px;border-radius:16px;background:rgba(15,23,42,0.96);border:2px solid ${
        isVictory ? '#38bdf8' : '#f43f5e'
      };text-align:center;box-shadow:0 16px 48px rgba(0,0,0,0.85);">
        <div style="font-size:38px;font-weight:900;letter-spacing:2px;color:${
          isVictory ? '#38bdf8' : '#f43f5e'
        };margin-bottom:8px;">${isVictory ? 'CHIẾN THẮNG!' : 'THẤT BẠI!'}</div>
        <div style="font-size:14px;color:#cbd5e1;margin-bottom:20px;">
          ${isVictory ? 'Nhà Chính Địch đã bị phá hủy!' : 'Nhà Chính của bạn đã thất thủ!'}
        </div>
        <div style="font-size:15px;font-weight:700;color:#f8fafc;margin-bottom:24px;">
          K/D/A: ${k}/${d}/${a} &nbsp;•&nbsp; Lính: ${cs} &nbsp;•&nbsp; Thời gian: ${String(
      mins
    ).padStart(2, '0')}:${String(secs).padStart(2, '0')}
        </div>
        <div style="display:flex;gap:12px;justify-content:center;">
          <button id="moba-restart-btn" class="moba-ui-interactive" style="padding:12px 24px;border-radius:8px;border:none;background:${
            isVictory ? '#0284c7' : '#e11d48'
          };color:#fff;font-size:14px;font-weight:800;cursor:pointer;">CHƠI LẠI</button>
          <button id="moba-lobby-btn" class="moba-ui-interactive" style="padding:12px 24px;border-radius:8px;border:1px solid rgba(148,163,184,0.45);background:rgba(30,41,59,0.9);color:#f8fafc;font-size:14px;font-weight:800;cursor:pointer;">ĐỔI TƯỚNG / VỀ MENU</button>
        </div>
      </div>
    `;
    this.matchEndModal.style.display = 'flex';
    const rBtn = this.matchEndModal.querySelector('#moba-restart-btn') as HTMLButtonElement | null;
    if (rBtn) {
      isolateUIElement(rBtn);
      rBtn.onclick = () => {
        this.matchEndModal.style.display = 'none';
        this.onRestart();
      };
    }
    const lBtn = this.matchEndModal.querySelector('#moba-lobby-btn') as HTMLButtonElement | null;
    if (lBtn) {
      isolateUIElement(lBtn);
      lBtn.onclick = () => {
        this.matchEndModal.style.display = 'none';
        this.onReturnToLobby();
      };
    }
  }

  public update(dt: number): void {
    if (dt > 0.001 && dt < 0.5) {
      const instFps = Math.min(240, Math.max(10, 1 / dt));
      this.smoothedFps = this.smoothedFps * 0.9 + instFps * 0.1;
    }

    if (this.announcementTimer > 0) {
      this.announcementTimer -= dt;
      if (this.announcementTimer <= 0) {
        this.announcementEl.style.opacity = '0';
      }
    }

    this.topScoreBlue.textContent = `${this.world.blueKills}`;
    this.topScoreRed.textContent = `${this.world.redKills}`;
    const mins = Math.floor(this.world.matchTime / 60);
    const secs = Math.floor(this.world.matchTime % 60);
    this.topClock.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    this.topFpsMode.textContent = `${this.world.gameMode.toUpperCase()} • ${Math.round(
      this.smoothedFps
    )} FPS`;
    this.camBadge.textContent = this.cameraCtrl.isLocked ? 'Cam Khóa (Y)' : 'Cam Tự Do (Y)';
    this.camBadge.style.borderColor = this.cameraCtrl.isLocked
      ? 'rgba(250,204,21,0.75)'
      : 'rgba(148,163,184,0.38)';

    const pid = this.world.playerEid;
    if (pid < 0) return;

    const gold = Math.round(Stats.gold[pid]);
    const k = Stats.kills[pid];
    const d = Stats.deaths[pid];
    const a = Stats.assists[pid];
    const cs = Stats.cs[pid];
    this.topStats.textContent = `K/D/A ${k}/${d}/${a} • CS ${cs} • ${gold}g`;

    if (UnitType.state[pid] === STATE_DEAD) {
      this.respawnBanner.style.display = 'block';
      this.respawnBanner.textContent = `BẠN ĐÃ HY SINH — Hồi sinh sau ${Math.max(
        0,
        UnitType.respawnTimer[pid]
      ).toFixed(1)}s`;
    } else {
      this.respawnBanner.style.display = 'none';
    }

    // Stealth / Bush indicator badge
    const inBrush = Vision.inBrushId[pid] >= 0;
    const bushRevealed = Vision.bushRevealTimer[pid] > 0;
    const invisT = StatusEffects.invisTimer[pid];
    if (UnitType.state[pid] !== STATE_DEAD && invisT > 0) {
      this.stealthBadgeWrap.style.display = 'flex';
      this.stealthBadgeWrap.style.background = 'rgba(88,28,135,0.92)';
      this.stealthBadgeWrap.style.borderColor = '#c084fc';
      this.stealthBadgeWrap.style.color = '#f3e8ff';
      this.stealthBadgeWrap.textContent = `Tàng hình (${invisT.toFixed(1)}s)`;
    } else if (UnitType.state[pid] !== STATE_DEAD && inBrush) {
      this.stealthBadgeWrap.style.display = 'flex';
      if (bushRevealed) {
        this.stealthBadgeWrap.style.background = 'rgba(127,29,29,0.92)';
        this.stealthBadgeWrap.style.borderColor = '#f87171';
        this.stealthBadgeWrap.style.color = '#fecaca';
        this.stealthBadgeWrap.textContent = `Bị lộ trong bụi (${Vision.bushRevealTimer[pid].toFixed(
          1
        )}s)`;
      } else {
        this.stealthBadgeWrap.style.background = 'rgba(6,78,59,0.92)';
        this.stealthBadgeWrap.style.borderColor = '#34d399';
        this.stealthBadgeWrap.style.color = '#a7f3d0';
        this.stealthBadgeWrap.textContent = 'Ẩn thân trong bụi';
      }
    } else {
      this.stealthBadgeWrap.style.display = 'none';
    }

    if (SkillBook.isRecalling[pid] === 1) {
      this.recallBarWrap.style.display = 'block';
      const rem = Math.max(0, SkillBook.recallTimer[pid]);
      const pct = Math.min(100, Math.max(0, ((3.5 - rem) / 3.5) * 100));
      this.recallBarFill.style.width = `${pct.toFixed(1)}%`;
      this.recallBarText.textContent = `ĐANG BIẾN VỀ BỆ ĐÁ CỔ... ${rem.toFixed(1)}s`;
    } else {
      this.recallBarWrap.style.display = 'none';
    }

    this.levelBadge.textContent = `${Stats.level[pid]}`;
    const xpPct = Math.min(100, (Stats.xp[pid] / Math.max(1, Stats.xpToNext[pid])) * 100);
    this.xpFill.style.width = `${xpPct.toFixed(1)}%`;

    const basePlusBonusMs = Movement.baseSpeed[pid] + Stats.moveSpeedBonus[pid];
    const effectiveMs =
      basePlusBonusMs *
      (StatusEffects.slowTimer[pid] > 0
        ? Math.max(0.2, 1 - StatusEffects.slowPercent[pid])
        : Movement.speedMult[pid]);
    const effectiveAs =
      Stats.attackSpeed[pid] * (1 + Stats.attackSpeedBonus[pid]) * Stats.asBuffMult[pid];
    const cdrPct = Math.round(computeCdrFraction(Stats.cdr[pid]) * 100);
    const critPct = Math.round(Math.min(1, Math.max(0, Stats.critChance[pid])) * 100);
    const lsPct = Math.round(Math.max(0, Stats.lifesteal[pid]) * 100);

    this.adStatEl.textContent = `AD ${Math.round(Stats.ad[pid])}`;
    this.apStatEl.textContent = `AP ${Math.round(Stats.ap[pid])}`;
    this.asStatEl.textContent = `TĐ ${effectiveAs.toFixed(2)}`;
    this.armorStatEl.textContent = `Giáp ${Math.round(Stats.armor[pid])}`;
    this.mrStatEl.textContent = `KP ${Math.round(Stats.mr[pid])}`;
    this.msStatEl.textContent = `TC ${effectiveMs.toFixed(1)}`;
    this.critStatEl.textContent = `CM ${critPct}%`;
    this.lsStatEl.textContent = `HM ${lsPct}%`;
    this.cdrStatEl.textContent = `GHC ${cdrPct}%`;
    this.goldShopBtn.textContent = `${gold}g • Cửa Hàng [P]`;

    // Update 6-slot inventory mini-bar with crisp SVG icons
    const inv = this.world.inventories.get(pid) ?? [];
    for (let i = 0; i < MAX_INVENTORY_SLOTS; i++) {
      const slotEl = this.invSlotEls[i];
      const item = inv[i] ? getItemById(inv[i]) : undefined;
      if (item) {
        slotEl.innerHTML = getItemIconSvg(item, 24);
        slotEl.title = `${item.name} (${item.shortBonus})`;
        slotEl.style.borderColor = 'rgba(250,204,21,0.68)';
      } else {
        slotEl.innerHTML = '';
        slotEl.title = 'Ô trống — Nhấn P mở Cửa hàng';
        slotEl.style.borderColor = 'rgba(71,85,105,0.75)';
      }
    }

    // Large HP & MP Bars
    const maxHp = Math.max(1, Stats.maxHp[pid]);
    const hp = Math.max(0, Stats.hp[pid]);
    const shield = Math.max(0, StatusEffects.shieldAmount[pid]);
    const hpScale = Math.max(maxHp, hp + shield);
    const hpPct = (hp / hpScale) * 100;
    const shieldPct = (shield / hpScale) * 100;

    this.hpFill.style.width = `${hpPct.toFixed(1)}%`;
    this.hpShieldFill.style.left = `${hpPct.toFixed(1)}%`;
    this.hpShieldFill.style.width = `${shieldPct.toFixed(1)}%`;
    this.hpShieldFill.style.display = shield > 0.5 ? 'block' : 'none';
    this.hpText.textContent =
      shield > 0.5
        ? `${Math.round(hp)} (+${Math.round(shield)}) / ${Math.round(maxHp)}`
        : `${Math.round(hp)} / ${Math.round(maxHp)}`;
    this.hpRegenText.textContent = `+${Stats.hpRegen[pid].toFixed(1)}/s`;

    const maxMp = Math.max(1, Stats.maxMp[pid]);
    const mp = Math.max(0, Stats.mp[pid]);
    this.mpFill.style.width = `${((mp / maxMp) * 100).toFixed(1)}%`;
    this.mpText.textContent = `${Math.round(mp)} / ${Math.round(maxMp)}`;
    this.mpRegenText.textContent = `+${Stats.mpRegen[pid].toFixed(1)}/s`;

    // Champion Portrait & Q, W, E, R Skill Slots
    const subKind = UnitType.subKind[pid];
    const def = getChampionData(subKind);
    if (this.lastChampSubKind !== subKind) {
      this.lastChampSubKind = subKind;
      this.portraitEmblem.innerHTML = getChampionEmblemSvg(def, 38);
      this.champNameEl.textContent = def.name;
      const hex = `#${def.primaryColor.toString(16).padStart(6, '0')}`;
      this.portraitCircle.style.borderColor = hex;
      for (const s of ['Q', 'W', 'E', 'R'] as const) {
        this.slots[s].iconBox.innerHTML = getSkillIconSvg(def.skills[s], 30);
      }
    }

    const pts = SkillBook.skillPoints[pid];
    const mainSlots: Array<'Q' | 'W' | 'E' | 'R'> = ['Q', 'W', 'E', 'R'];

    for (const s of mainSlots) {
      const dom = this.slots[s];
      const sk = def.skills[s];
      const isDash = Boolean(sk.isDash || sk.kind === 'dash');
      const isRecastActive = this.skills.isRecastReady(pid, s);

      dom.dashBadge.style.display = isDash ? 'block' : 'none';
      if (isRecastActive) {
        dom.recastBadge.style.display = 'block';
        dom.recastBadge.textContent = `R2 ${SkillBook.rRecastTimer[pid].toFixed(1)}s`;
      } else {
        dom.recastBadge.style.display = 'none';
      }

      const rawCd =
        s === 'Q'
          ? SkillBook.qCd[pid]
          : s === 'W'
            ? SkillBook.wCd[pid]
            : s === 'E'
              ? SkillBook.eCd[pid]
              : SkillBook.rCd[pid];
      const cd = isRecastActive ? 0 : rawCd;
      const maxCd =
        s === 'Q'
          ? SkillBook.qMaxCd[pid]
          : s === 'W'
            ? SkillBook.wMaxCd[pid]
            : s === 'E'
              ? SkillBook.eMaxCd[pid]
              : SkillBook.rMaxCd[pid];
      const rank =
        s === 'Q'
          ? SkillBook.qLevel[pid]
          : s === 'W'
            ? SkillBook.wLevel[pid]
            : s === 'E'
              ? SkillBook.eLevel[pid]
              : SkillBook.rLevel[pid];
      const maxRank = s === 'R' ? 3 : 5;

      const cost = isRecastActive ? 0 : sk.manaCost;
      dom.manaCost.textContent = cost > 0 ? `${cost}` : '0';
      dom.plusBtn.style.display = pts > 0 && rank < maxRank ? 'flex' : 'none';

      let pipsHtml = '';
      for (let r = 0; r < maxRank; r++) {
        pipsHtml += `<span style="width:6px;height:4px;border-radius:1px;background:${
          r < rank ? '#facc15' : '#334155'
        };"></span>`;
      }
      dom.rankWrap.innerHTML = pipsHtml;

      const enoughMana = Stats.mp[pid] >= cost;
      const isAiming = this.input.aimMode === s;

      dom.btn.style.background = isRecastActive
        ? 'linear-gradient(145deg,#451a03,#1e1b4b)'
        : !enoughMana
          ? 'linear-gradient(145deg,#0b1d45,#061029)'
          : 'linear-gradient(145deg,#1e293b,#0f172a)';
      dom.btn.style.borderColor = isAiming
        ? '#facc15'
        : isRecastActive
          ? '#fbbf24'
          : !enoughMana
            ? '#2563eb'
            : isDash
              ? '#22d3ee'
              : 'rgba(56,189,248,0.65)';
      dom.btn.style.boxShadow = isAiming
        ? '0 0 14px rgba(250,204,21,0.85)'
        : isRecastActive
          ? '0 0 14px rgba(251,191,36,0.75)'
          : isDash && cd <= 0 && enoughMana
            ? '0 0 10px rgba(34,211,238,0.38),inset 0 1px 0 rgba(255,255,255,0.12)'
            : 'inset 0 1px 0 rgba(255,255,255,0.12),0 3px 10px rgba(0,0,0,0.6)';
      dom.manaCost.style.color = enoughMana ? '#7dd3fc' : '#60a5fa';
      dom.oomMask.style.display = !enoughMana && cd <= 0 ? 'flex' : 'none';

      if (cd > 0) {
        const denom = Math.max(0.1, maxCd || sk.cooldown);
        const deg = Math.min(360, Math.max(0, (cd / denom) * 360)).toFixed(1);
        dom.cdMask.style.display = 'flex';
        dom.cdMask.style.background = `conic-gradient(from 0deg, rgba(2,6,23,0.85) ${deg}deg, rgba(2,6,23,0.18) ${deg}deg 360deg)`;
        dom.cdText.textContent = cd < 1 ? Math.max(0.1, cd).toFixed(1) : `${Math.ceil(cd)}`;
      } else {
        dom.cdMask.style.display = 'none';
      }
    }

    for (const s of ['D', 'F'] as const) {
      const dom = this.slots[s];
      const cd = s === 'D' ? SkillBook.dCd[pid] : SkillBook.fCd[pid];
      const maxCd = s === 'D' ? SkillBook.dMaxCd[pid] : SkillBook.fMaxCd[pid];
      const isAiming = this.input.aimMode === s;
      dom.btn.style.borderColor = isAiming ? '#facc15' : 'rgba(250,204,21,0.52)';
      dom.btn.style.boxShadow = isAiming
        ? '0 0 14px rgba(250,204,21,0.8)'
        : 'inset 0 1px 0 rgba(255,255,255,0.12),0 3px 10px rgba(0,0,0,0.6)';

      if (cd > 0) {
        const denom = Math.max(0.1, maxCd || SUMMONER_SPELLS[s].cooldown);
        const deg = Math.min(360, Math.max(0, (cd / denom) * 360)).toFixed(1);
        dom.cdMask.style.display = 'flex';
        dom.cdMask.style.background = `conic-gradient(from 0deg, rgba(2,6,23,0.85) ${deg}deg, rgba(2,6,23,0.18) ${deg}deg 360deg)`;
        dom.cdText.textContent = cd < 1 ? Math.max(0.1, cd).toFixed(1) : `${Math.ceil(cd)}`;
      } else {
        dom.cdMask.style.display = 'none';
      }
    }

    if (this.hoveredSlot) {
      this.showTooltip(this.hoveredSlot);
    }
  }

  public dispose(): void {
    this.input.hoveredSkillSlot = null;
    for (const unsub of this.unsubs) unsub();
    this.unsubs = [];
    window.removeEventListener('resize', this.applyResponsiveLayout);
    window.removeEventListener('keydown', this.handleHelpKey);
    this.root.remove();
  }
}
