import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const owner = '10000000-0000-4000-8000-000000000001';
const stranger = '10000000-0000-4000-8000-000000000002';

test('PostgreSQL enforces room ownership, private drafts, history and atomic rewrites', async (t) => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;
      insert into auth.users values ('${owner}'), ('${stranger}');
    `);
    await db.exec(
      await readFile(
        new URL(
          '../../supabase/migrations/202610210001_personal_room.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    await db.query('insert into public.room_owners(user_id) values ($1)', [
      owner,
    ]);
    async function as<T>(
      role: string,
      id: string,
      action: () => Promise<T>,
    ): Promise<T> {
      await db.exec(`set role ${role}`);
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
        id,
      ]);
      try {
        return await action();
      } finally {
        await db.exec('reset role');
      }
    }
    const insert = async (kind: string, body: string, status = 'published') =>
      (
        await db.query<{ id: string; updated_at: string }>(
          'insert into public.room_entries(kind,body,status) values ($1,$2,$3) returning id,updated_at',
          [kind, body, status],
        )
      ).rows[0];
    const note = await as('authenticated', owner, () =>
      insert('sticky', '最初的想法'),
    );
    const draft = await as('authenticated', owner, () =>
      insert('thought', '私有感受', 'draft'),
    );
    await t.test(
      'anonymous and signed-in nonowners cannot read drafts or write',
      async () => {
        for (const [role, id] of [
          ['anon', ''],
          ['authenticated', stranger],
        ]) {
          await as(role, id, async () => {
            const visible = (
              await db.query<{ id: string }>(
                'select id from public.room_entries',
              )
            ).rows;
            assert.deepEqual(
              visible.map((entry) => entry.id),
              [note.id],
            );
            await assert.rejects(() => insert('sticky', 'unauthorized'));
            const changed = await db
              .query(
                "update public.room_entries set body='unauthorized' where id=$1 returning id",
                [note.id],
              )
              .catch(() => ({ rows: [] }));
            assert.equal(changed.rows.length, 0);
          });
        }
      },
    );
    await t.test(
      'owner cannot delete notes or tamper with revision history',
      async () => {
        await as('authenticated', owner, async () => {
          await assert.rejects(() =>
            db.query('delete from public.room_entries where id=$1', [note.id]),
          );
          await assert.rejects(() =>
            db.query('delete from public.room_revisions'),
          );
        });
      },
    );
    await t.test(
      'publishing does not expose earlier private revisions',
      async () => {
        await as('authenticated', owner, () =>
          db.query(
            "update public.room_entries set body='确认公开的部分',status='published' where id=$1",
            [draft.id],
          ),
        );
        await as('anon', '', async () => {
          assert.equal(
            (
              await db.query(
                'select * from public.room_revisions where entry_id=$1',
                [draft.id],
              )
            ).rows.length,
            0,
          );
        });
      },
    );
    await t.test(
      'editing retains old text and stale writes cannot overwrite a newer edit',
      async () => {
        const updated = await as('authenticated', owner, () =>
          db.query(
            "update public.room_entries set body='修改后的想法' where id=$1 and updated_at=$2 returning updated_at",
            [note.id, note.updated_at],
          ),
        );
        assert.equal(updated.rows.length, 1);
        const stale = await as('authenticated', owner, () =>
          db.query(
            "update public.room_entries set body='过期覆盖' where id=$1 and updated_at=$2 returning id",
            [note.id, note.updated_at],
          ),
        );
        assert.equal(stale.rows.length, 0);
        await as('anon', '', async () => {
          assert.equal(
            (
              await db.query<{ body: string }>(
                'select body from public.room_revisions where entry_id=$1',
                [note.id],
              )
            ).rows[0].body,
            '最初的想法',
          );
        });
      },
    );
    await t.test(
      'failed replacement rolls back the tear; successful replacement archives rather than deletes',
      async () => {
        const current = (
          await db.query<{ updated_at: string }>(
            'select updated_at from public.room_entries where id=$1',
            [note.id],
          )
        ).rows[0];
        await as('authenticated', owner, async () => {
          await assert.rejects(() =>
            db.query('select * from public.rewrite_sticky($1,$2,$3)', [
              note.id,
              'x'.repeat(601),
              current.updated_at,
            ]),
          );
          assert.equal(
            (
              await db.query<{ paper_state: string }>(
                'select paper_state from public.room_entries where id=$1',
                [note.id],
              )
            ).rows[0].paper_state,
            'active',
          );
          const replacement = await db.query<{ id: string }>(
            'select * from public.rewrite_sticky($1,$2,$3)',
            [note.id, '重新写的一张', current.updated_at],
          );
          assert.equal(replacement.rows.length, 1);
          assert.notEqual(replacement.rows[0].id, note.id);
          assert.equal(
            (
              await db.query<{ paper_state: string }>(
                'select paper_state from public.room_entries where id=$1',
                [note.id],
              )
            ).rows[0].paper_state,
            'torn',
          );
          await assert.rejects(() =>
            db.query(
              "update public.room_entries set body='修改旧纸' where id=$1",
              [note.id],
            ),
          );
        });
      },
    );
  } finally {
    await db.close();
  }
});
