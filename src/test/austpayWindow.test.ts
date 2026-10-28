import {describe,it,expect} from 'vitest';
import {austpayRefundWindow} from '../../supabase/functions/_shared/refund-gateways/austpay-window';
const anticipated=(approved_at:string)=>({payment_method:'CREDIT_CARD',automatic_anticipation:true,approved_at,ledger_entries:[]});
describe('janela AustPay em Brasília',()=>{
 it('sexta 17:04 fecha sexta 23:59:59',()=>{expect(austpayRefundWindow(anticipated('2026-10-23T20:04:00Z'),new Date('2026-10-23T21:00:00Z'))).toMatchObject({gateway_window_closes_at:'2026-10-24T02:59:59.000Z',gateway_window_open:true,window_source:'estimado'});});
 it('sábado liquida segunda e fecha domingo',()=>{expect(austpayRefundWindow(anticipated('2026-10-24T20:00:00Z')).gateway_window_closes_at).toBe('2026-10-26T02:59:59.000Z');});
 it('feriado nacional adia D+1',()=>{expect(austpayRefundWindow(anticipated('2026-11-19T20:00:00Z')).gateway_window_closes_at).toBe('2026-11-23T02:59:59.000Z');});
 it('sexta santa nacional é respeitada',()=>{expect(austpayRefundWindow(anticipated('2026-04-02T20:00:00Z')).gateway_window_closes_at).toBe('2026-04-06T02:59:59.000Z');});
 it('menor payment_date TRANSACTION ganha, ignora taxa',()=>{const w=austpayRefundWindow({ledger_entries:[{type:'FEE',payment_date:'2026-01-01'},{type:'TRANSACTION',payment_date:'2026-12-20'},{type:'TRANSACTION',payment_date:'2026-11-10'}]});expect(w.gateway_window_closes_at).toBe('2026-11-10T02:59:59.000Z');expect(w.window_source).toBe('ledger');});
 it.each([{settled:true},{settlement_items:[{status:'PAID'}]},{fully_settled_at:'2026-10-28T00:00:00Z'}])('liquidação encerra independente da data %j',fields=>{expect(austpayRefundWindow({ledger_entries:[{type:'TRANSACTION',payment_date:'2099-01-01',...fields}]}).gateway_window_open).toBe(false);});
 it('sem prova nem antecipação não inventa janela',()=>{expect(austpayRefundWindow({approved_at:'2026-10-27T20:00:00Z',payment_method:'CREDIT_CARD'})).toMatchObject({gateway_window_open:false,gateway_window_closes_at:null,window_source:'indisponivel'});});
 it('Adriana fecha 27/10 e não pode tentar 28/10',()=>{expect(austpayRefundWindow(anticipated('2026-10-27T20:04:46.133Z'),new Date('2026-10-28T16:15:00Z'))).toMatchObject({gateway_window_closes_at:'2026-10-28T02:59:59.000Z',gateway_window_open:false});});
});