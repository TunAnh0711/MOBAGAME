import * as THREE from 'three';
import { GameWorld, MAP_HALF_SIZE, NEXUS_BLUE_POS } from '../ecs/World';
import { Transform } from '../ecs/Components';
import { EventBus } from './EventBus';

const BASE_CAM_Y = 28;
const BASE_CAM_Z_OFFSET = 22;
const MIN_ZOOM = 0.65;
const MAX_ZOOM = 1.55;

export class CameraController {
  public camera: THREE.PerspectiveCamera;
  public focusX = NEXUS_BLUE_POS.x;
  public focusZ = NEXUS_BLUE_POS.z;
  public isLocked = false;
  public spaceHeld = false;
  public blockedByModal = false;

  private world: GameWorld;
  private domElement: HTMLElement;
  private zoomScale = 1.0;
  private targetZoomScale = 1.0;
  private mouseX = -1;
  private mouseY = -1;
  private mouseInside = false;
  private mouseOverUI = false;
  private isMiddleDragging = false;
  private lastDragX = 0;
  private lastDragY = 0;
  private shakeIntensity = 0;

  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private abortCtrl = new AbortController();

  constructor(
    camera: THREE.PerspectiveCamera,
    domElement: HTMLElement,
    world: GameWorld,
    bus: EventBus
  ) {
    this.camera = camera;
    this.domElement = domElement;
    this.world = world;

    bus.on('cameraShake', (ev) => {
      this.shakeIntensity = Math.min(1.2, this.shakeIntensity + ev.intensity);
    });

    this.bindEvents();
    this.applyCameraTransform(0);
  }

  private bindEvents(): void {
    const signal = this.abortCtrl.signal;

    window.addEventListener(
      'mousemove',
      (e) => {
        this.mouseX = e.clientX;
        this.mouseY = e.clientY;
        this.mouseInside = true;
        const target = e.target as HTMLElement | null;
        this.mouseOverUI = Boolean(target?.closest('.moba-ui-interactive')) || target !== this.domElement;

        if (this.isMiddleDragging) {
          if (this.blockedByModal) {
            this.isMiddleDragging = false;
            return;
          }
          const dx = e.clientX - this.lastDragX;
          const dy = e.clientY - this.lastDragY;
          this.lastDragX = e.clientX;
          this.lastDragY = e.clientY;
          const scale = 0.068 * this.zoomScale;
          this.focusX -= dx * scale;
          this.focusZ -= dy * scale;
          this.clampFocus();
        }
      },
      { signal }
    );

    document.documentElement.addEventListener(
      'mouseleave',
      () => {
        this.mouseInside = false;
        this.mouseOverUI = false;
        this.isMiddleDragging = false;
      },
      { signal }
    );

    window.addEventListener(
      'blur',
      () => {
        this.mouseInside = false;
        this.mouseOverUI = false;
        this.isMiddleDragging = false;
        this.spaceHeld = false;
      },
      { signal }
    );

    this.domElement.addEventListener(
      'mousedown',
      (e) => {
        const target = e.target as HTMLElement | null;
        if (target?.closest('.moba-ui-interactive') || e.target !== this.domElement) return;
        if (this.blockedByModal) return;
        if (e.button === 1) {
          e.preventDefault();
          this.isMiddleDragging = true;
          this.lastDragX = e.clientX;
          this.lastDragY = e.clientY;
        }
      },
      { signal }
    );

    window.addEventListener(
      'mouseup',
      (e) => {
        if (e.button === 1) {
          this.isMiddleDragging = false;
        }
      },
      { signal }
    );

    this.domElement.addEventListener(
      'wheel',
      (e) => {
        const target = e.target as HTMLElement | null;
        if (target?.closest('.moba-ui-interactive') || e.target !== this.domElement) return;
        if (this.blockedByModal) return;
        e.preventDefault();
        this.targetZoomScale = Math.max(
          MIN_ZOOM,
          Math.min(MAX_ZOOM, this.targetZoomScale + Math.sign(e.deltaY) * 0.085)
        );
      },
      { passive: false, signal }
    );
  }

  public dispose(): void {
    this.abortCtrl.abort();
  }

