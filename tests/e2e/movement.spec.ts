import { test, expect, type Page } from '@playwright/test';
import { enterRoom, mockRoom } from './room-fixture';

type Point = { x: number; y: number };

async function avatarPosition(page: Page): Promise<Point> {
  return page.locator('[data-room-avatar]').evaluate((avatar) => ({
    x: Number((avatar as HTMLElement).dataset.x),
    y: Number((avatar as HTMLElement).dataset.y),
  }));
}

async function expectAt(page: Page, destination: Point) {
  await expect
    .poll(
      async () => {
        const current = await avatarPosition(page);
        return Math.hypot(current.x - destination.x, current.y - destination.y);
      },
      {
        timeout: 10000,
        message: 'the character should arrive at the requested floor point',
      },
    )
    .toBeLessThan(2);
  await expect(page.locator('[data-room-avatar]')).toHaveAttribute(
    'data-walking',
    'false',
  );
}

async function prepareRoom(
  page: Page,
  motion: 'reduce' | 'no-preference' = 'reduce',
) {
  await page.emulateMedia({ reducedMotion: motion });
  await mockRoom(page);
  await enterRoom(page);
  await expect(page.locator('[data-room-avatar]')).toHaveAttribute(
    'data-walking',
    'false',
  );
  await expectAt(page, { x: 480, y: 440 });
}

async function clickFloor(page: Page, destination: Point) {
  const viewport = page.locator('.room-viewport');
  await viewport.evaluate((element, point) => {
    const world = element.querySelector<HTMLElement>('.room-world')!;
    const width = Number(world.dataset.sceneWidth);
    element.scrollLeft =
      (point.x / width) * world.getBoundingClientRect().width -
      element.clientWidth / 2;
  }, destination);
  const client = await page.locator('.room-world').evaluate((world, point) => {
    const element = world as HTMLElement;
    const box = element.getBoundingClientRect();
    return {
      x: box.left + (point.x / Number(element.dataset.sceneWidth)) * box.width,
      y: box.top + (point.y / Number(element.dataset.sceneHeight)) * box.height,
    };
  }, destination);
  const interactive = await page.evaluate((point) => {
    const target = document.elementFromPoint(point.x, point.y);
    return (
      target?.closest('button, dialog')?.getAttribute('aria-label') ?? null
    );
  }, client);
  expect(
    interactive,
    'the floor gesture must not accidentally activate a furniture control',
  ).toBeNull();
  await page.mouse.click(client.x, client.y);
}

test('clicking clear floor moves the character to the destination', async ({
  page,
}) => {
  await prepareRoom(page);
  await clickFloor(page, { x: 560, y: 520 });
  await expectAt(page, { x: 560, y: 520 });
  await expect(page.locator('dialog[open]')).toHaveCount(0);
});

test('clicking the desk footprint approaches free floor without entering furniture', async ({
  page,
}) => {
  await prepareRoom(page);
  const start = await avatarPosition(page);
  await clickFloor(page, { x: 400, y: 312 });
  await expect
    .poll(async () => {
      const current = await avatarPosition(page);
      return Math.hypot(current.x - start.x, current.y - start.y);
    })
    .toBeGreaterThan(1);
  await expect(page.locator('[data-room-avatar]')).toHaveAttribute(
    'data-walking',
    'false',
  );
  const endpoint = await avatarPosition(page);
  expect(
    endpoint.x >= 384 &&
      endpoint.x <= 664 &&
      endpoint.y >= 256 &&
      endpoint.y <= 336,
  ).toBe(false);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
});

test('an object opens after the character reaches its approach point', async ({
  page,
}) => {
  await prepareRoom(page, 'no-preference');
  const books = page.getByRole('button', { name: '打开书架', exact: true });
  const destination = {
    x: Number(await books.getAttribute('data-walk-x')),
    y: Number(await books.getAttribute('data-walk-y')),
  };
  expect(Math.hypot(destination.x - 480, destination.y - 440)).toBeGreaterThan(
    150,
  );
  const panel = page.getByRole('dialog', { name: '书架', exact: true });
  await books.click();
  await expect(page.locator('[data-room-avatar]')).toHaveAttribute(
    'data-walking',
    'true',
  );
  await expect(panel).toBeHidden();
  await expect(panel).toBeVisible({ timeout: 10000 });
  await expectAt(page, destination);
});

test('a new floor destination cancels the pending object arrival and panel', async ({
  page,
}) => {
  await prepareRoom(page, 'no-preference');
  const panel = page.getByRole('dialog', { name: '书架', exact: true });
  await page.getByRole('button', { name: '打开书架', exact: true }).click();
  await expect(page.locator('[data-room-avatar]')).toHaveAttribute(
    'data-walking',
    'true',
  );
  await expect(panel).toBeHidden();
  await clickFloor(page, { x: 560, y: 560 });
  await expectAt(page, { x: 560, y: 560 });
  // Wait past the original short trip so a stale arrival callback cannot hide behind
  // an assertion that runs immediately after the replacement walk finishes.
  await page.waitForTimeout(2200);
  await expect(panel).toBeHidden();
  await expectAt(page, { x: 560, y: 560 });
});

test('touch panning the room does not turn the drag into a walk command', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'native touch panning is covered on the mobile project');
  await prepareRoom(page);
  const viewport = page.locator('.room-viewport');
  const bounds = await viewport.boundingBox();
  expect(bounds).not.toBeNull();
  const startPosition = await avatarPosition(page);
  const scrollBefore = await viewport.evaluate((element) => element.scrollLeft);
  const start = {
    x: bounds!.x + bounds!.width - 48,
    y: bounds!.y + bounds!.height * 0.9,
  };
  const end = { x: bounds!.x + 48, y: start.y };
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [start],
    });
    for (let step = 1; step <= 6; step++) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { x: start.x + ((end.x - start.x) * step) / 6, y: start.y },
        ],
      });
      await page.waitForTimeout(20);
    }
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
  } finally {
    await session.detach();
  }
  await expect
    .poll(() =>
      viewport.evaluate(
        (element, previous) => Math.abs(element.scrollLeft - previous),
        scrollBefore,
      ),
    )
    .toBeGreaterThan(20);
  await expectAt(page, startPosition);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
});
