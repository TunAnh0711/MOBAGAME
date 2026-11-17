import * as THREE from 'three';
import {
  Stats,
  TEAM_BLUE,
  TEAM_RED,
  LANE_MID,
} from '../ecs/Components';
import {
  GameWorld,
  TURRET_SPECS,
  NEXUS_BLUE_POS,
  NEXUS_RED_POS,
  JUNGLE_CAMPS,
  type GameMode,
} from '../ecs/World';
import { EventBus } from './EventBus';
import { CameraController } from './CameraController';
import { InputManager } from './InputManager';
import { VisualFactory } from '../entities/VisualFactory';
import { NavigationSystem } from '../ecs/systems/NavigationSystem';
import { CombatSystem } from '../ecs/systems/CombatSystem';
import { SkillSystem } from '../ecs/systems/SkillSystem';
import { MinionAISystem } from '../ecs/systems/MinionAISystem';
import { BotAISystem, build5v5TeamRoster } from '../ecs/systems/BotAISystem';
import { TurretSystem } from '../ecs/systems/TurretSystem';
import { FogOfWarSystem } from '../ecs/systems/FogOfWarSystem';
import { FloatingBars } from '../ui/FloatingBars';
import { DamageNumbers } from '../ui/DamageNumbers';
import { SkillHUD } from '../ui/SkillHUD';
import { Minimap } from '../ui/Minimap';
import { ShopUI } from '../ui/ShopUI';
import { ScoreboardUI } from '../ui/ScoreboardUI';
import { ChampionSelectUI } from '../ui/ChampionSelectUI';

export const FIXED_STEP = 1 / 30; // 33.33ms fixed ECS simulation step
const PASSIVE_GOLD_PER_SEC = 2.5;

export class Engine {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private sunLight!: THREE.DirectionalLight;

  private bus!: EventBus;
  private world!: GameWorld;
  private visuals!: VisualFactory;
  private cameraCtrl!: CameraController;
  private nav!: NavigationSystem;
  private combat!: CombatSystem;
  private skills!: SkillSystem;
  private minionAI!: MinionAISystem;
  private botAI!: BotAISystem;
  private turret!: TurretSystem;
  private fog!: FogOfWarSystem;
  private input!: InputManager;

  private floatingBars!: FloatingBars;
  private damageNumbers!: DamageNumbers;
  private skillHUD!: SkillHUD;
  private minimap!: Minimap;
  private shopUI!: ShopUI;
  private scoreboardUI!: ScoreboardUI;
  private lobbyUI: ChampionSelectUI;

  private currentMode: GameMode = '5v5';
  private currentChampionId = 1;
  private isMatchActive = false;

  private rafId = 0;
  private lastTime = 0;
  private accumulator = 0;
  private elapsedRenderTime = 0;

  constructor(container: HTMLElement) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.domElement.style.display = 'block';
    this.container.appendChild(this.renderer.domElement);

    window.addEventListener('resize', this.handleResize);

    // Initialize clean preview backdrop behind Champion Select Lobby
    this.setupPreviewScene();

