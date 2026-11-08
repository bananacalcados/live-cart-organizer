import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { z } from 'npm:zod@3';
import { withAccessLog } from '../_shared/withAccessLog.ts';
import { requireAuth } from '../_shared/requireAuth.ts';
import { DEFAULT_FOLLOWUP_CONFIG } from '../_shared/live-followup-rules.ts';
import { followupConfig } from '../_shared/live-followup.ts';
const step=z.object({minutes:z.number().int().min(1).max(4320),variants:z.array(z.string().trim().min(1).max(3500)).length(3)});
const kind=(count:number)=>z.object({enabled:z.boolean(),steps:z.array(step).length(count)});
const config=z.object({enabled:z.boolean(),types:z.object({A:kind(1),B:kind(1),C:kind(1),D:kind(3),E:kind(3),F:kind(4)}),limits:z.object({interval_min:z.number().int().min(20).max(3600),interval_max:z.number().int().min(20).max(3600),hourly:z.number().int().min(1).max(100),daily_customer:z.number().int().min(1).max(20),typing_min:z.number().int().min(2).max(10),typing_max:z.number().int().min(2).max(10)})}).superRefine((v,c)=>{
  if(v.limits.interval_max<v.limits.interval_min || v.limits.typing_max<v.limits.typing_min)c.addIssue({code:'custom',message:'Intervalo máximo menor que o mínimo'});
  for(const t of Object.values(v.types))if(t.steps.some((s,i)=>i>0 && s.minutes<=t.steps[i-1].minutes))c.addIssue({code:'custom',message:'Os prazos precisam aumentar a cada passo'});
});
const input=z.discriminatedUnion('action',[
  z.object({action:z.literal('get')}),z.object({action:z.literal('save'),config}),
  z.object({action:z.literal('resume'),instance_id:z.string().uuid()}),
]);
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...corsHeaders,'Content-Type':'application/json'}});
Deno.serve(withAccessLog('live-followup-admin',async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  const denied=await requireAuth(req,['events']);if(denied)return denied;
  try{
    const parsed=input.safeParse(await req.json());if(!parsed.success)return json({error:parsed.error.flatten()},400);
    const url=Deno.env.get('SUPABASE_URL');const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if(!url||!key)return json({error:'Configuração indisponível'},500);
    const sb=createClient(url,key);const body=parsed.data;
    if(body.action==='get')return json({config:await followupConfig(sb)});
    const adminDenied=await requireAuth(req,[],true);if(adminDenied)return adminDenied;
    if(body.action==='resume'){
      const {data:uncertain,error}=await sb.from('live_followup_jobs').select('id').eq('whatsapp_number_id',body.instance_id).in('status',['uncertain','processing']).limit(1);
      if(error)throw error;if(uncertain?.length)return json({error:'Há um envio sem confirmação; confira a conversa antes de liberar a instância.'},409);
      const r=await sb.from('live_followup_instances').update({paused:false,reason:null,consecutive_errors:0}).eq('whatsapp_number_id',body.instance_id);if(r.error)throw r.error;
      return json({ok:true});
    }
    const previous=await followupConfig(sb);
    if(body.config.enabled && !previous.enabled){
      const {data:active,error}=await sb.from('event_followup_dispatches').select('id').in('status',['processing','locked']).limit(1);
      if(error)throw error;if(active?.length)return json({error:'Há um lembrete antigo em envio; aguarde antes de ligar.'},409);
    }
    const value={...body.config,enabled_since:body.config.enabled ? (previous.enabled ? previous.enabled_since : new Date().toISOString()) : previous.enabled_since};
    const r=await sb.from('live_followup_settings').upsert({id:true,value,updated_at:new Date().toISOString()});if(r.error)throw r.error;
    return json({ok:true,config:value});
  }catch(e){console.error('[live-followup-admin]',e instanceof Error ? e.message:'internal');return json({error:'Não foi possível salvar o follow-up'},500);}
}));