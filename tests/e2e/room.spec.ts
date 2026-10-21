import { test, expect } from '@playwright/test';
import { mockRoom, enterRoom, entry } from './room-fixture';

test('successful login email requests show confirmation and wait before resending', async ({
  page,
}) => {
  await page.clock.install();
  await mockRoom(page);
  await enterRoom(page);
  await page.getByRole('button', { name: '房主登录', exact: true }).click();
  await page.locator('[data-login-email]').fill('owner@example.test');
  const send = page.locator('[data-login-form] button');
  await send.click();
  await expect(page.locator('[data-auth-status]')).toContainText(
    '登录邮件已发送',
  );
  await expect(send).toBeDisabled();
  await expect(send).toContainText('秒后可重发');
  await page.clock.fastForward(60000);
  await expect(send).toBeEnabled();
  await expect(send).toHaveText('发送登录链接');
});

test('email rate limits explain the wait and respect the server cooldown', async ({
  page,
}) => {
  await page.clock.install();
  await mockRoom(page);
  await page.route(
    'https://room-test.supabase.co/auth/v1/otp**',
    async (route) => {
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'over_email_send_rate_limit',
          msg: 'For security purposes, you can only request this after 32 seconds.',
        }),
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    },
  );
  await enterRoom(page);
  await page.getByRole('button', { name: '房主登录', exact: true }).click();
  await page.locator('[data-login-email]').fill('owner@example.test');
  const send = page.locator('[data-login-form] button');
  await send.click();
  await expect(page.locator('[data-auth-status]')).toContainText(
    '请求过于频繁',
  );
  await expect(page.locator('[data-auth-status]')).toContainText('32 秒后再试');
  await expect(send).toBeDisabled();
  await page.clock.fastForward(32000);
  await expect(send).toBeEnabled();
  await expect(send).toHaveText('发送登录链接');
});

test('enters through the door and restores scene focus', async ({
  page,
}, testInfo) => {
  await mockRoom(page);
  await page.goto('/');
  await expect(page.getByRole('dialog', { name: '房间入口' })).toBeVisible();
  await page.screenshot({
    path: `artifacts/room-door-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: '进入房间', exact: true }).click();
  await expect(page.locator('[data-entry]')).toBeHidden();
  await expect(page.locator('[data-room-stage]')).toBeFocused();
  await page.mouse.move(0, 0);
  await page.screenshot({
    path: `artifacts/room-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.reload();
  await expect(page.locator('[data-entry]')).toBeHidden();
  await page.getByRole('button', { name: '门口', exact: true }).click();
  await expect(page.locator('[data-entry]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-entry]')).toBeHidden();
});

test('visitors read the board and notes without editing controls', async ({
  page,
}) => {
  await mockRoom(page, {
    entries: [entry({ kind: 'whiteboard', body: '窗外下雨了' }), entry()],
  });
  await enterRoom(page);
  const boardOpener = page.getByRole('button', {
    name: '打开写字板',
    exact: true,
  });
  await boardOpener.click();
  const board = page.getByRole('dialog', { name: '写字板', exact: true });
  await expect(board.getByRole('textbox')).toHaveValue('窗外下雨了');
  await expect(board.getByRole('textbox')).toHaveAttribute('readonly', '');
  await expect(
    board.getByRole('button', { name: '保存', exact: true }),
  ).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(boardOpener).toBeFocused();
  await page.getByRole('button', { name: '便签板', exact: true }).click();
  await expect(page.locator('.sticky-card').first()).toContainText(
    '公开的便签',
  );
  await expect(page.getByRole('button', { name: '贴一张 +' })).toBeHidden();
});

test('selects a book, reads it and returns it to the shelf', async ({
  page,
}) => {
  await mockRoom(page);
  await enterRoom(page);
  await page.getByRole('button', { name: '书架', exact: true }).click();
  await page.locator('[data-read-book]').first().click();
  const reader = page.locator('[data-book-reader]').first();
  await expect(reader).toBeVisible();
  await expect(reader).toContainText('旧字迹');
  await reader.getByRole('button', { name: '放回书架' }).click();
  await expect(page.locator('[data-book-selection]')).toBeVisible();
});

test('uses desk and calendar objects to reach projects and notes', async ({
  page,
}) => {
  await mockRoom(page);
  await enterRoom(page);
  await page.getByRole('button', { name: '电脑', exact: true }).click();
  await page.locator('.project-file').first().click();
  await expect(page).toHaveURL(/\/projects\/ziklspace\/$/);
  await expect(page.getByRole('link', { name: 'GitHub' })).toHaveAttribute(
    'href',
    'https://github.com/Frank-Zikl/ziklspace',
  );
  await enterRoom(page);
  await page.getByRole('button', { name: '笔记本', exact: true }).click();
  await page
    .locator('[data-dialog="notebook"] a[href^="/notes/"]')
    .first()
    .click();
  await expect(page.locator('article h1')).not.toBeEmpty();
  await enterRoom(page);
  await page.getByRole('button', { name: '日历', exact: true }).click();
  await expect(page.locator('.calendar-entry').first()).toContainText(
    'Ziklspace',
  );
});

test('lamp and cat respond without changing navigation', async ({ page }) => {
  await mockRoom(page);
  await enterRoom(page);
  const lamp = page.getByRole('button', { name: '开关台灯' });
  await lamp.click();
  await expect(lamp).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('body')).toHaveClass(/night/);
  await lamp.click();
  await expect(lamp).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: '摸摸猫' }).click();
  await expect(page.locator('[data-room-status]')).toHaveText('喵。');
});

