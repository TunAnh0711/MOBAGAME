import * as THREE from 'three';
import { EventBus } from '../core/EventBus';
import { GameWorld } from '../ecs/World';

interface FloatingText {
  el: HTMLDivElement;
  wx: number;
  wy: number;
  wz: number;
  offsetX: number;
  age: number;
  duration: number;
  isBig: boolean;
}

export class DamageNumbers {
  private container: HTMLDivElement;
  private camera: THREE.PerspectiveCamera;
  private world?: GameWorld;
  private items: FloatingText[] = [];
  private projVec = new THREE.Vector3();
  private unsubDamage: () => void;
  private unsubHeal: () => void;
  private unsubGold: () => void;

  constructor(
    parent: HTMLElement,
    camera: THREE.PerspectiveCamera,
    bus: EventBus,
    world?: GameWorld
  ) {
    this.camera = camera;
    this.world = world;
    this.container = document.createElement('div');
    this.container.style.cssText =
      'position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:15;';
    parent.appendChild(this.container);

    this.unsubDamage = bus.on('damage', (ev) => {
      if (this.world && ev.targetEid >= 0 && !this.world.isVisibleToPlayer(ev.targetEid)) {
        return;
      }
      const color =
        ev.damageType === 'magic'
          ? '#c084fc'
          : ev.damageType === 'true'
            ? '#f8fafc'
            : ev.isCrit
              ? '#ef4444'
              : '#fb923c';
      const amt = Math.max(1, Math.round(ev.amount));
      const label = ev.isCrit ? `-${amt}!` : `-${amt}`;
      this.spawn(label, ev.x, ev.y, ev.z, color, !!ev.isCrit);
    });

    this.unsubHeal = bus.on('heal', (ev) => {
      if (this.world && ev.targetEid >= 0 && !this.world.isVisibleToPlayer(ev.targetEid)) {
        return;
      }
      const amt = Math.round(ev.amount);
      if (amt <= 0) return;
      this.spawn(`+${amt}`, ev.x, ev.y, ev.z, '#34d399', true);
    });

    this.unsubGold = bus.on('gold', (ev) => {
      if (
        this.world &&
        ev.targetEid >= 0 &&
        ev.targetEid !== this.world.playerEid &&
        !this.world.isVisibleToPlayer(ev.targetEid)
      ) {
        return;
      }
      const amt = Math.round(ev.amount);
      if (amt <= 0) return;
      this.spawn(`+${amt}g`, ev.x, ev.y + 0.4, ev.z, '#fde047', true);
    });
  }

  public setWorld(world: GameWorld): void {
    this.world = world;
  }

  private spawn(
    text: string,
    wx: number,
    wy: number,
    wz: number,
    color: string,
    isBig: boolean
  ): void {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = `position:absolute;left:0;top:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-weight:${
      isBig ? '900' : '800'
    };font-size:${
      isBig ? '17px' : '13px'
    };color:${color};text-shadow:0 2px 3px rgba(0,0,0,0.98),0 0 6px rgba(0,0,0,0.85);white-space:nowrap;will-change:transform,opacity;pointer-events:none;`;
    this.container.appendChild(el);

    this.items.push({
      el,
      wx,
      wy,
      wz,
      offsetX: (Math.random() - 0.5) * 26,
      age: 0,
      duration: isBig ? 1.05 : 0.82,
      isBig,
    });
  }

  public update(dt: number): void {
    const w = window.innerWidth;
    const h = window.innerHeight;

    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];
      item.age += dt;
      const p = item.age / item.duration;

      if (p >= 1) {
        item.el.remove();
        this.items.splice(i, 1);
        continue;
      }

      this.projVec.set(item.wx, item.wy + p * 1.5, item.wz).project(this.camera);
      if (this.projVec.z > 1 || this.projVec.z < -1) {
        item.el.style.display = 'none';
        continue;
      }

      const sx = (this.projVec.x * 0.5 + 0.5) * w + item.offsetX;
      const sy = (-this.projVec.y * 0.5 + 0.5) * h - p * 38;
      const pop = p < 0.2 ? 1.0 + Math.sin((p / 0.2) * Math.PI) * (item.isBig ? 0.34 : 0.18) : 1.0;

      item.el.style.display = 'block';
      item.el.style.opacity = p > 0.62 ? `${Math.max(0, 1 - (p - 0.62) / 0.38)}` : '1';
      item.el.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -50%) scale(${pop.toFixed(2)})`;
    }
  }

  public clear(): void {
    for (let i = 0; i < this.items.length; i++) {
      this.items[i].el.remove();
    }
    this.items = [];
  }

  public dispose(): void {
    this.unsubDamage();
    this.unsubHeal();
    this.unsubGold();
    this.clear();
    this.container.remove();
  }
}
