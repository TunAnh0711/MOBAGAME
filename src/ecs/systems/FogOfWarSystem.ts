import * as THREE from 'three';
import { query, hasComponent } from 'bitecs';
import {
  Transform,
  Team,
  UnitType,
  StatusEffects,
  Vision,
  STATE_ALIVE,
  TEAM_BLUE,
  TEAM_RED,
  UNIT_CHAMPION,
  UNIT_MINION,
  UNIT_TURRET,
  UNIT_NEXUS,
  UNIT_MONSTER,
} from '../Components';
import {
  GameWorld,
  MAP_HALF_SIZE,
  MAP_SIZE,
  MAP_BRUSHES,
  TURRET_TRUE_SIGHT_RANGE,
} from '../World';

export const FOW_GRID_SIZE = 128;
export const FOW_UNEXPLORED = 0;
export const FOW_EXPLORED = 128;
export const FOW_VISIBLE = 255;

export class FogOfWarSystem {
  private world: GameWorld;
  public blueGrid: Uint8Array;
  public redGrid: Uint8Array;
  private cellBrushIndex: Int16Array;
  private smoothFog: Float32Array;
  private rgbaData: Uint8Array;
  public fogTexture: THREE.DataTexture;
  public fogOverlayMesh: THREE.Mesh;
  private firstUpdate = true;