test('owner saves the whiteboard and reads the server version after reload', async ({
  page,
}) => {
  const { rows } = await mockRoom(page, { owner: true });
  await enterRoom(page);
  await expect(page.locator('[data-personal-room]')).toHaveAttribute(
    'data-owner',
    'true',
  );
  await page.getByRole('button', { name: '写字板', exact: true }).click();
  const panel = page.getByRole('dialog', { name: '写字板', exact: true });
  await panel.getByRole('textbox').fill('今天想到一个新问题');
  await panel.getByRole('button', { name: '保存', exact: true }).click();
  await expect(panel.locator('[data-board-status]')).toHaveText('已保存');
  expect(rows[0].body).toBe('今天想到一个新问题');
  await page.reload();
  await page.getByRole('button', { name: '写字板', exact: true }).click();
  await expect(page.locator('[data-board-input]')).toHaveValue(
    '今天想到一个新问题',
  );
});

test('owner modifies, crosses out and rewrites a note while preserving old paper', async ({
  page,
}) => {
  const { rows } = await mockRoom(page, { owner: true });
  await enterRoom(page);
  await expect(page.locator('[data-personal-room]')).toHaveAttribute(
    'data-owner',
    'true',
  );
  await page.getByRole('button', { name: '便签板', exact: true }).click();
  await page.getByRole('button', { name: '贴一张 +' }).click();
  await page.locator('[data-sticky-input]').fill('第一句话');
  await page.getByRole('button', { name: '贴上', exact: true }).click();
  const card = page.locator('[data-sticky-list] .sticky-card').first();
  await expect(card).toContainText('第一句话');
  await card.getByRole('button', { name: '修改', exact: true }).click();
  await page.locator('[data-sticky-input]').fill('重新想过的一句话');
  await page.getByRole('button', { name: '贴上', exact: true }).click();
  await expect(card).toContainText('重新想过的一句话');
  await card.locator('summary').click();
  await expect(card.locator('details')).toContainText('第一句话');
  await card.getByRole('button', { name: '划掉', exact: true }).click();
  await expect(card).toHaveClass(/is-crossed/);
  await card.getByRole('button', { name: '撕下重写', exact: true }).click();
  await page.locator('[data-sticky-input]').fill('一张新的纸');
  await page.getByRole('button', { name: '贴上', exact: true }).click();
  await expect(card).toContainText('一张新的纸');
  await page.locator('[data-bin-label]').click();
  await expect(page.locator('[data-torn-list]')).toContainText(
    '重新想过的一句话',
  );
  expect(rows).toHaveLength(2);
  expect(rows.some((row) => row.paper_state === 'torn')).toBe(true);
  await expect(
    page.getByRole('button', { name: '删除', exact: true }),
  ).toHaveCount(0);
});

