import * as THREE from 'three';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import {
  Transform,
  Movement,
  Team,
  UnitType,
  Stats,
  StatusEffects,
  Combat,
  SkillBook,
  UNIT_CHAMPION,
  UNIT_MINION,
  UNIT_MONSTER,
} from '../ecs/Components';
import { GameWorld, NEXUS_BLUE_POS } from '../ecs/World';
import { NavigationSystem } from '../ecs/systems/NavigationSystem';
import { SkillSystem } from '../ecs/systems/SkillSystem';
import { VisualFactory } from '../entities/VisualFactory';
import { getChampionDef, SUMMONER_SPELLS, type SkillKind } from '../entities/ChampionDefs';
import { CameraController } from './CameraController';
import { EventBus, SkillSlot } from './EventBus';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export type AimMode = 'none' | SkillSlot | 'A';

export const INTERACTIVE_UI_CLASS = 'moba-ui-interactive';

/**
 * Marks a HUD/UI element as interactive and isolates all mouse/pointer events
 * so clicks, right-clicks, and wheel scrolls never bleed through to the 3D canvas.
 */
export function isolateUIElement(el: HTMLElement): void {
  el.classList.add(INTERACTIVE_UI_CLASS);
  const stop = (e: Event): void => {
    e.stopPropagation();
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName;
    const isFormInput =
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      tag === 'OPTION' ||
      tag === 'LABEL' ||
      target?.isContentEditable === true;
    if (e.type === 'contextmenu') {
      e.preventDefault();
    } else if (
      !isFormInput &&
      (e.type === 'pointerdown' ||
        e.type === 'mousedown' ||
        e.type === 'mouseup' ||
        e.type === 'click')
    ) {
      e.preventDefault();
    }
  };
  for (const ev of ['pointerdown', 'mousedown', 'mouseup', 'click', 'contextmenu', 'wheel'] as const) {
    el.addEventListener(ev, stop);
  }
}

const CODE_TO_KEY: Record<string, string> = {
  KeyQ: 'Q',
  KeyW: 'W',
  KeyE: 'E',
  KeyR: 'R',
  KeyD: 'D',
  KeyF: 'F',
  KeyA: 'A',
  KeyS: 'S',
  KeyB: 'B',
  KeyY: 'Y',
  Digit1: '1',
  Digit2: '2',
  Digit3: '3',
  Digit4: '4',
};

export class InputManager {
  private world: GameWorld;
  private nav: NavigationSystem;
  private skills: SkillSystem;
  private visuals: VisualFactory;
  private cameraCtrl: CameraController;
  private bus: EventBus;
  private domElement: HTMLCanvasElement;

  private raycaster = new THREE.Raycaster();
  private pointerNDC = new THREE.Vector2(0, 0);
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private abortCtrl = new AbortController();

  public cursorWorldX = NEXUS_BLUE_POS.x + 12;
  public cursorWorldZ = NEXUS_BLUE_POS.z - 12;
  public hoveredEnemyEid = -1;
  public hoveredSkillSlot: SkillSlot | null = null;
  public aimMode: AimMode = 'none';
  public blockedByModal = false;

  constructor(
    canvas: HTMLCanvasElement,
    world: GameWorld,
    nav: NavigationSystem,
    skills: SkillSystem,
    visuals: VisualFactory,
    cameraCtrl: CameraController,
    bus: EventBus
  ) {
    this.domElement = canvas;
    this.world = world;
    this.nav = nav;
    this.skills = skills;
    this.visuals = visuals;
    this.cameraCtrl = cameraCtrl;
    this.bus = bus;
    this.raycaster.firstHitOnly = true;

    this.bindEvents();
  }

  private updatePointerFromClient(clientX: number, clientY: number): void {
    const rect = this.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    this.pointerNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  }

  private normalizeKey(e: KeyboardEvent): string {
    return CODE_TO_KEY[e.code] ?? e.key.toUpperCase();
  }

