import { assertEquals, assertRejects, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import * as R from './dispatch-link-rules.ts';

const now = new Date('2026-11-24T15:00:00Z');
const link = (o: Partial<R.DispatchLink> = {}): R.DispatchLink => ({
  id: 'L1', is_active: true, revoked_at: null, expires_at: null, password_version: 1,
  allowed_instance_ids: ['ravena'], template_mode: 'list', allowed_templates: [{ name: 'promo', language: 'pt_BR' }],
  allowed_audiences: [{ key: 'ravena', kind: 'ravena', label: 'Clientes Ravena' }], allowed_comm_types: null,
  allow_send_now: true, allow_schedule: false, max_recipients: 100, simulate_only: true, ...o,
});
const tpl = (o: any = {}) => ({ name: 'promo', language: 'pt_BR', status: 'APPROVED', components: [
  { type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'Oi {{1}}, {{2}}' }], ...o });
const code = (fn: () => unknown) => { try { fn(); return 'ok'; } catch (e) { return (e as R.RuleError).code; } };
const sess = (o: Partial<R.LinkSession> = {}): R.LinkSession => ({ id: 'S1', link_id: 'L1', password_version: 1, expires_at: '2026-11-24T16:00:00Z', revoked_at: null, ...o });

Deno.test('sessão revogada, expirada, senha trocada e link desativado/vencido são recusados', () => {
  assertEquals(code(() => R.sessionUsable(sess(), link(), now)), 'ok');
  assertEquals(code(() => R.sessionUsable(sess({ revoked_at: 'x' }), link(), now)), 'sessao_invalida');
  assertEquals(code(() => R.sessionUsable(sess({ expires_at: '2026-11-24T14:59:00Z' }), link(), now)), 'sessao_expirada');
  assertEquals(code(() => R.sessionUsable(sess(), link({ password_version: 2 }), now)), 'sessao_invalida');
  assertEquals(code(() => R.sessionUsable(sess(), link({ is_active: false }), now)), 'link_inativo');
  assertEquals(code(() => R.sessionUsable(sess(), link({ revoked_at: 'x' }), now)), 'link_inativo');
  assertEquals(code(() => R.sessionUsable(sess(), link({ expires_at: '2026-11-24T14:00:00Z' }), now)), 'link_vencido');
});

Deno.test('instância, modelo e público fora do preset são recusados', () => {
  assertEquals(code(() => R.checkInstance(link(), 'outra')), 'instancia_fora');
  assertEquals(code(() => R.checkTemplateAllowed(link(), 'outro', 'pt_BR')), 'template_fora');
  assertEquals(code(() => R.checkTemplateAllowed(link(), 'promo', 'pt_BR')), 'ok');
  assertEquals(code(() => R.findAudience(link(), 'crm')), 'publico_fora');
});

Deno.test('carrossel, vídeo e não aprovado recusados; imagem aceita com URL https', () => {
  assertEquals(code(() => R.checkTemplateSupported(tpl({ components: [{ type: 'CAROUSEL', cards: [] }] }))), 'carrossel_bloqueado');
  assertEquals(code(() => R.checkTemplateSupported(tpl({ components: [{ type: 'HEADER', format: 'VIDEO' }] }))), 'midia_bloqueada');
  assertEquals(code(() => R.checkTemplateSupported(tpl({ status: 'PENDING' }))), 'template_fora');
  assertEquals(code(() => R.checkTemplateSupported(tpl())), 'ok');
  assertEquals(code(() => R.checkHeaderMedia('IMAGE', 'http://x.com/a.jpg')), 'imagem_obrigatoria');
  assertEquals(code(() => R.checkHeaderMedia('IMAGE', 'https://x.com/a.jpg')), 'ok');
});

Deno.test('acima do limite e público vazio recusados', () => {
  assertEquals(code(() => R.checkLimit(link({ max_recipients: 100 }), 101)), 'acima_limite');
  assertEquals(code(() => R.checkLimit(link({ max_recipients: 100 }), 100)), 'ok');
  assertEquals(code(() => R.checkLimit(link(), 0)), 'publico_vazio');
});

Deno.test('agendar proibido, enviar agora proibido e datas fora da janela', () => {
  assertEquals(code(() => R.checkSchedule(link({ allow_schedule: false }), 'schedule', '2026-11-25T15:00:00Z', now)), 'agendar_proibido');
  assertEquals(code(() => R.checkSchedule(link({ allow_send_now: false, allow_schedule: true }), 'now', null, now)), 'agora_proibido');
  assertEquals(code(() => R.checkSchedule(link({ allow_schedule: true }), 'schedule', '2026-11-24T15:01:00Z', now)), 'data_invalida');
  assertEquals(code(() => R.checkSchedule(link({ allow_schedule: true }), 'schedule', '2026-11-25T15:00:00Z', now)), 'ok');
});

Deno.test('disparo sem teste e teste com outra configuração são recusados', async () => {
  const vars = R.normalizeVariables(tpl(), { body_1: { mode: '__first_name__' }, body_2: { mode: '__static__', staticValue: 'promo' } });
  const h = await R.configHash('ravena', 'promo', 'pt_BR', vars, 'https://x.com/a.jpg');
  assertEquals(code(() => R.findValidTest([], 'S1', h, now)), 'teste_obrigatorio');
  const test = { id: 'T', session_id: 'S1', config_hash: h, status: 'sent', created_at: '2026-11-24T14:30:00Z', used_at: null };
  assertEquals(code(() => R.findValidTest([test], 'S1', h, now)), 'ok');
  const vars2 = R.normalizeVariables(tpl(), { body_1: { mode: '__first_name__' }, body_2: { mode: '__static__', staticValue: 'outra' } });
  const h2 = await R.configHash('ravena', 'promo', 'pt_BR', vars2, 'https://x.com/a.jpg');
  const h3 = await R.configHash('outra', 'promo', 'pt_BR', vars, 'https://x.com/a.jpg');
  const h4 = await R.configHash('ravena', 'promo', 'pt_BR', vars, 'https://x.com/b.jpg');
  for (const other of [h2, h3, h4]) assertEquals(code(() => R.findValidTest([test], 'S1', other, now)), 'teste_obrigatorio');
  assertEquals(code(() => R.findValidTest([test], 'S2', h, now)), 'teste_obrigatorio');
  assertEquals(code(() => R.findValidTest([{ ...test, status: 'failed' }], 'S1', h, now)), 'teste_obrigatorio');
  assertEquals(code(() => R.findValidTest([{ ...test, used_at: 'x' }], 'S1', h, now)), 'teste_obrigatorio');
  assertEquals(code(() => R.findValidTest([{ ...test, created_at: '2026-11-24T12:00:00Z' }], 'S1', h, now)), 'teste_obrigatorio');
});

Deno.test('variáveis: modo proibido, campo inexistente e vazio recusados', () => {
  assertEquals(code(() => R.normalizeVariables(tpl(), { body_1: { mode: '__cashback_value__' }, body_2: { staticValue: 'a' } })), 'variavel_invalida');
  assertEquals(code(() => R.normalizeVariables(tpl(), { body_9: { staticValue: 'a' } })), 'variavel_invalida');
  assertEquals(code(() => R.normalizeVariables(tpl(), { body_1: { staticValue: '' }, body_2: { staticValue: 'a' } })), 'variavel_vazia');
});

Deno.test('limite de testes por hora e telefone de teste', () => {
  assertEquals(code(() => R.checkTestRate(4)), 'ok');
  assertEquals(code(() => R.checkTestRate(5)), 'limite_testes');
  assertEquals(R.normalizeTestPhone('(33) 99999-1234'), '5533999991234');
  assertEquals(code(() => R.normalizeTestPhone('123')), 'telefone_invalido');
});

Deno.test('tipo de comunicação: obrigatório e respeita lista do link', () => {
  assertEquals(code(() => R.checkCommType(link(), '')), 'tipo_obrigatorio');
  assertEquals(code(() => R.checkCommType(link(), 'oferta')), 'ok');
  assertEquals(code(() => R.checkCommType(link({ allowed_comm_types: ['pesquisa'] }), 'oferta')), 'tipo_fora');
});

Deno.test('preset do admin: exige público, modo e limite válidos', () => {
  const base = { name: 'Ravena', allowed_instance_ids: ['0ba63cd9-2c14-41e3-91ef-6291c5396014'], allowed_audiences: [{ kind: 'ravena' }], max_recipients: 500 };
  assertEquals(code(() => R.validatePreset(base)), 'ok');
  assertEquals(code(() => R.validatePreset({ ...base, allowed_audiences: [] })), 'publicos_invalidos');
  assertEquals(code(() => R.validatePreset({ ...base, allow_send_now: false, allow_schedule: false })), 'modo_invalido');
  assertEquals(code(() => R.validatePreset({ ...base, max_recipients: 0 })), 'limite_invalido');
  assertEquals(code(() => R.validatePassword('curta')), 'senha_invalida');
});
