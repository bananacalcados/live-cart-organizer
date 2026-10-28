import {describe,it,expect} from 'vitest';
import {validateManualRefund} from '../../supabase/functions/_shared/refund-manual';
const now=new Date('2026-10-28T16:15:00Z');
const body={source:'pos_sale',source_id:'a55f824e-28c8-47b3-9afb-9fa723a320a5',amount:359.99,reason:'cancelamento_antes_envio',manual_reference:'REF-1234',manual_done_at:'2026-10-28T15:00:00Z',password:'test-only'};
describe('registro manual sem devolução',()=>{
 it('aceita integral 359,99 com protocolo e data passada',()=>expect(validateManualRefund(body,now)).toBeNull());
 it.each(['','123','x'.repeat(81)])('protocolo fora de 4–80 rejeitado',manual_reference=>expect(validateManualRefund({...body,manual_reference},now)).toContain('Protocolo'));
 it('data futura não permitida',()=>expect(validateManualRefund({...body,manual_done_at:'2026-10-29T15:00:00Z'},now)).toContain('futuro'));
 it('data obrigatória',()=>expect(validateManualRefund({...body,manual_done_at:null},now)).toContain('data'));
 it('senha obrigatória',()=>expect(validateManualRefund({...body,password:''},now)).toContain('senha'));
 it.each([0,-1,359.999,NaN])('valor inválido %s',amount=>expect(validateManualRefund({...body,amount},now)).toContain('Valor'));
});