import { createClient } from 'npm:@supabase/supabase-js@2';
export async function freightAuth(req: Request, adminOnly = false) {
  const url = Deno.env.get('SUPABASE_URL'), anon = Deno.env.get('SUPABASE_ANON_KEY'), key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anon || !key) throw new Error('Configuração interna indisponível');
  const auth = req.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) throw Object.assign(new Error('Sessão obrigatória'), { status: 401 });
  const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data, error } = await userClient.auth.getClaims(auth.slice(7));
  const userId = data?.claims?.sub;
  if (error || !userId) throw Object.assign(new Error('Sessão inválida'), { status: 401 });
  const db = createClient(url, key);
  const { data: admin, error: roleError } = await db.rpc('has_role', { _user_id: userId, _role: 'admin' });
  if (roleError) throw new Error('Não foi possível conferir a permissão');
  if (!admin) {
    if (adminOnly) throw Object.assign(new Error('Somente administradores podem configurar os Correios'), { status: 403 });
    const permissions = await Promise.all(['pos', 'expedition'].map((module) => db.rpc('has_module_access', { _user_id: userId, _module: module })));
    if (permissions.some((p) => p.error) || !permissions.some((p) => p.data === true)) throw Object.assign(new Error('Sem acesso ao PDV/Expedição'), { status: 403 });
  }
  return { db, userClient, userId };
}