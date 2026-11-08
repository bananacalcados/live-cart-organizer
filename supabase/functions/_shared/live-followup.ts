import { DEFAULT_FOLLOWUP_CONFIG, scheduleStep, renderFollowup, stopReason, crossellWindow, type FollowupConfig, type FollowupType } from './live-followup-rules.ts';
import { internalCallHeaders } from './requireAuth.ts';
import { resolveEventNumber } from './event-sender.ts';
import { instagramFollowupMode } from './instagram-window.ts';
type Client = any;
export async function followupConfig(sb: Client): Promise<FollowupConfig> {
  const { data, error } = await sb.from('live_followup_settings').select('value').eq('id', true).maybeSingle();
  if (error) throw error;
  return data?.value || DEFAULT_FOLLOWUP_CONFIG;
}
/** This gate is deliberately global: the new event switch disables rather than revives old reminders. */
export async function replacesLegacyFollowups(sb: Client): Promise<boolean> {
  return (await followupConfig(sb)).enabled === true;
}
const normalizePhone = (value: string) => {
  let p = String(value || '').replace(/\D/g, '');
  if (p.length === 10 || p.length === 11) p = '55' + p;
  if (p.length === 12 && p.startsWith('55')) p = p.slice(0, 4) + '9' + p.slice(4);
  return /^55[1-9]\d9\d{8}$/.test(p) ? p : '';
};

