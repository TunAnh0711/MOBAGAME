import { query } from 'bitecs';
import {
  Transform,
  Movement,
  Team,
  UnitType,
  Stats,
  StatusEffects,
  Combat,
  SkillBook,
  SkillZone,
  Vision,
  STATE_ALIVE,
  UNIT_CHAMPION,
  UNIT_MINION,
  UNIT_MONSTER,
} from '../Components';
import { GameWorld, MAP_HALF_SIZE, PATH_GRID_SIZE, Waypoint } from '../World';

export function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function lerpAngle(current: number, target: number, t: number): number {
  const diff = normalizeAngle(target - current);
  return normalizeAngle(current + diff * t);
}

interface ActiveBarrier {
  x: number;
  z: number;
  r: number;
  team: number;
}

const GRID_TOTAL = PATH_GRID_SIZE * PATH_GRID_SIZE;
const ASTAR_DIRS: readonly [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

export class NavigationSystem {
  private world: GameWorld;
  private lastActiveObstacleCount = -1;

  // Reusable A* buffers for 80x80 walkGrid (zero per-call TypedArray allocation)
  private gScore = new Float32Array(GRID_TOTAL);
  private fScore = new Float32Array(GRID_TOTAL);
  private cameFrom = new Int32Array(GRID_TOTAL);
  private closed = new Uint8Array(GRID_TOTAL);
  private inOpen = new Uint8Array(GRID_TOTAL);
  private openHeap: number[] = [];

  constructor(world: GameWorld) {
    this.world = world;
  }

  /**
   * Computes a 2D A* path on the 80x80 walkGrid (3.0u cells) with line-of-sight string-pulling smoothing.
   */
  public commandMoveTo(eid: number, destX: number, destZ: number, attackMove = false): void {
    const clampedX = Math.max(-MAP_HALF_SIZE + 2.5, Math.min(MAP_HALF_SIZE - 2.5, destX));
    const clampedZ = Math.max(-MAP_HALF_SIZE + 2.5, Math.min(MAP_HALF_SIZE - 2.5, destZ));

    // Cancel recall when issuing move
    SkillBook.isRecalling[eid] = 0;
    SkillBook.recallTimer[eid] = 0;

    Movement.attackMove[eid] = attackMove ? 1 : 0;

    const sx = Transform.x[eid];
    const sz = Transform.z[eid];
    const losPad = Math.max(0.75, Transform.radius[eid] * 0.85);

    if (this.hasLineOfSight(sx, sz, clampedX, clampedZ, losPad)) {
      this.world.entityPaths.delete(eid);
      Movement.targetX[eid] = clampedX;
      Movement.targetZ[eid] = clampedZ;
      Movement.hasTarget[eid] = 1;
      return;
    }

    const existing = this.world.entityPaths.get(eid);
    if (existing && existing.length > 0 && Movement.hasTarget[eid] === 1) {
      const end = existing[existing.length - 1];
      if (
        Math.hypot(end.x - clampedX, end.z - clampedZ) < 1.8 &&
        this.hasLineOfSight(sx, sz, Movement.targetX[eid], Movement.targetZ[eid], 0.65)
      ) {
        return;
      }
    }

    const path = this.findGridPath(sx, sz, clampedX, clampedZ, losPad);
    if (path.length > 0) {
      this.world.entityPaths.set(eid, path);
      Movement.targetX[eid] = path[0].x;
      Movement.targetZ[eid] = path[0].z;
      Movement.hasTarget[eid] = 1;
    } else {
      this.world.entityPaths.delete(eid);
      Movement.targetX[eid] = clampedX;
      Movement.targetZ[eid] = clampedZ;
      Movement.hasTarget[eid] = 1;
    }
  }

  /**
   * Exact 2D segment-vs-circle obstacle line-of-sight check against active map obstacles.
   */
  private hasLineOfSight(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    extraRadius = 0.85
  ): boolean {
    if (Math.abs(x1) > MAP_HALF_SIZE - 2.0 || Math.abs(z1) > MAP_HALF_SIZE - 2.0) {
      return false;
    }

    const dx = x1 - x0;
    const dz = z1 - z0;
    const lenSq = dx * dx + dz * dz;
    if (lenSq < 1e-6) {
      return this.world.isPointWalkable(x1, z1, extraRadius);
    }

    const obstacles = this.world.obstacles;
    for (let i = 0; i < obstacles.length; i++) {
      const obs = obstacles[i];
      if (!this.world.isObstacleActive(obs)) continue;

      const r = obs.radius + extraRadius;
      let t = ((obs.x - x0) * dx + (obs.z - z0) * dz) / lenSq;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;

      const px = x0 + t * dx;
      const pz = z0 + t * dz;
      const odx = px - obs.x;
      const odz = pz - obs.z;
      if (odx * odx + odz * odz < r * r) {
        if (t === 0) {
          const startDistSq = (x0 - obs.x) * (x0 - obs.x) + (z0 - obs.z) * (z0 - obs.z);
          const endDistSq = (x1 - obs.x) * (x1 - obs.x) + (z1 - obs.z) * (z1 - obs.z);
          if (endDistSq >= startDistSq && endDistSq >= r * r) {
            continue;
          }
        }
        return false;
      }
    }
    return true;
  }

  private findNearestWalkableCell(gx: number, gz: number): { gx: number; gz: number } {
    const grid = this.world.walkGrid;
    if (grid[gz * PATH_GRID_SIZE + gx] === 0) return { gx, gz };
    let bestGx = gx;
    let bestGz = gz;
    let bestDistSq = Infinity;

    for (let r = 1; r <= 12; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          const nx = gx + dx;
          const nz = gz + dz;
          if (nx >= 0 && nx < PATH_GRID_SIZE && nz >= 0 && nz < PATH_GRID_SIZE) {
            if (grid[nz * PATH_GRID_SIZE + nx] === 0) {
              const dSq = dx * dx + dz * dz;
              if (dSq < bestDistSq) {
                bestDistSq = dSq;
                bestGx = nx;
                bestGz = nz;
              }
            }
          }
        }
      }
      if (bestDistSq < Infinity) return { gx: bestGx, gz: bestGz };
    }
    return { gx, gz };
  }

  private heapPush(nodeIdx: number): void {
    const heap = this.openHeap;
    const f = this.fScore;
    let i = heap.length;
    heap.push(nodeIdx);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const pIdx = heap[parent];
      if (f[pIdx] <= f[nodeIdx]) break;
      heap[i] = pIdx;
      i = parent;
    }
    heap[i] = nodeIdx;
  }

  private heapPop(): number {
    const heap = this.openHeap;
    const f = this.fScore;
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      let i = 0;
      const len = heap.length;
      const lastF = f[last];
      while (true) {
        const left = (i << 1) + 1;
        const right = left + 1;
        if (left >= len) break;
        let smallest = left;
        if (right < len && f[heap[right]] < f[heap[left]]) {
          smallest = right;
        }
        if (lastF <= f[heap[smallest]]) break;
        heap[i] = heap[smallest];
        i = smallest;
      }
      heap[i] = last;
    }
    return top;
  }

  private findGridPath(
    sx: number,
    sz: number,
    ex: number,
    ez: number,
    losPad = 0.85
  ): Waypoint[] {
    const startRaw = this.world.worldToGrid(sx, sz);
    const goalRaw = this.world.worldToGrid(ex, ez);
    const start = this.findNearestWalkableCell(startRaw.gx, startRaw.gz);
    const goal = this.findNearestWalkableCell(goalRaw.gx, goalRaw.gz);

    const N = PATH_GRID_SIZE;
    const startIdx = start.gz * N + start.gx;
    const goalIdx = goal.gz * N + goal.gx;

    if (startIdx === goalIdx) {
      if (this.world.isPointWalkable(ex, ez, 0.7)) {
        return [{ x: ex, z: ez }];
      }
      return [this.world.gridToWorld(goal.gx, goal.gz)];
    }

    this.gScore.fill(1e9);
    this.fScore.fill(1e9);
    this.cameFrom.fill(-1);
    this.closed.fill(0);
    this.inOpen.fill(0);
    this.openHeap.length = 0;

    this.gScore[startIdx] = 0;
    this.fScore[startIdx] = Math.hypot(goal.gx - start.gx, goal.gz - start.gz);
    this.heapPush(startIdx);
    this.inOpen[startIdx] = 1;

    let iterations = 0;
    const maxIterations = GRID_TOTAL;
    let found = false;

    while (this.openHeap.length > 0 && iterations < maxIterations) {
      iterations++;
      const current = this.heapPop();
      if (this.closed[current] === 1) continue;
      this.inOpen[current] = 0;
      this.closed[current] = 1;

      if (current === goalIdx) {
        found = true;
        break;
      }

      const cx = current % N;
      const cz = Math.floor(current / N);

      for (let d = 0; d < ASTAR_DIRS.length; d++) {
        const dx = ASTAR_DIRS[d][0];
        const dz = ASTAR_DIRS[d][1];
        const nx = cx + dx;
        const nz = cz + dz;
        if (nx < 0 || nx >= N || nz < 0 || nz >= N) continue;

        const nIdx = nz * N + nx;
        if (this.closed[nIdx] === 1 || this.world.walkGrid[nIdx] === 1) continue;

        if (dx !== 0 && dz !== 0) {
          if (
            this.world.walkGrid[cz * N + nx] === 1 ||
            this.world.walkGrid[nz * N + cx] === 1
          ) {
            continue;
          }
        }

        const tentativeG = this.gScore[current] + ASTAR_DIRS[d][2];
        if (tentativeG < this.gScore[nIdx]) {
          this.cameFrom[nIdx] = current;
          this.gScore[nIdx] = tentativeG;
          this.fScore[nIdx] = tentativeG + Math.hypot(goal.gx - nx, goal.gz - nz);
          this.heapPush(nIdx);
          this.inOpen[nIdx] = 1;
        }
      }
    }

    if (!found) return [];

    const rawPoints: Waypoint[] = [];
    let curr = goalIdx;
    while (curr !== -1 && curr !== startIdx) {
      const gx = curr % N;
      const gz = Math.floor(curr / N);
      rawPoints.push(this.world.gridToWorld(gx, gz));
      curr = this.cameFrom[curr];
    }
    rawPoints.reverse();
    if (rawPoints.length > 0 && this.world.isPointWalkable(ex, ez, 0.7)) {
      rawPoints[rawPoints.length - 1] = { x: ex, z: ez };
    }

    const smoothed: Waypoint[] = [];
    let anchorX = sx;
    let anchorZ = sz;
    let idx = 0;
    while (idx < rawPoints.length) {
      let furthest = idx;
      for (let j = rawPoints.length - 1; j > idx; j--) {
        if (this.hasLineOfSight(anchorX, anchorZ, rawPoints[j].x, rawPoints[j].z, losPad)) {
          furthest = j;
          break;
        }
      }
      smoothed.push(rawPoints[furthest]);
      anchorX = rawPoints[furthest].x;
      anchorZ = rawPoints[furthest].z;
      idx = furthest + 1;
    }

    return smoothed;
  }

  public update(dt: number): void {
    // Keep walkGrid synced if a turret/nexus obstacle was destroyed
    let activeObsCount = 0;
    for (let i = 0; i < this.world.obstacles.length; i++) {
      if (this.world.isObstacleActive(this.world.obstacles[i])) {
        activeObsCount++;
      }
    }
    if (this.lastActiveObstacleCount !== -1 && activeObsCount !== this.lastActiveObstacleCount) {
      this.world.rebuildWalkGrid();
    }
    this.lastActiveObstacleCount = activeObsCount;

    // Collect active circular barrier walls (e.g. TITAN R arena barrier)
    const zones = query(this.world.ecs, [Transform, SkillZone]);
    const barriers: ActiveBarrier[] = [];
    for (let i = 0; i < zones.length; i++) {
      const zid = zones[i];
      if (SkillZone.isBarrier[zid] === 1 && SkillZone.durationTimer[zid] > 0) {
        const r =
          SkillZone.barrierRadius[zid] > 0 ? SkillZone.barrierRadius[zid] : SkillZone.radius[zid];
        if (r > 0.5) {
          barriers.push({
            x: Transform.x[zid],
            z: Transform.z[zid],
            r,
            team: SkillZone.team[zid],
          });
        }
      }
    }

    const movables = query(this.world.ecs, [Transform, Movement, Team, UnitType, Stats]);
    const aliveMovables: number[] = [];

    for (let i = 0; i < movables.length; i++) {
      const eid = movables[i];
      if (UnitType.state[eid] === STATE_ALIVE) {
        aliveMovables.push(eid);
      }
    }

    const rotLerp = Math.min(1, 1 - Math.exp(-13 * dt));

    // 1. Movement, Dash Execution & Smooth Facing Rotation
    for (let i = 0; i < aliveMovables.length; i++) {
      const eid = aliveMovables[i];

      // Lock movement & dash when stunned or rooted
      if (StatusEffects.stunTimer[eid] > 0 || StatusEffects.rootTimer[eid] > 0) {
        Movement.vx[eid] = 0;
        Movement.vz[eid] = 0;
        Movement.isDashing[eid] = 0;
        continue;
      }

      if (Movement.isDashing[eid] === 1) {
        const dx = Movement.dashEndX[eid] - Transform.x[eid];
        const dz = Movement.dashEndZ[eid] - Transform.z[eid];
        const dist = Math.hypot(dx, dz);
        const step = Movement.dashSpeed[eid] * dt;
        if (dist <= step || dist < 0.15) {
          Transform.x[eid] = Movement.dashEndX[eid];
          Transform.z[eid] = Movement.dashEndZ[eid];
          Movement.isDashing[eid] = 0;
          Movement.vx[eid] = 0;
          Movement.vz[eid] = 0;
        } else {
          const nx = dx / dist;
          const nz = dz / dist;
          Movement.vx[eid] = nx * Movement.dashSpeed[eid];
          Movement.vz[eid] = nz * Movement.dashSpeed[eid];
          Transform.x[eid] += nx * step;
          Transform.z[eid] += nz * step;
          Transform.rotY[eid] = lerpAngle(Transform.rotY[eid], Math.atan2(nx, nz), 0.75);
        }
        continue;
      }

      // Pause translation while firing attack windup and turn toward target
      if (Combat.isWindingUp[eid] === 1) {
        Movement.vx[eid] = 0;
        Movement.vz[eid] = 0;
        const target = Combat.targetEid[eid];
        if (target >= 0 && this.world.isAliveUnit(target)) {
          const tx = Transform.x[target] - Transform.x[eid];
          const tz = Transform.z[target] - Transform.z[eid];
          if (tx * tx + tz * tz > 0.001) {
            Transform.rotY[eid] = lerpAngle(
              Transform.rotY[eid],
              Math.atan2(tx, tz),
              Math.min(1, 1 - Math.exp(-18 * dt))
            );
          }
        }
        continue;
      }

      if (Movement.hasTarget[eid] === 1) {
        const path = this.world.entityPaths.get(eid);
        const dx = Movement.targetX[eid] - Transform.x[eid];
        const dz = Movement.targetZ[eid] - Transform.z[eid];
        const dist = Math.hypot(dx, dz);

        if (path && path.length > 1 && dist < 1.35) {
          path.shift();
          Movement.targetX[eid] = path[0].x;
          Movement.targetZ[eid] = path[0].z;
        } else if (dist < 0.35) {
          if (path && path.length > 1) {
            path.shift();
            Movement.targetX[eid] = path[0].x;
            Movement.targetZ[eid] = path[0].z;
          } else {
            this.world.entityPaths.delete(eid);
            Movement.hasTarget[eid] = 0;
            Movement.attackMove[eid] = 0;
            Movement.vx[eid] = 0;
            Movement.vz[eid] = 0;
            continue;
          }
        }

        const curDx = Movement.targetX[eid] - Transform.x[eid];
        const curDz = Movement.targetZ[eid] - Transform.z[eid];
        const curDist = Math.hypot(curDx, curDz);

        if (curDist > 0.01) {
          const dirX = curDx / curDist;
          const dirZ = curDz / curDist;
          const slow =
            StatusEffects.slowTimer[eid] > 0
              ? Math.max(0, Math.min(0.85, StatusEffects.slowPercent[eid]))
              : 0;
          const baseWithItems = Math.max(2.0, Movement.baseSpeed[eid] + Stats.moveSpeedBonus[eid]);
          const effectiveSpeed =
            baseWithItems * Math.max(0.25, Movement.speedMult[eid] * (1 - slow));
          const step = Math.min(curDist, effectiveSpeed * dt);

          Movement.vx[eid] = dirX * effectiveSpeed;
          Movement.vz[eid] = dirZ * effectiveSpeed;
          Transform.x[eid] += dirX * step;
          Transform.z[eid] += dirZ * step;

          const desiredRot = Math.atan2(dirX, dirZ);
          Transform.rotY[eid] = lerpAngle(Transform.rotY[eid], desiredRot, rotLerp);
        }
      } else {
        Movement.vx[eid] = 0;
        Movement.vz[eid] = 0;

        const target = Combat.targetEid[eid];
        if (target >= 0 && this.world.isAliveUnit(target)) {
          const tx = Transform.x[target] - Transform.x[eid];
          const tz = Transform.z[target] - Transform.z[eid];
          if (tx * tx + tz * tz > 0.001) {
            Transform.rotY[eid] = lerpAngle(Transform.rotY[eid], Math.atan2(tx, tz), rotLerp);
          }
        }
      }
    }

    // 2. Local Avoidance (2D circular radius separation steering)
    const count = aliveMovables.length;
    for (let i = 0; i < count; i++) {
      const a = aliveMovables[i];
      if (Movement.isDashing[a] === 1) continue;
      for (let j = i + 1; j < count; j++) {
        const b = aliveMovables[j];
        if (Movement.isDashing[b] === 1) continue;

        const dx = Transform.x[b] - Transform.x[a];
        const dz = Transform.z[b] - Transform.z[a];
        const minDist = Transform.radius[a] + Transform.radius[b] + 0.28;
        const softDist = minDist + 0.45;
        const distSq = dx * dx + dz * dz;

        if (distSq < softDist * softDist) {
          const dist = Math.sqrt(distSq);
          const nx = dist > 0.001 ? dx / dist : Math.cos((a * 1.73 + b * 2.41) % (Math.PI * 2));
          const nz = dist > 0.001 ? dz / dist : Math.sin((a * 1.73 + b * 2.41) % (Math.PI * 2));

          const aIsChamp = UnitType.kind[a] === UNIT_CHAMPION;
          const bIsChamp = UnitType.kind[b] === UNIT_CHAMPION;
          const aMoving = Movement.hasTarget[a] === 1;
          const bMoving = Movement.hasTarget[b] === 1;

          let pushA = 0.5;
          let pushB = 0.5;
          if (aIsChamp && !bIsChamp) {
            pushA = 0.15;
            pushB = 0.85;
          } else if (!aIsChamp && bIsChamp) {
            pushA = 0.85;
            pushB = 0.15;
          } else if (!aMoving && bMoving) {
            pushA = 0.25;
            pushB = 0.75;
          } else if (aMoving && !bMoving) {
            pushA = 0.75;
            pushB = 0.25;
          }

          if (dist < minDist) {
            const overlap = minDist - dist;
            const force = Math.min(overlap * 0.5, 0.35);
            Transform.x[a] -= nx * force * pushA;
            Transform.z[a] -= nz * force * pushA;
            Transform.x[b] += nx * force * pushB;
            Transform.z[b] += nz * force * pushB;
          } else if (aMoving || bMoving) {
            const softFactor = (softDist - dist) / (softDist - minDist);
            const steer = softFactor * 0.85 * dt;
            if (aMoving) {
              Transform.x[a] -= nx * steer * pushA;
              Transform.z[a] -= nz * steer * pushA;
            }
            if (bMoving) {
              Transform.x[b] += nx * steer * pushB;
              Transform.z[b] += nz * steer * pushB;
            }
          }
        }
      }
    }

    // 3. Static Obstacle Sliding, Circular Barrier Walls, Map Bounds & Stealth Brush Membership
    for (let i = 0; i < count; i++) {
      const eid = aliveMovables[i];
      const rad = Transform.radius[eid];

      for (let o = 0; o < this.world.obstacles.length; o++) {
        const obs = this.world.obstacles[o];
        if (!this.world.isObstacleActive(obs)) continue;
        const dx = Transform.x[eid] - obs.x;
        const dz = Transform.z[eid] - obs.z;
        const minR = obs.radius + rad;
        const distSq = dx * dx + dz * dz;
        if (distSq < minR * minR) {
          const dist = Math.sqrt(distSq);
          const nx = dist > 0.001 ? dx / dist : 1;
          const nz = dist > 0.001 ? dz / dist : 0;
          Transform.x[eid] = obs.x + nx * minR;
          Transform.z[eid] = obs.z + nz * minR;
        }
      }

      // Enforce circular barrier walls (trapping enemies inside / keeping outside enemies out)
      if (barriers.length > 0 && Movement.isDashing[eid] === 0) {
        const myTeam = Team.id[eid];
        for (let b = 0; b < barriers.length; b++) {
          const bar = barriers[b];
          if (bar.team === myTeam) continue;

          const prevDist = Math.hypot(Transform.prevX[eid] - bar.x, Transform.prevZ[eid] - bar.z);
          const dx = Transform.x[eid] - bar.x;
          const dz = Transform.z[eid] - bar.z;
          const dist = Math.hypot(dx, dz);

          if (prevDist <= bar.r) {
            const maxInside = Math.max(0.5, bar.r - rad);
            if (dist > maxInside && dist > 0.001) {
              Transform.x[eid] = bar.x + (dx / dist) * maxInside;
              Transform.z[eid] = bar.z + (dz / dist) * maxInside;
            }
          } else {
            const minOutside = bar.r + rad;
            if (dist < minOutside) {
              const nx = dist > 0.001 ? dx / dist : 1;
              const nz = dist > 0.001 ? dz / dist : 0;
              Transform.x[eid] = bar.x + nx * minOutside;
              Transform.z[eid] = bar.z + nz * minOutside;
            }
          }
        }
      }

      const limit = MAP_HALF_SIZE - 2.0;
      if (Transform.x[eid] < -limit) Transform.x[eid] = -limit;
      if (Transform.x[eid] > limit) Transform.x[eid] = limit;
      if (Transform.z[eid] < -limit) Transform.z[eid] = -limit;
      if (Transform.z[eid] > limit) Transform.z[eid] = limit;

      let brushId = -1;
      const kind = UnitType.kind[eid];
      if (kind === UNIT_CHAMPION || kind === UNIT_MINION || kind === UNIT_MONSTER) {
        brushId = this.world.findBrushAt(Transform.x[eid], Transform.z[eid]);
      }
      Vision.inBrushId[eid] = brushId;
      UnitType.inBrush[eid] = brushId >= 0 ? 1 : 0;
    }
  }
}
