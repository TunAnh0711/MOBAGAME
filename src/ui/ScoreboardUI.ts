import {
  Stats,
  Team,
  UnitType,
  AI,
  STATE_DEAD,
  TEAM_BLUE,
  TEAM_RED,
} from '../ecs/Components';
import { GameWorld } from '../ecs/World';
import { getChampionData, getChampionEmblemSvg } from '../data/ChampionsData';
import { getItemById, getItemIconSvg, MAX_INVENTORY_SLOTS } from '../data/ItemsData';
import { isolateUIElement } from '../core/InputManager';

const LANE_TAG: Record<number, string> = {
  0: 'TOP',
  1: 'MID',
  2: 'BOT',
};

export class ScoreboardUI {
  private root: HTMLDivElement;
  private panel!: HTMLDivElement;
  private blueCol!: HTMLDivElement;
  private redCol!: HTMLDivElement;
  private titleScore!: HTMLDivElement;
  private closeBtn!: HTMLButtonElement;
  private world: GameWorld;
  private visible = false;
  private pinnedOpen = false;
  private tabDownTime = 0;
  private closeOnTabUp = false;
  private abortCtrl = new AbortController();

  constructor(parent: HTMLElement, world: GameWorld) {
    this.world = world;

    this.root = document.createElement('div');
    this.root.style.cssText =
      'position:fixed;inset:0;z-index:55;background:rgba(4,8,18,0.68);backdrop-filter:blur(5px);display:none;align-items:center;justify-content:center;padding:16px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#f8fafc;user-select:none;pointer-events:auto;';
    isolateUIElement(this.root);

    this.panel = document.createElement('div');
    this.panel.style.cssText =
      'width:min(980px,100%);max-height:90vh;overflow-y:auto;background:rgba(10,16,30,0.96);border:1.5px solid rgba(56,189,248,0.48);border-radius:14px;padding:18px 22px;box-shadow:0 20px 56px rgba(0,0,0,0.88);display:flex;flex-direction:column;gap:14px;';
    isolateUIElement(this.panel);

    const headerWrap = document.createElement('div');
    headerWrap.style.cssText =
      'display:flex;justify-content:space-between;align-items:center;gap:12px;border-bottom:1px solid rgba(148,163,184,0.22);padding-bottom:10px;';

    this.titleScore = document.createElement('div');
    this.titleScore.style.cssText =
      'flex:1;display:flex;justify-content:space-between;align-items:center;gap:10px;';

    this.closeBtn = document.createElement('button');
    this.closeBtn.style.cssText =
      'padding:5px 11px;border-radius:6px;border:1px solid rgba(148,163,184,0.38);background:rgba(30,41,59,0.92);color:#e2e8f0;font-size:11px;font-weight:800;cursor:pointer;flex-shrink:0;';
    this.closeBtn.textContent = 'Đóng [Tab / Esc]';
    isolateUIElement(this.closeBtn);
    this.closeBtn.onclick = () => this.close();

    headerWrap.append(this.titleScore, this.closeBtn);

    const cols = document.createElement('div');
    cols.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(390px,1fr));gap:16px;';

    this.blueCol = document.createElement('div');
    this.redCol = document.createElement('div');
    cols.append(this.blueCol, this.redCol);

    this.panel.append(headerWrap, cols);
    this.root.appendChild(this.panel);
    parent.appendChild(this.root);

