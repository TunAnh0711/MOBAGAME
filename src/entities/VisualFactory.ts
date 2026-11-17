import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

import {
  Transform,
  Movement,
  Team,
  UnitType,
  Combat,
  SkillBook,
  SkillZone,
  Projectile,
  StatusEffects,
  STATE_ALIVE,
  TEAM_BLUE,
  UNIT_CHAMPION,
  UNIT_MINION,
  UNIT_TURRET,
  UNIT_NEXUS,
  UNIT_PROJECTILE,
  UNIT_SKILL_ZONE,
  UNIT_MONSTER,
  MINION_MELEE,
  MINION_CASTER,
  TURRET_TIER_INHIB,
  TURRET_TIER_NEXUS_GUARD,
  ZONE_BARRIER,
  ZONE_ROOT_TRAP,
  ZONE_MULTI_TICK,
} from '../ecs/Components';
import {
  GameWorld,
  MAP_SIZE,
  JUNGLE_ROCKS,
  JUNGLE_CAMPS,
  SPEED_SHRINES,
  FOUNTAIN_BLUE,
  FOUNTAIN_RED,
} from '../ecs/World';
import { EventBus } from '../core/EventBus';
import { getChampionDef, type SkillKind } from './ChampionDefs';

export type SkillIndicatorMode = 'none' | 'Q' | 'W' | 'E' | 'R' | 'D' | 'F' | 'A';

interface TransientEffect {
  mesh: THREE.Object3D;
  age: number;
  duration: number;
  kind:
    | 'ringExpand'
    | 'clickMarker'
    | 'beam'
    | 'megaBeam'
    | 'flash'
    | 'dashTrail'
    | 'particle'
    | 'meteorFall'
    | 'smokeCloud';
  startScale: number;
  endScale: number;
  baseOpacity: number;
  startY?: number;
  endY?: number;
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

export class VisualFactory {
  private scene: THREE.Scene;
  private world: GameWorld;
  private bus: EventBus;

  public groundMesh!: THREE.Mesh;
  private riverMaterial!: THREE.ShaderMaterial;
  private nexusMaterials: THREE.ShaderMaterial[] = [];
  private brushGroups: THREE.Group[] = [];
  private shrineGroups: THREE.Group[] = [];
  private effects: TransientEffect[] = [];

  // Aiming Indicators
  public indicatorGroup: THREE.Group;
  private rangeCircle: THREE.Mesh;
  private dirArrowGroup: THREE.Group;
  private conePreviewMesh: THREE.Mesh;
  private aoeCursorGroup: THREE.Group;
  private beamPreviewGroup: THREE.Group;
  private hoverRing: THREE.Mesh;

  // Shared geometries for entity hitboxes (BVH enabled)
  private hitboxGeom: THREE.CylinderGeometry;
  private champHitboxGeom: THREE.CylinderGeometry;
  private particleGeom: THREE.SphereGeometry;
  private dashTrailGeom: THREE.TorusGeometry;
  private disposableGeoms: THREE.BufferGeometry[] = [];
  private disposableMats: THREE.Material[] = [];