  private bindEvents(): void {
    const signal = this.abortCtrl.signal;

    this.domElement.addEventListener(
      'contextmenu',
      (e) => {
        if ((e.target as HTMLElement | null)?.closest('.moba-ui-interactive')) return;
        if (e.target !== this.domElement) return;
        e.preventDefault();
      },
      { signal }
    );

    this.domElement.addEventListener(
      'pointerdown',
      (e) => {
        if ((e.target as HTMLElement | null)?.closest('.moba-ui-interactive')) return;
        if (e.target !== this.domElement) return;
      },
      { signal }
    );

    this.domElement.addEventListener(
      'mouseup',
      (e) => {
        if ((e.target as HTMLElement | null)?.closest('.moba-ui-interactive')) return;
        if (e.target !== this.domElement) return;
      },
      { signal }
    );

    window.addEventListener(
      'mousemove',
      (e) => {
        const target = e.target as HTMLElement | null;
        if (target?.closest('.moba-ui-interactive') || e.target !== this.domElement) {
          this.hoveredEnemyEid = -1;
          return;
        }
        this.updatePointerFromClient(e.clientX, e.clientY);
        this.raycastCursor();
      },
      { signal }
    );

    this.domElement.addEventListener(
      'mousedown',
      (e) => {
        if ((e.target as HTMLElement | null)?.closest('.moba-ui-interactive')) return;
        if (e.target !== this.domElement) return;

        this.updatePointerFromClient(e.clientX, e.clientY);
        this.raycastCursor();

        const pid = this.world.playerEid;
        if (pid < 0 || this.world.matchEnded || this.blockedByModal) return;

        if (e.button === 2) {
          e.preventDefault();
          if (this.aimMode !== 'none') {
            const wasSkillAim = this.aimMode !== 'A';
            this.aimMode = 'none';
            if (wasSkillAim) return;
          }
          if (!this.world.isAliveUnit(pid) || this.skills.isChanneling(pid)) return;

          if (this.hoveredEnemyEid >= 0) {
            const target = this.hoveredEnemyEid;
            Combat.targetEid[pid] = target;
            Movement.attackMove[pid] = 0;
            SkillBook.isRecalling[pid] = 0;
            SkillBook.recallTimer[pid] = 0;

            const dist = Math.hypot(
              Transform.x[target] - Transform.x[pid],
              Transform.z[target] - Transform.z[pid]
            );
            if (
              dist > Combat.attackRange[pid] + Transform.radius[target] &&
              StatusEffects.rootTimer[pid] <= 0
            ) {
              this.nav.commandMoveTo(pid, Transform.x[target], Transform.z[target], false);
            } else {
              Movement.hasTarget[pid] = 0;
              Movement.vx[pid] = 0;
              Movement.vz[pid] = 0;
              this.world.entityPaths.delete(pid);
            }

            this.bus.emit('clickMarker', {
              x: Transform.x[target],
              z: Transform.z[target],
              kind: 'attack',
            });
          } else {
            Combat.targetEid[pid] = -1;
            Combat.isWindingUp[pid] = 0;
            if (StatusEffects.rootTimer[pid] <= 0) {
              this.nav.commandMoveTo(pid, this.cursorWorldX, this.cursorWorldZ, false);
            }
            this.bus.emit('clickMarker', {
              x: this.cursorWorldX,
              z: this.cursorWorldZ,
              kind: 'move',
            });
          }
        } else if (e.button === 0) {
          if (!this.world.isAliveUnit(pid) || this.skills.isChanneling(pid)) return;

          if (this.aimMode === 'A') {
            if (this.hoveredEnemyEid >= 0) {
              const target = this.hoveredEnemyEid;
              Combat.targetEid[pid] = target;
              Movement.attackMove[pid] = 0;
              SkillBook.isRecalling[pid] = 0;
              SkillBook.recallTimer[pid] = 0;
              this.bus.emit('clickMarker', {
                x: Transform.x[target],
                z: Transform.z[target],
                kind: 'attack',
              });
            } else {
              Combat.targetEid[pid] = -1;
              Combat.isWindingUp[pid] = 0;
              if (StatusEffects.rootTimer[pid] <= 0) {
                this.nav.commandMoveTo(pid, this.cursorWorldX, this.cursorWorldZ, true);
              }
              this.bus.emit('clickMarker', {
                x: this.cursorWorldX,
                z: this.cursorWorldZ,
                kind: 'attackMove',
              });
            }
            this.aimMode = 'none';
          } else if (
            this.aimMode === 'Q' ||
            this.aimMode === 'W' ||
            this.aimMode === 'E' ||
            this.aimMode === 'R' ||
            this.aimMode === 'D' ||
            this.aimMode === 'F'
          ) {
            this.skills.castSkill(pid, this.aimMode, this.cursorWorldX, this.cursorWorldZ);
            this.aimMode = 'none';
          }
        }
      },
      { signal }
    );

    window.addEventListener(
      'keydown',
      (e) => {
        if (e.repeat) return;
        const activeTag = document.activeElement?.tagName;
        if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;

        if (e.key === 'Escape') {
          this.aimMode = 'none';
          return;
        }

        const pid = this.world.playerEid;
        if (pid < 0 || this.world.matchEnded || this.blockedByModal) return;

        const key = this.normalizeKey(e);

        if (e.code === 'Space') {
          e.preventDefault();
          this.cameraCtrl.spaceHeld = true;
          return;
        }

        if (key === 'Y') {
          this.cameraCtrl.toggleLock();
          return;
        }

        // Level up skills via 1-4 or Ctrl+Q/W/E/R
        if (key === '1' || (e.ctrlKey && key === 'Q')) {
          e.preventDefault();
          this.skills.upgradeSkill(pid, 'Q');
          return;
        }
        if (key === '2' || (e.ctrlKey && key === 'W')) {
          e.preventDefault();
          this.skills.upgradeSkill(pid, 'W');
          return;
        }
        if (key === '3' || (e.ctrlKey && key === 'E')) {
          e.preventDefault();
          this.skills.upgradeSkill(pid, 'E');
          return;
        }
        if (key === '4' || (e.ctrlKey && key === 'R')) {
          e.preventDefault();
          this.skills.upgradeSkill(pid, 'R');
          return;
        }

        if (!this.world.isAliveUnit(pid)) return;

        if (key === 'S') {
          Movement.hasTarget[pid] = 0;
          Movement.attackMove[pid] = 2; // Hold/Stop: prevent idle auto-reacquire until next command
          Movement.vx[pid] = 0;
          Movement.vz[pid] = 0;
          Combat.targetEid[pid] = -1;
          Combat.isWindingUp[pid] = 0;
          SkillBook.isRecalling[pid] = 0;
          SkillBook.recallTimer[pid] = 0;
          this.world.entityPaths.delete(pid);
          this.aimMode = 'none';
          return;
        }

        if (key === 'B') {
          this.aimMode = 'none';
          this.skills.startRecall(pid);
          return;
        }

        if (key === 'A') {
          this.aimMode = 'A';
          return;
        }

        // Quick Cast on Q / W / E / R / D / F immediately toward cursor world point
        if (key === 'Q' || key === 'W' || key === 'E' || key === 'R' || key === 'D' || key === 'F') {
          this.raycastCursor();
          this.aimMode = 'none';
          this.skills.castSkill(pid, key, this.cursorWorldX, this.cursorWorldZ);
        }
      },
      { signal }
    );

    window.addEventListener(
      'keyup',
      (e) => {
        if (e.code === 'Space') {
          this.cameraCtrl.spaceHeld = false;
        }
      },
      { signal }
    );

    window.addEventListener(
      'blur',
      () => {
        this.cameraCtrl.spaceHeld = false;
        this.aimMode = 'none';
        this.hoveredSkillSlot = null;
      },
      { signal }
    );
  }

