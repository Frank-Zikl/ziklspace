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

test('supports narrow screens and reduced motion', async ({ page }) => {
  await mockRoom(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await enterRoom(page);
  for (const width of [320, 390, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    if (width <= 800) {
      const viewport = page.locator('.room-viewport');
      expect(
        await viewport.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
      await page.getByRole('button', { name: '近看 +' }).click();
      expect(
        await viewport.evaluate(
          (element) =>
            element.scrollWidth > element.clientWidth && element.scrollLeft > 0,
        ),
      ).toBe(true);
      await page.getByRole('button', { name: '全景 −' }).click();
      expect(
        await viewport.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `width ${width}`,
    ).toBe(true);
    await page.getByRole('button', { name: '书架', exact: true }).click();
    await expect(
      page.getByRole('dialog', { name: '书架', exact: true }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
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