  constructor(scene: THREE.Scene, world: GameWorld, bus: EventBus) {
    this.scene = scene;
    this.world = world;
    this.bus = bus;

    this.hitboxGeom = new THREE.CylinderGeometry(1.1, 1.1, 2.8, 10);
    this.hitboxGeom.computeBoundsTree();
    this.champHitboxGeom = new THREE.CylinderGeometry(1.35, 1.35, 3.2, 12);
    this.champHitboxGeom.computeBoundsTree();

    this.particleGeom = new THREE.SphereGeometry(0.24, 6, 6);
    this.dashTrailGeom = new THREE.TorusGeometry(0.75, 0.08, 8, 20);
    this.dashTrailGeom.rotateX(Math.PI / 2);

    this.indicatorGroup = new THREE.Group();
    this.scene.add(this.indicatorGroup);

    // 1. Max Range Ring around caster
    const rangeGeom = new THREE.RingGeometry(0.97, 1.0, 64);
    rangeGeom.rotateX(-Math.PI / 2);
    this.rangeCircle = new THREE.Mesh(
      rangeGeom,
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    this.rangeCircle.position.y = 0.14;
    this.rangeCircle.visible = false;
    this.indicatorGroup.add(this.rangeCircle);

    // 2. Directional Line Skillshot Arrow
    this.dirArrowGroup = new THREE.Group();
    const shaftGeom = new THREE.PlaneGeometry(1.2, 1.0);
    shaftGeom.rotateX(-Math.PI / 2);
    shaftGeom.translate(0, 0, 0.5);
    const shaft = new THREE.Mesh(
      shaftGeom,
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    shaft.name = 'shaft';

    const tipGeom = new THREE.ConeGeometry(0.95, 1.6, 4);
    tipGeom.rotateY(Math.PI * 0.25);
    tipGeom.rotateX(Math.PI * 0.5);
    const tip = new THREE.Mesh(
      tipGeom,
      new THREE.MeshBasicMaterial({
        color: 0x7dd3fc,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
      })
    );
    tip.name = 'tip';

    this.dirArrowGroup.add(shaft, tip);
    this.dirArrowGroup.position.y = 0.16;
    this.dirArrowGroup.visible = false;
    this.indicatorGroup.add(this.dirArrowGroup);

    // 2b. Frontal Cone Indicator (for VALKYRIE Q)
    const coneSectorGeom = new THREE.CircleGeometry(1.0, 28, Math.PI * 0.5 - 0.95, 1.9);
    coneSectorGeom.rotateX(-Math.PI / 2);
    this.conePreviewMesh = new THREE.Mesh(
      coneSectorGeom,
      new THREE.MeshBasicMaterial({
        color: 0xfb923c,
        transparent: true,
        opacity: 0.32,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    this.conePreviewMesh.position.y = 0.16;
    this.conePreviewMesh.visible = false;
    this.indicatorGroup.add(this.conePreviewMesh);

    // 3. AOE Target Reticle
    this.aoeCursorGroup = new THREE.Group();
    const aoeRingGeom = new THREE.RingGeometry(0.92, 1.0, 48);
    aoeRingGeom.rotateX(-Math.PI / 2);
    const aoeFillGeom = new THREE.CircleGeometry(0.92, 48);
    aoeFillGeom.rotateX(-Math.PI / 2);
    const aoeRing = new THREE.Mesh(
      aoeRingGeom,
      new THREE.MeshBasicMaterial({
        color: 0xa855f7,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    aoeRing.name = 'aoeRing';
    const aoeFill = new THREE.Mesh(
      aoeFillGeom,
      new THREE.MeshBasicMaterial({
        color: 0xa855f7,
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    aoeFill.name = 'aoeFill';
    this.aoeCursorGroup.add(aoeRing, aoeFill);
    this.aoeCursorGroup.position.y = 0.17;
    this.aoeCursorGroup.visible = false;
    this.indicatorGroup.add(this.aoeCursorGroup);

    // 4. R Laser Beam Preview Strip
    this.beamPreviewGroup = new THREE.Group();
    const beamStripGeom = new THREE.PlaneGeometry(1, 1);
    beamStripGeom.rotateX(-Math.PI / 2);
    beamStripGeom.translate(0, 0, 0.5);
    const beamStrip = new THREE.Mesh(
      beamStripGeom,
      new THREE.MeshBasicMaterial({
        color: 0xf43f5e,
        transparent: true,
        opacity: 0.28,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    beamStrip.name = 'beamStrip';
    const beamCenterGeom = new THREE.PlaneGeometry(0.12, 1);
    beamCenterGeom.rotateX(-Math.PI / 2);
    beamCenterGeom.translate(0, 0.01, 0.5);
    const beamCenter = new THREE.Mesh(
      beamCenterGeom,
      new THREE.MeshBasicMaterial({
        color: 0xfecdd3,
        transparent: true,
        opacity: 0.75,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    beamCenter.name = 'beamCenter';
    this.beamPreviewGroup.add(beamStrip, beamCenter);
    this.beamPreviewGroup.position.y = 0.17;
    this.beamPreviewGroup.visible = false;
    this.indicatorGroup.add(this.beamPreviewGroup);

    // 5. Target Hover Ring
    const hoverGeom = new THREE.RingGeometry(1.0, 1.24, 32);
    hoverGeom.rotateX(-Math.PI / 2);
    this.hoverRing = new THREE.Mesh(
      hoverGeom,
      new THREE.MeshBasicMaterial({
        color: 0xf43f5e,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    this.hoverRing.position.y = 0.15;
    this.hoverRing.visible = false;
    this.scene.add(this.hoverRing);

    this.buildArena();
    this.bindEvents();
  }

  private bindEvents(): void {
    this.bus.on('clickMarker', (ev) => {
      const color =
        ev.kind === 'attack' ? 0xf43f5e : ev.kind === 'attackMove' ? 0xf97316 : 0x34d399;
      const group = new THREE.Group();
      const outerGeom = new THREE.RingGeometry(0.45, 0.72, 24);
      outerGeom.rotateX(-Math.PI / 2);
      const outerMesh = new THREE.Mesh(
        outerGeom,
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.92,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      );
      const innerGeom = new THREE.RingGeometry(0.16, 0.28, 16);
      innerGeom.rotateX(-Math.PI / 2);
      const innerMesh = new THREE.Mesh(
        innerGeom,
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.85,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      );
      group.add(outerMesh, innerMesh);
      group.position.set(ev.x, 0.16, ev.z);
      this.scene.add(group);
      this.effects.push({
        mesh: group,
        age: 0,
        duration: 0.42,
        kind: 'clickMarker',
        startScale: 1.45,
        endScale: 0.12,
        baseOpacity: 0.92,
      });
    });

    this.bus.on('skillImpact', (ev) => {
      if (ev.kind === 'beam' || (ev.kind === 'line' && ev.length && ev.width)) {
        this.spawnMegaBeamVFX(
          ev.x,
          ev.z,
          ev.dirX ?? 0,
          ev.dirZ ?? 1,
          ev.length ?? 22,
          ev.width ?? 2.5,
          ev.color
        );
      } else if (ev.kind === 'meteor') {
        this.spawnMeteorFallVFX(ev.x, ev.z, ev.radius, ev.color);
      } else if (ev.kind === 'smoke') {
        this.spawnSmokeCloudVFX(ev.x, ev.z, ev.radius, ev.color);
      } else if (
        ev.kind === 'pulse' ||
        ev.kind === 'aoe' ||
        ev.kind === 'slow' ||
        ev.kind === 'barrier' ||
        ev.kind === 'root' ||
        ev.kind === 'shrine'
      ) {
        const ringGeom = new THREE.RingGeometry(0.65, 1.0, 40);
        ringGeom.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(
          ringGeom,
          new THREE.MeshBasicMaterial({
            color: ev.color,
            transparent: true,
            opacity: 0.88,
            side: THREE.DoubleSide,
            depthWrite: false,
          })
        );
        mesh.position.set(ev.x, 0.18, ev.z);
        this.scene.add(mesh);
        this.effects.push({
          mesh,
          age: 0,
          duration: 0.45,
          kind: 'ringExpand',
          startScale: 0.45,
          endScale: ev.radius,
          baseOpacity: 0.88,
        });

        if ((ev.kind === 'aoe' || ev.kind === 'barrier') && ev.radius >= 3.0) {
          const beamGeom = new THREE.CylinderGeometry(
            ev.radius * 0.35,
            ev.radius * 0.72,
            16,
            16,
            1,
            true
          );
          const beamMesh = new THREE.Mesh(
            beamGeom,
            new THREE.MeshBasicMaterial({
              color: ev.color,
              transparent: true,
              opacity: 0.55,
              side: THREE.DoubleSide,
              depthWrite: false,
            })
          );
          beamMesh.position.set(ev.x, 8, ev.z);
          this.scene.add(beamMesh);
          this.effects.push({
            mesh: beamMesh,
            age: 0,
            duration: 0.42,
            kind: 'beam',
            startScale: 1.0,
            endScale: 0.15,
            baseOpacity: 0.55,
          });
        }
      } else if (ev.kind === 'hit') {
        const sphereGeom = new THREE.IcosahedronGeometry(0.45, 0);
        const mesh = new THREE.Mesh(
          sphereGeom,
          new THREE.MeshBasicMaterial({
            color: ev.color,
            transparent: true,
            opacity: 0.92,
          })
        );
        mesh.position.set(ev.x, 1.2, ev.z);
        this.scene.add(mesh);
        this.effects.push({
          mesh,
          age: 0,
          duration: 0.24,
          kind: 'ringExpand',
          startScale: 0.5,
          endScale: Math.max(1.2, ev.radius * 1.8),
          baseOpacity: 0.92,
        });
      } else if (ev.kind === 'dash' && ev.targetX !== undefined && ev.targetZ !== undefined) {
        const steps = 4;
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const px = ev.x + (ev.targetX - ev.x) * t;
          const pz = ev.z + (ev.targetZ - ev.z) * t;
          this.spawnDashRing(px, pz, ev.color, 0.38 + s * 0.04);
        }
      } else if (ev.kind === 'flash' || ev.kind === 'heal' || ev.kind === 'recall') {
        const cylGeom = new THREE.CylinderGeometry(0.9, 1.1, 4.5, 16, 1, true);
        const m = new THREE.Mesh(
          cylGeom,
          new THREE.MeshBasicMaterial({
            color: ev.color,
            transparent: true,
            opacity: 0.65,
            side: THREE.DoubleSide,
            depthWrite: false,
          })
        );
        m.position.set(ev.x, 2.2, ev.z);
        this.scene.add(m);
        this.effects.push({
          mesh: m,
          age: 0,
          duration: 0.5,
          kind: 'flash',
          startScale: 0.8,
          endScale: 1.5,
          baseOpacity: 0.65,
        });
      }
    });

    this.bus.on('levelup', (ev) => {
      const cylGeom = new THREE.CylinderGeometry(1.1, 1.4, 14, 18, 1, true);
      const m = new THREE.Mesh(
        cylGeom,
        new THREE.MeshBasicMaterial({
          color: 0xfacc15,
          transparent: true,
          opacity: 0.75,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      );
      m.position.set(ev.x, 7, ev.z);
      this.scene.add(m);
      this.effects.push({
        mesh: m,
        age: 0,
        duration: 0.85,
        kind: 'beam',
        startScale: 1.1,
        endScale: 0.2,
        baseOpacity: 0.75,
      });
    });
  }

  private spawnMeteorFallVFX(x: number, z: number, radius: number, color: number): void {
    const group = new THREE.Group();
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(Math.max(0.55, radius * 0.26), 0),
      new THREE.MeshBasicMaterial({
        color: 0xfef08a,
        transparent: true,
        opacity: 0.95,
      })
    );
    const tail = new THREE.Mesh(
      new THREE.ConeGeometry(Math.max(0.45, radius * 0.24), 4.8, 8),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
      })
    );
    tail.position.y = 2.4;
    group.add(rock, tail);
    group.position.set(x, 12.0, z);
    this.scene.add(group);
    this.effects.push({
      mesh: group,
      age: 0,
      duration: 0.24,
      kind: 'meteorFall',
      startScale: 1.0,
      endScale: 1.2,
      baseOpacity: 0.95,
      startY: 12.0,
      endY: 0.4,
    });

    const ringGeom = new THREE.RingGeometry(0.5, 1.0, 32);
    ringGeom.rotateX(-Math.PI / 2);
    const shock = new THREE.Mesh(
      ringGeom,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.88,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    shock.position.set(x, 0.2, z);
    this.scene.add(shock);
    this.effects.push({
      mesh: shock,
      age: 0,
      duration: 0.36,
      kind: 'ringExpand',
      startScale: 0.35,
      endScale: Math.max(1.5, radius),
      baseOpacity: 0.88,
    });
  }

  private spawnSmokeCloudVFX(x: number, z: number, radius: number, color: number): void {
    const group = new THREE.Group();
    group.position.set(x, 0.1, z);
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      const dist = radius * 0.38;
      const puff = new THREE.Mesh(
        new THREE.DodecahedronGeometry(radius * 0.32, 1),
        new THREE.MeshBasicMaterial({
          color: i % 2 === 0 ? color : 0x581c87,
          transparent: true,
          opacity: 0.55,
          depthWrite: false,
        })
      );
      puff.position.set(Math.cos(ang) * dist, 0.85 + (i % 2) * 0.35, Math.sin(ang) * dist);
      group.add(puff);
    }
    this.scene.add(group);
    this.effects.push({
      mesh: group,
      age: 0,
      duration: 1.4,
      kind: 'smokeCloud',
      startScale: 0.75,
      endScale: 1.25,
      baseOpacity: 0.55,
    });
  }

  private spawnDashRing(x: number, z: number, color: number, duration = 0.35): void {
    const group = new THREE.Group();
    const ring = new THREE.Mesh(
      this.dashTrailGeom,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
      })
    );
    ring.position.y = 0.85;
    const echo = new THREE.Mesh(
      this.dashTrailGeom,
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
      })
    );
    echo.position.y = 0.25;
    echo.scale.setScalar(1.15);
    group.add(ring, echo);
    group.position.set(x, 0, z);
    this.scene.add(group);
    this.effects.push({
      mesh: group,
      age: 0,
      duration,
      kind: 'dashTrail',
      startScale: 1.05,
      endScale: 0.22,
      baseOpacity: 0.8,
    });
  }

  private spawnMegaBeamVFX(
    originX: number,
    originZ: number,
    dirX: number,
    dirZ: number,
    length: number,
    width: number,
    color: number
  ): void {
    const len = Math.max(2, length);
    const wid = Math.max(0.8, width);
    const dLen = Math.hypot(dirX, dirZ) || 1;
    const nx = dirX / dLen;
    const nz = dirZ / dLen;

    const group = new THREE.Group();
    group.position.set(originX, 0, originZ);
    group.rotation.y = Math.atan2(nx, nz);

    const coreGeom = new THREE.CylinderGeometry(wid * 0.22, wid * 0.22, len, 14);
    coreGeom.rotateX(Math.PI / 2);
    coreGeom.translate(0, 1.25, len * 0.5);
    const coreMesh = new THREE.Mesh(
      coreGeom,
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.96,
        depthWrite: false,
      })
    );

    const outerGeom = new THREE.CylinderGeometry(wid * 0.5, wid * 0.5, len, 16, 1, true);
    outerGeom.rotateX(Math.PI / 2);
    outerGeom.translate(0, 1.25, len * 0.5);
    const outerMesh = new THREE.Mesh(
      outerGeom,
      new THREE.MeshBasicMaterial({
        color: color || 0xf43f5e,
        transparent: true,
        opacity: 0.72,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );

    const floorGeom = new THREE.PlaneGeometry(wid * 1.1, len);
    floorGeom.rotateX(-Math.PI / 2);
    floorGeom.translate(0, 0.22, len * 0.5);
    const floorMesh = new THREE.Mesh(
      floorGeom,
      new THREE.MeshBasicMaterial({
        color: color || 0xff2244,
        transparent: true,
        opacity: 0.65,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );

    const ringCount = len > 80 ? 8 : 3;
    for (let k = 0; k < ringCount; k++) {
      const rGeom = new THREE.TorusGeometry(wid * 0.55, 0.1, 8, 24);
      const rMesh = new THREE.Mesh(
        rGeom,
        new THREE.MeshBasicMaterial({
          color: 0xfef08a,
          transparent: true,
          opacity: 0.85,
          depthWrite: false,
        })
      );
      rMesh.position.set(0, 1.25, len * ((k + 0.5) / ringCount));
      group.add(rMesh);
    }

    group.add(coreMesh, outerMesh, floorMesh);
    this.scene.add(group);
    this.effects.push({
      mesh: group,
      age: 0,
      duration: 0.52,
      kind: 'megaBeam',
      startScale: 1.15,
      endScale: 0.08,
      baseOpacity: 0.95,
    });
  }

  private buildArena(): void {
    // 1. Procedural 240x240 3-Lane Terrain with Diagonal River Channel & BVH BoundsTree
    const groundGeom = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, 148, 148);
    groundGeom.rotateX(-Math.PI / 2);

    const pos = groundGeom.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vz = pos.getZ(i);
      const distToRiver = Math.abs(vx - vz) / Math.SQRT2;
      const alongRiver = Math.abs(vx + vz) / Math.SQRT2;
      const onBridge =
        Math.abs(vx + vz) < 8.5 ||
        (vx < -85 && vz < -85) ||
        (vx > 85 && vz > 85);

      if (distToRiver < 7.5 && alongRiver < 116 && !onBridge) {
        const depth = Math.cos((distToRiver / 7.5) * Math.PI * 0.5) * 0.52;
        pos.setY(i, -depth);
      } else if (distToRiver < 7.5 && onBridge) {
        pos.setY(i, 0.04);
      }
    }
    groundGeom.computeVertexNormals();
    groundGeom.computeBoundsTree();
    this.disposableGeoms.push(groundGeom);

    const groundMat = new THREE.ShaderMaterial({
      uniforms: {
        uSunDir: { value: new THREE.Vector3(0.45, 0.82, 0.35).normalize() },
      },
      vertexShader: `
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          vNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform vec3 uSunDir;
        varying vec3 vWorldPos;
        varying vec3 vNormal;

        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }

        float valueNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = hash21(i);
          float b = hash21(i + vec2(1.0, 0.0));
          float c = hash21(i + vec2(0.0, 1.0));
          float d = hash21(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }

        void main() {
          vec2 p = vWorldPos.xz;
          float n = valueNoise(p * 0.18) * 0.65 + valueNoise(p * 0.55) * 0.35;

          // Rich dark-emerald jungle grass base
          vec3 grassDark = vec3(0.08, 0.18, 0.15);
          vec3 grassLight = vec3(0.14, 0.28, 0.20);
          vec3 col = mix(grassDark, grassLight, n);

          // 3 Lanes on 240x240 map: Mid (x + z = 0), Top (x = -94 or z = -94), Bot (x = 94 or z = 94)
          float midDist = abs(p.x + p.y) * 0.7071;
          float topDist = min(abs(p.x + 94.0), abs(p.y + 94.0));
          float botDist = min(abs(p.x - 94.0), abs(p.y - 94.0));
          if (p.x > 94.0 || p.y < -94.0) topDist = 999.0;
          if (p.x < -94.0 || p.y > 94.0) botDist = 999.0;

          float laneDist = min(midDist, min(topDist, botDist));
          float laneMask = 1.0 - smoothstep(5.6, 8.2, laneDist);
          float laneEdge = smoothstep(5.2, 6.0, laneDist) * (1.0 - smoothstep(6.0, 7.0, laneDist));

          vec3 stoneBase = mix(vec3(0.19, 0.22, 0.29), vec3(0.26, 0.30, 0.38), n);
          col = mix(col, stoneBase, laneMask);
          col += vec3(0.08, 0.13, 0.19) * laneEdge;

          // Blue Base (-94, 94) & Red Base (94, -94) Platforms
          float blueDist = length(p - vec2(-94.0, 94.0));
          float redDist = length(p - vec2(94.0, -94.0));
          float blueBase = 1.0 - smoothstep(24.0, 28.0, blueDist);
          float redBase = 1.0 - smoothstep(24.0, 28.0, redDist);

          col = mix(col, vec3(0.12, 0.23, 0.38), blueBase);
          col = mix(col, vec3(0.32, 0.14, 0.20), redBase);

          // Subtle stone tile runes
          float tileGrid = smoothstep(0.94, 0.99, abs(sin(p.x * 0.55))) + smoothstep(0.94, 0.99, abs(sin(p.y * 0.55)));
          col += vec3(0.03, 0.05, 0.09) * tileGrid * max(laneMask, max(blueBase, redBase));

          // Diagonal River bank along x = z (cut cleanly at lane bridges)
          float riverDist = abs(p.x - p.y) * 0.7071;
          float riverAlong = abs(p.x + p.y) * 0.7071;
          float bridgeCut = smoothstep(5.6, 7.6, abs(p.x + p.y) * 0.7071);
          float riverBank = (1.0 - smoothstep(5.8, 9.2, riverDist)) * (1.0 - smoothstep(104.0, 115.0, riverAlong)) * bridgeCut;
          col = mix(col, vec3(0.13, 0.19, 0.22), riverBank * 0.78);

          // Directional sunlight shading
          float diff = max(dot(vNormal, uSunDir), 0.0);
          float light = 0.55 + 0.55 * diff;
          col *= light;

          // Map outer border vignette (240x240 bounds at +-120)
          float edge = max(abs(p.x), abs(p.y));
          col *= 1.0 - smoothstep(112.0, 120.0, edge) * 0.65;

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.disposableMats.push(groundMat);

    this.groundMesh = new THREE.Mesh(groundGeom, groundMat);
    this.groundMesh.receiveShadow = true;
    this.scene.add(this.groundMesh);

    // Mid-lane bridge rune pillars
    this.buildMidBridgeRails();

    // 2. Diagonal Animated Reflective River Water Shader along x = z
    const riverGeom = new THREE.PlaneGeometry(14.5, 224.0, 12, 48);
    riverGeom.rotateX(-Math.PI / 2);
    riverGeom.rotateY(-Math.PI / 4);
    this.disposableGeoms.push(riverGeom);

    this.riverMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: new THREE.Vector3(0.45, 0.85, 0.35).normalize() },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorldPos;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uSunDir;
        varying vec2 vUv;
        varying vec3 vWorldPos;
        void main() {
          vec2 p = vWorldPos.xz;
          float w1 = sin((p.x + p.y) * 0.75 - uTime * 2.4 + cos(p.x - p.y) * 1.1);
          float w2 = cos((p.x - p.y) * 1.25 + uTime * 1.8 - p.y * 1.5);
          float w3 = sin(p.x * 1.4 - uTime * 3.0);

          vec3 N = normalize(vec3((w1 + w3) * 0.08, 1.0, (w2 - w3) * 0.09));
          vec3 V = normalize(cameraPosition - vWorldPos);
          float fresnel = pow(1.0 - max(dot(N, V), 0.0), 2.8);

          vec3 R = reflect(-V, N);
          float spec = pow(max(dot(R, uSunDir), 0.0), 32.0);
          float ripple = smoothstep(0.35, 0.95, (w1 + w2) * 0.5);

          vec3 deepWater = vec3(0.03, 0.22, 0.38);
          vec3 shallowWater = vec3(0.11, 0.50, 0.72);
          vec3 skyReflect = vec3(0.55, 0.82, 0.98);

          vec3 col = mix(deepWater, shallowWater, ripple * 0.55);
          col = mix(col, skyReflect, clamp(fresnel * 0.55, 0.0, 0.65));
          col += vec3(0.95, 0.98, 1.0) * spec * 0.65;

          float edgeFade = smoothstep(0.0, 0.16, vUv.x) * (1.0 - smoothstep(0.84, 1.0, vUv.x));
          gl_FragColor = vec4(col, 0.74 * edgeFade);
        }
      `,
      transparent: true,
      depthWrite: false,
    });

    const riverMesh = new THREE.Mesh(riverGeom, this.riverMaterial);
    riverMesh.position.y = -0.11;
    this.scene.add(riverMesh);

    // 3. Base Fountains (Blue & Red)
    this.createFountain(FOUNTAIN_BLUE.x, FOUNTAIN_BLUE.z, 0x38bdf8);
    this.createFountain(FOUNTAIN_RED.x, FOUNTAIN_RED.z, 0xf43f5e);

    // 4. 2 Interactive River Speed Shrines
    this.buildSpeedShrines();

    // 5. 6 Neutral Jungle Camp Rune Pads
    this.buildJungleCampPads();

    // 6. Flanking Rock Walls (JUNGLE_ROCKS) & Decorative Trees
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.85,
      metalness: 0.15,
    });
    const rockCapMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.75,
    });
    const crystalMat = new THREE.MeshStandardMaterial({
      color: 0x22d3ee,
      emissive: 0x0891b2,
      emissiveIntensity: 0.95,
      roughness: 0.2,
    });
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x451a03, roughness: 0.9 });
    const leafMat1 = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.8 });
    const leafMat2 = new THREE.MeshStandardMaterial({ color: 0x166534, roughness: 0.8 });
    this.disposableMats.push(rockMat, rockCapMat, crystalMat, trunkMat, leafMat1, leafMat2);

    for (let i = 0; i < JUNGLE_ROCKS.length; i++) {
      const r = JUNGLE_ROCKS[i];
      const group = new THREE.Group();
      group.position.set(r.x, 0, r.z);

      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(r.radius * 0.82, r.radius, r.height, 7),
        rockMat
      );
      base.position.y = r.height * 0.5;
      base.castShadow = true;
      base.receiveShadow = true;
      group.add(base);

      const top = new THREE.Mesh(
        new THREE.DodecahedronGeometry(r.radius * 0.62, 0),
        rockCapMat
      );
      top.position.y = r.height * 0.92;
      top.scale.y = 0.55;
      top.castShadow = true;
      group.add(top);

      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.58, 0), crystalMat);
      crystal.position.set(r.radius * 0.45, r.height * 0.65, 0);
      crystal.scale.set(0.6, 1.5, 0.6);
      group.add(crystal);

      if (r.radius >= 4.5) {
        const tree = this.createTreeMesh(trunkMat, leafMat1, leafMat2);
        tree.position.set(-0.5, r.height, 0.4);
        tree.scale.setScalar(0.92);
        group.add(tree);
      }

      this.scene.add(group);
    }

    // Perimeter stylized trees along 240x240 map borders
    for (let i = -108; i <= 108; i += 16) {
      const spots: Array<[number, number]> = [
        [i, -114],
        [i, 114],
        [-114, i],
        [114, i],
      ];
      for (const [tx, tz] of spots) {
        if (Math.abs(tx - tz) < 12) continue;
        const t = this.createTreeMesh(trunkMat, leafMat1, leafMat2);
        t.position.set(tx, 0, tz);
        t.scale.setScalar(0.95 + ((Math.abs(tx + tz) % 5) * 0.07));
        this.scene.add(t);
      }
    }

    // 7. 18 Dense Stealth Bushes (world.brushes) with swirling emerald-teal foliage
    const brushMat1 = new THREE.MeshStandardMaterial({
      color: 0x10b981,
      emissive: 0x064e3b,
      emissiveIntensity: 0.4,
      transparent: true,
      opacity: 0.78,
      roughness: 0.8,
    });
    const brushMat2 = new THREE.MeshStandardMaterial({
      color: 0x14b8a6,
      emissive: 0x0f766e,
      emissiveIntensity: 0.35,
      transparent: true,
      opacity: 0.74,
      roughness: 0.8,
    });
    this.disposableMats.push(brushMat1, brushMat2);

    for (const b of this.world.brushes) {
      const bGroup = new THREE.Group();
      bGroup.position.set(b.x, 0, b.z);

      const pad = new THREE.Mesh(
        new THREE.CircleGeometry(b.radius, 24),
        new THREE.MeshBasicMaterial({
          color: 0x052e16,
          transparent: true,
          opacity: 0.58,
          depthWrite: false,
        })
      );
      pad.rotation.x = -Math.PI / 2;
      pad.position.y = 0.04;
      bGroup.add(pad);

      for (let k = 0; k < 16; k++) {
        const ang = (k / 16) * Math.PI * 2 + k * 0.42;
        const dist = (k % 3) * (b.radius * 0.28);
        const blade = new THREE.Mesh(
          new THREE.ConeGeometry(0.65, 1.95 + (k % 3) * 0.22, 5),
          k % 2 === 0 ? brushMat1 : brushMat2
        );
        blade.position.set(Math.cos(ang) * dist, 0.92, Math.sin(ang) * dist);
        blade.rotation.z = ((k % 5) - 2) * 0.065;
        bGroup.add(blade);
      }

      this.brushGroups.push(bGroup);
      this.scene.add(bGroup);
    }
  }

  private buildSpeedShrines(): void {
    const stoneMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.55,
      metalness: 0.4,
    });
    this.disposableMats.push(stoneMat);

    for (const sh of SPEED_SHRINES) {
      const g = new THREE.Group();
      g.position.set(sh.x, 0.04, sh.z);

      const pad = new THREE.Mesh(
        new THREE.CylinderGeometry(sh.radius * 0.88, sh.radius, 0.22, 24),
        stoneMat
      );
      pad.position.y = 0.08;
      g.add(pad);

      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x2dd4bf,
        transparent: true,
        opacity: 0.88,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      this.disposableMats.push(ringMat);

      const outerRing = new THREE.Mesh(
        new THREE.RingGeometry(sh.radius * 0.78, sh.radius * 0.95, 32),
        ringMat
      );
      outerRing.name = 'shrineRing';
      outerRing.rotation.x = -Math.PI / 2;
      outerRing.position.y = 0.21;

      const crystalMat = new THREE.MeshStandardMaterial({
        color: 0x5eead4,
        emissive: 0x14b8a6,
        emissiveIntensity: 1.4,
      });
      this.disposableMats.push(crystalMat);

      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.62, 0), crystalMat);
      crystal.name = 'shrineCrystal';
      crystal.position.y = 1.25;

      g.add(outerRing, crystal);
      this.shrineGroups.push(g);
      this.scene.add(g);
    }
  }

