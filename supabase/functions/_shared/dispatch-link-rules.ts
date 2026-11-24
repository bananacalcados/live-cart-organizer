// Regras puras dos Links de Disparo (sem rede/banco) — usadas pelas duas funções
// e cobertas por testes. Toda decisão de trava passa por aqui.

export type LinkAudience = {
  key: string;
  kind: 'ravena' | 'saved';
  label: string;
  publico_id?: string;
  filters?: Record<string, unknown>;
};

export type DispatchLink = {
  id: string;
  is_active: boolean;
  revoked_at: string | null;
  expires_at: string | null;
  password_version: number;
  allowed_instance_ids: string[];
  template_mode: 'all_approved' | 'list';
  allowed_templates: { name: string; language?: string }[];
  allowed_audiences: LinkAudience[];
  allowed_comm_types: string[] | null;
  allow_send_now: boolean;
  allow_schedule: boolean;
  max_recipients: number;
  simulate_only: boolean;
};

export type LinkSession = { id: string; link_id: string; password_version: number; expires_at: string; revoked_at: string | null };
export type LinkTest = { id: string; session_id: string; config_hash: string; status: string; created_at: string; used_at: string | null };

export class RuleError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}

export const COMM_TYPES = ['convite_live', 'oferta', 'reativacao', 'lancamento', 'pesquisa'] as const;
export const ALLOWED_VAR_MODES = ['__static__', '__first_name__', '__full_name__'] as const;
export const TEST_TTL_MS = 2 * 60 * 60 * 1000;
export const TESTS_PER_HOUR = 5;

export function linkUsable(link: DispatchLink | null, now = new Date()) {
  if (!link || !link.is_active || link.revoked_at) throw new RuleError('link_inativo', 'Este link está desativado.', 403);
  if (link.expires_at && new Date(link.expires_at).getTime() <= now.getTime()) throw new RuleError('link_vencido', 'Este link venceu.', 403);
}

export function sessionUsable(session: LinkSession | null, link: DispatchLink | null, now = new Date()) {
  if (!session || session.revoked_at) throw new RuleError('sessao_invalida', 'Acesso encerrado. Digite a senha de novo.', 401);
  if (new Date(session.expires_at).getTime() <= now.getTime()) throw new RuleError('sessao_expirada', 'Acesso expirou. Digite a senha de novo.', 401);
  if (!link || link.id !== session.link_id || link.password_version !== session.password_version) {
    throw new RuleError('sessao_invalida', 'Acesso encerrado. Digite a senha de novo.', 401);
  }
  linkUsable(link, now);
}

export function checkInstance(link: DispatchLink, instanceId: string) {
  if (!instanceId || !link.allowed_instance_ids.includes(instanceId)) {
    throw new RuleError('instancia_fora', 'Instância não permitida neste link.', 403);
  }
}

export function checkTemplateAllowed(link: DispatchLink, name: string, language: string) {
  if (link.template_mode === 'all_approved') return;
  const ok = (link.allowed_templates || []).some((t) => t.name === name && (!t.language || t.language === language));
  if (!ok) throw new RuleError('template_fora', 'Modelo não permitido neste link.', 403);
}

/** Só texto ou imagem no cabeçalho. Carrossel, vídeo, documento e localização ficam para depois. */
export function checkTemplateSupported(template: any) {
  if (!template || template.status !== 'APPROVED') throw new RuleError('template_fora', 'Modelo não aprovado ou não encontrado.', 403);
  const comps: any[] = template.components || [];
  if (comps.some((c) => String(c.type || '').toUpperCase() === 'CAROUSEL')) {
    throw new RuleError('carrossel_bloqueado', 'Modelo em carrossel ainda não pode ser usado pelo link.', 403);
  }
  const header = comps.find((c) => String(c.type || '').toUpperCase() === 'HEADER');
  const fmt = String(header?.format || 'TEXT').toUpperCase();
  if (!['TEXT', 'IMAGE'].includes(fmt)) throw new RuleError('midia_bloqueada', 'Só modelos com texto ou imagem são aceitos.', 403);
  return { headerFormat: header ? fmt : null };
}

export function checkHeaderMedia(headerFormat: string | null, url: string | null | undefined) {
  if (headerFormat !== 'IMAGE') return null;
  const u = String(url || '').trim();
  if (!/^https:\/\/[^\s]{4,2000}$/.test(u)) throw new RuleError('imagem_obrigatoria', 'Envie a imagem do cabeçalho.');
  return u;
}

