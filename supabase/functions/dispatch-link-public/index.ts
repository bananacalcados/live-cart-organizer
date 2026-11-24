// Links de Disparo — página pública (celular). Nunca confia no navegador:
// cada chamada revalida sessão, link (ativo/vencido/revogado) e todos os presets.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { withAccessLog } from '../_shared/withAccessLog.ts';
import { internalCallHeaders } from '../_shared/requireAuth.ts';
import * as R from '../_shared/dispatch-link-rules.ts';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(URL_, SERVICE, { auth: { persistSession: false } });

const LINK_COLS = 'id,name,description,is_active,revoked_at,expires_at,password_version,allowed_instance_ids,template_mode,allowed_templates,allowed_audiences,allowed_comm_types,allow_send_now,allow_schedule,max_recipients,simulate_only';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

function clientIp(req: Request) {
  return (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || req.headers.get('cf-connecting-ip') || null;
}

function randomToken() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function loadContext(token: unknown) {
  const t = String(token || '');
  if (t.length < 20 || t.length > 200) throw new R.RuleError('sessao_invalida', 'Acesso encerrado. Digite a senha de novo.', 401);
  const hash = await R.sha256Hex(t);
  const { data: session } = await db.from('dispatch_link_sessions').select('id,link_id,password_version,expires_at,revoked_at').eq('token_hash', hash).maybeSingle();
  const { data: link } = session ? await db.from('dispatch_links').select(LINK_COLS).eq('id', session.link_id).maybeSingle() : { data: null };
  R.sessionUsable(session as R.LinkSession | null, link as R.DispatchLink | null);
  return { session: session as R.LinkSession, link: link as R.DispatchLink & { name: string } };
}

async function fetchTemplates(instanceId: string): Promise<any[]> {
  const res = await fetch(`${URL_}/functions/v1/meta-whatsapp-get-templates?whatsappNumberId=${encodeURIComponent(instanceId)}`, {
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!data?.success) throw new R.RuleError('templates_indisponiveis', 'Não consegui carregar os modelos agora. Tente de novo.', 502);
  return (data.templates || []).filter((t: any) => t.status === 'APPROVED');
}

async function resolveTemplate(link: R.DispatchLink, instanceId: string, name: unknown, language: unknown) {
  R.checkInstance(link, String(instanceId || ''));
  const n = String(name || ''), l = String(language || '');
  R.checkTemplateAllowed(link, n, l);
  const tpl = (await fetchTemplates(instanceId)).find((t) => t.name === n && t.language === l);
  const { headerFormat } = R.checkTemplateSupported(tpl);
  return { tpl, headerFormat };
}

async function assertInstanceActive(id: string) {
  const { data } = await db.from('whatsapp_numbers').select('id,label,provider,is_active').eq('id', id).maybeSingle();
  if (!data || !data.is_active || data.provider !== 'meta') throw new R.RuleError('instancia_fora', 'Instância indisponível.', 403);
  return data;
}

function applyRavenaFilters(q: any, f: Record<string, any> = {}) {
  q = q.not('phone', 'is', null);
  if (f.rfm_segments?.length) q = q.in('rfm_segment', f.rfm_segments);
  if (f.states?.length) q = q.in('state', f.states);
  if (f.cities?.length) q = q.in('city', f.cities);
  if (f.ddds?.length) q = q.in('ddd', f.ddds);
  if (f.tags?.length) q = q.overlaps('tags', f.tags);
  if (Number.isFinite(f.min_orders)) q = q.gte('total_orders', f.min_orders);
  if (Number.isFinite(f.max_orders)) q = q.lte('total_orders', f.max_orders);
  if (Number.isFinite(f.min_ticket)) q = q.gte('avg_ticket', f.min_ticket);
  if (Number.isFinite(f.max_ticket)) q = q.lte('avg_ticket', f.max_ticket);
  return q;
}

async function savedFilter(a: R.LinkAudience) {
  const { data } = await db.from('campanha_publicos').select('filtro_json').eq('id', a.publico_id!).maybeSingle();
  if (!data) throw new R.RuleError('publico_fora', 'Público salvo não existe mais.', 403);
  return data.filtro_json || {};
}

async function countAudience(a: R.LinkAudience): Promise<number> {
  if (a.kind === 'ravena') {
    const { count, error } = await applyRavenaFilters(db.from('ravena_customers').select('id', { count: 'exact', head: true }), a.filters as any);
    if (error) throw error;
    return count || 0;
  }
  const { data, error } = await db.rpc('count_campaign_audience', { p_filtro: await savedFilter(a) });
  if (error) throw error;
  return Number(data || 0);
}

type Cand = { unified_id: string | null; phone: string; name: string | null };
async function listAudience(a: R.LinkAudience, cap: number): Promise<Cand[]> {
  const out = new Map<string, Cand>();
  const add = (phone: unknown, name: unknown, uid: string | null) => {
    const p = R.normalizeRecipientPhone(phone);
    if (p && !out.has(p)) out.set(p, { unified_id: uid, phone: p, name: name ? String(name) : null });
  };
  if (a.kind === 'ravena') {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await applyRavenaFilters(db.from('ravena_customers').select('id,name,phone'), a.filters as any).order('id').range(from, from + 999);
      if (error) throw error;
      for (const r of data || []) add(r.phone, r.name, null);
      if (!data || data.length < 1000 || out.size > cap) break;
    }
  } else {
    const filtro = await savedFilter(a);
    for (let off = 0; ; off += 5000) {
      const { data, error } = await db.rpc('list_campaign_audience', { p_filtro: filtro, p_limit: 5000, p_offset: off });
      if (error) throw error;
      for (const r of (data as any[]) || []) add(r.phone, r.nome, r.cliente_id);
      if (!data || (data as any[]).length < 5000 || out.size > cap) break;
    }
  }
  return [...out.values()];
}

async function sentToday(template: string, instance: string) {
  const s = new Set<string>();
  const { data, error } = await db.rpc('dispatch_link_sent_today', { p_template: template, p_instance: instance });
  if (error) throw error;
  for (const p of (data as any[]) || []) s.add(String(typeof p === 'string' ? p : Object.values(p)[0]));
  return s;
}

async function prepareConfig(link: R.DispatchLink, body: any) {
  const instanceId = String(body.instance_id || '');
  R.checkInstance(link, instanceId);
  await assertInstanceActive(instanceId);
  const { tpl, headerFormat } = await resolveTemplate(link, instanceId, body.template_name, body.language);
  const vars = R.normalizeVariables(tpl, body.variables);
  const headerMediaUrl = R.checkHeaderMedia(headerFormat, body.header_media_url);
  const hash = await R.configHash(instanceId, tpl.name, tpl.language, vars, headerMediaUrl);
  return { instanceId, tpl, vars, headerMediaUrl, hash };
}

const UPLOAD_BUCKET = 'chat-media';
const UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
const UPLOAD_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png' };
const UPLOADS_PER_SESSION = 15;

async function lockMinutesLeft(code: string, ip: string | null) {
  const { data: l } = await db.from('dispatch_links').select('id').eq('code', code).maybeSingle();
  if (!l) return 15;
  const since = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data } = await db.from('dispatch_link_attempts').select('created_at,ip').eq('link_id', l.id).eq('success', false).gte('created_at', since)
    .order('created_at', { ascending: false }).limit(40);
  const rows = (data || []) as { created_at: string; ip: string | null }[];
  const mine = rows.filter((r) => r.ip === ip);
  // libera quando a tentativa que mantém o bloqueio sair da janela de 15 min
  const ref = mine.length >= 5 ? mine[4] : rows.length >= 20 ? rows[19] : rows[rows.length - 1];
  if (!ref) return 1;
  const ms = new Date(ref.created_at).getTime() + 15 * 60_000 - Date.now();
  return Math.max(1, Math.ceil(ms / 60_000));
}

