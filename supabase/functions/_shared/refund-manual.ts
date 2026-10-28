export function validateManualRefund(body: any, now=new Date()) {
  if (!['order','pos_sale'].includes(body.source) || !/^[0-9a-f-]{36}$/i.test(String(body.source_id))) return 'Compra inválida.';
  if (!Number.isFinite(body.amount) || body.amount<=0 || Math.abs(body.amount*100-Math.round(body.amount*100))>0.001) return 'Valor inválido.';
  if (!['cancelamento_antes_envio','devolucao','troca_com_diferenca','outro'].includes(body.reason)) return 'Motivo inválido.';
  if (typeof body.manual_reference!=='string' || body.manual_reference.trim().length<4 || body.manual_reference.trim().length>80) return 'Protocolo obrigatório, de 4 a 80 caracteres.';
  if (typeof body.manual_done_at!=='string' || !Number.isFinite(Date.parse(body.manual_done_at)) || Date.parse(body.manual_done_at)>now.getTime()) return 'Informe a data da devolução; ela não pode estar no futuro.';
  if (typeof body.password!=='string' || !body.password || body.password.length>1024) return 'Confirme sua senha do sistema.';
  if (body.note!=null && (typeof body.note!=='string' || body.note.length>500)) return 'Observação inválida.';
  return null;
}

/** Sole persistence boundary: database RPC locks payment and reuses its pending row. */
export async function persistManualRefund(sb:any,payload:any,isAdmin:boolean) {
  if(!isAdmin) return {error:'Só administradores podem registrar estornos manuais.',id:null};
  const {data:id,error}=await sb.rpc('register_manual_refund',{p_row:payload});
  return {id:id||null,error:error?.message||(!id?'Não foi possível registrar o estorno.':null)};
}