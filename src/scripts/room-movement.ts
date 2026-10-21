export type RoomPoint = { x: number; y: number };
export type Point = RoomPoint;
export type RoomObstacle = RoomPoint & { width: number; height: number };
export type RoomNavigationMap = {
  width: number;
  height: number;
  bounds: RoomObstacle;
  obstacles?: readonly RoomObstacle[];
  /** Optional floor outline, in the same scene coordinates as the artwork. */
  polygon?: readonly RoomPoint[];
  cellSize?: number;
  clearance?: number;
};

type NavigationGrid = {
  columns: number;
  rows: number;
  point: (index: number) => RoomPoint;
  free: (index: number) => boolean;
  neighbors: (index: number) => number[];
};

const distance = (a: RoomPoint, b: RoomPoint) =>
  Math.hypot(a.x - b.x, a.y - b.y);

function insidePolygon(point: RoomPoint, polygon: readonly RoomPoint[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}

function canStand(point: RoomPoint, map: RoomNavigationMap) {
  const { bounds, obstacles = [], polygon, clearance = 6 } = map;
  if (
    point.x < bounds.x + clearance ||
    point.x > bounds.x + bounds.width - clearance ||
    point.y < bounds.y + clearance ||
    point.y > bounds.y + bounds.height - clearance
  )
    return false;
  if (polygon?.length && !insidePolygon(point, polygon)) return false;
  return !obstacles.some(
    (box) =>
      point.x >= box.x - clearance &&
      point.x <= box.x + box.width + clearance &&
      point.y >= box.y - clearance &&
      point.y <= box.y + box.height + clearance,
  );
}

function buildGrid(map: RoomNavigationMap): NavigationGrid {
  const size = map.cellSize ?? 16;
  const { bounds } = map;
  const columns = Math.ceil(bounds.width / size);
  const rows = Math.ceil(bounds.height / size);
  const point = (index: number) => ({
    x:
      bounds.x +
      Math.min(bounds.width - 1, (index % columns) * size + size / 2),
    y:
      bounds.y +
      Math.min(
        bounds.height - 1,
        Math.floor(index / columns) * size + size / 2,
      ),
  });
  const walkable = Array.from({ length: columns * rows }, (_, index) =>
    canStand(point(index), map),
  );
  const free = (index: number) =>
    index >= 0 && index < walkable.length && walkable[index];
  const neighbors = (index: number) => {
    const x = index % columns;
    const y = Math.floor(index / columns);
    const result: number[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= columns || ny >= rows) continue;
        const next = ny * columns + nx;
        if (!free(next) || !clearSegment(point(index), point(next), map))
          continue;
        // A diagonal is legal only when both adjoining floor cells are clear.
        // Otherwise a character could pass through the corner of two objects.
        if (dx && dy && (!free(y * columns + nx) || !free(ny * columns + x)))
          continue;
        result.push(next);
      }
    }
    return result;
  };
  return { columns, rows, point, free, neighbors };
}

function crossesObstacle(
  a: RoomPoint,
  b: RoomPoint,
  box: RoomObstacle,
  clearance: number,
) {
  let enter = 0;
  let leave = 1;
  for (const axis of ['x', 'y'] as const) {
    const delta = b[axis] - a[axis];
    const minimum = box[axis] - clearance;
    const maximum =
      box[axis] + box[axis === 'x' ? 'width' : 'height'] + clearance;
    if (Math.abs(delta) < 1e-9) {
      if (a[axis] < minimum || a[axis] > maximum) return false;
      continue;
    }
    const first = (minimum - a[axis]) / delta;
    const second = (maximum - a[axis]) / delta;
    enter = Math.max(enter, Math.min(first, second));
    leave = Math.min(leave, Math.max(first, second));
    if (enter > leave) return false;
  }
  // Equality is a corner touch, which must also count as a collision.
  return enter <= leave;
}