async function handle(action: string, body: any, req: Request) {
  if (action === 'info') {
    const code = String(body.code || '');
    if (!/^[A-Za-z0-9_-]{10,64}$/.test(code)) return json({ ok: false, code: 'link_invalido', error: 'Link inválido.' }, 404);
    const { data: l } = await db.from('dispatch_links').select('name,is_active,revoked_at,expires_at').eq('code', code).maybeSingle();
    if (!l) return json({ ok: false, code: 'link_invalido', error: 'Link inválido.' }, 404);
    const usable = l.is_active && !l.revoked_at && (!l.expires_at || new Date(l.expires_at).getTime() > Date.now());
    if (!usable) return json({ ok: false, code: 'link_inativo', error: 'Este link está desativado ou venceu.' }, 403);
    return json({ ok: true, link_name: l.name });
  }

  if (action === 'login') {
    const code = String(body.code || '');
    if (!/^[A-Za-z0-9_-]{10,64}$/.test(code)) return json({ ok: false, error: 'Código ou senha inválidos.' }, 401);
    const token = randomToken();
    const { data, error } = await db.rpc('dispatch_link_login', {
      p_code: code, p_password: String(body.password || '').slice(0, 200), p_ip: clientIp(req), p_token_hash: await R.sha256Hex(token),
    });
    if (error) throw error;
    const r = data as any;
    if (!r?.ok) {
      if (r?.reason === 'locked') {
        const minutes = await lockMinutesLeft(code, clientIp(req));
        return json({ ok: false, code: 'bloqueado', minutes, error: `Muitas tentativas. Espere ${minutes} minuto(s).` }, 429);
      }
      if (r?.reason === 'inactive') return json({ ok: false, code: 'link_inativo', error: 'Este link está desativado ou venceu.' }, 403);
      return json({ ok: false, code: 'senha_invalida', error: 'Código ou senha inválidos.' }, 401);
    }
    return json({ ok: true, token, expires_at: r.expires_at, link_name: r.link_name });
  }

  const { session, link } = await loadContext(body.token);

  if (action === 'options') {
    const { data: inst } = await db.from('whatsapp_numbers').select('id,label,provider,is_active').in('id', link.allowed_instance_ids);
    const instances = [];
    for (const i of (inst || []).filter((x: any) => x.is_active && x.provider === 'meta')) {
      let templates: any[] = [];
      try {
        templates = (await fetchTemplates(i.id)).filter((t) => {
          try { R.checkTemplateAllowed(link, t.name, t.language); R.checkTemplateSupported(t); return true; } catch { return false; }
        }).map((t) => ({ name: t.name, language: t.language, category: t.category, components: t.components, variable_keys: R.templateVarKeys(t) }));
      } catch { templates = []; }
      instances.push({ id: i.id, label: i.label, templates });
    }
    const audiences = link.allowed_audiences.map((a) => ({ key: a.key, label: a.label }));
    return json({
      ok: true, link_name: link.name, instances, audiences,
      comm_types: link.allowed_comm_types?.length ? link.allowed_comm_types : R.COMM_TYPES,
      allow_send_now: link.allow_send_now, allow_schedule: link.allow_schedule,
      max_recipients: link.max_recipients, variable_modes: R.ALLOWED_VAR_MODES,
    });
  }

  if (action === 'count') {
    const a = R.findAudience(link, String(body.audience_key || ''));
    const total = await countAudience(a);
    return json({ ok: true, total, max: link.max_recipients, exceeds: total > link.max_recipients });
  }

  if (action === 'send_test') {
    const cfg = await prepareConfig(link, body);
    const phone = R.normalizeTestPhone(body.test_phone);
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await db.from('dispatch_link_tests').select('id', { count: 'exact', head: true }).eq('session_id', session.id).gte('created_at', since);
    R.checkTestRate(count || 0);
    let status: 'sent' | 'failed' | 'simulated' = 'simulated';
    let messageId: string | null = null, err: string | null = null;
    if (!link.simulate_only) {
      const res = await fetch(`${URL_}/functions/v1/meta-whatsapp-send-template`, {
        method: 'POST',
        headers: { ...(await internalCallHeaders()), apikey: SERVICE, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone, templateName: cfg.tpl.name, language: cfg.tpl.language, whatsappNumberId: cfg.instanceId,
          components: R.buildTestComponents(cfg.tpl, cfg.vars, cfg.headerMediaUrl), renderedMessage: R.renderMessage(cfg.tpl, cfg.vars),
        }),
      });
      const d = await res.json().catch(() => ({}));
      status = d?.success ? 'sent' : 'failed';
      messageId = d?.messageId || d?.message_id || d?.data?.messages?.[0]?.id || null;
      if (!d?.success) err = String(d?.error || d?.details?.error?.message || 'falha no envio').slice(0, 300);
    }
    const { data: t, error } = await db.from('dispatch_link_tests').insert({
      link_id: link.id, session_id: session.id, config_hash: cfg.hash, phone_masked: R.maskPhone(phone), status, message_id: messageId, error: err,
    }).select('id').single();
    if (error) throw error;
    if (status === 'failed') return json({ ok: false, code: 'teste_falhou', error: `O teste não foi enviado: ${err}` }, 502);
    return json({ ok: true, test_id: t.id, simulated: status === 'simulated' });
  }

  if (action === 'create_dispatch') {
    const cfg = await prepareConfig(link, body);
    R.checkCommType(link, String(body.comm_type || ''));
    const scheduledAt = R.checkSchedule(link, String(body.mode || ''), body.scheduled_at);
    const audience = R.findAudience(link, String(body.audience_key || ''));
    const { data: tests } = await db.from('dispatch_link_tests').select('id,session_id,config_hash,status,created_at,used_at')
      .eq('session_id', session.id).eq('config_hash', cfg.hash).order('created_at', { ascending: false }).limit(20);
    const test = R.findValidTest((tests || []) as R.LinkTest[], session.id, cfg.hash);

    const all = await listAudience(audience, link.max_recipients);
    const already = await sentToday(cfg.tpl.name, cfg.instanceId);
    const cands = all.filter((c) => !already.has(c.phone) && !already.has(c.phone.replace(/^55/, '')));
    if (all.length > link.max_recipients) {
      // lista parou cedo de propósito: informa o total real sem baixar todo mundo
      const total = await countAudience(audience);
      R.checkLimit(link, Math.max(total - already.size, cands.length));
    }
    R.checkLimit(link, cands.length);

    // Uma confirmação por teste (protege contra clique duplo)
    const { data: claimed } = await db.from('dispatch_link_tests').update({ used_at: new Date().toISOString() })
      .eq('id', test.id).is('used_at', null).select('id').maybeSingle();
    if (!claimed) throw new R.RuleError('ja_confirmado', 'Este disparo já foi confirmado.', 409);

    if (link.simulate_only) {
      return json({ ok: true, simulated: true, would_enqueue: cands.length, skipped_sent_today: all.length - cands.length, scheduled_at: scheduledAt });
    }

    const varsCfg = cfg.vars;
    const { data: d, error: insErr } = await db.from('dispatch_history').insert({
      template_name: cfg.tpl.name, template_language: cfg.tpl.language, whatsapp_number_id: cfg.instanceId,
      campaign_name: body.campaign_name ? String(body.campaign_name).slice(0, 120) : `Link: ${link.name}`,
      audience_source: audience.kind === 'ravena' ? 'ravena' : 'crm',
      audience_filters: { link_audience_key: audience.key, label: audience.label, publico_id: audience.publico_id ?? null, filters: audience.filters ?? null },
      total_recipients: 0, rendered_message: R.renderMessage(cfg.tpl, varsCfg), variables_config: varsCfg,
      force_resend: false, track_clicks: false, status: 'scheduled_paused', template_components: cfg.tpl.components,
      has_dynamic_vars: Object.values(varsCfg).some((v) => v.mode !== '__static__'), header_media_url: cfg.headerMediaUrl,
      template_category: cfg.tpl.category || 'MARKETING', dispatch_link_id: link.id,
    }).select('id').single();
    if (insErr || !d) {
      await db.from('dispatch_link_tests').update({ used_at: null }).eq('id', test.id);
      throw insErr || new Error('dispatch insert failed');
    }
    let inserted = 0, excluded = 0;
    try {
      for (let i = 0; i < cands.length; i += 1000) {
        const { data: res, error } = await db.rpc('enqueue_dispatch_recipients_guarded', {
          p_dispatch_id: d.id, p_candidates: cands.slice(i, i + 1000), p_tipo_comunicacao: String(body.comm_type),
          p_provider: 'meta_cloud', p_overrides: [], p_skip_unify: audience.kind === 'ravena', p_override_quota: false,
        });
        if (error) throw error;
        inserted += Number((res as any)?.inserted || 0);
        excluded += Number((res as any)?.summary?.excluded_total || 0);
      }
    } catch (e) {
      await db.from('dispatch_history').update({ status: 'failed' }).eq('id', d.id);
      throw e;
    }
    await db.from('dispatch_link_tests').update({ used_dispatch_id: d.id }).eq('id', test.id);
    if (inserted === 0) {
      await db.from('dispatch_history').update({ status: 'failed' }).eq('id', d.id);
      return json({ ok: false, code: 'todos_bloqueados', error: 'Ninguém pôde receber (bloqueios e descadastros).', dispatch_id: d.id }, 409);
    }
    if (scheduledAt) {
      await db.from('dispatch_history').update({ status: 'scheduled', scheduled_at: scheduledAt, total_recipients: inserted }).eq('id', d.id);
    } else {
      await db.from('dispatch_history').update({ status: 'sending', started_at: new Date().toISOString(), processing_batch: false, total_recipients: inserted }).eq('id', d.id);
      for (let i = 0; i < 2; i++) {
        fetch(`${URL_}/functions/v1/dispatch-worker`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE}`, apikey: SERVICE },
          body: JSON.stringify({ dispatchId: d.id }),
        }).catch((e) => console.error('[dispatch-link-public] worker kick failed', e));
      }
    }
    return json({ ok: true, dispatch_id: d.id, enqueued: inserted, excluded, skipped_sent_today: all.length - cands.length, scheduled_at: scheduledAt });
  }

  if (action === 'upload_url') {
    const ct = String(body.content_type || '');
    const ext = UPLOAD_TYPES[ct];
    if (!ext) throw new R.RuleError('imagem_tipo', 'Use uma foto JPG ou PNG.');
    const size = Number(body.size || 0);
    if (!Number.isFinite(size) || size <= 0 || size > UPLOAD_MAX_BYTES) throw new R.RuleError('imagem_grande', 'A foto precisa ter até 5 MB.');
    const dir = `dispatch-links/${link.id}/${session.id}`;
    const { data: existing } = await db.storage.from(UPLOAD_BUCKET).list(dir, { limit: 100 });
    if ((existing || []).length >= UPLOADS_PER_SESSION) throw new R.RuleError('imagem_limite', 'Muitas fotos neste acesso. Entre de novo pelo link.', 429);
    const path = `${dir}/${crypto.randomUUID()}.${ext}`;
    const { data, error } = await db.storage.from(UPLOAD_BUCKET).createSignedUploadUrl(path);
    if (error || !data) throw error || new Error('signed upload failed');
    return json({ ok: true, path, upload_url: data.signedUrl });
  }

  if (action === 'confirm_upload') {
    const path = String(body.path || '');
    const dir = `dispatch-links/${link.id}/${session.id}`;
    const m = path.match(/^dispatch-links\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/([0-9a-f-]{36}\.(jpg|png))$/);
    if (!m || !path.startsWith(dir + '/')) throw new R.RuleError('imagem_invalida', 'Foto inválida. Envie de novo.', 403);
    const { data: files } = await db.storage.from(UPLOAD_BUCKET).list(dir, { search: m[1], limit: 5 });
    const f = (files || []).find((x: any) => x.name === m[1]) as any;
    const size = Number(f?.metadata?.size || 0), mime = String(f?.metadata?.mimetype || '');
    if (!f || size <= 0 || size > UPLOAD_MAX_BYTES || !UPLOAD_TYPES[mime]) {
      if (f) await db.storage.from(UPLOAD_BUCKET).remove([path]);
      throw new R.RuleError('imagem_invalida', 'A foto precisa ser JPG ou PNG de até 5 MB.');
    }
    const { data } = db.storage.from(UPLOAD_BUCKET).getPublicUrl(path);
    return json({ ok: true, url: data.publicUrl });
  }

  if (action === 'status') {
    const { data } = await db.from('dispatch_history').select('id,status,sent_count,failed_count,total_recipients,scheduled_at,completed_at,created_at')
      .eq('id', String(body.dispatch_id || '')).eq('dispatch_link_id', link.id).maybeSingle();
    if (!data) return json({ ok: false, error: 'Disparo não encontrado.' }, 404);
    return json({ ok: true, dispatch: data });
  }

  return json({ ok: false, error: 'Ação inválida.' }, 400);
}

Deno.serve(withAccessLog('dispatch-link-public', async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'Método inválido.' }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    return await handle(String(body?.action || ''), body || {}, req);
  } catch (e) {
    if (e instanceof R.RuleError) return json({ ok: false, code: e.code, error: e.message }, e.status);
    console.error('[dispatch-link-public] error', e);
    return json({ ok: false, error: 'Erro interno. Tente de novo.' }, 500);
  }
}));
