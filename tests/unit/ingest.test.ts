import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../../supabase/functions/submit-thought/handler.ts';
const secret = 'test-only-inbox-token-with-at-least-32-characters';
const valid = {
  title: '一次思考',
  body: '这是我自己确认过的感受。',
  source: 'gpt',
  request_id: '10000000-0000-4000-8000-000000000001',
};
function setup(responseStatus = 201) {
  const calls: RequestInit[] = [];
  const handler = createHandler({
    env: (name) =>
      ({
        ROOM_INGEST_TOKEN: secret,
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'server-only-test-key',
      })[name],
    fetch: (async (_input, init) => {
      calls.push(init!);
      return new Response(
        JSON.stringify(responseStatus === 200 ? [] : [{ id: 'draft-id' }]),
        { status: responseStatus },
      );
    }) as typeof fetch,
  });
  const request = (body: unknown = valid, token = secret) =>
    new Request('https://example.test/submit-thought', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  return { handler, calls, request };
}
test('unauthorized callers cannot reach the database', async () => {
  const { handler, calls, request } = setup();
  assert.equal((await handler(request(valid, 'wrong'))).status, 401);
  assert.equal(calls.length, 0);
});
test('AI can only create a draft even if it requests publication', async () => {
  const { handler, calls, request } = setup();
  const response = await handler(
    request({
      ...valid,
      status: 'published',
      kind: 'whiteboard',
      id: 'overwrite-id',
    }),
  );
  assert.equal(response.status, 201);
  const sent = JSON.parse(String(calls[0].body));
  assert.equal(sent.status, 'draft');
  assert.equal(sent.kind, 'thought');
  assert.equal(sent.id, undefined);
  assert.equal(sent.body, valid.body);
  assert.equal(sent.ingest_key, valid.request_id);
  assert.equal(
    JSON.stringify(await response.json()).includes('server-only'),
    false,
  );
});
test('retry is acknowledged without creating a second draft', async () => {
  const { handler, request } = setup(200);
  assert.deepEqual(await (await handler(request())).json(), {
    status: 'draft',
    duplicate: true,
  });
});
test('malformed and over-limit input never reaches the database', async () => {
  const { handler, calls, request } = setup();
  for (const input of [
    { ...valid, request_id: 'bad' },
    { ...valid, body: '' },
    { ...valid, body: 'a'.repeat(30001) },
    { ...valid, title: ' '.repeat(20) },
    { ...valid, body: 'a'.repeat(66000) },
  ]) {
    assert.equal((await handler(request(input))).status, 400);
  }
  assert.equal(calls.length, 0);
});
test('missing configuration fails closed', async () => {
  const handler = createHandler({ env: () => undefined, fetch });
  assert.equal(
    (await handler(new Request('https://example.test', { method: 'POST' })))
      .status,
    503,
  );
});
test('storage errors do not disclose backend response details', async () => {
  const { handler, request } = setup(500);
  const response = await handler(request());
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'Unable to save draft' });
});