  private buildJungleCampPads(): void {
    const padMat = new THREE.MeshBasicMaterial({
      color: 0x7e22ce,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xc084fc,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.disposableMats.push(padMat, ringMat);

    for (const camp of JUNGLE_CAMPS) {
      const g = new THREE.Group();
      g.position.set(camp.x, 0.06, camp.z);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(3.2, 24), padMat);
      disc.rotation.x = -Math.PI / 2;
      const ring = new THREE.Mesh(new THREE.RingGeometry(3.0, 3.35, 24), ringMat);
      ring.rotation.x = -Math.PI / 2;
      g.add(disc, ring);
      this.scene.add(g);
    }
  }

  private buildMidBridgeRails(): void {
    const railMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      roughness: 0.6,
      metalness: 0.3,
    });
    const runeMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0284c7,
      emissiveIntensity: 0.9,
    });
    this.disposableMats.push(railMat, runeMat);

    const bridgeGroup = new THREE.Group();
    bridgeGroup.rotation.y = Math.PI / 4;
    for (const side of [-7.0, 7.0]) {
      const curb = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.38, 14.5), railMat);
      curb.position.set(side, 0.18, 0);
      curb.castShadow = true;
      bridgeGroup.add(curb);

      for (const pz of [-6.2, 0, 6.2]) {
        const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.95, 0.8), railMat);
        pillar.position.set(side, 0.45, pz);
        pillar.castShadow = true;
        const cap = new THREE.Mesh(new THREE.OctahedronGeometry(0.24, 0), runeMat);
        cap.position.set(side, 1.12, pz);
        bridgeGroup.add(pillar, cap);
      }
    }
    this.scene.add(bridgeGroup);
  }

  private createTreeMesh(
    trunkMat: THREE.Material,
    leafMat1: THREE.Material,
    leafMat2: THREE.Material
  ): THREE.Group {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.45, 2.4, 6), trunkMat);
    trunk.position.y = 1.2;
    trunk.castShadow = true;
    g.add(trunk);

    const c1 = new THREE.Mesh(new THREE.ConeGeometry(1.7, 2.4, 7), leafMat2);
    c1.position.y = 2.9;
    c1.castShadow = true;
    const c2 = new THREE.Mesh(new THREE.ConeGeometry(1.25, 2.0, 7), leafMat1);
    c2.position.y = 4.0;
    c2.castShadow = true;
    g.add(c1, c2);
    return g;
  }

  private createFountain(x: number, z: number, color: number): void {
    const g = new THREE.Group();
    g.position.set(x, 0.05, z);

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(5.6, 6.2, 0.3, 24),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4, metalness: 0.5 })
    );
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(5.2, 0.18, 8, 48),
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 1.5,
      })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.2;

    const healCircle = new THREE.Mesh(
      new THREE.RingGeometry(2.0, 2.8, 24),
      new THREE.MeshBasicMaterial({
        color: 0x34d399,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
      })
    );
    healCircle.rotation.x = -Math.PI / 2;
    healCircle.position.y = 0.18;

    g.add(base, ring, healCircle);
    this.scene.add(g);
  }

  public syncWorldVisuals(alpha: number, time: number, dt = 1 / 60): void {
    // 1. Create pending meshes
    while (this.world.pendingVisualCreate.length > 0) {
      const eid = this.world.pendingVisualCreate.shift()!;
      if (!this.world.visuals.has(eid)) {
        const obj = this.createEntityVisual(eid);
        if (obj) {
          const kind = UnitType.kind[eid];
          if (kind === UNIT_CHAMPION || kind === UNIT_MINION || kind === UNIT_MONSTER) {
            obj.visible = this.world.isVisibleToPlayer(eid);
          }
          this.world.visuals.set(eid, obj);
          this.scene.add(obj);
        }
      }
    }

    // 2. Remove destroyed meshes and free non-shared Three.js geometries/materials
    while (this.world.pendingVisualDestroy.length > 0) {
      const eid = this.world.pendingVisualDestroy.shift()!;
      const obj = this.world.visuals.get(eid);
      if (obj) {
        this.scene.remove(obj);
        obj.traverse((c) => {
          const m = c as THREE.Mesh;
          if (!m.isMesh) return;
          if (
            m.geometry &&
            m.geometry !== this.hitboxGeom &&
            m.geometry !== this.champHitboxGeom &&
            m.geometry !== this.particleGeom &&
            m.geometry !== this.dashTrailGeom
          ) {
            if (m.geometry.boundsTree) m.geometry.disposeBoundsTree();
            m.geometry.dispose();
          }
          if (Array.isArray(m.material)) {
            for (const mat of m.material) mat.dispose();
          } else if (m.material) {
            m.material.dispose();
          }
        });
        this.world.visuals.delete(eid);
      }
      const hitMesh = this.world.hitMeshByEid.get(eid);
      if (hitMesh) {
        const idx = this.world.hitMeshes.indexOf(hitMesh);
        if (idx >= 0) this.world.hitMeshes.splice(idx, 1);
        this.world.hitMeshByEid.delete(eid);
      }
    }

    // 3. Interpolate transforms, enforce bush stealth visibility, and animate procedural parts
    for (const [eid, obj] of this.world.visuals.entries()) {
      const kind = UnitType.kind[eid];
      const alive = UnitType.state[eid] === STATE_ALIVE;

      if ((kind === UNIT_CHAMPION || kind === UNIT_MONSTER || kind === UNIT_MINION) && !alive) {
        obj.visible = false;
        continue;
      }

      if (kind === UNIT_CHAMPION || kind === UNIT_MINION || kind === UNIT_MONSTER) {
        const visibleToPlayer = this.world.isVisibleToPlayer(eid);
        const vanished = kind === UNIT_CHAMPION && StatusEffects.untargetableTimer[eid] > 0;
        obj.visible = visibleToPlayer && !vanished;
        if (!obj.visible) continue;
      }

      const ix = Transform.prevX[eid] + (Transform.x[eid] - Transform.prevX[eid]) * alpha;
      const iy = Transform.prevY[eid] + (Transform.y[eid] - Transform.prevY[eid]) * alpha;
      const iz = Transform.prevZ[eid] + (Transform.z[eid] - Transform.prevZ[eid]) * alpha;
      const irot = lerpAngle(Transform.prevRotY[eid], Transform.rotY[eid], alpha);

      obj.position.set(ix, iy, iz);
      if (
        kind !== UNIT_TURRET &&
        kind !== UNIT_NEXUS &&
        (kind !== UNIT_SKILL_ZONE || SkillZone.isBeam[eid] === 1)
      ) {
        obj.rotation.y = irot;
      }

      if (kind === UNIT_CHAMPION) {
        this.animateChampion(eid, obj, time, dt);
      } else if (kind === UNIT_MINION) {
        this.animateMinion(eid, obj, time);
      } else if (kind === UNIT_MONSTER) {
        this.animateMonster(eid, obj, time);
      } else if (kind === UNIT_TURRET) {
        this.animateTurret(eid, obj, time);
      } else if (kind === UNIT_NEXUS) {
        this.animateNexus(obj, time);
      } else if (kind === UNIT_SKILL_ZONE) {
        this.animateSkillZone(eid, obj, time);
      } else if (kind === UNIT_PROJECTILE) {
        this.animateProjectile(obj, ix, iy, iz, dt);
      }
    }

    // 4. Update environmental shaders, bush sway, and speed shrines
    this.riverMaterial.uniforms.uTime.value = time;
    for (const mat of this.nexusMaterials) {
      mat.uniforms.uTime.value = time;
    }
    for (let i = 0; i < this.brushGroups.length; i++) {
      const bg = this.brushGroups[i];
      bg.rotation.z = Math.sin(time * 2.2 + i * 0.7) * 0.038;
      bg.rotation.x = Math.cos(time * 1.7 + i * 0.5) * 0.025;
    }
    for (let i = 0; i < this.shrineGroups.length; i++) {
      const sg = this.shrineGroups[i];
      const ready = this.world.isSpeedShrineReady(i);
      const crystal = sg.getObjectByName('shrineCrystal');
      const ring = sg.getObjectByName('shrineRing') as THREE.Mesh | undefined;
      if (crystal) {
        crystal.visible = ready;
        crystal.rotation.y = time * 2.4;
        crystal.position.y = 1.2 + Math.sin(time * 3.5 + i) * 0.2;
      }
      if (ring) {
        ring.rotation.z = time * 1.2;
        (ring.material as THREE.MeshBasicMaterial).opacity = ready ? 0.88 : 0.2;
      }
    }

    // 5. Update transient VFX
    const stepDt = Math.min(0.05, Math.max(0.004, dt));
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const fx = this.effects[i];
      fx.age += stepDt;
      const p = Math.min(1, fx.age / fx.duration);
      const scale = fx.startScale + (fx.endScale - fx.startScale) * p;
      if (fx.kind === 'beam') {
        fx.mesh.scale.set(scale, 1, scale);
      } else if (fx.kind === 'megaBeam') {
        fx.mesh.scale.set(scale, scale, 1);
      } else if (fx.kind === 'flash') {
        fx.mesh.scale.set(scale, 1 + p * 0.8, scale);
        fx.mesh.rotation.y += 0.12;
      } else if (fx.kind === 'meteorFall') {
        fx.mesh.scale.setScalar(scale);
        if (fx.startY !== undefined && fx.endY !== undefined) {
          fx.mesh.position.y = fx.startY + (fx.endY - fx.startY) * p;
        }
      } else if (fx.kind === 'smokeCloud') {
        fx.mesh.scale.set(scale, 1, scale);
        fx.mesh.rotation.y += 0.025;
      } else {
        fx.mesh.scale.setScalar(scale);
      }
      fx.mesh.traverse((c) => {
        if ((c as THREE.Mesh).material) {
          const m = (c as THREE.Mesh).material as THREE.MeshBasicMaterial;
          m.opacity = (1 - p) * fx.baseOpacity;
        }
      });
      if (p >= 1) {
        this.scene.remove(fx.mesh);
        fx.mesh.traverse((c) => {
          const mesh = c as THREE.Mesh;
          if (mesh.isMesh) {
            if (
              mesh.geometry &&
              mesh.geometry !== this.particleGeom &&
              mesh.geometry !== this.dashTrailGeom
            ) {
              mesh.geometry.dispose();
            }
            const mat = mesh.material;
            if (Array.isArray(mat)) {
              for (const m of mat) m.dispose();
            } else if (mat) {
              mat.dispose();
            }
          }
        });
        this.effects.splice(i, 1);
      }
    }
  }

  private createEntityVisual(eid: number): THREE.Object3D | null {
    const kind = UnitType.kind[eid];
    const team = Team.id[eid];
    const teamColor = team === TEAM_BLUE ? 0x38bdf8 : 0xf43f5e;

    if (kind === UNIT_CHAMPION) {
      return this.buildChampionMesh(eid, teamColor);
    }
    if (kind === UNIT_MINION) {
      return this.buildMinionMesh(eid, teamColor);
    }
    if (kind === UNIT_TURRET) {
      return this.buildTurretMesh(eid, teamColor);
    }
    if (kind === UNIT_NEXUS) {
      return this.buildNexusMesh(eid, teamColor);
    }
    if (kind === UNIT_PROJECTILE) {
      return this.buildProjectileMesh(eid);
    }
    if (kind === UNIT_SKILL_ZONE) {
      return this.buildSkillZoneMesh(eid);
    }
    if (kind === UNIT_MONSTER) {
      return this.buildMonsterMesh(eid);
    }
    return null;
  }

  private attachHitbox(group: THREE.Group, eid: number, isChamp: boolean): void {
    const geom = isChamp ? this.champHitboxGeom : this.hitboxGeom;
    const hitMesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ visible: false }));
    hitMesh.position.y = 1.4;
    hitMesh.userData = { eid };
    group.add(hitMesh);
    this.world.hitMeshes.push(hitMesh);
    this.world.hitMeshByEid.set(eid, hitMesh);
  }

  private buildStunHalo(yPos: number): THREE.Group {
    const stunGroup = new THREE.Group();
    stunGroup.name = 'stunRing';
    stunGroup.position.y = yPos;
    stunGroup.visible = false;

    const ringGeom = new THREE.TorusGeometry(0.55, 0.06, 6, 18);
    ringGeom.rotateX(Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
    const ring = new THREE.Mesh(ringGeom, ringMat);
    stunGroup.add(ring);

    const starGeom = new THREE.OctahedronGeometry(0.14, 0);
    const starMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      const star = new THREE.Mesh(starGeom, starMat);
      star.position.set(Math.cos(a) * 0.55, 0, Math.sin(a) * 0.55);
      stunGroup.add(star);
    }
    return stunGroup;
  }

  private buildRootSnareRing(): THREE.Group {
    const rootGroup = new THREE.Group();
    rootGroup.name = 'rootRing';
    rootGroup.position.y = 0.35;
    rootGroup.visible = false;

    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xc084fc,
      transparent: true,
      opacity: 0.9,
    });
    const r1 = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.06, 6, 20), ringMat);
    r1.rotation.x = Math.PI / 2;
    const r2 = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.05, 6, 20), ringMat);
    r2.rotation.x = Math.PI / 2;
    r2.position.y = 0.42;
    rootGroup.add(r1, r2);
    return rootGroup;
  }

  private buildChampionMesh(eid: number, teamColor: number): THREE.Group {
    const def = getChampionDef(UnitType.subKind[eid]);
    const isPlayer = UnitType.isPlayer[eid] === 1;
    const g = new THREE.Group();

    // Team / Player Ground Ring
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.95, 1.16, 32),
      new THREE.MeshBasicMaterial({
        color: isPlayer ? 0xfacc15 : teamColor,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.12;
    g.add(ring);

    const bodyGroup = new THREE.Group();
    bodyGroup.name = 'body';
    g.add(bodyGroup);

    const weaponPivot = new THREE.Group();
    weaponPivot.name = 'weapon';
    weaponPivot.position.set(0.65, 1.25, 0.15);

    if (def.id === 'titan') {
      // 1. TITAN (Đỡ Đòn): Steel-blue heavy blocky armor, wide pauldrons, giant rectangular glowing front shield
      const steelBlueMat = new THREE.MeshStandardMaterial({
        color: 0x2563eb,
        roughness: 0.32,
        metalness: 0.68,
      });
      const heavyPlateMat = new THREE.MeshStandardMaterial({
        color: 0x334155,
        roughness: 0.45,
        metalness: 0.6,
      });
      const cyanGlowMat = new THREE.MeshStandardMaterial({
        color: 0x60a5fa,
        emissive: 0x38bdf8,
        emissiveIntensity: 1.45,
      });

      const torso = new THREE.Mesh(new THREE.BoxGeometry(1.12, 1.35, 0.82), steelBlueMat);
      torso.position.y = 1.18;
      torso.castShadow = true;
      const chestCore = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.46, 0.88), cyanGlowMat);
      chestCore.position.set(0, 1.28, 0.02);

      // Wide blocky pauldrons
      const pLeft = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.54, 0.72), heavyPlateMat);
      pLeft.position.set(-0.78, 1.62, 0);
      const pRight = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.54, 0.72), heavyPlateMat);
      pRight.position.set(0.78, 1.62, 0);

      const helm = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.56, 0.58), heavyPlateMat);
      helm.position.y = 2.12;
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.14, 0.62), cyanGlowMat);
      visor.position.set(0, 2.12, 0.04);
      const crest = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.36, 0.64), cyanGlowMat);
      crest.position.set(0, 2.46, -0.02);

      bodyGroup.add(torso, chestCore, pLeft, pRight, helm, visor, crest);

      // Giant Rectangular Glowing Front Shield + Heavy Gauntlet Mace
      const shieldPlate = new THREE.Mesh(new THREE.BoxGeometry(1.38, 1.78, 0.18), steelBlueMat);
      shieldPlate.position.set(-0.92, -0.05, 0.68);
      const shieldFrame = new THREE.Mesh(new THREE.BoxGeometry(1.48, 1.88, 0.12), cyanGlowMat);
      shieldFrame.position.set(-0.92, -0.05, 0.64);
      const maceShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.3, 8), heavyPlateMat);
      maceShaft.rotation.x = Math.PI * 0.4;
      maceShaft.position.set(0.15, 0.1, 0.45);
      const maceHead = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.6), cyanGlowMat);
      maceHead.position.set(0.15, 0.28, 0.95);
      weaponPivot.add(shieldPlate, shieldFrame, maceShaft, maceHead);
    } else if (def.id === 'valkyrie') {
      // 2. VALKYRIE (Đấu Sĩ): Red-orange armored warrior with long glowing right-hand greatsword
      const crimsonArmorMat = new THREE.MeshStandardMaterial({
        color: 0xea580c,
        roughness: 0.32,
        metalness: 0.6,
      });
      const goldTrimMat = new THREE.MeshStandardMaterial({
        color: 0xfacc15,
        emissive: 0xd97706,
        emissiveIntensity: 0.55,
        roughness: 0.25,
        metalness: 0.8,
      });
      const bladeGlowMat = new THREE.MeshStandardMaterial({
        color: 0xfef08a,
        emissive: 0xf97316,
        emissiveIntensity: 1.5,
        metalness: 0.7,
      });

      const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.44, 0.92, 6, 12), crimsonArmorMat);
      torso.position.y = 1.16;
      torso.castShadow = true;

      const pLeft = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.58, 5), goldTrimMat);
      pLeft.position.set(-0.58, 1.56, 0);
      pLeft.rotation.z = 0.55;
      const pRight = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.58, 5), goldTrimMat);
      pRight.position.set(0.58, 1.56, 0);
      pRight.rotation.z = -0.55;

      const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 1), crimsonArmorMat);
      head.position.y = 2.04;
      const wingL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.48, 0.32), goldTrimMat);
      wingL.position.set(-0.28, 2.32, -0.05);
      wingL.rotation.z = 0.38;
      const wingR = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.48, 0.32), goldTrimMat);
      wingR.position.set(0.28, 2.32, -0.05);
      wingR.rotation.z = -0.38;

      bodyGroup.add(torso, pLeft, pRight, head, wingL, wingR);

      // Long glowing right-hand greatsword
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.14, 0.18), goldTrimMat);
      guard.position.set(0, 0.12, 0.25);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 2.45), bladeGlowMat);
      blade.position.set(0, 0.12, 1.45);
      weaponPivot.add(guard, blade);

      // Golden R Empower Aura VFX (visible when StatusEffects.empoweredTimer > 0)
      const auraGroup = new THREE.Group();
      auraGroup.name = 'valkyrieAura';
      auraGroup.visible = false;
      const auraRing = new THREE.Mesh(
        new THREE.TorusGeometry(1.25, 0.09, 8, 28),
        new THREE.MeshBasicMaterial({
          color: 0xfde047,
          transparent: true,
          opacity: 0.85,
        })
      );
      auraRing.rotation.x = Math.PI / 2;
      auraRing.position.y = 0.3;
      const auraCrown = new THREE.Mesh(
        new THREE.CylinderGeometry(0.95, 1.2, 2.4, 16, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0xf59e0b,
          transparent: true,
          opacity: 0.26,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      );
      auraCrown.position.y = 1.2;
      auraGroup.add(auraRing, auraCrown);
      g.add(auraGroup);
    } else if (def.id === 'shadow') {
      // 3. SHADOW (Sát Thủ): Sharp purple-black cloaked assassin holding twin purple daggers
      const cloakMat = new THREE.MeshStandardMaterial({
        color: 0x1e1b4b,
        roughness: 0.55,
        metalness: 0.35,
      });
      const violetTrimMat = new THREE.MeshStandardMaterial({
        color: 0x7e22ce,
        emissive: 0x581c87,
        emissiveIntensity: 0.7,
        roughness: 0.35,
      });
      const daggerGlowMat = new THREE.MeshStandardMaterial({
        color: 0xf5d0fe,
        emissive: 0xc084fc,
        emissiveIntensity: 1.55,
      });

      const torso = new THREE.Mesh(new THREE.ConeGeometry(0.58, 1.55, 6), cloakMat);
      torso.position.y = 1.05;
      torso.castShadow = true;

      const hood = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.62, 6), violetTrimMat);
      hood.position.set(0, 2.15, -0.04);
      const eyes = new THREE.Mesh(
        new THREE.BoxGeometry(0.38, 0.1, 0.25),
        new THREE.MeshBasicMaterial({ color: 0xf43f5e })
      );
      eyes.position.set(0, 1.98, 0.22);

      const scarfL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.05, 0.36), violetTrimMat);
      scarfL.position.set(-0.34, 1.22, -0.46);
      scarfL.rotation.x = 0.48;
      const scarfR = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.05, 0.36), violetTrimMat);
      scarfR.position.set(0.34, 1.22, -0.46);
      scarfR.rotation.x = 0.48;

      bodyGroup.add(torso, hood, eyes, scarfL, scarfR);

      // Twin Purple Daggers
      const dagR = new THREE.Mesh(new THREE.ConeGeometry(0.12, 1.22, 4), daggerGlowMat);
      dagR.rotation.x = Math.PI * 0.5;
      dagR.position.set(0, 0.05, 0.68);
      const dagL = new THREE.Mesh(new THREE.ConeGeometry(0.12, 1.22, 4), daggerGlowMat);
      dagL.rotation.x = Math.PI * 0.5;
      dagL.position.set(-1.3, 0.05, 0.68);
      weaponPivot.add(dagR, dagL);
    } else if (def.id === 'nova') {
      // 4. NOVA (Xạ Thủ): Gold-white tech gunner wielding a long blue-glowing plasma cannon
      const whiteTechMat = new THREE.MeshStandardMaterial({
        color: 0xf8fafc,
        roughness: 0.28,
        metalness: 0.55,
      });
      const goldMat = new THREE.MeshStandardMaterial({
        color: 0xf59e0b,
        emissive: 0xb45309,
        emissiveIntensity: 0.4,
        roughness: 0.25,
        metalness: 0.8,
      });
      const plasmaGlowMat = new THREE.MeshStandardMaterial({
        color: 0x7dd3fc,
        emissive: 0x0ea5e9,
        emissiveIntensity: 1.6,
      });

      const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 0.88, 6, 12), whiteTechMat);
      torso.position.y = 1.15;
      torso.castShadow = true;

      const chestTrim = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.42, 0.56), goldMat);
      chestTrim.position.set(0, 1.32, 0.04);

      const wingL = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.14, 0.28), goldMat);
      wingL.position.set(-0.46, 1.56, -0.4);
      wingL.rotation.z = 0.52;
      const wingR = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.14, 0.28), goldMat);
      wingR.position.set(0.46, 1.56, -0.4);
      wingR.rotation.z = -0.52;

      const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 12), whiteTechMat);
      head.position.y = 2.02;
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.14, 0.26), plasmaGlowMat);
      visor.position.set(0, 2.04, 0.22);

      bodyGroup.add(torso, chestTrim, wingL, wingR, head, visor);

      // Long blue-glowing plasma cannon
      const cannonBody = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.28, 1.85), whiteTechMat);
      cannonBody.position.set(-0.1, 0.08, 0.72);
      const cannonCore = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.95, 10), plasmaGlowMat);
      cannonCore.rotation.x = Math.PI / 2;
      cannonCore.position.set(-0.1, 0.08, 0.76);
      const muzzleRing = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.04, 6, 16), goldMat);
      muzzleRing.position.set(-0.1, 0.08, 1.68);
      weaponPivot.add(cannonBody, cannonCore, muzzleRing);
    } else {
      // 5. AURELIA (Pháp Sư): Teal-purple robed mage hovering with 3 orbiting arcane spheres
      const tealRobeMat = new THREE.MeshStandardMaterial({
        color: 0x0d9488,
        roughness: 0.4,
        metalness: 0.35,
      });
      const purpleMantleMat = new THREE.MeshStandardMaterial({
        color: 0x7e22ce,
        emissive: 0x581c87,
        emissiveIntensity: 0.5,
        roughness: 0.35,
      });
      const arcaneGlowMat = new THREE.MeshStandardMaterial({
        color: 0x5eead4,
        emissive: 0x2dd4bf,
        emissiveIntensity: 1.5,
      });
      const orbPurpleMat = new THREE.MeshStandardMaterial({
        color: 0xf5d0fe,
        emissive: 0xc084fc,
        emissiveIntensity: 1.6,
      });

      const robe = new THREE.Mesh(new THREE.ConeGeometry(0.66, 1.62, 10), tealRobeMat);
      robe.position.y = 0.98;
      robe.castShadow = true;

      const mantle = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.56, 0.55, 8), purpleMantleMat);
      mantle.position.y = 1.52;

      const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 12), purpleMantleMat);
      head.position.y = 2.02;
      const crown = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.05, 6, 20), arcaneGlowMat);
      crown.position.set(0, 2.26, -0.08);
      crown.rotation.x = 0.65;

      bodyGroup.add(robe, mantle, head, crown);

      // Arcane Staff
      const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.0, 8), purpleMantleMat);
      staff.rotation.x = Math.PI * 0.25;
      staff.position.set(0, 0.25, 0.35);
      const staffGem = new THREE.Mesh(new THREE.OctahedronGeometry(0.26, 0), arcaneGlowMat);
      staffGem.position.set(0, 0.92, 0.82);
      weaponPivot.add(staff, staffGem);

      // 3 Orbiting Arcane Spheres rotating smoothly around AURELIA
      const orbRing = new THREE.Group();
      orbRing.name = 'arcaneOrbs';
      orbRing.position.y = 1.38;
      for (let k = 0; k < 3; k++) {
        const ang = (k / 3) * Math.PI * 2;
        const sphere = new THREE.Mesh(
          new THREE.IcosahedronGeometry(0.22, 1),
          k % 2 === 0 ? orbPurpleMat : arcaneGlowMat
        );
        sphere.position.set(Math.cos(ang) * 1.25, 0, Math.sin(ang) * 1.25);
        orbRing.add(sphere);
      }
      bodyGroup.add(orbRing);
    }

    bodyGroup.add(weaponPivot);

    // Shield Bubble (StatusEffects.shieldAmount > 0)
    const shieldGroup = new THREE.Group();
    shieldGroup.name = 'shieldBubble';
    shieldGroup.position.y = 1.25;
    shieldGroup.visible = false;
    const shieldWire = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.32, 1),
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.45,
        wireframe: true,
      })
    );
    const shieldShell = new THREE.Mesh(
      new THREE.SphereGeometry(1.28, 18, 14),
      new THREE.MeshBasicMaterial({
        color: 0x7dd3fc,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
      })
    );
    shieldGroup.add(shieldWire, shieldShell);
    g.add(shieldGroup);

    // Stun Halo & Root Snare Ring
    g.add(this.buildStunHalo(2.65));
    g.add(this.buildRootSnareRing());

    // Shadow Q Mark Indicator overhead
    const markRing = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.24, 0),
      new THREE.MeshBasicMaterial({ color: 0xe879f9 })
    );
    markRing.name = 'markIndicator';
    markRing.position.y = 2.95;
    markRing.visible = false;
    g.add(markRing);

    // Recall Ring
    const recallRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.15, 0.07, 8, 32),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.85 })
    );
    recallRing.name = 'recallRing';
    recallRing.rotation.x = Math.PI / 2;
    recallRing.position.y = 0.4;
    recallRing.visible = false;
    g.add(recallRing);

    this.attachHitbox(g, eid, true);
    return g;
  }

  private buildMinionMesh(eid: number, teamColor: number): THREE.Group {
    const sub = UnitType.subKind[eid];
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: teamColor,
      roughness: 0.45,
      metalness: 0.35,
    });
    const trimMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.6,
    });
    const glowMat = new THREE.MeshStandardMaterial({
      color: teamColor,
      emissive: teamColor,
      emissiveIntensity: 1.2,
    });

    const body = new THREE.Group();
    body.name = 'body';
    g.add(body);

    if (sub === MINION_MELEE) {
      const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.55, 4, 8), mat);
      torso.position.y = 0.72;
      torso.castShadow = true;
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.1, 0.2), glowMat);
      visor.position.set(0, 1.0, 0.22);
      const shield = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.65, 0.55), trimMat);
      shield.position.set(-0.38, 0.72, 0.15);
      body.add(torso, visor, shield);
    } else if (sub === MINION_CASTER) {
      const robe = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.25, 7), mat);
      robe.position.y = 0.65;
      robe.castShadow = true;
      const hood = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 8), trimMat);
      hood.position.y = 1.3;
      const orb = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 0), glowMat);
      orb.position.set(0.36, 1.15, 0.25);
      body.add(robe, hood, orb);
    } else {
      const hull = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.55, 1.25), trimMat);
      hull.position.y = 0.52;
      hull.castShadow = true;
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 1.1, 8), mat);
      barrel.rotation.x = Math.PI * 0.45;
      barrel.position.set(0, 0.85, 0.45);
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), glowMat);
      core.position.set(0, 0.88, -0.15);
      body.add(hull, barrel, core);
    }

    g.add(this.buildStunHalo(1.85));
    g.add(this.buildRootSnareRing());
    this.attachHitbox(g, eid, false);
    return g;
  }

  private buildMonsterMesh(eid: number): THREE.Group {
    const g = new THREE.Group();
    const stoneMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      roughness: 0.82,
      metalness: 0.2,
    });
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0xc084fc,
      emissive: 0x9333ea,
      emissiveIntensity: 1.4,
    });

    const body = new THREE.Group();
    body.name = 'body';
    g.add(body);

    const torso = new THREE.Mesh(new THREE.DodecahedronGeometry(0.95, 0), stoneMat);
    torso.position.y = 1.35;
    torso.scale.set(1.15, 1.05, 0.95);
    torso.castShadow = true;

    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.48, 0), coreMat);
    core.position.set(0, 1.45, 0.72);

    const fistL = new THREE.Mesh(new THREE.DodecahedronGeometry(0.45, 0), stoneMat);
    fistL.position.set(-1.15, 1.05, 0.25);
    const fistR = new THREE.Mesh(new THREE.DodecahedronGeometry(0.45, 0), stoneMat);
    fistR.position.set(1.15, 1.05, 0.25);

    const hornL = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.85, 5), coreMat);
    hornL.position.set(-0.55, 2.25, 0);
    hornL.rotation.z = 0.35;
    const hornR = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.85, 5), coreMat);
    hornR.position.set(0.55, 2.25, 0);
    hornR.rotation.z = -0.35;

    body.add(torso, core, fistL, fistR, hornL, hornR);
    g.add(this.buildStunHalo(2.8));
    this.attachHitbox(g, eid, true);
    return g;
  }

  private animateMonster(eid: number, obj: THREE.Object3D, time: number): void {
    const body = obj.getObjectByName('body');
    if (body) {
      const moving = Movement.hasTarget[eid] === 1;
      body.position.y = moving ? Math.abs(Math.sin(time * 8)) * 0.14 : Math.sin(time * 2.2) * 0.06;
    }
    const stunRing = obj.getObjectByName('stunRing');
    if (stunRing) {
      const isStunned = StatusEffects.stunTimer[eid] > 0;
      stunRing.visible = isStunned;
      if (isStunned) stunRing.rotation.y = time * 5.5;
    }
  }

  private buildTurretMesh(eid: number, teamColor: number): THREE.Group {
    const tier = UnitType.subKind[eid];
    const g = new THREE.Group();
    const stoneMat = new THREE.MeshStandardMaterial({
      color: tier >= TURRET_TIER_INHIB ? 0x1e293b : 0x334155,
      roughness: 0.65,
      metalness: 0.38,
    });
    const glowMat = new THREE.MeshStandardMaterial({
      color: teamColor,
      emissive: teamColor,
      emissiveIntensity: 1.5,
    });

    const base = new THREE.Mesh(new THREE.CylinderGeometry(2.05, 2.55, 1.2, 8), stoneMat);
    base.position.y = 0.6;
    base.castShadow = true;
    base.receiveShadow = true;

    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.65, 4.2, 8), stoneMat);
    pillar.position.y = 3.2;
    pillar.castShadow = true;

    if (tier >= TURRET_TIER_INHIB) {
      for (let b = 0; b < 4; b++) {
        const ang = (b / 4) * Math.PI * 2;
        const fin = new THREE.Mesh(new THREE.BoxGeometry(0.45, 2.6, 0.9), stoneMat);
        fin.position.set(Math.cos(ang) * 1.55, 2.2, Math.sin(ang) * 1.55);
        fin.rotation.y = -ang;
        g.add(fin);
      }
    }

    const crystal = new THREE.Mesh(
      new THREE.OctahedronGeometry(tier === TURRET_TIER_NEXUS_GUARD ? 1.3 : 1.15, 0),
      glowMat
    );
    crystal.name = 'crystal';
    crystal.position.y = 6.2;

    const gyro = new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.1, 8, 24), glowMat);
    gyro.name = 'gyro';
    gyro.position.y = 6.2;

    // Ground attack range indicator ring (shown when player nears enemy turret)
    const rangeRingGeom = new THREE.RingGeometry(0.985, 1.0, 72);
    rangeRingGeom.rotateX(-Math.PI / 2);
    const rangeRing = new THREE.Mesh(
      rangeRingGeom,
      new THREE.MeshBasicMaterial({
        color: 0xf43f5e,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    rangeRing.name = 'rangeRing';
    rangeRing.position.y = 0.13;
    rangeRing.visible = false;

    const rangeFillGeom = new THREE.CircleGeometry(1.0, 72);
    rangeFillGeom.rotateX(-Math.PI / 2);
    const rangeFill = new THREE.Mesh(
      rangeFillGeom,
      new THREE.MeshBasicMaterial({
        color: 0xf43f5e,
        transparent: true,
        opacity: 0.06,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    rangeFill.name = 'rangeFill';
    rangeRing.add(rangeFill);

    g.add(base, pillar, crystal, gyro, rangeRing);

    const hitMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(2.3, 2.3, 7.2, 10),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hitMesh.geometry.computeBoundsTree();
    this.disposableGeoms.push(hitMesh.geometry);
    hitMesh.position.y = 3.5;
    hitMesh.userData = { eid };
    g.add(hitMesh);
    this.world.hitMeshes.push(hitMesh);
    this.world.hitMeshByEid.set(eid, hitMesh);

    return g;
  }

  private buildNexusMesh(eid: number, teamColor: number): THREE.Group {
    const g = new THREE.Group();
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x3b4963,
      roughness: 0.4,
      metalness: 0.45,
      emissive: teamColor,
      emissiveIntensity: 0.12,
    });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 4.2, 1.4, 12), baseMat);
    base.position.y = 0.7;
    base.castShadow = true;
    base.receiveShadow = true;
    g.add(base);

    const cColor = new THREE.Color(teamColor);
    const shaderMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: cColor },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vPos;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uColor;
        varying vec3 vNormal;
        varying vec3 vPos;
        void main() {
          float pulse = 0.7 + 0.3 * sin(uTime * 3.5 + vPos.y * 2.0);
          float rim = 1.0 - max(dot(vNormal, vec3(0.0, 0.0, 1.0)), 0.0);
          vec3 col = uColor * (0.85 + 0.7 * pulse) + vec3(0.45) * pow(rim, 2.0);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.nexusMaterials.push(shaderMat);

    const core = new THREE.Mesh(new THREE.OctahedronGeometry(2.1, 0), shaderMat);
    core.name = 'core';
    core.position.y = 4.2;
    core.scale.set(0.9, 1.6, 0.9);
    g.add(core);

    const ringMat = new THREE.MeshStandardMaterial({
      color: teamColor,
      emissive: teamColor,
      emissiveIntensity: 1.4,
    });
    for (let i = 0; i < 2; i++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(2.85 + i * 0.45, 0.12, 8, 32),
        ringMat
      );
      ring.name = `ring${i}`;
      ring.position.y = 4.2;
      ring.rotation.x = i === 0 ? 0.6 : -0.6;
      g.add(ring);
    }

    const hitMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(3.6, 3.6, 7.5, 12),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hitMesh.geometry.computeBoundsTree();
    this.disposableGeoms.push(hitMesh.geometry);
    hitMesh.position.y = 3.6;
    hitMesh.userData = { eid };
    g.add(hitMesh);
    this.world.hitMeshes.push(hitMesh);
    this.world.hitMeshByEid.set(eid, hitMesh);

    return g;
  }

  private buildProjectileMesh(eid: number): THREE.Group {
    const g = new THREE.Group();
    const color = Projectile.color[eid] || 0xf97316;
    const isSkillshot = Projectile.targetEid[eid] < 0;

    if (isSkillshot) {
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(0.44, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0xfef08a })
      );
      const aura = new THREE.Mesh(
        new THREE.SphereGeometry(0.68, 12, 12),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.72,
          depthWrite: false,
        })
      );
      const tail = new THREE.Mesh(
        new THREE.ConeGeometry(0.55, 1.85, 8),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.62,
          depthWrite: false,
        })
      );
      tail.rotation.x = -Math.PI / 2;
      tail.position.z = -0.8;
      g.add(core, aura, tail);
      g.userData.isFireball = true;
      g.userData.trailTimer = 0;
      g.userData.trailColor = color;
    } else {
      const rad = Projectile.isTurretShot[eid] === 1 ? 0.55 : 0.32;
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(rad, 10, 10),
        new THREE.MeshBasicMaterial({ color })
      );
      g.add(orb);
    }
    return g;
  }

  private buildSkillZoneMesh(eid: number): THREE.Group {
    const g = new THREE.Group();
    const color = SkillZone.color[eid] || 0xa855f7;
    const zKind = SkillZone.zoneKind[eid];

    if (SkillZone.isBeam[eid] === 1) {
      const len = SkillZone.beamLength[eid] || 22;
      const wid = SkillZone.beamWidth[eid] || 2.5;

      const bgGeom = new THREE.PlaneGeometry(wid, len);
      bgGeom.rotateX(-Math.PI / 2);
      bgGeom.translate(0, 0.14, len * 0.5);
      const bgStrip = new THREE.Mesh(
        bgGeom,
        new THREE.MeshBasicMaterial({
          color: 0xef4444,
          transparent: true,
          opacity: 0.28,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      );

      const railGeom = new THREE.PlaneGeometry(0.12, len);
      railGeom.rotateX(-Math.PI / 2);
      railGeom.translate(0, 0.16, len * 0.5);
      const railMat = new THREE.MeshBasicMaterial({
        color: 0xff2244,
        transparent: true,
        opacity: 0.92,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const leftRail = new THREE.Mesh(railGeom, railMat);
      leftRail.position.x = -wid * 0.5;
      const rightRail = new THREE.Mesh(railGeom, railMat);
      rightRail.position.x = wid * 0.5;

      const fillGeom = new THREE.PlaneGeometry(wid * 0.92, len);
      fillGeom.rotateX(-Math.PI / 2);
      fillGeom.translate(0, 0.15, len * 0.5);
      const fillStrip = new THREE.Mesh(
        fillGeom,
        new THREE.MeshBasicMaterial({
          color: 0xff3355,
          transparent: true,
          opacity: 0.65,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      );
      fillStrip.name = 'beamFill';
      fillStrip.scale.set(0.08, 1, 1);

      g.add(bgStrip, leftRail, rightRail, fillStrip);
      return g;
    }

    const rad = SkillZone.radius[eid] || 3.5;

    // TITAN R Circular Glowing Barrier Wall (2.5s physical arena wall)
    if (zKind === ZONE_BARRIER || SkillZone.isBarrier[eid] === 1) {
      const wallCyl = new THREE.Mesh(
        new THREE.CylinderGeometry(rad, rad, 3.4, 36, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0x38bdf8,
          transparent: true,
          opacity: 0.42,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      );
      wallCyl.name = 'barrierWall';
      wallCyl.position.y = 1.7;

      const topRing = new THREE.Mesh(
        new THREE.TorusGeometry(rad, 0.12, 8, 40),
        new THREE.MeshBasicMaterial({ color: 0x7dd3fc })
      );
      topRing.rotation.x = Math.PI / 2;
      topRing.position.y = 3.4;

      const botRing = new THREE.Mesh(
        new THREE.TorusGeometry(rad, 0.14, 8, 40),
        new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
      );
      botRing.rotation.x = Math.PI / 2;
      botRing.position.y = 0.12;

      for (let p = 0; p < 8; p++) {
        const ang = (p / 8) * Math.PI * 2;
        const post = new THREE.Mesh(
          new THREE.BoxGeometry(0.32, 3.6, 0.32),
          new THREE.MeshBasicMaterial({ color: 0xbae6fd })
        );
        post.position.set(Math.cos(ang) * rad, 1.8, Math.sin(ang) * rad);
        g.add(post);
      }

      g.add(wallCyl, topRing, botRing);
      return g;
    }

    const outerRing = new THREE.Mesh(
      new THREE.RingGeometry(rad * 0.93, rad, 48),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.92,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    outerRing.rotation.x = -Math.PI / 2;

    const runeRing = new THREE.Mesh(
      new THREE.RingGeometry(rad * 0.58, rad * 0.65, zKind === ZONE_ROOT_TRAP ? 8 : 6),
      new THREE.MeshBasicMaterial({
        color: zKind === ZONE_MULTI_TICK ? 0xfef08a : 0xe879f9,
        transparent: true,
        opacity: 0.78,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    runeRing.name = 'runeRing';
    runeRing.rotation.x = -Math.PI / 2;
    runeRing.position.y = 0.02;

    const baseGlow = new THREE.Mesh(
      new THREE.CircleGeometry(rad * 0.94, 48),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.14,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    baseGlow.rotation.x = -Math.PI / 2;

    const fillDisc = new THREE.Mesh(
      new THREE.CircleGeometry(rad, 48),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.32,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    fillDisc.name = 'fillDisc';
    fillDisc.rotation.x = -Math.PI / 2;
    fillDisc.position.y = 0.01;
    fillDisc.scale.setScalar(0.05);

    g.add(outerRing, runeRing, baseGlow, fillDisc);
    return g;
  }

  private animateChampion(eid: number, obj: THREE.Object3D, time: number, dt: number): void {
    const subKind = UnitType.subKind[eid];
    const body = obj.getObjectByName('body');
    const weapon = obj.getObjectByName('weapon');
    const shieldBubble = obj.getObjectByName('shieldBubble');
    const stunRing = obj.getObjectByName('stunRing');
    const rootRing = obj.getObjectByName('rootRing');
    const recallRing = obj.getObjectByName('recallRing');
    const valkyrieAura = obj.getObjectByName('valkyrieAura');
    const arcaneOrbs = obj.getObjectByName('arcaneOrbs');
    const markIndicator = obj.getObjectByName('markIndicator');

    // VALKYRIE R: Smoothly scale 3D model to 1.25x with golden aura VFX when empoweredTimer > 0!
    const isValkyrieEmpowered = subKind === 1 && StatusEffects.empoweredTimer[eid] > 0;
    const targetScale = isValkyrieEmpowered ? 1.25 : 1.0;
    const curScale = obj.scale.x || 1.0;
    const nextScale = curScale + (targetScale - curScale) * Math.min(1, dt * 10);
    obj.scale.setScalar(nextScale);

    if (valkyrieAura) {
      valkyrieAura.visible = isValkyrieEmpowered;
      if (isValkyrieEmpowered) {
        valkyrieAura.rotation.y = time * 3.2;
      }
    }

    // AURELIA: Continuously hover slightly (Math.sin) with 3 orbiting arcane spheres rotating smoothly!
    const speed = Math.hypot(Movement.vx[eid], Movement.vz[eid]);
    if (body) {
      if (subKind === 4) {
        body.position.y = 0.26 + Math.sin(time * 3.4 + eid) * 0.12;
      } else {
        body.position.y =
          speed > 0.5 ? Math.abs(Math.sin(time * 12)) * 0.14 : Math.sin(time * 3) * 0.04;
      }

      // Bush Stealth Visuals: 0.45 opacity for local team in bush (inBrushId >= 0), 0.35 when invisible (invisTimer > 0), 1.0 outside / revealed enemy
      const localOpacity = this.world.getLocalOpacityForUnit(eid);
      const targetOpacity = localOpacity > 0 ? localOpacity : 1.0;
      const needTransparent = targetOpacity < 0.99;

      body.traverse((c) => {
        if ((c as THREE.Mesh).isMesh) {
          const m = (c as THREE.Mesh).material as THREE.MeshStandardMaterial;
          if (m && typeof m.opacity === 'number') {
            if (m.transparent !== needTransparent) {
              m.transparent = needTransparent;
              m.needsUpdate = true;
            }
            m.opacity = targetOpacity;
          }
        }
      });
    }

    if (arcaneOrbs) {
      arcaneOrbs.rotation.y = time * 2.8;
      arcaneOrbs.rotation.z = Math.sin(time * 2.0) * 0.18;
    }

    if (weapon) {
      if (Combat.attackAnimTimer[eid] > 0) {
        weapon.rotation.x = Math.sin(Combat.attackAnimTimer[eid] * 22) * 1.15;
      } else {
        weapon.rotation.x = 0;
      }
    }

    if (shieldBubble) {
      const hasShield =
        StatusEffects.shieldAmount[eid] > 0 || StatusEffects.wStanceTimer[eid] > 0;
      shieldBubble.visible = hasShield;
      if (hasShield) {
        shieldBubble.rotation.y = time * 2.5;
        shieldBubble.rotation.x = Math.sin(time * 1.8) * 0.15;
      }
    }

    if (stunRing) {
      const isStunned = StatusEffects.stunTimer[eid] > 0;
      stunRing.visible = isStunned;
      if (isStunned) {
        stunRing.rotation.y = time * 5.5;
      }
    }

    if (rootRing) {
      const isRooted = StatusEffects.rootTimer[eid] > 0;
      rootRing.visible = isRooted;
      if (isRooted) {
        rootRing.rotation.y = -time * 3.5;
      }
    }

    if (markIndicator) {
      const isMarked = StatusEffects.markedByEid[eid] >= 0 && StatusEffects.markTimer[eid] > 0;
      markIndicator.visible = isMarked;
      if (isMarked) {
        markIndicator.rotation.y = time * 4.5;
        markIndicator.position.y = 2.95 + Math.sin(time * 6) * 0.1;
      }
    }

    if (recallRing) {
      recallRing.visible = SkillBook.isRecalling[eid] === 1;
      if (recallRing.visible) {
        recallRing.position.y = 0.25 + ((time * 2.5) % 1.0) * 1.9;
        recallRing.rotation.z = time * 4.0;
      }
    }

    // Dash after-image rings while Movement.isDashing === 1
    if (Movement.isDashing[eid] === 1) {
      obj.userData.dashAfterTimer = (obj.userData.dashAfterTimer ?? 0) - dt;
      if (obj.userData.dashAfterTimer <= 0) {
        obj.userData.dashAfterTimer = 0.045;
        const def = getChampionDef(subKind);
        this.spawnDashRing(obj.position.x, obj.position.z, def.primaryColor, 0.32);
      }
    }
  }

  private animateMinion(eid: number, obj: THREE.Object3D, time: number): void {
    const body = obj.getObjectByName('body');
    if (body) {
      const moving = Movement.hasTarget[eid] === 1 && Combat.isWindingUp[eid] === 0;
      body.position.y = moving ? Math.abs(Math.sin(time * 14 + eid)) * 0.09 : 0;
    }
    const stunRing = obj.getObjectByName('stunRing');
    if (stunRing) {
      const isStunned = StatusEffects.stunTimer[eid] > 0;
      stunRing.visible = isStunned;
      if (isStunned) stunRing.rotation.y = time * 5.5;
    }
    const rootRing = obj.getObjectByName('rootRing');
    if (rootRing) {
      const isRooted = StatusEffects.rootTimer[eid] > 0;
      rootRing.visible = isRooted;
      if (isRooted) rootRing.rotation.y = -time * 3.5;
    }
  }

  private animateTurret(eid: number, obj: THREE.Object3D, time: number): void {
    const crystal = obj.getObjectByName('crystal');
    const gyro = obj.getObjectByName('gyro');
    const rangeRing = obj.getObjectByName('rangeRing') as THREE.Mesh | undefined;

    if (crystal) {
      crystal.rotation.y = time * 1.6;
      crystal.position.y = 6.2 + Math.sin(time * 3.0 + eid) * 0.18;
    }
    if (gyro) {
      gyro.rotation.x = time * 1.2;
      gyro.rotation.y = time * 0.8;
    }

    if (rangeRing) {
      const pid = this.world.playerEid;
      if (
        pid >= 0 &&
        this.world.isAliveUnit(pid) &&
        this.world.isAliveUnit(eid) &&
        Team.id[eid] !== Team.id[pid]
      ) {
        const range = Combat.attackRange[eid] || 15.0;
        const dist = Math.hypot(
          Transform.x[pid] - Transform.x[eid],
          Transform.z[pid] - Transform.z[eid]
        );
        if (dist <= range + 8.5) {
          rangeRing.visible = true;
          rangeRing.scale.setScalar(range);
          const ringMat = rangeRing.material as THREE.MeshBasicMaterial;
          const fillChild = rangeRing.getObjectByName('rangeFill') as THREE.Mesh | undefined;
          const targeted = Combat.targetEid[eid] === pid;
          if (targeted) {
            ringMat.color.setHex(0xff1e42);
            ringMat.opacity = 0.65 + 0.3 * Math.sin(time * 12.0);
            if (fillChild) {
              (fillChild.material as THREE.MeshBasicMaterial).color.setHex(0xff1e42);
              (fillChild.material as THREE.MeshBasicMaterial).opacity = 0.12;
            }
          } else if (dist <= range) {
            ringMat.color.setHex(0xf43f5e);
            ringMat.opacity = 0.72;
            if (fillChild) {
              (fillChild.material as THREE.MeshBasicMaterial).color.setHex(0xf43f5e);
              (fillChild.material as THREE.MeshBasicMaterial).opacity = 0.08;
            }
          } else {
            ringMat.color.setHex(0xfb923c);
            ringMat.opacity = 0.45;
            if (fillChild) {
              (fillChild.material as THREE.MeshBasicMaterial).color.setHex(0xfb923c);
              (fillChild.material as THREE.MeshBasicMaterial).opacity = 0.04;
            }
          }
        } else {
          rangeRing.visible = false;
        }
      } else {
        rangeRing.visible = false;
      }
    }
  }

  private animateNexus(obj: THREE.Object3D, time: number): void {
    const core = obj.getObjectByName('core');
    const r0 = obj.getObjectByName('ring0');
    const r1 = obj.getObjectByName('ring1');
    if (core) core.rotation.y = time * 0.9;
    if (r0) r0.rotation.y = time * 1.4;
    if (r1) r1.rotation.z = -time * 1.2;
  }

  private animateSkillZone(eid: number, obj: THREE.Object3D, time: number): void {
    const total = Math.max(0.01, SkillZone.totalDelay[eid]);
    const rem = Math.max(0, SkillZone.delayTimer[eid]);
    const prog = Math.min(1, 1 - rem / total);

    if (SkillZone.isBeam[eid] === 1) {
      const beamFill = obj.getObjectByName('beamFill');
      if (SkillZone.triggered[eid] === 1) {
        obj.visible = false;
      } else if (beamFill) {
        beamFill.scale.set(Math.max(0.08, prog), 1, 1);
      }
      return;
    }

    if (SkillZone.isBarrier[eid] === 1) {
      const wall = obj.getObjectByName('barrierWall') as THREE.Mesh | undefined;
      if (wall) {
        wall.rotation.y = time * 1.5;
        (wall.material as THREE.MeshBasicMaterial).opacity =
          0.32 + 0.16 * Math.sin(time * 5.0);
      }
      return;
    }

    const fill = obj.getObjectByName('fillDisc');
    if (fill) {
      fill.scale.setScalar(Math.max(0.05, prog));
    }
    const runeRing = obj.getObjectByName('runeRing');
    if (runeRing) {
      runeRing.rotation.z = time * 2.8;
    }
  }

  private animateProjectile(
    obj: THREE.Object3D,
    px: number,
    py: number,
    pz: number,
    dt: number
  ): void {
    obj.rotation.z += 0.25;
    if (!obj.userData.isFireball) return;

    obj.userData.trailTimer = (obj.userData.trailTimer ?? 0) - dt;
    if (obj.userData.trailTimer <= 0) {
      obj.userData.trailTimer = 0.025;
      const pMesh = new THREE.Mesh(
        this.particleGeom,
        new THREE.MeshBasicMaterial({
          color: obj.userData.trailColor ?? 0xf97316,
          transparent: true,
          opacity: 0.85,
          depthWrite: false,
        })
      );
      pMesh.position.set(
        px + (Math.random() - 0.5) * 0.28,
        Math.max(0.3, py + (Math.random() - 0.5) * 0.22),
        pz + (Math.random() - 0.5) * 0.28
      );
      this.scene.add(pMesh);
      this.effects.push({
        mesh: pMesh,
        age: 0,
        duration: 0.26,
        kind: 'particle',
        startScale: 1.05,
        endScale: 0.1,
        baseOpacity: 0.85,
      });
    }
  }

  public updateSkillIndicators(params: {
    mode: SkillIndicatorMode;
    skillKind?: SkillKind;
    playerX: number;
    playerZ: number;
    cursorX: number;
    cursorZ: number;
    range: number;
    aoeRadius: number;
    color: number;
    hoveredEid: number;
  }): void {
    if (params.hoveredEid >= 0 && this.world.isAliveUnit(params.hoveredEid)) {
      const hx = Transform.x[params.hoveredEid];
      const hz = Transform.z[params.hoveredEid];
      const hr = Transform.radius[params.hoveredEid] * 1.2;
      this.hoverRing.position.set(hx, 0.15, hz);
      this.hoverRing.scale.setScalar(hr);
      this.hoverRing.visible = true;
    } else {
      this.hoverRing.visible = false;
    }

    if (params.mode === 'none') {
      this.rangeCircle.visible = false;
      this.dirArrowGroup.visible = false;
      this.conePreviewMesh.visible = false;
      this.aoeCursorGroup.visible = false;
      this.beamPreviewGroup.visible = false;
      return;
    }

    const kind =
      params.skillKind ??
      (params.mode === 'Q' || params.mode === 'E' || params.mode === 'D'
        ? 'linear_projectile'
        : params.mode === 'W'
          ? 'ground_aoe'
          : params.mode === 'R'
            ? 'channeled_beam'
            : undefined);

    const ringRadius =
      kind === 'self_buff_pulse' || kind === 'self_empower'
        ? Math.max(2.5, params.aoeRadius)
        : params.mode === 'F'
          ? Math.max(2.2, params.range)
          : Math.min(28, params.range);
    (this.rangeCircle.material as THREE.MeshBasicMaterial).color.setHex(params.color);
    this.rangeCircle.position.set(params.playerX, 0.14, params.playerZ);
    this.rangeCircle.scale.setScalar(ringRadius);
    this.rangeCircle.visible = true;

    const dx = params.cursorX - params.playerX;
    const dz = params.cursorZ - params.playerZ;
    const dist = Math.hypot(dx, dz);
    const ang = Math.atan2(dx, dz);

    this.dirArrowGroup.visible = false;
    this.conePreviewMesh.visible = false;
    this.aoeCursorGroup.visible = false;
    this.beamPreviewGroup.visible = false;

    if (kind === 'linear_projectile' || kind === 'dash' || kind === 'stance_wave') {
      const len =
        kind === 'dash' ? Math.min(params.range, Math.max(2.0, dist)) : params.range;
      this.dirArrowGroup.position.set(params.playerX, 0.16, params.playerZ);
      this.dirArrowGroup.rotation.y = ang;

      const shaft = this.dirArrowGroup.getObjectByName('shaft') as THREE.Mesh;
      const tip = this.dirArrowGroup.getObjectByName('tip') as THREE.Mesh;
      if (shaft) {
        shaft.scale.set(Math.max(0.8, params.aoeRadius), 1, Math.max(1, len - 1.2));
        (shaft.material as THREE.MeshBasicMaterial).color.setHex(params.color);
      }
      if (tip) {
        tip.position.set(0, 0, len - 0.5);
        (tip.material as THREE.MeshBasicMaterial).color.setHex(params.color);
      }
      this.dirArrowGroup.visible = true;
    } else if (kind === 'cone_slash') {
      this.conePreviewMesh.position.set(params.playerX, 0.16, params.playerZ);
      this.conePreviewMesh.rotation.y = ang;
      this.conePreviewMesh.scale.setScalar(Math.max(2.5, params.range));
      (this.conePreviewMesh.material as THREE.MeshBasicMaterial).color.setHex(params.color);
      this.conePreviewMesh.visible = true;
    } else if (kind === 'ground_aoe' || kind === 'targeted_blink') {
      const clampedDist = Math.min(params.range, dist);
      const nx = dist > 0.01 ? dx / dist : 0;
      const nz = dist > 0.01 ? dz / dist : 1;
      this.aoeCursorGroup.position.set(
        params.playerX + nx * clampedDist,
        0.17,
        params.playerZ + nz * clampedDist
      );
      this.aoeCursorGroup.scale.setScalar(Math.max(1.0, params.aoeRadius));
      const aoeRing = this.aoeCursorGroup.getObjectByName('aoeRing') as THREE.Mesh | undefined;
      const aoeFill = this.aoeCursorGroup.getObjectByName('aoeFill') as THREE.Mesh | undefined;
      if (aoeRing) (aoeRing.material as THREE.MeshBasicMaterial).color.setHex(params.color);
      if (aoeFill) (aoeFill.material as THREE.MeshBasicMaterial).color.setHex(params.color);
      this.aoeCursorGroup.visible = true;
    } else if (kind === 'channeled_beam') {
      const len = Math.min(85, params.range || 22);
      const wid = params.aoeRadius > 1.6 ? params.aoeRadius * 2 : Math.max(2.5, params.aoeRadius * 2);
      this.beamPreviewGroup.position.set(params.playerX, 0.17, params.playerZ);
      this.beamPreviewGroup.rotation.y = ang;
      const strip = this.beamPreviewGroup.getObjectByName('beamStrip') as THREE.Mesh | undefined;
      const center = this.beamPreviewGroup.getObjectByName('beamCenter') as THREE.Mesh | undefined;
      if (strip) {
        strip.scale.set(wid, 1, len);
        (strip.material as THREE.MeshBasicMaterial).color.setHex(params.color);
      }
      if (center) {
        center.scale.set(1, 1, len);
      }
      this.beamPreviewGroup.visible = true;
    }
  }

  public dispose(): void {
    this.hitboxGeom.disposeBoundsTree();
    this.hitboxGeom.dispose();
    this.champHitboxGeom.disposeBoundsTree();
    this.champHitboxGeom.dispose();
    this.particleGeom.dispose();
    this.dashTrailGeom.dispose();
    for (const g of this.disposableGeoms) {
      if (g.boundsTree) g.disposeBoundsTree();
      g.dispose();
    }
    this.disposableGeoms = [];
    for (const m of this.disposableMats) m.dispose();
    this.disposableMats = [];
    this.riverMaterial.dispose();
    for (const m of this.nexusMaterials) m.dispose();
    this.nexusMaterials = [];
    this.effects = [];
  }
}
