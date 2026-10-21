import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { z } from 'npm:zod@3';
import { freightAuth } from '../_shared/freight-auth.ts';
import { loadCorreiosSettings, quoteCorreios, DEFAULT_SENDER, DEFAULT_SERVICES, type CorreiosSettings } from '../_shared/correios.ts';
const field = z.string().max(255);
const configSchema = z.object({ usuario: field.optional(), codigo_acesso: z.string().max(4096).optional(), cartao_postagem: z.string().regex(/^\d*$/).max(30).optional(), contrato: field.nullable().optional(), ambiente: z.enum(['producao', 'homologacao']).optional(), enabled: z.boolean().optional(), remetente: z.object({ nome: field, cnpj: z.string().regex(/^\d{14}$/), telefone: z.string().regex(/^\d{10,13}$/), email: z.union([z.literal(''), z.string().email().max(255)]), cep: z.string().regex(/^\d{8}$/), logradouro: field, numero: field, complemento: field, bairro: field, cidade: field, uf: z.string().regex(/^[A-Z]{2}$/) }).optional(), servicos: z.array(z.object({ codigo: z.enum(['03220','03298']), nome: field, ativo: z.boolean() })).length(2).refine((s) => new Set(s.map((v) => v.codigo)).size === 2, 'Serviços duplicados').optional() }).strict();
function safeConfig(s: CorreiosSettings) {
  return { usuario: s.usuario, codigo_acesso: { configured: !!s.codigo_acesso, last4: s.codigo_acesso.slice(-4) }, cartao_postagem: s.cartao_postagem, contrato: s.contrato, ambiente: s.ambiente, enabled: s.enabled, remetente: s.remetente, servicos: s.servicos, updated_at: s.updated_at };
}
Deno.serve(async (req) => {
  const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { db, userId } = await freightAuth(req, true);
    const parsed = z.object({ action: z.enum(['get_config','set_config','test_connection']), config: configSchema.optional() }).strict().safeParse(await req.json().catch(() => null));
    if (!parsed.success) return reply({ error: 'Dados inválidos', details: parsed.error.flatten().fieldErrors }, 400);
    const s = await loadCorreiosSettings(db);
    if (parsed.data.action === 'get_config') return reply({ config: safeConfig(s) });
    if (parsed.data.action === 'set_config') {
      if (!parsed.data.config) return reply({ error: 'Informe a configuração' }, 400);
      const patch = { ...parsed.data.config };
      if (!patch.codigo_acesso?.trim()) delete patch.codigo_acesso;
      else patch.codigo_acesso = patch.codigo_acesso.trim();
      if (patch.usuario != null) patch.usuario = patch.usuario.trim();
      if (patch.servicos) patch.servicos = patch.servicos.map((svc) => ({ ...svc, nome: DEFAULT_SERVICES.find((d) => d.codigo === svc.codigo)?.nome || svc.nome }));
      const invalidate = (['usuario','codigo_acesso','cartao_postagem','ambiente'] as const).some((k) => patch[k] !== undefined && patch[k] !== s[k]);
      const next = { ...s, ...patch };
      if (next.enabled && (!next.usuario || !next.codigo_acesso || !next.cartao_postagem)) return reply({ error: 'Preencha usuário, código de acesso à API e cartão antes de ativar' }, 400);
      if (invalidate) { next.token = null; next.token_meta = null; next.token_expira_em = null; }
      const changed = JSON.stringify(safeConfig(next)) !== JSON.stringify(safeConfig(s)) || next.codigo_acesso !== s.codigo_acesso;
      if (changed || !s.updated_at) {
        const { error } = await db.from('correios_settings').upsert({ ...next, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: 'id' });
        if (error) throw new Error('Não foi possível salvar a configuração');
      }
      return reply({ config: safeConfig(await loadCorreiosSettings(db)) });
    }
    // Persist defaults first only if the admin has supplied credentials previously.
    if (!s.updated_at) return reply({ error: 'Salve as credenciais antes de testar a conexão' }, 400);
    const result = await quoteCorreios(db, s, { peso_g: 500, c: 30, l: 20, a: 12, itens: 1, origem: 'padrao' }, '01310100', true, true);
    return reply({ ...result.meta, expiraEm: result.expiraEm, options: result.options, error: result.error });
  } catch (e) {
    const err = e as Error & { status?: number };
    return reply({ error: err.message || 'Não foi possível conectar aos Correios' }, err.status || 400);
  }
});