export function templateVarKeys(template: any): string[] {
  const keys: string[] = [];
  for (const c of template.components || []) {
    const t = String(c.type || '').toUpperCase();
    if ((t === 'HEADER' || t === 'BODY') && c.text) {
      for (const m of String(c.text).matchAll(/\{\{(\d+)\}\}/g)) keys.push(`${t.toLowerCase()}_${m[1]}`);
    }
    if (t === 'BUTTONS') {
      (c.buttons || []).filter((b: any) => b.type === 'URL' && String(b.url || '').includes('{{'))
        .forEach((_: any, i: number) => keys.push(`button_url_${i}`));
    }
  }
  return [...new Set(keys)];
}

export type VarCfg = { mode: string; staticValue?: string };

/** Normaliza variáveis: só chaves do modelo, só modos permitidos, todas preenchidas. */
export function normalizeVariables(template: any, input: unknown): Record<string, VarCfg> {
  const raw = (input && typeof input === 'object') ? input as Record<string, any> : {};
  const keys = templateVarKeys(template);
  for (const k of Object.keys(raw)) if (!keys.includes(k)) throw new RuleError('variavel_invalida', `Campo ${k} não existe neste modelo.`);
  const out: Record<string, VarCfg> = {};
  for (const k of keys.sort()) {
    const v = raw[k] || {};
    const mode = String(v.mode || '__static__');
    if (!(ALLOWED_VAR_MODES as readonly string[]).includes(mode)) throw new RuleError('variavel_invalida', `Tipo de campo não permitido em ${k}.`);
    if (k.startsWith('button_url_') && mode !== '__static__') throw new RuleError('variavel_invalida', 'O final do link precisa ser texto fixo.');
    const staticValue = String(v.staticValue ?? '').trim();
    if (staticValue.length > 500) throw new RuleError('variavel_invalida', `Texto muito longo em ${k}.`);
    if (mode === '__static__' && !staticValue) throw new RuleError('variavel_vazia', `Preencha o campo ${k}.`);
    out[k] = mode === '__static__' ? { mode, staticValue } : { mode, staticValue: staticValue || 'Cliente' };
  }
  return out;
}

export function canonicalConfig(instanceId: string, name: string, language: string, vars: Record<string, VarCfg>, headerMediaUrl: string | null) {
  const sortedVars = Object.keys(vars).sort().map((k) => [k, vars[k].mode, vars[k].staticValue ?? '']);
  return JSON.stringify({ i: instanceId, t: name, l: language, v: sortedVars, h: headerMediaUrl || '' });
}

export async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function configHash(instanceId: string, name: string, language: string, vars: Record<string, VarCfg>, headerMediaUrl: string | null) {
  return sha256Hex(canonicalConfig(instanceId, name, language, vars, headerMediaUrl));
}

export function findAudience(link: DispatchLink, key: string): LinkAudience {
  const a = (link.allowed_audiences || []).find((x) => x.key === key);
  if (!a) throw new RuleError('publico_fora', 'Público não permitido neste link.', 403);
  return a;
}

export function checkCommType(link: DispatchLink, t: string) {
  if (!(COMM_TYPES as readonly string[]).includes(t)) throw new RuleError('tipo_obrigatorio', 'Escolha o tipo de comunicação.');
  if (link.allowed_comm_types && link.allowed_comm_types.length && !link.allowed_comm_types.includes(t)) {
    throw new RuleError('tipo_fora', 'Tipo de comunicação não permitido neste link.', 403);
  }
}

export function checkSchedule(link: DispatchLink, mode: string, scheduledAt: string | null | undefined, now = new Date()) {
  if (mode === 'now') {
    if (!link.allow_send_now) throw new RuleError('agora_proibido', 'Este link não permite enviar na hora.', 403);
    return null;
  }
  if (mode !== 'schedule') throw new RuleError('modo_invalido', 'Escolha enviar agora ou agendar.');
  if (!link.allow_schedule) throw new RuleError('agendar_proibido', 'Este link não permite agendar.', 403);
  const ts = new Date(String(scheduledAt || '')).getTime();
  if (!Number.isFinite(ts)) throw new RuleError('data_invalida', 'Data do agendamento inválida.');
  if (ts < now.getTime() + 5 * 60 * 1000) throw new RuleError('data_invalida', 'Agende para pelo menos 5 minutos à frente.');
  if (ts > now.getTime() + 30 * 24 * 60 * 60 * 1000) throw new RuleError('data_invalida', 'Agende para no máximo 30 dias à frente.');
  return new Date(ts).toISOString();
}