  public dispose(): void {
    this.abortCtrl.abort();
  }

  public triggerSlotFromUI(slot: SkillSlot | 'B'): void {
    const pid = this.world.playerEid;
    if (pid < 0 || !this.world.isAliveUnit(pid) || this.world.matchEnded || this.blockedByModal) {
      return;
    }

    if (slot === 'B') {
      this.aimMode = 'none';
      this.skills.startRecall(pid);
      return;
    }
    if (slot === 'F') {
      this.aimMode = 'none';
      this.skills.castSkill(pid, 'F', Transform.x[pid], Transform.z[pid]);
      return;
    }

    if (!this.canStartSkillAim(pid, slot)) return;

    if (slot !== 'D') {
      const def = getChampionDef(UnitType.subKind[pid]);
      const sk = def.skills[slot];
      const isRRecast = slot === 'R' && this.skills.isRecastReady(pid, 'R');
      // Instant self-buff / self-empower abilities cast immediately when clicked on HUD
      if (!isRRecast && (sk.kind === 'self_buff_pulse' || sk.kind === 'self_empower' || sk.range <= 0)) {
        this.aimMode = 'none';
        this.skills.castSkill(pid, slot, this.cursorWorldX, this.cursorWorldZ);
        return;
      }
    }

    this.aimMode = this.aimMode === slot ? 'none' : slot;
  }