function clearSegment(a: RoomPoint, b: RoomPoint, map: RoomNavigationMap) {
  if (!canStand(a, map) || !canStand(b, map)) return false;
  if (
    map.obstacles?.some((box) => crossesObstacle(a, b, box, map.clearance ?? 6))
  )
    return false;
  // The rectangular bounds are convex, so clear endpoints keep the entire
  // segment inside them. A custom concave floor still needs interior checks.
  if (map.polygon?.length) {
    const steps = Math.max(1, Math.ceil(distance(a, b)));
    for (let step = 1; step < steps; step++) {
      const t = step / steps;
      if (
        !insidePolygon(
          { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
          map.polygon,
        )
      )
        return false;
    }
  }
  return true;
}

/**
 * Return a collision-free route to the nearest reachable point on the floor.
 * Clicking a wall or a furniture footprint therefore never places the avatar
 * inside it. The reachable component is considered before choosing the target.
 */
export function findRoomPath(
  start: RoomPoint,
  destination: RoomPoint,
  map: RoomNavigationMap,
): RoomPoint[] {
  const grid = buildGrid(map);
  const count = grid.columns * grid.rows;
  let startIndex = -1;
  let closestStart = Infinity;
  for (let index = 0; index < count; index++) {
    if (!grid.free(index)) continue;
    if (canStand(start, map) && !clearSegment(start, grid.point(index), map))
      continue;
    const d = distance(start, grid.point(index));
    if (d < closestStart) {
      closestStart = d;
      startIndex = index;
    }
  }
  if (startIndex < 0) return [];

  const reachable = new Set<number>([startIndex]);
  const frontier = [startIndex];
  for (let head = 0; head < frontier.length; head++) {
    for (const next of grid.neighbors(frontier[head])) {
      if (reachable.has(next)) continue;
      reachable.add(next);
      frontier.push(next);
    }
  }
  let targetIndex = startIndex;
  let closestTarget = Infinity;
  for (const index of reachable) {
    const d = distance(destination, grid.point(index));
    if (d < closestTarget) {
      closestTarget = d;
      targetIndex = index;
    }
  }

  const open = new Set<number>([startIndex]);
  const previous = new Map<number, number>();
  const cost = new Map<number, number>([[startIndex, 0]]);
  const estimate = (index: number) =>
    (cost.get(index) ?? Infinity) +
    distance(grid.point(index), grid.point(targetIndex));
  while (open.size) {
    let current = -1;
    let lowest = Infinity;
    for (const index of open) {
      const score = estimate(index);
      if (score < lowest) {
        lowest = score;
        current = index;
      }
    }
    if (current === targetIndex) break;
    open.delete(current);
    for (const next of grid.neighbors(current)) {
      const nextCost =
        cost.get(current)! + distance(grid.point(current), grid.point(next));
      if (nextCost >= (cost.get(next) ?? Infinity)) continue;
      previous.set(next, current);
      cost.set(next, nextCost);
      open.add(next);
    }
  }

  const route: RoomPoint[] = [grid.point(targetIndex)];
  let cursor = targetIndex;
  while (cursor !== startIndex) {
    const parent = previous.get(cursor);
    if (parent === undefined) return [];
    cursor = parent;
    route.unshift(grid.point(cursor));
  }
  if (canStand(start, map) && clearSegment(start, route[0], map))
    route.unshift({ ...start });
  const last = route[route.length - 1];
  if (canStand(destination, map) && clearSegment(last, destination, map))
    route.push({ ...destination });

  // Keep straight passages straight without cutting the corners of furniture.
  const smooth: RoomPoint[] = [route[0]];
  let anchor = 0;
  while (anchor < route.length - 1) {
    let next = route.length - 1;
    while (next > anchor + 1 && !clearSegment(route[anchor], route[next], map))
      next--;
    smooth.push(route[next]);
    anchor = next;
  }
  return smooth;
}

export type RoomMovementOptions = RoomNavigationMap & {
  world: HTMLElement;
  avatar: HTMLElement;
  target: HTMLElement;
  start: RoomPoint;
  speed?: number;
  onUpdate?: (point: RoomPoint, moving: boolean) => void;
};
export type RoomWalkOptions = { onArrival?: () => void };

/** Input stays with the room controller, allowing touch scrolling and tap to coexist. */
export function createRoomMovement(options: RoomMovementOptions) {
  const { world, avatar, target, speed = 200, onUpdate } = options;
  const map: RoomNavigationMap = options;
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const initialPath = findRoomPath(options.start, options.start, map);
  let position = initialPath.at(-1) ?? { ...options.start };
  let path: RoomPoint[] = [];
  let frame = 0;
  let previousTime = 0;
  let hideTargetTimer: number | undefined;
  let arrival: (() => void) | undefined;
  let settle: ((completed: boolean) => void) | undefined;
  let destroyed = false;

  function render() {
    avatar.style.left = `${(position.x / map.width) * 100}%`;
    avatar.style.top = `${(position.y / map.height) * 100}%`;
    avatar.dataset.x = String(Math.round(position.x));
    avatar.dataset.y = String(Math.round(position.y));
    onUpdate?.({ ...position }, avatar.dataset.walking === 'true');
  }
  function setWalking(value: boolean) {
    avatar.classList.toggle('walking', value);
    avatar.dataset.walking = String(value);
  }
  function cancel() {
    window.cancelAnimationFrame(frame);
    window.clearTimeout(hideTargetTimer);
    path = [];
    arrival = undefined;
    settle?.(false);
    settle = undefined;
    target.hidden = true;
    setWalking(false);
  }
  function finish() {
    window.cancelAnimationFrame(frame);
    path = [];
    setWalking(false);
    onUpdate?.({ ...position }, false);
    const onArrival = arrival;
    arrival = undefined;
    settle?.(true);
    settle = undefined;
    hideTargetTimer = window.setTimeout(() => {
      target.hidden = true;
    }, 180);
    onArrival?.();
  }
  function face(destination: RoomPoint) {
    const dx = destination.x - position.x;
    const dy = destination.y - position.y;
    avatar.dataset.direction =
      Math.abs(dx) > Math.abs(dy)
        ? dx < 0
          ? 'left'
          : 'right'
        : dy < 0
          ? 'up'
          : 'down';
  }
  function tick(time: number) {
    if (destroyed || !path.length) return;
    let remaining = ((time - previousTime) / 1000) * speed;
    previousTime = time;
    // Never jump across the room after a background tab resumes.
    remaining = Math.min(remaining, speed * 0.05);
    while (path.length && remaining >= 0) {
      const next = path[0];
      const length = distance(position, next);
      if (length > 0.1) face(next);
      if (length <= remaining || length < 0.1) {
        position = { ...next };
        path.shift();
        remaining -= length;
      } else {
        const progress = remaining / length;
        position = {
          x: position.x + (next.x - position.x) * progress,
          y: position.y + (next.y - position.y) * progress,
        };
        break;
      }
    }
    render();
    if (path.length) frame = window.requestAnimationFrame(tick);
    else finish();
  }
  function walkTo(destination: RoomPoint, walkOptions: RoomWalkOptions = {}) {
    cancel();
    if (destroyed) return Promise.resolve(false);
    const route = findRoomPath(position, destination, map);
    if (!route.length) return Promise.resolve(false);
    path = route;
    const endpoint = path[path.length - 1];
    target.style.left = `${(endpoint.x / map.width) * 100}%`;
    target.style.top = `${(endpoint.y / map.height) * 100}%`;
    target.hidden = false;
    arrival = walkOptions.onArrival;
    const completed = new Promise<boolean>((resolve) => {
      settle = resolve;
    });
    if (motion.matches || distance(position, endpoint) < 1) {
      if (distance(position, endpoint) >= 1) face(endpoint);
      position = { ...endpoint };
      setWalking(true);
      render();
      finish();
    } else {
      setWalking(true);
      previousTime = performance.now();
      frame = window.requestAnimationFrame(tick);
    }
    return completed;
  }
  function fromClientPoint(clientX: number, clientY: number): RoomPoint {
    const rect = world.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * map.width,
      y: ((clientY - rect.top) / rect.height) * map.height,
    };
  }
  function reduceMotion() {
    if (!motion.matches || !path.length) return;
    face(path[path.length - 1]);
    position = { ...path[path.length - 1] };
    render();
    finish();
  }
  motion.addEventListener('change', reduceMotion);
  target.hidden = true;
  avatar.dataset.direction = 'down';
  setWalking(false);
  render();

  return {
    walkTo,
    cancel,
    fromClientPoint,
    get position() {
      return { ...position };
    },
    destroy() {
      cancel();
      destroyed = true;
      motion.removeEventListener('change', reduceMotion);
    },
  };
}