export function checkLimit(link: DispatchLink, count: number) {
  if (count <= 0) throw new RuleError('publico_vazio', 'Ninguém para receber (todos já receberam hoje ou estão bloqueados).');
  if (count > link.max_recipients) {
    throw new RuleError('acima_limite', `Este público tem ${count} pessoas e o limite do link é ${link.max_recipients}.`, 403);
  }
}

/** Teste válido: mesma sessão, mesma configuração, sucesso, menos de 2h, ainda não usado. */
export function findValidTest(tests: LinkTest[], sessionId: string, hash: string, now = new Date()) {
  const t = tests
    .filter((x) => x.session_id === sessionId && x.config_hash === hash && ['sent', 'simulated'].includes(x.status) && !x.used_at)
    .filter((x) => now.getTime() - new Date(x.created_at).getTime() <= TEST_TTL_MS)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (!t) throw new RuleError('teste_obrigatorio', 'Faça o teste no seu número com este modelo e estes textos antes de confirmar.', 403);
  return t;
}

export function checkTestRate(recentTestsLastHour: number) {
  if (recentTestsLastHour >= TESTS_PER_HOUR) throw new RuleError('limite_testes', 'Muitos testes nesta hora. Espere um pouco.', 429);
}

export function normalizeTestPhone(input: unknown) {
  let d = String(input || '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) d = '55' + d;
  if (!/^55\d{10,11}$/.test(d)) throw new RuleError('telefone_invalido', 'Número de teste inválido. Use DDD + número.');
  return d;
}

export function maskPhone(d: string) {
  return d.length > 6 ? `${d.slice(0, 4)}*****${d.slice(-2)}` : '***';
}

export function normalizeRecipientPhone(p: unknown) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.length < 8) return null;
  if (!d.startsWith('55') && (d.length === 10 || d.length === 11)) d = '55' + d;
  return d;
}

/** Monta os componentes do teste igual ao worker (nome = "Teste"). */
export function buildTestComponents(template: any, vars: Record<string, VarCfg>, headerMediaUrl: string | null) {
  const comps: any[] = template.components || [];
  const val = (k: string) => {
    const v = vars[k];
    if (!v) return '';
    if (v.mode === '__static__') return v.staticValue || 'Cliente';
    return v.mode === '__full_name__' ? 'Teste' : 'Teste';
  };
  const out: any[] = [];
  const header = comps.find((c) => String(c.type).toUpperCase() === 'HEADER');
  const keys = templateVarKeys(template);
  if (header && String(header.format || 'TEXT').toUpperCase() === 'IMAGE' && headerMediaUrl) {
    out.push({ type: 'header', parameters: [{ type: 'image', image: { link: headerMediaUrl } }] });
  } else {
    const hk = keys.filter((k) => k.startsWith('header_'));
    if (hk.length) out.push({ type: 'header', parameters: hk.map((k) => ({ type: 'text', text: val(k) })) });
  }
  const bk = keys.filter((k) => k.startsWith('body_'));
  if (bk.length) out.push({ type: 'body', parameters: bk.map((k) => ({ type: 'text', text: val(k) })) });
  keys.filter((k) => k.startsWith('button_url_')).forEach((k) => {
    const idx = k.replace('button_url_', '');
    if (vars[k]?.staticValue) out.push({ type: 'button', sub_type: 'url', index: idx, parameters: [{ type: 'text', text: vars[k].staticValue }] });
  });
  return out;
}

export function renderMessage(template: any, vars: Record<string, VarCfg>) {
  const parts: string[] = [];
  const fill = (prefix: string, text: string) => text.replace(/\{\{(\d+)\}\}/g, (_, n) => {
    const v = vars[`${prefix}_${n}`];
    if (!v) return `{{${n}}}`;
    if (v.mode === '__static__') return v.staticValue || '';
    return v.mode === '__full_name__' ? '{{nome_completo}}' : '{{primeiro_nome}}';
  });
  for (const c of template.components || []) {
    const t = String(c.type).toUpperCase();
    if (t === 'HEADER' && c.text) parts.push(`*${fill('header', c.text)}*`);
    if (t === 'BODY' && c.text) parts.push(fill('body', c.text));
    if (t === 'FOOTER' && c.text) parts.push(`_${c.text}_`);
  }
  return parts.join('\n\n');
}

