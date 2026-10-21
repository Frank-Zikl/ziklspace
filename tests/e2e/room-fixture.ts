import type { Page } from '@playwright/test';
import type { RoomEntry } from '../../src/lib/room-api';
export const ownerId = '10000000-0000-4000-8000-000000000001';
export function entry(overrides: Partial<RoomEntry> = {}): RoomEntry {
  return {
    id: crypto.randomUUID(),
    kind: 'sticky',
    title: '',
    body: '公开的便签',
    source: 'manual',
    status: 'published',
    paper_state: 'active',
    created_at: '2026-10-21T00:00:00.000Z',
    updated_at: '2026-10-21T00:00:00.000Z',
    ...overrides,
  };
}
export async function mockRoom(
  page: Page,
  options: {
    owner?: boolean;
    entries?: RoomEntry[];
    failWrites?: boolean;
  } = {},
) {
  const rows = [...(options.entries ?? [])];
  const revisions: {
    id: string;
    entry_id: string;
    body: string;
    recorded_at: string;
  }[] = [];
  let tick = 0;
  const timestamp = () =>
    new Date(Date.UTC(2026, 9, 21, 1, 0, ++tick)).toISOString();
  const user = {
    id: ownerId,
    email: 'owner@example.test',
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-10-21T00:00:00Z',
  };
  const token = [
    Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString(
      'base64url',
    ),
    Buffer.from(
      JSON.stringify({
        sub: ownerId,
        role: 'authenticated',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString('base64url'),
    'test-signature',
  ].join('.');
  if (options.owner)
    await page.addInitScript(
      ({ token, user }) => {
        if (!sessionStorage.getItem('room-test-seeded')) {
          localStorage.setItem(
            'sb-room-test-auth-token',
            JSON.stringify({
              access_token: token,
              refresh_token: 'test-refresh',
              token_type: 'bearer',
              expires_in: 3600,
              expires_at: Math.floor(Date.now() / 1000) + 3600,
              user,
            }),
          );
          sessionStorage.setItem('room-test-seeded', '1');
        }
      },
      { token, user },
    );
  await page.route('https://room-test.supabase.co/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const owner = request.headers().authorization === `Bearer ${token}`;
    const respond = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
        },
      });
    if (request.method() === 'OPTIONS') {
      await respond({});
      return;
    }
    if (url.pathname.endsWith('/auth/v1/user')) {
      await respond(user);
      return;
    }
    if (url.pathname.endsWith('/auth/v1/logout')) {
      await route.fulfill({ status: 204 });
      return;
    }
    if (url.pathname.endsWith('/auth/v1/otp')) {
      await respond({});
      return;
    }
    if (url.pathname.endsWith('/room_owners')) {
      await respond(owner ? [{ user_id: ownerId }] : []);
      return;
    }
    if (url.pathname.endsWith('/room_revisions')) {
      const id = url.searchParams.get('entry_id')?.replace('eq.', '');
      await respond(revisions.filter((row) => row.entry_id === id));
      return;
    }
    if (request.method() === 'GET' && url.pathname.endsWith('/room_entries')) {
      await respond(rows.filter((row) => owner || row.status === 'published'));
      return;
    }
    if (!owner) {
      await respond({ message: 'Owner required' }, 403);
      return;
    }
    if (options.failWrites) {
      await respond({ message: 'Storage unavailable' }, 500);
      return;
    }
    const input = request.postDataJSON();
    if (url.pathname.endsWith('/rpc/rewrite_sticky')) {
      const old = rows.find((row) => row.id === input.p_id);
      if (!old || old.updated_at !== input.p_expected_updated_at) {
        await respond({ message: 'Conflict' }, 409);
        return;
      }
      revisions.push({
        id: crypto.randomUUID(),
        entry_id: old.id,
        body: old.body,
        recorded_at: timestamp(),
      });
      old.paper_state = 'torn';
      old.updated_at = timestamp();
      const replacement = entry({
        body: input.p_body,
        updated_at: timestamp(),
      });
      rows.unshift(replacement);
      await respond([replacement]);
      return;
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/room_entries')) {
      const created = entry({ ...input, updated_at: timestamp() });
      rows.unshift(created);
      await respond(created, 201);
      return;
    }
    if (
      request.method() === 'PATCH' &&
      url.pathname.endsWith('/room_entries')
    ) {
      const id = url.searchParams.get('id')?.replace('eq.', '');
      const updated = url.searchParams.get('updated_at')?.replace('eq.', '');
      const old = rows.find(
        (row) => row.id === id && row.updated_at === updated,
      );
      if (!old) {
        await respond({ message: 'Conflict' }, 409);
        return;
      }
      revisions.push({
        id: crypto.randomUUID(),
        entry_id: old.id,
        body: old.body,
        recorded_at: timestamp(),
      });
      Object.assign(old, input, { updated_at: timestamp() });
      await respond(old);
      return;
    }
    await respond({ message: 'Unexpected request' }, 400);
  });
  return { rows, revisions };
}
export async function enterRoom(page: Page) {
  await page.goto('/');
  const skip = page.getByRole('button', { name: '跳过动画' });
  if (await skip.isVisible()) await skip.click();
}