    this.lobbyUI = new ChampionSelectUI(this.container, (cfg) => {
      this.currentMode = cfg.mode;
      this.currentChampionId = cfg.championId;
      this.startMatch(cfg.mode, cfg.championId);
    });

    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.loop);
  }

  private handleResize = (): void => {
    if (!this.camera) return;
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  private setupPreviewScene(): void {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x09101d);
    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.5, 360);
    this.camera.position.set(-34, 46, 52);
    this.camera.lookAt(0, 0, 0);

    const hemi = new THREE.HemisphereLight(0x93c5fd, 0x0f172a, 0.95);
    this.scene.add(hemi);
    this.sunLight = new THREE.DirectionalLight(0xfffbeb, 1.5);
    this.sunLight.position.set(22, 48, 20);
    this.scene.add(this.sunLight);
  }

  public startMatch(mode: GameMode, championId: number): void {
    this.cleanupMatch();
    this.isMatchActive = true;
    this.currentMode = mode;
    this.currentChampionId = championId;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x09101d);

    this.camera = new THREE.PerspectiveCamera(
      45,
      window.innerWidth / window.innerHeight,
      0.5,
      360
    );

    const hemi = new THREE.HemisphereLight(0x93c5fd, 0x0f172a, 0.95);
    this.scene.add(hemi);

    this.sunLight = new THREE.DirectionalLight(0xfffbeb, 1.6);
    this.sunLight.position.set(22, 52, 20);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 5;
    this.sunLight.shadow.camera.far = 180;
    const d = 56;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0005;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    this.bus = new EventBus();
    this.world = new GameWorld(mode);
    this.visuals = new VisualFactory(this.scene, this.world, this.bus);
    this.cameraCtrl = new CameraController(
      this.camera,
      this.renderer.domElement,
      this.world,
      this.bus
    );

    this.nav = new NavigationSystem(this.world);
    this.combat = new CombatSystem(this.world, this.bus, this.nav);
    this.skills = new SkillSystem(this.world, this.bus, this.combat);
    this.minionAI = new MinionAISystem(this.world, this.nav, this.bus);
    this.botAI = new BotAISystem(this.world, this.nav, this.skills, this.bus);
    this.turret = new TurretSystem(this.world, this.bus, this.scene);
    this.fog = new FogOfWarSystem(this.world, this.scene);

    this.input = new InputManager(
      this.renderer.domElement,
      this.world,
      this.nav,
      this.skills,
      this.visuals,
      this.cameraCtrl,
      this.bus
    );

    this.shopUI = new ShopUI(this.container, this.world, this.bus, (isOpen) => {
      if (this.input) this.input.blockedByModal = isOpen;
      if (this.cameraCtrl) this.cameraCtrl.blockedByModal = isOpen;
    });
    this.scoreboardUI = new ScoreboardUI(this.container, this.world);

    this.floatingBars = new FloatingBars(this.container, this.world, this.camera);
    this.damageNumbers = new DamageNumbers(this.container, this.camera, this.bus, this.world);
    this.skillHUD = new SkillHUD(
      this.container,
      this.world,
      this.input,
      this.skills,
      this.cameraCtrl,
      this.bus,
      () => this.shopUI.toggle(),
      () => this.startMatch(this.currentMode, this.currentChampionId),
      () => this.returnToLobby(),
      () => this.scoreboardUI.toggle()
    );
    this.minimap = new Minimap(
      this.container,
      this.world,
      this.fog,
      this.cameraCtrl,
      this.nav,
      this.bus
    );

    this.bus.on('matchEnd', () => {
      if (this.shopUI?.isShopOpen()) {
        this.shopUI.close();
      }
      if (this.scoreboardUI?.isOpen()) {
        this.scoreboardUI.close();
      }
    });

    this.spawnInitialEntities(mode, championId);
    this.cameraCtrl.snapToPlayer();
    this.cameraCtrl.update(0.016);
    this.fog.update(0.15);
    this.visuals.syncWorldVisuals(1, 0, 0.016);

    this.bus.emit('announcement', {
      text:
        mode === '5v5'
          ? 'CHÀO MỪNG ĐẾN VỚI AETHER RIFT 5v5 (240x240)!'
          : 'CHẾ ĐỘ SOLO 1v1 ĐƯỜNG GIỮA BẮT ĐẦU!',
      color: '#38bdf8',
    });
  }

  public returnToLobby(): void {
    this.cleanupMatch();
    this.isMatchActive = false;
    this.setupPreviewScene();
    this.lobbyUI.show();
  }

  private spawnInitialEntities(mode: GameMode, playerChampId: number): void {
    // 1. Nexuses
    this.world.spawnNexus(TEAM_BLUE, NEXUS_BLUE_POS.x, NEXUS_BLUE_POS.z);
    this.world.spawnNexus(TEAM_RED, NEXUS_RED_POS.x, NEXUS_RED_POS.z);

    // 2. Turrets (22 total in 5v5: 11 Blue + 11 Red; Mid + Nexus Guards in 1v1)
    for (const spec of TURRET_SPECS) {
      if (mode === '1v1' && spec.lane !== LANE_MID) continue;
      this.world.spawnTurret(spec);
    }

    // 3. Neutral Jungle Camps (6 camps in 5v5)
    if (mode === '5v5') {
      for (const camp of JUNGLE_CAMPS) {
        this.world.spawnJungleMonster(camp.id, camp.x, camp.z);
      }
    }

    if (mode === '1v1') {
      // 1v1 Mid Duel
      this.world.spawnChampion(playerChampId, TEAM_BLUE, -86, 86, LANE_MID, true);
      const enemyId = (playerChampId + 4) % 5;
      this.world.spawnChampion(enemyId, TEAM_RED, 86, -86, LANE_MID, false);
      return;
    }

    // 4. 5v5 Roster: 2 Top, 1 Mid, 2 Bot on BOTH Blue & Red Teams (all 5 unique champions per team)
    const blueRoster = build5v5TeamRoster(TEAM_BLUE, playerChampId);
    for (const slot of blueRoster) {
      this.world.spawnChampion(
        slot.champId,
        TEAM_BLUE,
        slot.x,
        slot.z,
        slot.lane,
        slot.isPlayer
      );
    }

    const redRoster = build5v5TeamRoster(TEAM_RED, playerChampId);
    for (const slot of redRoster) {
      this.world.spawnChampion(
        slot.champId,
        TEAM_RED,
        slot.x,
        slot.z,
        slot.lane,
        false
      );
    }
  }

  private cleanupMatch(): void {
    if (this.input) this.input.dispose();
    if (this.cameraCtrl) this.cameraCtrl.dispose();
    if (this.shopUI) this.shopUI.dispose();
    if (this.scoreboardUI) this.scoreboardUI.dispose();
    if (this.floatingBars) {
      this.floatingBars.clear();
      this.floatingBars.dispose();
    }
    if (this.damageNumbers) {
      this.damageNumbers.clear();
      this.damageNumbers.dispose();
    }
    if (this.skillHUD) this.skillHUD.dispose();
    if (this.minimap) this.minimap.dispose();
    if (this.turret) this.turret.dispose();
    if (this.fog) this.fog.dispose();
    if (this.visuals) this.visuals.dispose();
    if (this.bus) this.bus.clear();

    if (this.world) {
      this.world.visuals.clear();
      this.world.hitMeshes.length = 0;
      this.world.hitMeshByEid.clear();
      this.world.entityPaths.clear();
      this.world.inventories.clear();
      this.world.projectileHits.clear();
      this.world.championEids.length = 0;
      this.world.playerEid = -1;
    }

    if (this.scene) {
      this.scene.clear();
    }

    this.accumulator = 0;
  }

  private loop = (now: number): void => {
    this.rafId = requestAnimationFrame(this.loop);

    const rawDt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    const frameDt = Math.min(rawDt, 0.25);
    this.elapsedRenderTime += frameDt;

    if (!this.isMatchActive) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    this.accumulator += frameDt;

    // 30Hz Fixed Simulation Step (33.33ms)
    while (this.accumulator >= FIXED_STEP) {
      this.world.snapshotTransforms();
      if (!this.world.matchEnded) {
        this.world.matchTime += FIXED_STEP;
        // Gentle MOBA passive gold income once minions start marching
        if (this.world.matchTime >= 2.0) {
          for (let i = 0; i < this.world.championEids.length; i++) {
            Stats.gold[this.world.championEids[i]] += PASSIVE_GOLD_PER_SEC * FIXED_STEP;
          }
        }
      }
      this.minionAI.update(FIXED_STEP);
      this.botAI.update(FIXED_STEP);
      this.turret.update(FIXED_STEP);
      this.skills.update(FIXED_STEP);
      this.combat.update(FIXED_STEP);
      this.nav.update(FIXED_STEP);
      this.fog.update(FIXED_STEP);
      this.accumulator -= FIXED_STEP;
    }

    // Smooth Render Interpolation Step
    const alpha = this.accumulator / FIXED_STEP;
    this.visuals.syncWorldVisuals(alpha, this.elapsedRenderTime, frameDt);
    this.turret.updateLaserVisuals(this.elapsedRenderTime);
    this.cameraCtrl.update(frameDt);
    this.input.updateFrame();

    this.sunLight.position.set(
      this.cameraCtrl.focusX + 22,
      52,
      this.cameraCtrl.focusZ + 20
    );
    this.sunLight.target.position.set(this.cameraCtrl.focusX, 0, this.cameraCtrl.focusZ);
    this.sunLight.target.updateMatrixWorld();

    this.floatingBars.update();
    this.damageNumbers.update(frameDt);
    this.skillHUD.update(frameDt);
    this.shopUI.update();
    this.scoreboardUI.update();
    this.minimap.update();

    this.renderer.render(this.scene, this.camera);
  };

  public destroy(): void {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.handleResize);
    this.lobbyUI.dispose();
    this.cleanupMatch();
    this.renderer.dispose();
  }
}
