import { supabase } from '@/integrations/supabase/client';
export async function rhRpc(name:string,args:Record<string,unknown>={}) {
 const {data,error}=await (supabase.rpc as any)(name,args);if(error)throw new Error(error.message);return data;
}
export async function rhNotice(action:'notify'|'test',candidatoId?:string){
 const {data,error}=await supabase.functions.invoke('rh-score',{body:{action,candidato_id:candidatoId}});
 if(error){let message='Não foi possível enviar o aviso.';try{message=(await error.context.json()).message||message;}catch{}throw new Error(message);}
 if(data?.ok===false)throw new Error(data.message||'Não foi possível enviar o aviso.');return data;
}
export const RH_STATUS=[['novo','Novo'],['em_analise','Em análise'],['chamado','Chamado'],['aprovado','Aprovado'],['reprovado','Reprovado']] as const;
export const statusLabel=(s:string)=>RH_STATUS.find(([k])=>k===s)?.[1]||'Incompleto';
export const transportLabel=(s:string)=>({a_pe:'A pé',onibus:'Ônibus',moto:'Moto',bicicleta:'Bicicleta',carro:'Carro'}[s]||'—');
