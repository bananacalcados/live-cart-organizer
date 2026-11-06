import { describe, it, expect } from 'vitest';
import { REVERSE_VALID_DAYS, reverseValidity, buildReversePayload, reverseMessage } from '../../supabase/functions/_shared/correios-reverse-domain';

const customer = { nome: 'Maria Souza', cpf: '12345678909', telefone: '+55 (11) 98765-4321', email: '', cep: '01310-100', logradouro: 'Rua A', numero: '10', complemento: '', bairro: 'Centro', cidade: 'São Paulo', uf: 'SP' };
const store = { nome: 'Banana Calçados Pérola', cnpj: '26.586.173/0001-27', telefone: '33991230581', email: '', cep: '35051-520', logradouro: 'Rua Vale Formoso', numero: '362', bairro: 'Kennedy', cidade: 'Governador Valadares', uf: 'MG' };

describe('Prazo de postagem da reversa', () => {
  it('dá 7 dias corridos para a cliente postar', () => {
    const now = new Date('2026-11-04T18:00:00-03:00');
    expect(REVERSE_VALID_DAYS).toBe(7);
    const v = reverseValidity(now);
    expect(v.br).toBe('11/11/2026');
    expect(v.iso).toBe('2026-11-11');
  });
  it('grava no payload a data de validade calculada com 7 dias', () => {
    const v = reverseValidity(new Date('2026-11-04T18:00:00-03:00'));
    const { payload, problems } = buildReversePayload({ customer, store, serviceCode: '03301', pkg: { peso_g: 1000, c: 33, l: 22, a: 13 }, items: [], validUntilBr: v.br, reference: 'abcd1234' });
    expect(problems).toEqual([]);
    expect(payload.logisticaReversa).toBe('S');
    expect(payload.dataValidadeLogReversa).toBe('11/11/2026');
  });
  it('avisa a cliente que o código só vale até a data', () => {
    const msg = reverseMessage({ firstName: 'Maria', code: 'NL123456789BR', service: 'PAC Reverso', validUntilBr: '11/11/2026' });
    expect(msg).toContain('Válido até: 11/11/2026');
    expect(msg).toContain('só vale até essa data');
  });
});

import { reverseReturnItems } from '../../supabase/functions/_shared/correios-reverse-domain';
describe('reverseReturnItems', () => {
  const items = [{ id: 'a', product_name: 'Tenis', quantity: 2, unit_price: 100 }, { id: 'b', product_name: 'Bolsa', quantity: 1, unit_price: 100 }];
  it('usa o valor pago com desconto rateado', () => {
    const r = reverseReturnItems(items, [{ sale_item_id: 'a', quantidade: 1 }], 30);
    expect(r.problems).toEqual([]);
    expect(r.items[0]).toMatchObject({ quantidade: 1, valor_unitario: 100, valor_pago: 90 });
  });
  it('recusa item de outra venda ou quantidade maior que a comprada', () => {
    expect(reverseReturnItems(items, [{ sale_item_id: 'x', quantidade: 1 }], 0).problems.length).toBe(1);
    expect(reverseReturnItems(items, [{ sale_item_id: 'b', quantidade: 2 }], 0).problems.length).toBe(1);
  });
});
it('inclui a nota de devolução na pré-postagem', async () => {
  const { buildReversePayload } = await import('../../supabase/functions/_shared/correios-reverse-domain');
  const { payload } = buildReversePayload({ customer: { nome: 'Ana Souza', telefone: '31991177671', cep: '35010000', logradouro: 'Rua A', numero: '1', bairro: 'Centro', cidade: 'GV', uf: 'MG' }, store: { nome: 'Banana', cnpj: '12345678000199', telefone: '3332710000', cep: '35010000', logradouro: 'Rua B', numero: '2', bairro: 'Centro', cidade: 'GV', uf: 'MG' } as any, serviceCode: '03301', pkg: { peso_g: 1000, c: 33, l: 22, a: 13 }, items: [], validUntilBr: '01/01/2027', reference: 'abcd1234', invoice: { numero: 123, chave: '3'.repeat(44) } });
  expect(payload).toMatchObject({ numeroNotaFiscal: '123', chaveNFe: '3'.repeat(44) });
});
