import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { z } from 'npm:zod@3';
import { withAccessLog } from '../_shared/withAccessLog.ts';
import { requireAuth } from '../_shared/requireAuth.ts';
import { DEFAULT_FOLLOWUP_CONFIG } from '../_shared/live-followup-rules.ts';
import { followupConfig, scheduleGlobalFollowups } from '../_shared/live-followup.ts';
import {resolveIgAccountByNumberId} from '../_shared/instagram-account.ts';
const step=z.object({minutes:z.number().int().min(1).max(4320),variants:z.array(z.string().trim().min(1).max(3500)).length(3)});
const kind=(count:number)=>z.object({enabled:z.boolean(),steps:z.array(step).length(count),button_title:z.string().trim().min(1).max(20).optional()});
const config=z.object({enabled:z.boolean(),types:z.object({A:kind(1),B:kind(1),C:kind(1),D:kind(3),E:kind(3),F:kind(4)}),limits:z.object({interval_min:z.number().int().min(20).max(3600),interval_max:z.number().int().min(20).max(3600),hourly:z.number().int().min(1).max(100),daily_customer:z.number().int().min(1).max(20),typing_min:z.number().int().min(2).max(10),typing_max:z.number().int().min(2).max(10)})}).superRefine((v,c)=>{
  if(v.limits.interval_max<v.limits.interval_min || v.limits.typing_max<v.limits.typing_min)c.addIssue({code:'custom',message:'Intervalo máximo menor que o mínimo'});
  for(const t of Object.values(v.types))if(t.steps.some((s,i)=>i>0 && s.minutes<=t.steps[i-1].minutes))c.addIssue({code:'custom',message:'Os prazos precisam aumentar a cada passo'});
});
const input=z.discriminatedUnion('action',[
  z.object({action:z.literal('get')}),z.object({action:z.literal('save'),config}),
  z.object({action:z.literal('resume'),instance_id:z.string().uuid()}),
  z.object({action:z.literal('simulate'),event_id:z.string().uuid(),offset:z.number().int().min(0).default(0)}),
  z.object({action:z.literal('instagram_permissions'),number_id:z.string().uuid()}),
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
    if(body.action==='instagram_permissions'){
      const acct=await resolveIgAccountByNumberId(sb,body.number_id);
      const app=Deno.env.get('META_APP_ID'),secret=Deno.env.get('META_APP_SECRET');
      let valid=false,approved=false,status=0;
      if(acct.accessToken && app && secret){
        const q=new URLSearchParams({input_token:acct.accessToken,access_token:`${app}|${secret}`});
        const r=await fetch(`https://graph.facebook.com/v25.0/debug_token?${q}`,{signal:AbortSignal.timeout(15000)});status=r.status;
        const d=await r.json();valid=r.ok && d.data?.is_valid===true;
        approved=valid && Array.isArray(d.data?.scopes) && d.data.scopes.includes('human_agent');
      }
      const evidence=approved?'provider_human_agent_scope':valid?'feature_approval_not_proven':'token_inspection_unavailable';
      const save=await sb.from('instagram_account_capabilities').upsert({whatsapp_number_id:body.number_id,human_agent_approved:approved,evidence,checked_at:new Date().toISOString()});if(save.error)throw save.error;
      return json({human_agent_approved:approved,token_valid:valid,inspection_http_status:status,evidence,provider_messages_sent:0});
    }
    if(body.action==='simulate')return json(await scheduleGlobalFollowups(sb,{eventId:body.event_id,offset:body.offset}));
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