// ---------- validação do preset (admin) ----------
const RAVENA_FILTER_KEYS = ['rfm_segments', 'states', 'cities', 'ddds', 'tags', 'min_orders', 'max_orders', 'min_ticket', 'max_ticket'];

export function validatePreset(input: any) {
  const name = String(input?.name || '').trim();
  if (name.length < 3 || name.length > 120) throw new RuleError('nome_invalido', 'Nome do link precisa ter de 3 a 120 letras.');
  const ids = Array.isArray(input?.allowed_instance_ids) ? [...new Set(input.allowed_instance_ids.map(String))] : [];
  if (!ids.length || ids.some((x) => !/^[0-9a-f-]{36}$/i.test(x as string))) throw new RuleError('instancias_invalidas', 'Escolha ao menos uma instância.');
  const template_mode = input?.template_mode === 'list' ? 'list' : 'all_approved';
  const allowed_templates = Array.isArray(input?.allowed_templates)
    ? input.allowed_templates.map((t: any) => ({ name: String(t?.name || '').trim(), ...(t?.language ? { language: String(t.language) } : {}) })).filter((t: any) => t.name)
    : [];
  if (template_mode === 'list' && !allowed_templates.length) throw new RuleError('templates_invalidos', 'Escolha ao menos um modelo.');
  const audIn = Array.isArray(input?.allowed_audiences) ? input.allowed_audiences : [];
  if (!audIn.length) throw new RuleError('publicos_invalidos', 'Escolha ao menos um público.');
  const seen = new Set<string>();
  const allowed_audiences: LinkAudience[] = audIn.map((a: any, i: number) => {
    const kind = a?.kind;
    if (kind !== 'ravena' && kind !== 'saved') throw new RuleError('publicos_invalidos', 'Tipo de público inválido.');
    const key = String(a?.key || `${kind}_${i + 1}`);
    if (seen.has(key)) throw new RuleError('publicos_invalidos', 'Públicos repetidos.');
    seen.add(key);
    const label = String(a?.label || (kind === 'ravena' ? 'Clientes Ravena' : 'Público salvo')).slice(0, 120);
    if (kind === 'saved') {
      if (!/^[0-9a-f-]{36}$/i.test(String(a?.publico_id || ''))) throw new RuleError('publicos_invalidos', 'Público salvo inválido.');
      return { key, kind, label, publico_id: String(a.publico_id) };
    }
    const f = a?.filters && typeof a.filters === 'object' ? a.filters : {};
    const filters: Record<string, unknown> = {};
    for (const k of Object.keys(f)) {
      if (!RAVENA_FILTER_KEYS.includes(k)) throw new RuleError('publicos_invalidos', `Filtro ${k} não suportado.`);
      filters[k] = Array.isArray(f[k]) ? f[k].map(String) : Number(f[k]);
    }
    return { key, kind, label, filters };
  });
  const comm = input?.allowed_comm_types == null ? null : (Array.isArray(input.allowed_comm_types) ? input.allowed_comm_types.map(String) : []);
  if (comm && comm.some((c: string) => !(COMM_TYPES as readonly string[]).includes(c))) throw new RuleError('tipos_invalidos', 'Tipo de comunicação inválido.');
  const allow_send_now = input?.allow_send_now !== false;
  const allow_schedule = input?.allow_schedule === true;
  if (!allow_send_now && !allow_schedule) throw new RuleError('modo_invalido', 'Permita enviar agora ou agendar.');
  const max_recipients = Math.floor(Number(input?.max_recipients));
  if (!(max_recipients > 0 && max_recipients <= 50000)) throw new RuleError('limite_invalido', 'Limite precisa ser entre 1 e 50.000.');
  let expires_at: string | null = null;
  if (input?.expires_at) {
    const ts = new Date(String(input.expires_at)).getTime();
    if (!Number.isFinite(ts)) throw new RuleError('validade_invalida', 'Validade inválida.');
    expires_at = new Date(ts).toISOString();
  }
  return {
    name, description: input?.description ? String(input.description).slice(0, 500) : null,
    allowed_instance_ids: ids as string[], template_mode, allowed_templates, allowed_audiences,
    allowed_comm_types: comm && comm.length ? comm : null, allow_send_now, allow_schedule, max_recipients, expires_at,
    simulate_only: input?.simulate_only === true,
  };
}

export function validatePassword(p: unknown) {
  const s = String(p || '');
  if (s.length < 8 || s.length > 128) throw new RuleError('senha_invalida', 'A senha precisa ter de 8 a 128 caracteres.');
  return s;
}