  private canStartSkillAim(eid: number, slot: 'Q' | 'W' | 'E' | 'R' | 'D'): boolean {
    if (StatusEffects.stunTimer[eid] > 0 || this.skills.isChanneling(eid)) return false;
    if (slot === 'D') {
      if (StatusEffects.rootTimer[eid] > 0) return false;
      return SkillBook.dCd[eid] <= 0;
    }

    const def = getChampionDef(UnitType.subKind[eid]);
    const skill = def.skills[slot];

    if (
      StatusEffects.rootTimer[eid] > 0 &&
      (skill.isDash || skill.kind === 'dash' || skill.kind === 'targeted_blink')
    ) {
      return false;
    }

    // VALKYRIE R2 active recast requires 0 mana and is ready while rRecastTimer > 0
    if (this.skills.isRecastReady(eid, slot)) {
      return true;
    }

    const cd =
      slot === 'Q'
        ? SkillBook.qCd[eid]
        : slot === 'W'
          ? SkillBook.wCd[eid]
          : slot === 'E'
            ? SkillBook.eCd[eid]
            : SkillBook.rCd[eid];
    const rank =
      slot === 'Q'
        ? SkillBook.qLevel[eid]
        : slot === 'W'
          ? SkillBook.wLevel[eid]
          : slot === 'E'
            ? SkillBook.eLevel[eid]
            : SkillBook.rLevel[eid];
    return rank > 0 && cd <= 0 && Stats.mp[eid] >= skill.manaCost;
  }

  public raycastCursor(): void {
    this.raycaster.setFromCamera(this.pointerNDC, this.cameraCtrl.camera);
    const playerTeam = this.world.getPlayerTeam();

    // 1. BVH Raycast against enemy hitboxes (firstHitOnly = true)
    let foundEnemy = -1;
    if (this.world.hitMeshes.length > 0) {
      const hits = this.raycaster.intersectObjects(this.world.hitMeshes, false);
      for (let i = 0; i < hits.length; i++) {
        const eid = hits[i].object.userData?.eid as number | undefined;
        if (eid === undefined || !this.world.isAliveUnit(eid)) continue;
        if (Team.id[eid] === playerTeam) continue;
        if (StatusEffects.untargetableTimer[eid] > 0) continue;
        if (
          (UnitType.kind[eid] === UNIT_CHAMPION ||
            UnitType.kind[eid] === UNIT_MINION ||
            UnitType.kind[eid] === UNIT_MONSTER) &&
          !this.world.isVisibleToPlayer(eid)
        ) {
          continue;
        }
        foundEnemy = eid;
        break;
      }
    }
    this.hoveredEnemyEid = foundEnemy;

    // 2. BVH Raycast against terrain mesh
    const groundHits = this.raycaster.intersectObject(this.visuals.groundMesh, false);
    if (groundHits.length > 0) {
      this.cursorWorldX = groundHits[0].point.x;
      this.cursorWorldZ = groundHits[0].point.z;
    } else {
      const planeHit = new THREE.Vector3();
      if (this.raycaster.ray.intersectPlane(this.groundPlane, planeHit)) {
        this.cursorWorldX = planeHit.x;
        this.cursorWorldZ = planeHit.z;
      }
    }
  }

