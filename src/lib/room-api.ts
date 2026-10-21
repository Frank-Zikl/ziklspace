import { createClient } from '@supabase/supabase-js';

export interface RoomEntry {
  id: string;
  kind: 'whiteboard' | 'sticky' | 'thought';
  title: string;
  body: string;
  source: 'manual' | 'gpt' | 'gemini' | 'other';
  status: 'draft' | 'published';
  paper_state: 'active' | 'crossed' | 'torn';
  created_at: string;
  updated_at: string;
}
export interface RoomRevision {
  id: string;
  body: string;
  recorded_at: string;
}
const url = import.meta.env.PUBLIC_SUPABASE_URL;
const key = import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export const roomClient =
  url && key
    ? createClient(url, key, {
        auth: {
          flowType: 'pkce',
          detectSessionInUrl: true,
          persistSession: true,
          autoRefreshToken: true,
        },
      })
    : null;
const entryColumns =
  'id,kind,title,body,source,status,paper_state,created_at,updated_at';
function client() {
  if (!roomClient) throw new Error('房间尚未连接云端，暂时无法保存。');
  return roomClient;
}
export async function viewer() {
  const api = client();
  const {
    data: { session },
  } = await api.auth.getSession();
  if (!session) return { owner: false, signedIn: false };
  const { data, error } = await api.auth.getUser();
  if (error || !data.user) throw new Error('登录已失效，请重新登录。');
  const membership = await api
    .from('room_owners')
    .select('user_id')
    .eq('user_id', data.user.id)
    .maybeSingle();
  if (membership.error) throw new Error('无法确认房主权限，请检查云端连接。');
  return { owner: !!membership.data, signedIn: true };
}
export async function loadRoomEntries(): Promise<RoomEntry[]> {
  const { data, error } = await client()
    .from('room_entries')
    .select(entryColumns)
    .order('created_at', { ascending: false });
  if (error) throw new Error('暂时无法读取房间内容，请稍后重试。');
  return data as RoomEntry[];
}

export async function loadPublishedThoughts(): Promise<RoomEntry[]> {
  const { data, error } = await client()
    .from('room_entries')
    .select(entryColumns)
    .eq('kind', 'thought')
    .eq('status', 'published')
    .order('created_at', { ascending: false });
  if (error) throw new Error('云端笔记暂时无法读取。');
  return (data as RoomEntry[]).filter(
    (entry) => entry.kind === 'thought' && entry.status === 'published',
  );
}
export async function saveRoomEntry(
  values: Partial<
    Pick<RoomEntry, 'title' | 'body' | 'source' | 'status' | 'paper_state'>
  > & { kind?: RoomEntry['kind'] },
  existing?: RoomEntry,
): Promise<RoomEntry> {
  const query = existing
    ? client()
        .from('room_entries')
        .update(values)
        .eq('id', existing.id)
        .eq('updated_at', existing.updated_at)
    : client().from('room_entries').insert(values);
  const { data, error } = await query.select(entryColumns).single();
  if (error)
    throw new Error(
      '保存失败，可能已在另一窗口修改。请保留当前文字，重新打开后核对。',
    );
  return data as RoomEntry;
}
export async function rewriteSticky(existing: RoomEntry, body: string) {
  const { data, error } = await client().rpc('rewrite_sticky', {
    p_id: existing.id,
    p_body: body,
    p_expected_updated_at: existing.updated_at,
  });
  if (error)
    throw new Error('重写失败，原便签仍然保留。请重新打开便签后重试。');
  return data[0] as RoomEntry;
}
export async function loadRevisions(id: string): Promise<RoomRevision[]> {
  const { data, error } = await client()
    .from('room_revisions')
    .select('id,body,recorded_at')
    .eq('entry_id', id)
    .order('recorded_at', { ascending: false });
  if (error) throw new Error('旧字迹暂时无法读取。');
  return data as RoomRevision[];
}
export class LoginRateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super(
      `请求过于频繁，请先检查收件箱和垃圾邮件，${retryAfterSeconds} 秒后再试。`,
    );
    this.name = 'LoginRateLimitError';
  }
}

export async function login(email: string) {
  const { error } = await client().auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: window.location.origin + '/',
    },
  });
  if (error?.status === 429 || error?.code === 'over_email_send_rate_limit') {
    const wait = error.message.match(/after\s+(\d+)\s+seconds?/i);
    const seconds = wait ? Number(wait[1]) : 60;
    throw new LoginRateLimitError(Math.max(1, Math.min(seconds, 3600)));
  }
  if (error) throw new Error('登录邮件暂未能发送，请稍后重试。');
}