  constructor(world: GameWorld, scene: THREE.Scene) {
    this.world = world;
    const total = FOW_GRID_SIZE * FOW_GRID_SIZE;
    this.blueGrid = new Uint8Array(total);
    this.redGrid = new Uint8Array(total);
    this.cellBrushIndex = new Int16Array(total);
    this.cellBrushIndex.fill(-1);
    this.smoothFog = new Float32Array(total);
    this.smoothFog.fill(0.94); // Unexplored starts black until first vision pass
    this.rgbaData = new Uint8Array(total * 4);

    // Precompute brush membership for each 128x128 cell covering 240x240 arena
    const cellSize = MAP_SIZE / FOW_GRID_SIZE;
    for (let gz = 0; gz < FOW_GRID_SIZE; gz++) {
      const cz = -MAP_HALF_SIZE + (gz + 0.5) * cellSize;
      for (let gx = 0; gx < FOW_GRID_SIZE; gx++) {
        const cx = -MAP_HALF_SIZE + (gx + 0.5) * cellSize;
        for (let b = 0; b < MAP_BRUSHES.length; b++) {
          const brush = MAP_BRUSHES[b];
          const dx = cx - brush.x;
          const dz = cz - brush.z;
          if (dx * dx + dz * dz <= brush.radius * brush.radius) {
            this.cellBrushIndex[gz * FOW_GRID_SIZE + gx] = b;
            break;
          }
        }
      }
    }

    this.fogTexture = new THREE.DataTexture(
      this.rgbaData,
      FOW_GRID_SIZE,
      FOW_GRID_SIZE,
      THREE.RGBAFormat,
      THREE.UnsignedByteType
    );
    this.fogTexture.minFilter = THREE.LinearFilter;
    this.fogTexture.magFilter = THREE.LinearFilter;
    this.fogTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.fogTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.fogTexture.flipY = false;
    this.fogTexture.needsUpdate = true;

    const geom = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, 1, 1);
    geom.rotateX(-Math.PI / 2);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uFogTex: { value: this.fogTexture },
        uMapSize: { value: MAP_SIZE },
        uHalfSize: { value: MAP_HALF_SIZE },
      },
      vertexShader: `
        varying vec2 vWorldXZ;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldXZ = wp.xz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform sampler2D uFogTex;
        uniform float uMapSize;
        uniform float uHalfSize;
        varying vec2 vWorldXZ;
        void main() {
          vec2 uv = clamp((vWorldXZ + uHalfSize) / uMapSize, 0.0, 1.0);
          vec4 fog = texture2D(uFogTex, uv);
          gl_FragColor = vec4(fog.rgb, fog.a);
        }
      `,
      transparent: true,
      depthWrite: false,
    });

    this.fogOverlayMesh = new THREE.Mesh(geom, mat);
    this.fogOverlayMesh.position.y = 0.09;
    this.fogOverlayMesh.renderOrder = 25;
    scene.add(this.fogOverlayMesh);
  }

  public update(dt: number): void {
    const total = FOW_GRID_SIZE * FOW_GRID_SIZE;
    // Downgrade currently visible (255) -> explored (128); unexplored (0) stays 0
    for (let i = 0; i < total; i++) {
      if (this.blueGrid[i] === FOW_VISIBLE) this.blueGrid[i] = FOW_EXPLORED;
      if (this.redGrid[i] === FOW_VISIBLE) this.redGrid[i] = FOW_EXPLORED;
    }

    const viewers = query(this.world.ecs, [Transform, Team, UnitType, Vision]);
    const cellSize = MAP_SIZE / FOW_GRID_SIZE;

    const blueSources: number[] = [];
    const redSources: number[] = [];
    const blueTrueSight: number[] = [];
    const redTrueSight: number[] = [];
    const blueOccupiedBrushes = new Uint8Array(MAP_BRUSHES.length);
    const redOccupiedBrushes = new Uint8Array(MAP_BRUSHES.length);
    const blueBrushRevealed = new Uint8Array(MAP_BRUSHES.length);
    const redBrushRevealed = new Uint8Array(MAP_BRUSHES.length);

    // 1. Refresh bush membership, decay bushRevealTimer, and collect team vision + true-sight sources
    for (let i = 0; i < viewers.length; i++) {
      const eid = viewers[i];
      if (Vision.bushRevealTimer[eid] > 0) {
        Vision.bushRevealTimer[eid] = Math.max(0, Vision.bushRevealTimer[eid] - dt);
      }

      if (UnitType.state[eid] !== STATE_ALIVE) {
        Vision.inBrushId[eid] = -1;
        UnitType.inBrush[eid] = 0;
        continue;
      }

      const kind = UnitType.kind[eid];
      const team = Team.id[eid];
      const wx = Transform.x[eid];
      const wz = Transform.z[eid];

      const brushId =
        kind === UNIT_CHAMPION || kind === UNIT_MINION || kind === UNIT_MONSTER
          ? this.world.findBrushAt(wx, wz)
          : -1;
      Vision.inBrushId[eid] = brushId;
      UnitType.inBrush[eid] = brushId >= 0 ? 1 : 0;

      if (team === TEAM_BLUE) {
        blueSources.push(eid);
        if (brushId >= 0) {
          blueOccupiedBrushes[brushId] = 1;
          blueBrushRevealed[brushId] = 1;
        }
        if (kind === UNIT_TURRET || kind === UNIT_NEXUS) {
          blueTrueSight.push(eid);
          this.markBrushesWithinRadius(wx, wz, TURRET_TRUE_SIGHT_RANGE, blueBrushRevealed);
        }
      } else if (team === TEAM_RED) {
        redSources.push(eid);
        if (brushId >= 0) {
          redOccupiedBrushes[brushId] = 1;
          redBrushRevealed[brushId] = 1;
        }
        if (kind === UNIT_TURRET || kind === UNIT_NEXUS) {
          redTrueSight.push(eid);
          this.markBrushesWithinRadius(wx, wz, TURRET_TRUE_SIGHT_RANGE, redBrushRevealed);
        }
      }
    }

    // Reveal bush on fog texture when an opposing unit inside it attacks (bushRevealTimer > 0) within team vision
    for (let i = 0; i < viewers.length; i++) {
      const eid = viewers[i];
      if (UnitType.state[eid] !== STATE_ALIVE) continue;
      const brushId = Vision.inBrushId[eid];
      if (brushId < 0 || Vision.bushRevealTimer[eid] <= 0) continue;

      const team = Team.id[eid];
      const wx = Transform.x[eid];
      const wz = Transform.z[eid];
      if (team !== TEAM_BLUE && this.hasVisionCoverage(wx, wz, blueSources)) {
        blueBrushRevealed[brushId] = 1;
      }
      if (team !== TEAM_RED && this.hasVisionCoverage(wx, wz, redSources)) {
        redBrushRevealed[brushId] = 1;
      }
    }

    // 2. Paint team Fog of War grids
    for (let i = 0; i < viewers.length; i++) {
      const eid = viewers[i];
      if (UnitType.state[eid] !== STATE_ALIVE) continue;

      const team = Team.id[eid];
      if (team !== TEAM_BLUE && team !== TEAM_RED) continue;

      const range = Vision.range[eid];
      const wx = Transform.x[eid];
      const wz = Transform.z[eid];
      const grid = team === TEAM_BLUE ? this.blueGrid : this.redGrid;
      const revealedBrushes = team === TEAM_BLUE ? blueBrushRevealed : redBrushRevealed;

      const minGx = Math.max(
        0,
        Math.floor(((wx - range + MAP_HALF_SIZE) / MAP_SIZE) * FOW_GRID_SIZE)
      );
      const maxGx = Math.min(
        FOW_GRID_SIZE - 1,
        Math.ceil(((wx + range + MAP_HALF_SIZE) / MAP_SIZE) * FOW_GRID_SIZE)
      );
      const minGz = Math.max(
        0,
        Math.floor(((wz - range + MAP_HALF_SIZE) / MAP_SIZE) * FOW_GRID_SIZE)
      );
      const maxGz = Math.min(
        FOW_GRID_SIZE - 1,
        Math.ceil(((wz + range + MAP_HALF_SIZE) / MAP_SIZE) * FOW_GRID_SIZE)
      );

      const rSq = range * range;
      for (let gz = minGz; gz <= maxGz; gz++) {
        const cz = -MAP_HALF_SIZE + (gz + 0.5) * cellSize;
        const dz = cz - wz;
        for (let gx = minGx; gx <= maxGx; gx++) {
          const cx = -MAP_HALF_SIZE + (gx + 0.5) * cellSize;
          const dx = cx - wx;
          if (dx * dx + dz * dz <= rSq) {
            const cellIdx = gz * FOW_GRID_SIZE + gx;
            const brushIdx = this.cellBrushIndex[cellIdx];
            if (brushIdx < 0 || revealedBrushes[brushIdx] === 1) {
              grid[cellIdx] = FOW_VISIBLE;
            } else if (grid[cellIdx] === FOW_UNEXPLORED) {
              // Keep unentered stealth brushes darkened as explored (128), not visible (255)
              grid[cellIdx] = FOW_EXPLORED;
            }
          }
        }
      }
    }

    // 3. Determine unit visibility for both teams (with Bush Stealth + 1.5s Attack Reveal + Invisibility + Turret True Sight)
    const pTeam = this.world.getPlayerTeam();

    for (let i = 0; i < viewers.length; i++) {
      const eid = viewers[i];
      const kind = UnitType.kind[eid];
      const visual = this.world.visuals.get(eid);

      if (UnitType.state[eid] !== STATE_ALIVE) {
        Vision.visibleToBlue[eid] = 0;
        Vision.visibleToRed[eid] = 0;
        if (visual && (kind === UNIT_CHAMPION || kind === UNIT_MINION || kind === UNIT_MONSTER)) {
          visual.visible = false;
        }
        continue;
      }

      if (kind === UNIT_TURRET || kind === UNIT_NEXUS) {
        Vision.visibleToBlue[eid] = 1;
        Vision.visibleToRed[eid] = 1;
        if (visual) visual.visible = true;
        continue;
      }

      const team = Team.id[eid];
      const ux = Transform.x[eid];
      const uz = Transform.z[eid];
      const uRad = Transform.radius[eid];
      const brushId = Vision.inBrushId[eid];
      const attackRevealed = Vision.bushRevealTimer[eid] > 0;
      const isInvis =
        hasComponent(this.world.ecs, eid, StatusEffects) && StatusEffects.invisTimer[eid] > 0;

      const gx = Math.max(
        0,
        Math.min(FOW_GRID_SIZE - 1, Math.floor(((ux + MAP_HALF_SIZE) / MAP_SIZE) * FOW_GRID_SIZE))
      );
      const gz = Math.max(
        0,
        Math.min(FOW_GRID_SIZE - 1, Math.floor(((uz + MAP_HALF_SIZE) / MAP_SIZE) * FOW_GRID_SIZE))
      );
      const idx = gz * FOW_GRID_SIZE + gx;

      // Visibility to Blue Team
      if (team === TEAM_BLUE) {
        Vision.visibleToBlue[eid] = 1;
      } else {
        const inBlueTrueSight = this.hasNearbySource(
          ux,
          uz,
          blueTrueSight,
          TURRET_TRUE_SIGHT_RANGE + uRad
        );
        if (isInvis && !inBlueTrueSight) {
          Vision.visibleToBlue[eid] = 0;
        } else if (brushId >= 0) {
          const sameBrush = blueOccupiedBrushes[brushId] === 1;
          const revealedByAttack =
            attackRevealed && this.hasVisionCoverage(ux, uz, blueSources);
          Vision.visibleToBlue[eid] =
            sameBrush || revealedByAttack || inBlueTrueSight ? 1 : 0;
        } else {
          Vision.visibleToBlue[eid] =
            this.blueGrid[idx] === FOW_VISIBLE || inBlueTrueSight ? 1 : 0;
        }
      }

      // Visibility to Red Team
      if (team === TEAM_RED) {
        Vision.visibleToRed[eid] = 1;
      } else {
        const inRedTrueSight = this.hasNearbySource(
          ux,
          uz,
          redTrueSight,
          TURRET_TRUE_SIGHT_RANGE + uRad
        );
        if (isInvis && !inRedTrueSight) {
          Vision.visibleToRed[eid] = 0;
        } else if (brushId >= 0) {
          const sameBrush = redOccupiedBrushes[brushId] === 1;
          const revealedByAttack =
            attackRevealed && this.hasVisionCoverage(ux, uz, redSources);
          Vision.visibleToRed[eid] =
            sameBrush || revealedByAttack || inRedTrueSight ? 1 : 0;
        } else {
          Vision.visibleToRed[eid] =
            this.redGrid[idx] === FOW_VISIBLE || inRedTrueSight ? 1 : 0;
        }
      }

      // Hide enemy Minions, Champions, and fogged Neutral Monsters hidden by stealth or fog
      if (kind === UNIT_CHAMPION || kind === UNIT_MINION || kind === UNIT_MONSTER) {
        if (visual) {
          visual.visible = this.world.isVisibleToTeam(eid, pTeam);
        }
      }
    }

    // 4. Upload CPU visibility grid to LinearFilter DataTexture
    const displayGrid = pTeam === TEAM_RED ? this.redGrid : this.blueGrid;
    const blendRate = this.firstUpdate ? 1.0 : Math.min(1, dt * 11.0);
    this.firstUpdate = false;
    for (let i = 0; i < total; i++) {
      const state = displayGrid[i];
      const targetAlpha =
        state === FOW_VISIBLE ? 0.0 : state === FOW_EXPLORED ? 0.56 : 0.92;
      const cur = this.smoothFog[i] + (targetAlpha - this.smoothFog[i]) * blendRate;
      this.smoothFog[i] = cur;

      const p = i * 4;
      this.rgbaData[p] = state === FOW_UNEXPLORED ? 2 : 6;
      this.rgbaData[p + 1] = state === FOW_UNEXPLORED ? 3 : 10;
      this.rgbaData[p + 2] = state === FOW_UNEXPLORED ? 7 : 20;
      this.rgbaData[p + 3] = Math.round(cur * 255);
    }
    this.fogTexture.needsUpdate = true;
  }

  private markBrushesWithinRadius(
    wx: number,
    wz: number,
    radius: number,
    revealed: Uint8Array
  ): void {
    for (let b = 0; b < MAP_BRUSHES.length; b++) {
      if (revealed[b] === 1) continue;
      const brush = MAP_BRUSHES[b];
      const dx = wx - brush.x;
      const dz = wz - brush.z;
      const r = radius + brush.radius;
      if (dx * dx + dz * dz <= r * r) {
        revealed[b] = 1;
      }
    }
  }

  private hasVisionCoverage(x: number, z: number, sources: number[]): boolean {
    for (let i = 0; i < sources.length; i++) {
      const sid = sources[i];
      const vr = Vision.range[sid];
      const dx = Transform.x[sid] - x;
      const dz = Transform.z[sid] - z;
      if (dx * dx + dz * dz <= vr * vr) return true;
    }
    return false;
  }

  private hasNearbySource(x: number, z: number, sources: number[], radius: number): boolean {
    const rSq = radius * radius;
    for (let i = 0; i < sources.length; i++) {
      const sid = sources[i];
      const dx = Transform.x[sid] - x;
      const dz = Transform.z[sid] - z;
      if (dx * dx + dz * dz <= rSq) return true;
    }
    return false;
  }

  public isWorldPosVisibleToTeam(x: number, z: number, team: number): boolean {
    const gx = Math.max(
      0,
      Math.min(FOW_GRID_SIZE - 1, Math.floor(((x + MAP_HALF_SIZE) / MAP_SIZE) * FOW_GRID_SIZE))
    );
    const gz = Math.max(
      0,
      Math.min(FOW_GRID_SIZE - 1, Math.floor(((z + MAP_HALF_SIZE) / MAP_SIZE) * FOW_GRID_SIZE))
    );
    const grid = team === TEAM_RED ? this.redGrid : this.blueGrid;
    return grid[gz * FOW_GRID_SIZE + gx] === FOW_VISIBLE;
  }

  public isWorldPosVisibleToBlue(x: number, z: number): boolean {
    return this.isWorldPosVisibleToTeam(x, z, TEAM_BLUE);
  }

  public dispose(): void {
    this.fogTexture.dispose();
    this.fogOverlayMesh.geometry.dispose();
    (this.fogOverlayMesh.material as THREE.Material).dispose();
  }
}
