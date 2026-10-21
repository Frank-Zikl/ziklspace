import { test, expect } from '@playwright/test';
import { mockRoom, enterRoom } from './room-fixture';

test('renders pages and resolves internal links without browser errors', async ({
  page,
  request,
}) => {
  await mockRoom(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const links = new Set<string>();
  for (const route of [
    '/',
    '/notes/',
    '/projects/',
    '/now/',
    '/about/',
    '/play/',
    '/books/',
    '/books/room-notebook/',
  ]) {
    const response = await page.goto(route);
    expect(response?.status()).toBe(200);
    await expect(page.locator('main h1')).toHaveCount(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    for (const href of await page
      .locator('a[href^="/"]')
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute('href')!),
      ))
      links.add(href);
  }
  for (const href of links)
    expect((await request.get(href)).status(), href).toBe(200);
  expect(errors).toEqual([]);
});

test('does not publish draft MDX notes, projects, books or updates', async ({
  page,
  request,
}) => {
  await mockRoom(page);
  for (const route of [
    '/notes/e2e-private-note/',
    '/projects/e2e-private-project/',
    '/books/e2e-private-book/',
  ])
    expect((await request.get(route)).status()).toBe(404);
  for (const route of ['/', '/notes/', '/projects/', '/now/', '/books/']) {
    await page.goto(route);
    await expect(page.locator('main')).not.toContainText('PRIVATE_');
    await expect(page.locator('a[href*="e2e-private"]')).toHaveCount(0);
  }
});

test('fills the viewport and keeps room objects reachable with reduced motion', async ({
  page,
}, testInfo) => {
  await mockRoom(page, { owner: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await enterRoom(page);
  await expect(page.locator('[data-personal-room]')).toHaveAttribute(
    'data-owner',
    'true',
  );
  await expect(page.getByRole('banner')).toHaveCount(0);
  await expect(page.getByRole('contentinfo')).toHaveCount(0);
  await expect(
    page.getByRole('navigation', { name: '房间物件快捷入口' }),
  ).toHaveCount(0);
  for (const { width, height } of [
    { width: 320, height: 900 },
    { width: 390, height: 844 },
    { width: 768, height: 900 },
    { width: 1024, height: 768 },
    { width: 1920, height: 1080 },
    { width: 2560, height: 1080 },
  ]) {
    await page.setViewportSize({ width, height });
    await page.reload();
    await expect(page.locator('[data-personal-room]')).toHaveAttribute(
      'data-owner',
      'true',
    );
    await expect(page.locator('[data-entry]')).toBeHidden();
    await page.mouse.move(0, 0);
    await page.locator('[data-room-stage]').focus();
    const geometry = await page
      .locator('[data-room-stage]')
      .evaluate((stage) => {
        const bounds = stage.getBoundingClientRect();
        const art = stage.querySelector('.room-art')!.getBoundingClientRect();
        return {
          stage: {
            left: bounds.left,
            top: bounds.top,
            width: bounds.width,
            height: bounds.height,
          },
          art: {
            left: art.left,
            top: art.top,
            right: art.right,
            bottom: art.bottom,
          },
          pageWidth: document.documentElement.scrollWidth,
          pageHeight: document.documentElement.scrollHeight,
        };
      });
    expect(
      Math.abs(geometry.stage.left),
      `${width}: scene starts at left edge`,
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(geometry.stage.top),
      `${width}: scene starts at top edge`,
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(geometry.stage.width - width),
      `${width}: scene fills screen width`,
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(geometry.stage.height - height),
      `${width}: scene fills screen height`,
    ).toBeLessThanOrEqual(1);
    expect(
      geometry.art.left,
      `${width}: artwork covers left edge`,
    ).toBeLessThanOrEqual(1);
    expect(
      geometry.art.top,
      `${width}: artwork covers top edge`,
    ).toBeLessThanOrEqual(1);
    expect(
      geometry.art.right,
      `${width}: artwork covers right edge`,
    ).toBeGreaterThanOrEqual(width - 1);
    expect(
      geometry.art.bottom,
      `${width}: artwork covers bottom edge`,
    ).toBeGreaterThanOrEqual(height - 1);
    expect(
      geometry.pageWidth,
      `${width}: no horizontal page scroll`,
    ).toBeLessThanOrEqual(width + 1);
    expect(
      geometry.pageHeight,
      `${width}: no vertical page scroll`,
    ).toBeLessThanOrEqual(height + 1);
    await page.screenshot({
      path: `artifacts/immersive-room-${width}x${height}-${testInfo.project.name}.png`,
      fullPage: true,
    });
    for (const name of ['写字板', '便签板', '书架', '电脑', '笔记本', '日历']) {
      const opener = page.getByRole('button', {
        name: `打开${name}`,
        exact: true,
      });
      await opener.scrollIntoViewIfNeeded();
      await expect(opener).toBeInViewport({ ratio: 0.75 });
      await opener.click();
      await expect(
        page.getByRole('dialog', { name, exact: true }),
      ).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(opener).toBeFocused();
    }
    const key = page.locator('.room-hotspot[data-open="account"]');
    await key.focus();
    await expect(key).toBeInViewport({ ratio: 0.75 });
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('dialog', { name: '房主', exact: true }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    const inbox = page.locator('.room-hotspot[data-open="inbox"]');
    await inbox.scrollIntoViewIfNeeded();
    await inbox.click();
    await expect(
      page.getByRole('dialog', { name: '收件箱', exact: true }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    if (width <= 390) {
      for (const hotspot of await page.locator('.room-hotspot:visible').all()) {
        const bounds = await hotspot.boundingBox();
        expect(
          bounds?.width,
          `${width}: usable touch target width`,
        ).toBeGreaterThanOrEqual(44);
        expect(
          bounds?.height,
          `${width}: usable touch target height`,
        ).toBeGreaterThanOrEqual(44);
      }
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `width ${width}`,
    ).toBe(true);
  }
  expect(
    await page
      .locator('.room-art')
      .evaluate((element) => getComputedStyle(element).transitionDuration),
  ).toBe('0s');
});

test('paper play remains keyboard accessible', async ({ page }) => {
  await page.goto('/play/');
  const opener = page.getByRole('button', { name: '打开纸团' });
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: '纸团' });
  await expect(dialog).toBeVisible();
  const first = await dialog.locator('[data-thought-text]').textContent();
  await dialog.getByRole('button', { name: '换一张' }).click();
  await expect(dialog.locator('[data-thought-text]')).not.toHaveText(
    first!.trim(),
  );
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test('unknown pages offer a return to the room', async ({ page }) => {
  const response = await page.goto('/this-page-does-not-exist/');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    '页面不存在',
  );
  await page.locator('main a[href="/"]').click();
  await expect(page).toHaveURL('/');
});