  public panTo(x: number, z: number): void {
    this.focusX = x;
    this.focusZ = z;
    this.clampFocus();
    this.applyCameraTransform(0);
  }

  public snapToPlayer(): void {
    const pid = this.world.playerEid;
    if (pid < 0) return;
    const vis = this.world.visuals.get(pid);
    if (vis) {
      this.focusX = vis.position.x;
      this.focusZ = vis.position.z;
    } else {
      this.focusX = Transform.x[pid];
      this.focusZ = Transform.z[pid];
    }
    this.clampFocus();
    this.applyCameraTransform(0);
  }

  public toggleLock(): boolean {
    this.isLocked = !this.isLocked;
    if (this.isLocked) this.snapToPlayer();
    return this.isLocked;
  }

  public update(dt: number): void {
    // Smooth zoom
    this.zoomScale += (this.targetZoomScale - this.zoomScale) * Math.min(1, dt * 12);

    const pid = this.world.playerEid;
    if ((this.spaceHeld || this.isLocked) && pid >= 0) {
      const vis = this.world.visuals.get(pid);
      const px = vis ? vis.position.x : Transform.x[pid];
      const pz = vis ? vis.position.z : Transform.z[pid];
      const lerpFactor = Math.min(1, dt * 16);
      this.focusX += (px - this.focusX) * lerpFactor;
      this.focusZ += (pz - this.focusZ) * lerpFactor;
    } else if (this.mouseInside && !this.mouseOverUI && !this.isMiddleDragging && !this.blockedByModal) {
      // Edge Panning at all 4 screen edges
      const margin = 22;
      const w = window.innerWidth;
      const h = window.innerHeight;
      const panSpeed = 48 * this.zoomScale;

      let panX = 0;
      let panZ = 0;
      if (this.mouseX >= 0 && this.mouseX < margin) panX = -1;
      else if (this.mouseX > w - margin) panX = 1;

      if (this.mouseY >= 0 && this.mouseY < margin) panZ = -1;
      else if (this.mouseY > h - margin) panZ = 1;

      if (panX !== 0 || panZ !== 0) {
        const len = Math.hypot(panX, panZ);
        this.focusX += (panX / len) * panSpeed * dt;
        this.focusZ += (panZ / len) * panSpeed * dt;
      }
    }

    this.clampFocus();
    this.applyCameraTransform(dt);
  }

  private clampFocus(): void {
    const limit = MAP_HALF_SIZE - 4;
    this.focusX = Math.max(-limit, Math.min(limit, this.focusX));
    this.focusZ = Math.max(-limit, Math.min(limit, this.focusZ));
  }

  private applyCameraTransform(dt: number): void {
    let sx = 0;
    let sz = 0;
    if (this.shakeIntensity > 0.005) {
      sx = (Math.random() - 0.5) * this.shakeIntensity * 1.4;
      sz = (Math.random() - 0.5) * this.shakeIntensity * 1.4;
      this.shakeIntensity = Math.max(0, this.shakeIntensity - dt * 2.8);
    } else {
      this.shakeIntensity = 0;
    }

    const camY = BASE_CAM_Y * this.zoomScale;
    const camZOffset = BASE_CAM_Z_OFFSET * this.zoomScale;

    this.camera.position.set(this.focusX + sx, camY, this.focusZ + camZOffset + sz);
    this.camera.lookAt(this.focusX + sx, 0.25, this.focusZ + sz);
    this.camera.updateMatrixWorld();
  }

  public getViewportGroundBounds(): Array<{ x: number; z: number }> {
    const corners = [
      new THREE.Vector2(-1, 1),
      new THREE.Vector2(1, 1),
      new THREE.Vector2(1, -1),
      new THREE.Vector2(-1, -1),
    ];
    const out: Array<{ x: number; z: number }> = [];
    const hit = new THREE.Vector3();
    for (const c of corners) {
      this.raycaster.setFromCamera(c, this.camera);
      if (this.raycaster.ray.intersectPlane(this.groundPlane, hit)) {
        out.push({ x: hit.x, z: hit.z });
      }
    }
    return out;
  }
}
