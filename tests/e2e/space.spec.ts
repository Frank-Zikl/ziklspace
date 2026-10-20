import { test, expect } from '@playwright/test';

test('explores the canvas navigation', async ({ page }) => {
  for (const [label, route, heading] of [
    ['笔记', '/notes/', '笔记'],
    ['项目', '/projects/', '项目'],
    ['近况', '/now/', '近况'],
    ['关于', '/about/', 'Zikl'],
  ]) {
    await page.goto('/');
    await page
      .getByRole('navigation', { name: '主要导航' })
      .getByRole('link', { name: new RegExp(label) })
      .click();
    await expect(page).toHaveURL(new RegExp(`${route}$`));
    await expect(page.locator('main h1')).toContainText(heading);
  }
});

test('reads a note and returns to the index', async ({ page }) => {
  await page.goto('/');
  const note = page.locator('.desk-note');
  const href = await note.getAttribute('href');
  await note.click();
  await expect(page).toHaveURL(new RegExp(`${href}$`));
  await expect(page.locator('article h1')).not.toBeEmpty();
  await page.getByRole('link', { name: '← 翻回笔记本' }).click();
  await expect(page).toHaveURL(/\/notes\/$/);
  await expect(page.locator('.note-preview').first()).toBeVisible();
});

test('opens a project and its external destination', async ({ page }) => {
  await page.goto('/');
  await page.locator('.project-note').click();
  await expect(page.locator('article h1')).toContainText('Ziklspace');
  const repository = page.getByRole('link', { name: 'GitHub' });
  await expect(repository).toHaveAttribute(
    'href',
    'https://github.com/Frank-Zikl/ziklspace',
  );
  await expect(repository).toHaveAttribute('rel', /noopener/);
});

test('opens, changes and closes the paper with keyboard focus restored', async ({
  page,
}) => {
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
  await expect(dialog).not.toBeVisible();
  await expect(opener).toBeFocused();
  await opener.click();
  await dialog.getByRole('button', { name: '收起纸条' }).click();
  await expect(dialog).not.toBeVisible();
  await opener.click();
  await page.mouse.click(3, 3);
  await expect(dialog).not.toBeVisible();
});

test('rotates the stamp with a pointer and keyboard', async ({ page }) => {
  await page.goto('/');
  const stamp = page.getByRole('button', { name: '旋转印章' });
  const initial = await stamp.evaluate(
    (element) => getComputedStyle(element).transform,
  );
  await stamp.click();
  await expect
    .poll(() =>
      stamp.evaluate((element) => getComputedStyle(element).transform),
    )
    .not.toBe(initial);
  await expect(stamp.locator('[data-stamp-state]')).toHaveText('45°');
  await page.keyboard.press('Enter');
  await expect(stamp.locator('[data-stamp-state]')).toHaveText('90°');
});

test('browses the note slips on each screen size', async ({
  page,
  isMobile,
}) => {
  await page.goto('/');
  const slips = page.locator('.index-slip');
  if (!isMobile) {
    for (const slip of await slips.all()) await expect(slip).toBeVisible();
    await expect(
      page.getByRole('button', { name: '下一张笔记' }),
    ).not.toBeVisible();
    return;
  }
  const stack = page.locator('[data-index-stack]');
  const next = page.getByRole('button', { name: '下一张笔记' });
  await next.scrollIntoViewIfNeeded();
  const initial = await stack.evaluate((element) => element.scrollLeft);
  await next.click();
  await expect
    .poll(() => stack.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(initial + 50);
  const moved = await stack.evaluate((element) => element.scrollLeft);
  await page.getByRole('button', { name: '上一张笔记' }).click();
  await expect
    .poll(() => stack.evaluate((element) => element.scrollLeft))
    .toBeLessThan(moved - 20);
});

test('renders pages and resolves all internal links without browser errors', async ({
  page,
  request,
}) => {
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

test('does not publish draft notes, projects or updates', async ({
  page,
  request,
}) => {
  for (const route of [
    '/notes/e2e-private-note/',
    '/projects/e2e-private-project/',
  ])
    expect((await request.get(route)).status()).toBe(404);
  for (const route of ['/', '/notes/', '/projects/', '/now/']) {
    await page.goto(route);
    await expect(page.locator('main')).not.toContainText('PRIVATE_');
    await expect(page.locator('a[href*="e2e-private"]')).toHaveCount(0);
  }
});

test('supports narrow screens and reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [320, 390, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `width ${width}`,
    ).toBe(true);
  }
  expect(
    await page
      .locator('.desk-note')
      .evaluate((element) => getComputedStyle(element).transitionDuration),
  ).toBe('0s');
});

test('returns a useful 404 page', async ({ page }) => {
  const response = await page.goto('/this-page-does-not-exist/');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    '页面不存在',
  );
  await page.getByRole('link', { name: '回到工作台 ↗' }).click();
  await expect(page).toHaveURL('/');
});