  public updateFrame(): void {
    const pid = this.world.playerEid;
    if (pid < 0 || !this.world.isAliveUnit(pid)) {
      this.visuals.updateSkillIndicators({
        mode: 'none',
        playerX: 0,
        playerZ: 0,
        cursorX: 0,
        cursorZ: 0,
        range: 1,
        aoeRadius: 1,
        color: 0x38bdf8,
        hoveredEid: -1,
      });
      this.domElement.style.cursor = 'default';
      return;
    }

    const vis = this.world.visuals.get(pid);
    const px = vis ? vis.position.x : Transform.x[pid];
    const pz = vis ? vis.position.z : Transform.z[pid];

    let activeMode: AimMode = 'none';
    if (this.aimMode !== 'none') {
      activeMode = this.aimMode;
    } else if (this.hoveredSkillSlot !== null) {
      activeMode = this.hoveredSkillSlot;
    } else if (this.cameraCtrl.spaceHeld) {
      activeMode = 'A';
    }

    let range = 1;
    let aoeRadius = 1;
    let color = 0x38bdf8;
    let skillKind: SkillKind | undefined;
    const def = getChampionDef(UnitType.subKind[pid]);

    if (activeMode === 'Q' || activeMode === 'W' || activeMode === 'E' || activeMode === 'R') {
      const sk = def.skills[activeMode];
      const isRRecast = activeMode === 'R' && this.skills.isRecastReady(pid, 'R');
      if (isRRecast) {
        range = sk.range > 0 ? sk.range : 18.0;
        aoeRadius = (sk.width ?? 3.5) * 0.5;
        color = sk.color;
        skillKind = 'channeled_beam';
      } else {
        range = sk.range > 0 ? sk.range : sk.radius;
        aoeRadius = sk.kind === 'channeled_beam' ? (sk.width ?? 2.5) * 0.5 : sk.radius;
        color = sk.color;
        skillKind = sk.kind;
      }
    } else if (activeMode === 'D') {
      range = SUMMONER_SPELLS.D.range;
      aoeRadius = 1.0;
      color = SUMMONER_SPELLS.D.color;
      skillKind = 'dash';
    } else if (activeMode === 'F') {
      range = SUMMONER_SPELLS.F.range > 0 ? SUMMONER_SPELLS.F.range : 3.2;
      aoeRadius = 1.0;
      color = SUMMONER_SPELLS.F.color;
    } else if (activeMode === 'A') {
      range = Combat.attackRange[pid];
      aoeRadius = 1;
      color = this.aimMode === 'A' ? 0xf43f5e : 0x38bdf8;
    }

    this.visuals.updateSkillIndicators({
      mode: activeMode,
      skillKind,
      playerX: px,
      playerZ: pz,
      cursorX: this.cursorWorldX,
      cursorZ: this.cursorWorldZ,
      range,
      aoeRadius,
      color,
      hoveredEid: this.hoveredEnemyEid,
    });

    this.domElement.style.cursor =
      this.aimMode !== 'none'
        ? 'crosshair'
        : this.hoveredEnemyEid >= 0
          ? 'pointer'
          : 'default';
  }
}
