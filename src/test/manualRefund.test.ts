import {describe,it,expect,vi} from 'vitest';
import {validateManualRefund,persistManualRefund} from '../../supabase/functions/_shared/refund-manual';
const now=new Date('2026-10-28T16:15:00Z');
const body={source:'pos_sale',source_id:'a55f824e-28c8-47b3-9afb-9fa723a320a5',amount:359.99,reason:'cancelamento_antes_envio',manual_reference:'REF-1234',manual_done_at:'2026-10-28T15:00:00Z',password:'test-only'};
describe('registro manual sem devolução',()=>{
 it('aceita integral 359,99 com protocolo e data passada',()=>expect(validateManualRefund(body,now)).toBeNull());
 it.each(['','123','x'.repeat(81)])('protocolo fora de 4–80 rejeitado',manual_reference=>expect(validateManualRefund({...body,manual_reference},now)).toContain('Protocolo'));
 it('data futura não permitida',()=>expect(validateManualRefund({...body,manual_done_at:'2026-10-29T15:00:00Z'},now)).toContain('futuro'));
 it('data obrigatória',()=>expect(validateManualRefund({...body,manual_done_at:null},now)).toContain('data'));
 it('senha obrigatória',()=>expect(validateManualRefund({...body,password:''},now)).toContain('senha'));
 it.each([0,-1,359.999,NaN])('valor inválido %s',amount=>expect(validateManualRefund({...body,amount},now)).toContain('Valor'));
 it('não-admin não alcança escrita',async()=>{const rpc=vi.fn();expect((await persistManualRefund({rpc},body,false)).error).toContain('administradores');expect(rpc).not.toHaveBeenCalled();});
 it('solicitação pendente usa ID devolvido pela transação, sem insert separado',async()=>{const rpc=vi.fn().mockResolvedValue({data:'solicitacao-vitoria',error:null});const result=await persistManualRefund({rpc},body,true);expect(result.id).toBe('solicitacao-vitoria');expect(rpc).toHaveBeenCalledExactlyOnceWith('register_manual_refund',{p_row:body});});
 it('conflito de pagamento não vira concluído',async()=>{const rpc=vi.fn().mockResolvedValue({data:null,error:{message:'Existe estorno em andamento ou concluído'}});const r=await persistManualRefund({rpc},body,true);expect(r.id).toBeNull();expect(r.error).toContain('em andamento');});
});