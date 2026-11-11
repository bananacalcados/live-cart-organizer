import { describe,it,expect } from 'vitest';
import { centralDecision,tokenAllowed,overlappingItem,productChoiceRule,NO_CHOICE_REASON } from '../../supabase/functions/_shared/central-rules';
const now=Date.parse('2026-11-09T12:00:00Z');
describe('central rules',()=>{
 it.each(['troca','devolucao'] as const)('%s aceita exatamente 7 dias desde entrega confirmada',()=>{expect(centralDecision({deliveredAt:'2026-11-02T12:00:00Z',source:'carrier',unused:true,itemEligible:true},now).status).toBe('aprovado');});
 it('um segundo fora do prazo escala, nunca nega',()=>{expect(centralDecision({deliveredAt:'2026-11-02T11:59:59Z',source:'carrier',unused:true,itemEligible:true},now).status).toBe('escalado');});
 it.each([null,'customer_informed','manual'])('origem %s não aprova',source=>{expect(centralDecision({deliveredAt:'2026-11-08T12:00:00Z',source,unused:true,itemEligible:true},now).status).toBe('escalado');});
 it('condição incerta escala',()=>{expect(centralDecision({deliveredAt:'2026-11-08T12:00:00Z',source:'carrier',unused:false,itemEligible:true},now).status).toBe('escalado');});
 it('token troca não abre devolução',()=>{expect(tokenAllowed({request_type:'troca',expires_at:'2026-11-10T12:00:00Z'},'devolucao',now)).toBe(false);});
 it('token devolução não abre troca',()=>{expect(tokenAllowed({request_type:'devolucao',expires_at:'2026-11-10T12:00:00Z'},'troca',now)).toBe(false);});
 it('vencido/revogado não abre',()=>{expect(tokenAllowed({request_type:'troca',expires_at:'2026-11-08T12:00:00Z'},'troca',now)).toBe(false);expect(tokenAllowed({request_type:'troca',expires_at:'2026-11-10T12:00:00Z',revoked_at:'2026-11-08T12:00:00Z'},'troca',now)).toBe(false);});
 it('mesmo item impede duplicidade',()=>{expect(overlappingItem([{sku:'A123'}],{sku:'A123'})).toBe(true);expect(overlappingItem([{item_id:'a'}],{item_id:'a'})).toBe(true);expect(overlappingItem([{barcode:'123'}],{barcode:'123'})).toBe(true);expect(overlappingItem([{sku:'A123'}],{sku:'B123'})).toBe(false);});
});
describe('interruptor exigir escolha do produto',()=>{
 it('ligado mantém o produto escolhido e reserva',()=>{const r=productChoiceRule({type:'troca',required:true,replacementId:'p1'});expect(r.replacementId).toBe('p1');expect(r.reserve).toBe(1);expect(r.forceEscalate).toBeNull();});
 it('desligado não reserva e escala com o motivo combinado',()=>{const r=productChoiceRule({type:'troca',required:false,replacementId:null,desired:'nº 37 preto'});expect(r.reserve).toBe(0);expect(r.forceEscalate).toBe('Cliente não escolheu o produto: escolha e separe o produto');expect(r.desired).toBe('nº 37 preto');});
 it('desligado ignora produto enviado por navegador adulterado',()=>{const r=productChoiceRule({type:'troca',required:false,replacementId:'p1'});expect(r.replacementId).toBeNull();expect(r.reserve).toBe(0);expect(r.forceEscalate).toBe(NO_CHOICE_REASON);});
 it('pedido de tamanho limitado a 200 caracteres',()=>{expect(productChoiceRule({type:'troca',required:false,replacementId:null,desired:'x'.repeat(300)}).desired?.length).toBe(200);});
 it('devolução não muda',()=>{const r=productChoiceRule({type:'devolucao',required:false,replacementId:null,desired:'37'});expect(r.forceEscalate).toBeNull();expect(r.desired).toBeNull();});
});
