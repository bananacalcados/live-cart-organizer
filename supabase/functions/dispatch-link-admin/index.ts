// Links de Disparo — gestão (só admin do ERP). Senha só vira hash bcrypt no banco.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { withAccessLog, verifiedIdentity } from '../_shared/withAccessLog.ts';
import { requireAuth } from '../_shared/requireAuth.ts';
import * as R from '../_shared/dispatch-link-rules.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const COLS = 'id,code,name,description,password_version,allowed_instance_ids,template_mode,allowed_templates,allowed_audiences,allowed_comm_types,allow_send_now,allow_schedule,max_recipients,expires_at,is_active,revoked_at,simulate_only,created_by,created_at,updated_at';
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

function newCode() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hashPassword(p: string) {
  const { data, error } = await db.rpc('dispatch_link_hash_password', { p_password: R.validatePassword(p) });
  if (error || !data) throw new R.RuleError('senha_invalida', 'Senha inválida.');
  return data as string;
}

async function checkPresetRefs(p: ReturnType<typeof R.validatePreset>) {
  const { data: inst } = await db.from('whatsapp_numbers').select('id,provider').in('id', p.allowed_instance_ids);
  if ((inst || []).length !== p.allowed_instance_ids.length || (inst || []).some((i: any) => i.provider !== 'meta')) {
    throw new R.RuleError('instancias_invalidas', 'Só instâncias de WhatsApp API (Meta) podem ser usadas.');
  }
  const saved = p.allowed_audiences.filter((a) => a.kind === 'saved').map((a) => a.publico_id!);
  if (saved.length) {
    const { data } = await db.from('campanha_publicos').select('id').in('id', saved);
    if ((data || []).length !== new Set(saved).size) throw new R.RuleError('publicos_invalidos', 'Público salvo não encontrado.');
  }
}

const revokeSessions = (linkId: string) => db.from('dispatch_link_sessions').update({ revoked_at: new Date().toISOString() }).eq('link_id', linkId).is('revoked_at', null);

Deno.serve(withAccessLog('dispatch-link-admin', async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const denied = await requireAuth(req, [], true);
  if (denied) return denied;
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || '');
    const id = String(body?.id || '');
    const who = await verifiedIdentity(req);

    if (action === 'list') {
      const { data, error } = await db.from('dispatch_links').select(COLS).order('created_at', { ascending: false }).limit(200);
      if (error) throw error;
      return json({ ok: true, links: data });
    }
    if (action === 'create') {
      const p = R.validatePreset(body);
      await checkPresetRefs(p);
      const password_hash = await hashPassword(body.password);
      const { data, error } = await db.from('dispatch_links').insert({ ...p, code: newCode(), password_hash, created_by: who?.userId ?? null }).select(COLS).single();
      if (error) throw error;
      return json({ ok: true, link: data });
    }
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ ok: false, error: 'Link inválido.' }, 400);
    const { data: cur } = await db.from('dispatch_links').select('id,password_version,revoked_at').eq('id', id).maybeSingle();
    if (!cur) return json({ ok: false, error: 'Link não encontrado.' }, 404);

    if (action === 'update') {
      if (cur.revoked_at) return json({ ok: false, error: 'Link revogado não pode ser editado.' }, 409);
      const p = R.validatePreset(body);
      await checkPresetRefs(p);
      const { data, error } = await db.from('dispatch_links').update({ ...p, updated_at: new Date().toISOString() }).eq('id', id).select(COLS).single();
      if (error) throw error;
      return json({ ok: true, link: data });
    }
    if (action === 'reset_password') {
      const password_hash = await hashPassword(body.password);
      const { error } = await db.from('dispatch_links').update({ password_hash, password_version: cur.password_version + 1, updated_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
      await revokeSessions(id);
      return json({ ok: true });
    }
    if (action === 'set_active') {
      if (cur.revoked_at && body.active) return json({ ok: false, error: 'Link revogado não pode ser reativado.' }, 409);
      const { error } = await db.from('dispatch_links').update({ is_active: !!body.active, updated_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
      if (!body.active) await revokeSessions(id);
      return json({ ok: true });
    }
    if (action === 'revoke') {
      const now = new Date().toISOString();
      const { error } = await db.from('dispatch_links').update({ is_active: false, revoked_at: now, updated_at: now }).eq('id', id);
      if (error) throw error;
      await revokeSessions(id);
      return json({ ok: true });
    }
    if (action === 'history') {
      const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 200);
      const offset = Math.max(Number(body.offset) || 0, 0);
      const { data, error } = await db.from('dispatch_history')
        .select('id,campaign_name,template_name,status,total_recipients,sent_count,failed_count,scheduled_at,started_at,completed_at,created_at,whatsapp_number_id')
        .eq('dispatch_link_id', id).order('created_at', { ascending: false }).range(offset, offset + limit - 1);
      if (error) throw error;
      return json({ ok: true, dispatches: data });
    }
    return json({ ok: false, error: 'Ação inválida.' }, 400);
  } catch (e) {
    if (e instanceof R.RuleError) return json({ ok: false, code: e.code, error: e.message }, e.status);
    console.error('[dispatch-link-admin] error', e);
    return json({ ok: false, error: 'Erro interno.' }, 500);
  }
}));