export async function scheduleGlobalFollowups(sb: Client, simulation?: {eventId:string;offset:number}) {
  const saved = await followupConfig(sb);
  const cfg = simulation ? {...saved,enabled:true,enabled_since:'1970-01-01T00:00:00Z'} : saved;
  if (!cfg.enabled) return { scheduled: 0, enabled: false };
  const { data: sources, error } = await sb.rpc(simulation?'live_followup_audit_contexts':'live_followup_source_contexts', simulation?{p_event_id:simulation.eventId,p_limit:100,p_offset:simulation.offset}:{ p_limit: 50 });
  if (error) throw error;
  let scheduled = 0;
  const counts: Record<string,number>={A:0,B:0,C:0,D:0,E:0,F:0};
  const senders: Record<string,string[]>={A:[],B:[],C:[],D:[],E:[],F:[]};
  let privateReplies=0, endedPrivateReplies=0;
  for (const source of sources || []) {
    const c = source.context;
    const o = c.order;
    const a = c.access;
    const ev = c.event;
    if (!ev?.live_followup_enabled) { await ack(); continue; }
    const phone = normalizePhone(c.registration?.whatsapp || a?.confirmed_phone || a?.entered_phone || c.customer?.whatsapp || '');
    const ig = String(a?.instagram || c.customer?.instagram_handle || '').replace(/^@/, '').toLowerCase();
    const customer = phone ? 'wa:' + phone.slice(2,4) + phone.slice(-8) : 'ig:' + ig;
    const stopped = o && (o.is_paid || o.paid_externally || ['cancelled','paid','completed','shipped','refunded'].includes(o.stage) || o.merged_into_order_id || !(o.products || []).length);
    if (stopped) { await sb.from('live_followup_jobs').update({status:'cancelled',reason:'order_closed'}).eq('order_id',o.id).eq('status','pending'); await ack(); continue; }
    let type: FollowupType | null = null;
    let base: string | null = null;
    let sequence = o ? 'order:' + o.id : 'access:' + a?.id;
    if (o?.origin === 'catalog' && o.attribution?.source !== 'vitrine_grupo' && c.paid_same_day) { type='E'; base=c.first_item_at || o.created_at; }
    else if (o && (o.selfservice_cart_sent_at || c.cart_sent_at)) { type='D'; base=o.selfservice_cart_sent_at || c.cart_sent_at; }
    else if (a && !a.registered_at && !a.whatsapp_confirmed_at && phone) { type='A'; base=a.created_at; sequence='registration:'+ev.id+':'+customer; }
    else if (o && phone && (a?.registered_at || o.registered_at || c.registration)) {
      type=a?.registered_at && !a.whatsapp_confirmed_at ? 'B':'C'; base=a?.registered_at || o.registered_at || o.created_at;
    } else if (o && !phone && ig && !o.registered_at && o.origin !== 'catalog') { type='F'; base=o.created_at; }
    // No cart exists for a filled registration without an order: never manufacture one.
    if (!type || !base || !cfg.types[type].enabled || !cfg.enabled_since || Date.parse(base)<Date.parse(cfg.enabled_since)) { await ack(); continue; }
    if (!phone && type !== 'F') { await ack(); continue; }
    const numberId = type === 'F' ? c.ig_instance_id : (await resolveEventNumber(sb,ev.id)).id;
    if (!numberId) { await ack(); continue; }
    if(simulation){
      counts[type]+=cfg.types[type].steps.length;
      if(!senders[type].includes(numberId))senders[type].push(numberId);
      if(type==='F') {
        const igctx=await sb.rpc('instagram_reply_context',{p_username:ig,p_event_id:ev.id,p_number_id:numberId});
        if(igctx.error)throw igctx.error;
        const mode=instagramFollowupMode(igctx.data);
        if(mode==='private_reply')privateReplies++;
        if(mode==='live_ended_no_private_reply')endedPrivateReplies++;
      }
      scheduled+=cfg.types[type].steps.length;continue;
    }
    // B/C are one common initial-cart step, not two independent sequences.
    if (type === 'B' || type === 'C') sequence += ':initial';
    else sequence += ':' + type;
    const rows = cfg.types[type].steps.map((step,index) => ({
      event_id: ev.id, order_id:o?.id || null, access_id:a?.id || null,
      customer_key:customer, phone:phone || null, instagram:ig || null, whatsapp_number_id:numberId || null,
      channel:type === 'F'?'instagram':'whatsapp', type, step:index, sequence_key:sequence,
      base_at:base, scheduled_at:scheduleStep(new Date(base),type,type==='F' && index===0 ? Math.min(step.minutes,2) : type==='F' ? step.minutes+Math.min(cfg.types.F.steps[0].minutes,2) : step.minutes).toISOString(), status:'pending',
    }));
    const result = await sb.from('live_followup_jobs').upsert(rows,{onConflict:'customer_key,sequence_key,step',ignoreDuplicates:true});
    if (result.error) throw result.error;
    scheduled += rows.length;
    await ack();
    async function ack() {
      if(simulation)return;
      const r = await sb.from('live_followup_sources').delete().eq('source_key',source.source_key).eq('changed_at',source.changed_at);
      if (r.error) throw r.error;
    }
  }
  return {scheduled,enabled:true,...(simulation?{simulated:true,scanned:sources?.length || 0,counts,senders,privateReplies,endedPrivateReplies,provider_calls:0}:{})};
}