test('imports AI Markdown as a private draft, sanitizes it, and publishes only on request', async ({
  page,
}) => {
  const { rows } = await mockRoom(page, { owner: true });
  await enterRoom(page);
  await expect(page.locator('[data-personal-room]')).toHaveAttribute(
    'data-owner',
    'true',
  );
  await page.getByRole('button', { name: '收件箱', exact: true }).click();
  await page.getByRole('button', { name: '整理一篇 +' }).click();
  await page.locator('[data-import-markdown]').setInputFiles({
    name: '对话.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(
      '# 一次真实的感受\n\n我想慢一点。\n\n<img src=x onerror="window.roomXss=true">\n\n[链接](javascript:alert(1))',
    ),
  });
  await page.locator('[data-thought-source]').selectOption('gpt');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  const reader = page.locator('[data-dialog="thought"]');
  await expect(reader).toBeVisible();
  await expect(reader).toContainText('仅自己可见');
  await expect(reader.locator('img,script')).toHaveCount(0);
  expect(rows[0].status).toBe('draft');
  expect(await page.evaluate(() => 'roomXss' in window)).toBe(false);
  await page.getByRole('button', { name: '发布到笔记本', exact: true }).click();
  await expect(reader.locator('[data-thought-meta]')).toHaveText('笔记 / GPT');
  expect(rows[0].status).toBe('published');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '笔记本', exact: true }).click();
  await expect(page.locator('[data-thought-list]')).toContainText(
    '一次真实的感受',
  );
});

test('saving errors retain unsaved text', async ({ page }) => {
  await mockRoom(page, { owner: true, failWrites: true });
  await enterRoom(page);
  await expect(page.locator('[data-personal-room]')).toHaveAttribute(
    'data-owner',
    'true',
  );
  await page.getByRole('button', { name: '写字板', exact: true }).click();
  await page.locator('[data-board-input]').fill('不能丢掉的文字');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('[data-board-status]')).toContainText('保存失败');
  await expect(page.locator('[data-board-input]')).toHaveValue(
    '不能丢掉的文字',
  );
});

test('signing out removes drafts and editing controls', async ({ page }) => {
  await mockRoom(page, {
    owner: true,
    entries: [
      entry({
        kind: 'thought',
        status: 'draft',
        title: '私有草稿',
        body: '未公开',
      }),
    ],
  });
  await enterRoom(page);
  await expect(page.locator('[data-personal-room]')).toHaveAttribute(
    'data-owner',
    'true',
  );
  await page.getByRole('button', { name: '收件箱', exact: true }).click();
  await expect(page.locator('[data-draft-list]')).toContainText('私有草稿');
  await page.keyboard.press('Escape');
  await page.locator('[data-open="account"]').click();
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page.locator('[data-personal-room]')).toHaveAttribute(
    'data-owner',
    'false',
  );
  await expect(page.locator('[data-draft-list]')).toBeEmpty();
  await expect(
    page.getByRole('button', { name: '收件箱', exact: true }),
  ).toBeHidden();
});

test('an older editor cannot overwrite a newer whiteboard save', async ({
  page,
}) => {
  const { rows } = await mockRoom(page, {
    owner: true,
    entries: [entry({ kind: 'whiteboard', body: '原来的内容' })],
  });
  await enterRoom(page);
  await expect(page.locator('[data-personal-room]')).toHaveAttribute(
    'data-owner',
    'true',
  );
  await page.getByRole('button', { name: '写字板', exact: true }).click();
  await page.locator('[data-board-input]').fill('当前窗口尚未保存的文字');
  rows[0].body = '另一窗口已经保存的文字';
  rows[0].updated_at = '2026-10-21T02:00:00.000Z';
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('[data-board-status]')).toContainText(
    '另一窗口修改',
  );
  await expect(page.locator('[data-board-input]')).toHaveValue(
    '当前窗口尚未保存的文字',
  );
  expect(rows[0].body).toBe('另一窗口已经保存的文字');
});

test('published thoughts appear in the notes index and open through a direct link', async ({
  page,
}) => {
  const published = entry({
    kind: 'thought',
    title: '可以分享的思考',
    body: '已经确认公开的正文',
  });
  const draft = entry({
    kind: 'thought',
    title: '不要公开的草稿',
    status: 'draft',
  });
  await mockRoom(page, { entries: [published, draft] });
  await page.goto('/notes/');
  await expect(page.locator('[data-cloud-thoughts]')).toContainText(
    published.title,
  );
  await expect(page.locator('[data-cloud-thoughts]')).not.toContainText(
    draft.title,
  );
  await page.getByRole('link', { name: /可以分享的思考/ }).click();
  await expect(page).toHaveURL(new RegExp(`thought=${published.id}`));
  await expect(page.locator('[data-dialog="thought"]')).toBeVisible();
  await expect(page.locator('[data-thought-content]')).toContainText(
    published.body,
  );
  await expect(page.locator('[data-entry]')).toBeHidden();
  await page.goto(`/?thought=${draft.id}`);
  await expect(page.locator('[data-room-status]')).toContainText(
    '尚未公开或不存在',
  );
  await expect(page.locator('[data-dialog="thought"]')).toBeHidden();
});
