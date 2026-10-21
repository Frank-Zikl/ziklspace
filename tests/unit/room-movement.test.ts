import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findRoomPath,
  type RoomNavigationMap,
  type RoomPoint,
} from '../../src/scripts/room-movement.ts';

const room: RoomNavigationMap = {
  width: 960,
  height: 640,
  bounds: { x: 32, y: 280, width: 896, height: 328 },
  obstacles: [
    { x: 384, y: 256, width: 280, height: 80 },
    { x: 784, y: 248, width: 128, height: 72 },
    { x: 72, y: 416, width: 200, height: 136 },
    { x: 776, y: 464, width: 112, height: 80 },
    { x: 672, y: 280, width: 88, height: 56 },
  ],
};

const distance = (a: RoomPoint, b: RoomPoint) =>
  Math.hypot(a.x - b.x, a.y - b.y);

function assertSafeRoute(route: RoomPoint[], map: RoomNavigationMap) {
  assert.ok(route.length > 0, 'a reachable floor point should have a route');
  const clearance = map.clearance ?? 6;
  const samples = [route[0]];
  for (let index = 1; index < route.length; index++) {
    const start = route[index - 1];
    const end = route[index];
    const count = Math.max(1, Math.ceil(distance(start, end)));
    for (let step = 1; step <= count; step++) {
      samples.push({
        x: start.x + ((end.x - start.x) * step) / count,
        y: start.y + ((end.y - start.y) * step) / count,
      });
    }
  }
  for (const point of samples) {
    assert.ok(point.x >= map.bounds.x + clearance, 'stay inside left wall');
    assert.ok(point.y >= map.bounds.y + clearance, 'stay inside back wall');
    assert.ok(
      point.x <= map.bounds.x + map.bounds.width - clearance,
      'stay inside right wall',
    );
    assert.ok(
      point.y <= map.bounds.y + map.bounds.height - clearance,
      'stay inside front floor edge',
    );
    for (const obstacle of map.obstacles ?? []) {
      assert.ok(
        !(
          point.x >= obstacle.x - clearance &&
          point.x <= obstacle.x + obstacle.width + clearance &&
          point.y >= obstacle.y - clearance &&
          point.y <= obstacle.y + obstacle.height + clearance
        ),
        `route crosses furniture at ${point.x},${point.y}`,
      );
    }
  }
}

test('walks around the desk without cutting through its footprint', () => {
  const start = { x: 340, y: 300 };
  const destination = { x: 780, y: 350 };
  const route = findRoomPath(start, destination, room);
  assertSafeRoute(route, room);
  assert.deepEqual(route[0], start);
  assert.deepEqual(route.at(-1), destination);
  assert.ok(route.length > 2, 'the desk requires a detour');
});

test('furniture and outside-wall destinations resolve to safe reachable floor', () => {
  const start = { x: 480, y: 440 };
  for (const destination of [
    { x: 520, y: 300 },
    { x: 160, y: 480 },
    { x: 840, y: 500 },
    { x: 1100, y: 100 },
  ]) {
    const route = findRoomPath(start, destination, room);
    assertSafeRoute(route, room);
    const endpoint = route.at(-1)!;
    assert.notDeepEqual(endpoint, destination);
    assert.ok(
      distance(endpoint, destination) < distance(start, destination),
      'approach the requested location instead of ignoring a blocked click',
    );
  }
});

test('a destination across a solid barrier stays in the starting floor component', () => {
  const divided: RoomNavigationMap = {
    width: 100,
    height: 100,
    bounds: { x: 0, y: 0, width: 100, height: 100 },
    obstacles: [{ x: 40, y: 0, width: 20, height: 100 }],
    cellSize: 10,
    clearance: 1,
  };
  const route = findRoomPath({ x: 10, y: 50 }, { x: 90, y: 50 }, divided);
  assertSafeRoute(route, divided);
  assert.ok(route.at(-1)!.x < 39, 'never teleport through a disconnected room');
});

test('cannot squeeze diagonally between touching furniture corners', () => {
  const corners: RoomNavigationMap = {
    width: 64,
    height: 64,
    bounds: { x: 0, y: 0, width: 64, height: 64 },
    obstacles: [
      { x: 16, y: 0, width: 16, height: 16 },
      { x: 0, y: 16, width: 16, height: 16 },
    ],
    cellSize: 16,
    clearance: 0,
  };
  const start = { x: 8, y: 8 };
  const route = findRoomPath(start, { x: 56, y: 56 }, corners);
  assertSafeRoute(route, corners);
  assert.deepEqual(route.at(-1), start);
});

test('staying at the current destination has no artificial movement', () => {
  const start = { x: 480, y: 440 };
  const route = findRoomPath(start, start, room);
  assertSafeRoute(route, room);
  assert.ok(route.every((point) => distance(point, start) < 0.01));
});

test('a room with no walkable floor returns no route', () => {
  const blocked: RoomNavigationMap = {
    width: 64,
    height: 64,
    bounds: { x: 0, y: 0, width: 64, height: 64 },
    obstacles: [{ x: 0, y: 0, width: 64, height: 64 }],
  };
  assert.deepEqual(findRoomPath({ x: 8, y: 8 }, { x: 56, y: 56 }, blocked), []);
});