export async function processGlobalFollowups(sb: Client) {
  const cfg = await followupConfig(sb);
  const {data:jobs,error} = await sb.rpc('live_followup_claim',{p_limit:20});
  if(error) throw error;
  let sent=0;
  for (const job of jobs || []) {
    // Failed/uncertain sends are never reclaimed or retried automatically.
    let sendStarted=false;
    try {
      let context = await getContext();
      let reason = check(context);
      if (reason) { await stop(reason); continue; }
      if(job.type==='E') {
        const next=crossellWindow(new Date());
        if(next.getTime()>Date.now()+1000) {
          await sb.from('live_followup_jobs').update({status:'pending',claimed_at:null,scheduled_at:next.toISOString()}).eq('id',job.id).eq('status','processing'); continue;
        }
      }
      if(job.type==='F' && job.step>0 && !context.initial_sent_at){await stop('initial_not_sent');continue;}
      const step=cfg.types[job.type as FollowupType]?.steps[job.step];
      if(!step || job.variant==null) {await stop('config_changed');continue;}
      const slug=context.event?.self_service_slug;
      const cart=slug && job.order_id ? `https://checkout.bananacalcados.com.br/pedido/${slug}/carrinho/${job.order_id.replace(/-/g,'')}` : context.order?.cart_link;
      const registration=slug ? `https://checkout.bananacalcados.com.br/pedido/${slug}` : '';
      if(job.type==='A' ? !registration : !cart && !['D'].includes(job.type)) { await stop('missing_link');continue; }
      let text=renderFollowup(step.variants[job.variant],context.registration?.full_name || context.access?.form_draft?.full_name || context.customer?.full_name || '',registration,cart || '');
      if (text===context.instance?.last_message) text=text.replace(/😊/g,'🙂').replace(/!/,'.');
      if (!text.trim()) {await stop('empty_text');continue;}
      const headers={...(await internalCallHeaders()),'Content-Type':'application/json','x-force-instance':'true'};
      const url=Deno.env.get('SUPABASE_URL');
      async function call(fn: string, body: unknown) {
        const r=await fetch(`${url}/functions/v1/${fn}`,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
        const d=await r.json().catch(()=>({}));
        if(!r.ok || d.error || d.success===false) throw new Error(`provider_${r.status}:${d.error || 'rejected'}`);
        return d;
      }
      if(context.number?.provider==='uazapi') {
        const valid=await call('uazapi-check-number',{phone:job.phone,whatsapp_number_id:job.whatsapp_number_id});
        if(valid.exists!==true) { await stop('invalid_whatsapp');continue; }
        const seconds=cfg.limits.typing_min+Math.floor(Math.random()*(cfg.limits.typing_max-cfg.limits.typing_min+1));
        await call('uazapi-presence',{phone:job.phone,whatsapp_number_id:job.whatsapp_number_id,presence:'composing',delay:seconds*1000}).catch(()=>null);
        await new Promise(r=>setTimeout(r,seconds*1000));
      }
      // Revalidate the global switch, payment and actual incoming/manual messages just before the external send.
      context=await getContext();reason=check(context);
      if(reason) {await stop(reason);continue;}
      const stored=await sb.from('live_followup_jobs').update({message:text}).eq('id',job.id).eq('status','processing').select('id').maybeSingle();
      if(stored.error || !stored.data) throw new Error('claim_lost');
      if (job.type==='B' || job.type==='C') {
        const reserve=await sb.rpc('live_followup_cart_reserve',{p_job_id:job.id});
        if(reserve.error)throw reserve.error;
        if(reserve.data!==true){await stop('cart_already_contacted');continue;}
      }
      sendStarted=true;
      const provider=context.number?.provider;
      const out=job.channel==='instagram'
        ? await call('instagram-dm-send',{username:job.instagram,message:text,eventId:job.event_id,whatsapp_number_id:job.whatsapp_number_id,liveFollowup:true,followupStep:job.step,fallbackCommentIds:context.instagram_context?.comment_ids || []})
        : await call(provider==='meta'?'meta-whatsapp-send':`${provider}-send-message`,{phone:job.phone,message:text,type:'text',whatsapp_number_id:job.whatsapp_number_id,linkPreview:false});
      const mid=out.messageId || out.message_id || out.data?.id || null;
      if (!mid) throw new Error('provider_confirmation_missing');
      // Instagram sender already records its outgoing message; WhatsApp transports do not.
      if(job.channel==='whatsapp') {
        const log=await sb.from('whatsapp_messages').insert({phone:job.phone,whatsapp_number_id:job.whatsapp_number_id,message:text,direction:'outgoing',status:'sent',channel:'whatsapp',message_id:mid,source:'live_followup'});
        if(log.error) throw new Error('sent_history_uncertain');
      }
      if(job.type==='B' || job.type==='C'){
        const cartFinish=await sb.rpc('live_followup_cart_finish',{p_job_id:job.id,p_message_id:mid});
        if(cartFinish.error)throw cartFinish.error;
      }
      if(job.type==='F' && job.step===0){
        for(let i=1;i<cfg.types.F.steps.length;i++){
          const stepAt=scheduleStep(new Date(),'F',cfg.types.F.steps[i].minutes);
          await sb.from('live_followup_jobs').update({scheduled_at:stepAt.toISOString()}).eq('sequence_key',job.sequence_key).eq('step',i).eq('status','pending');
        }
      }
      const finish=await sb.from('live_followup_jobs').update({status:'sent',sent_at:new Date().toISOString(),message_id:mid}).eq('id',job.id).eq('status','processing');
      if(finish.error) throw new Error('sent_persistence_uncertain');
      await sb.from('live_followup_instances').update({consecutive_errors:0,last_message:text}).eq('whatsapp_number_id',job.whatsapp_number_id);
      sent++;
    } catch(e) {
      const reason=String(e instanceof Error ? e.message : 'internal_failure').slice(0,200);
      await sb.rpc('live_followup_failure',{p_job_id:job.id,p_reason:reason,p_uncertain:sendStarted});
    }
    async function getContext() { const r=await sb.rpc('live_followup_job_context',{p_job_id:job.id});if(r.error) throw r.error;return r.data; }
    function check(c: any) {
      if(!c) return 'context_missing';
      const o=c.order;
      if (c.linked_closed) return 'order_closed';
      const basic=stopReason(job.type,{global:c.global_enabled,event:c.event?.live_followup_enabled===true,type:c.type_enabled,paid:!!(o?.is_paid || o?.paid_externally),cancelled:!!(job.order_id && (!o || ['cancelled','paid','completed','shipped','refunded'].includes(o.stage) || o.merged_into_order_id || !(o.products || []).length)),replied:c.customer_replied,registered:!!(c.access?.registered_at || c.access?.whatsapp_confirmed_at),manualRecent:c.manual_recent,optedOut:c.opted_out,lateMinutes:(Date.now()-Date.parse(job.scheduled_at))/60000});
      if(basic)return basic;
      if(job.channel==='whatsapp' && c.event?.whatsapp_number_id!==job.whatsapp_number_id)return 'instance_changed';
      if(!job.whatsapp_number_id)return 'live_without_number';
      if(!c.number?.is_active || c.number?.is_online===false)return 'instance_disconnected';
      if(!['uazapi','wasender','zapi','meta','instagram'].includes(c.number.provider))return 'unsupported_provider';
      if(job.type==='F' && c.has_phone)return 'whatsapp_available';
      if(job.type==='F' && o?.registered_at)return 'registration_completed';
      if(['B','C'].includes(job.type) && (o?.selfservice_cart_sent_at || c.cart_sent_at || c.customer_replied))return 'cart_already_contacted';
      if(job.channel==='instagram') {
        const mode=instagramFollowupMode(c.instagram_context,job.step);
        if(!['direct_dm','private_reply'].includes(mode))return mode;
      } else if(c.number?.provider==='meta' && !c.window_open)return 'meta_window_closed';
      return null;
    }
    async function stop(reason: string) {
      if(reason==='late_step') {
        await sb.from('live_followup_jobs').update({status:'skipped',reason}).eq('id',job.id).eq('status','processing');
        return;
      }
      if(reason==='instance_disconnected' && job.whatsapp_number_id) await sb.from('live_followup_instances').update({paused:true,reason}).eq('whatsapp_number_id',job.whatsapp_number_id);
      const scope=sb.from('live_followup_jobs').update({status:'cancelled',reason}).eq('customer_key',job.customer_key).eq('event_id',job.event_id).in('status',['pending','processing']);
      if (job.order_id) scope.eq('order_id',job.order_id);
      else scope.eq('sequence_key',job.sequence_key);
      await scope;
    }
  }
  return {processed:jobs?.length || 0,sent};
}