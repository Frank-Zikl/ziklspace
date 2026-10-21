type Dependencies = {
  env: (name: string) => string | undefined;
  fetch: typeof fetch;
};
const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
async function sameToken(actual: string, expected: string) {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all(
    [actual, expected].map((value) =>
      crypto.subtle.digest('SHA-256', encoder.encode(value)),
    ),
  );
  const aa = new Uint8Array(a);
  const bb = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < aa.length; i++) difference |= aa[i] ^ bb[i];
  return difference === 0;
}
async function readLimited(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Empty body');
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 65536) {
      await reader.cancel();
      throw new Error('Too large');
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(joined)) as unknown;
}
export function createHandler(deps: Dependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST')
      return reply(405, { error: 'POST required' });
    const secret = deps.env('ROOM_INGEST_TOKEN');
    const url = deps.env('SUPABASE_URL');
    const serviceKey = deps.env('SUPABASE_SERVICE_ROLE_KEY');
    if (!secret || secret.length < 32 || !url || !serviceKey)
      return reply(503, { error: 'Inbox is not configured' });
    const token =
      request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
    if (token.length > 512 || !(await sameToken(token, secret)))
      return reply(401, { error: 'Unauthorized' });
    if (!request.headers.get('Content-Type')?.startsWith('application/json'))
      return reply(415, { error: 'JSON required' });
    let input: unknown;
    try {
      input = await readLimited(request);
    } catch {
      return reply(400, { error: 'Invalid JSON or body exceeds 64 KiB' });
    }
    if (!input || typeof input !== 'object' || Array.isArray(input))
      return reply(400, { error: 'Object required' });
    const { title, body, source, request_id } = input as Record<
      string,
      unknown
    >;
    if (
      typeof title !== 'string' ||
      !title.trim() ||
      title.length > 200 ||
      typeof body !== 'string' ||
      !body.trim() ||
      body.length > 30000 ||
      !['gpt', 'gemini', 'other'].includes(String(source)) ||
      typeof request_id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        request_id,
      )
    ) {
      return reply(400, { error: 'Invalid title, body, source or request_id' });
    }
    try {
      // Accept only a draft INSERT. Ignore any caller-supplied publication or ownership fields.
      const response = await deps.fetch(
        `${url.replace(/\/$/, '')}/rest/v1/room_entries?on_conflict=ingest_key&select=id`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${serviceKey}`,
            apikey: serviceKey,
            'Content-Type': 'application/json',
            Prefer: 'resolution=ignore-duplicates,return=representation',
          },
          body: JSON.stringify({
            kind: 'thought',
            title: title.trim(),
            body,
            source,
            status: 'draft',
            paper_state: 'active',
            ingest_key: request_id,
          }),
          signal: AbortSignal.timeout(10000),
        },
      );
      if (!response.ok) return reply(502, { error: 'Unable to save draft' });
      const rows = (await response.json()) as { id: string }[];
      return reply(rows.length ? 201 : 200, {
        status: 'draft',
        duplicate: rows.length === 0,
        ...(rows[0] ? { id: rows[0].id } : {}),
      });
    } catch {
      return reply(502, { error: 'Unable to reach inbox storage' });
    }
  };
}