    this.bindKeys();
  }

  private bindKeys(): void {
    const signal = this.abortCtrl.signal;
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.code === 'Tab' || e.key === 'Tab') {
          if (this.world.playerEid >= 0) {
            e.preventDefault();
            if (e.repeat) return;
            if (this.visible && this.pinnedOpen) {
              this.closeOnTabUp = true;
            } else if (!this.visible) {
              this.tabDownTime = performance.now();
              this.closeOnTabUp = false;
              this.visible = true;
              this.root.style.display = 'flex';
              this.render();
            }
          }
        } else if (e.key === 'Escape' && this.visible) {
          this.close();
        }
      },
      { signal }
    );

    window.addEventListener(
      'keyup',
      (e) => {
        if (e.code === 'Tab' || e.key === 'Tab') {
          if (this.visible) {
            e.preventDefault();
            const heldMs = performance.now() - this.tabDownTime;
            if (this.closeOnTabUp || heldMs >= 220) {
              this.close();
            } else {
              this.pinnedOpen = true;
            }
          }
        }
      },
      { signal }
    );

    window.addEventListener(
      'blur',
      () => {
        if (!this.pinnedOpen) {
          this.close();
        }
      },
      { signal }
    );
  }

  public toggle(): void {
    if (this.visible) {
      this.close();
    } else {
      this.open();
    }
  }

  public open(): void {
    this.visible = true;
    this.pinnedOpen = true;
    this.closeOnTabUp = false;
    this.root.style.display = 'flex';
    this.render();
  }

  public close(): void {
    this.visible = false;
    this.pinnedOpen = false;
    this.closeOnTabUp = false;
    this.root.style.display = 'none';
  }

  public isOpen(): boolean {
    return this.visible;
  }

  public update(): void {
    if (this.visible) {
      this.render();
    }
  }

  private render(): void {
    const mins = Math.floor(this.world.matchTime / 60);
    const secs = Math.floor(this.world.matchTime % 60);
    const modeLabel = this.world.gameMode === '5v5' ? '5v5 ĐẤU TRƯỜNG' : '1v1 SOLO MID';

    this.titleScore.innerHTML = `
      <div style="font-size:15px;font-weight:900;color:#38bdf8;">ĐỘI XANH (${this.world.blueKills})</div>
      <div style="font-size:14px;font-weight:800;color:#e2e8f0;text-align:center;">
        BẢNG ĐIỂM ${modeLabel} • ${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}
        <span style="font-size:11px;color:#94a3b8;font-weight:600;margin-left:6px;">(Tab để bật/tắt)</span>
      </div>
      <div style="font-size:15px;font-weight:900;color:#f43f5e;">(${this.world.redKills}) ĐỘI ĐỎ</div>
    `;

    const blues = this.world.championEids.filter((eid) => Team.id[eid] === TEAM_BLUE);
    const reds = this.world.championEids.filter((eid) => Team.id[eid] === TEAM_RED);

    this.blueCol.innerHTML = blues.map((eid) => this.renderRow(eid, true)).join('');
    this.redCol.innerHTML = reds.map((eid) => this.renderRow(eid, false)).join('');
  }

  private renderRow(eid: number, isBlue: boolean): string {
    const def = getChampionData(UnitType.subKind[eid]);
    const isPlayer = UnitType.isPlayer[eid] === 1;
    const isDead = UnitType.state[eid] === STATE_DEAD;
    const laneIdx =
      this.world.gameMode === '1v1' ? 1 : isPlayer ? def.suggestedLane : AI.lane[eid];
    const laneStr = LANE_TAG[laneIdx] ?? 'MID';
    const inv = this.world.inventories.get(eid) ?? [];

    let itemsHtml = '';
    for (let i = 0; i < MAX_INVENTORY_SLOTS; i++) {
      const it = inv[i] ? getItemById(inv[i]) : undefined;
      itemsHtml += `<span title="${it ? `${it.name}: ${it.shortBonus}` : 'Ô trống'}" style="width:26px;height:26px;border-radius:5px;border:1px solid ${
        it ? 'rgba(250,204,21,0.65)' : 'rgba(51,65,85,0.75)'
      };background:rgba(15,23,42,0.9);display:inline-flex;align-items:center;justify-content:center;">${
        it ? getItemIconSvg(it, 20) : ''
      }</span>`;
    }

    const border = isPlayer
      ? 'rgba(250,204,21,0.82)'
      : isBlue
        ? 'rgba(56,189,248,0.32)'
        : 'rgba(244,63,94,0.32)';

    const respawnTag = isDead
      ? ` <span style="color:#f87171;font-size:10px;font-weight:800;">(${Math.ceil(
          Math.max(0, UnitType.respawnTimer[eid])
        )}s)</span>`
      : '';

    return `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;margin-bottom:7px;border-radius:9px;background:rgba(15,23,42,0.88);border:1px solid ${border};opacity:${
        isDead ? '0.68' : '1'
      };">
        <div style="display:flex;align-items:center;gap:8px;min-width:146px;">
          <div style="width:30px;height:30px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            ${getChampionEmblemSvg(def, 28)}
          </div>
          <div>
            <div style="font-size:13px;font-weight:900;color:${
              isPlayer ? '#fde047' : isBlue ? '#7dd3fc' : '#fda4af'
            };">${def.name}${isPlayer ? ' (Bạn)' : ''}${respawnTag}</div>
            <div style="font-size:10px;color:#94a3b8;font-weight:700;">Lv.${Stats.level[eid]} • ${def.role} • ${laneStr}</div>
          </div>
        </div>
        <div style="text-align:center;min-width:86px;">
          <div style="font-size:12.5px;font-weight:800;color:#f8fafc;">K/D/A ${Stats.kills[eid]}/${Stats.deaths[eid]}/${Stats.assists[eid]}</div>
          <div style="font-size:10px;color:#fde047;font-weight:700;">CS ${Stats.cs[eid]} • ${Math.round(Stats.gold[eid])}g</div>
        </div>
        <div style="display:flex;gap:3px;flex-shrink:0;">${itemsHtml}</div>
      </div>
    `;
  }

  public dispose(): void {
    this.abortCtrl.abort();
    this.root.remove();
  }
}
