import {internalCallHeaders} from './requireAuth.ts';
import {renderFollowup} from './live-followup-rules.ts';
export async function handleLiveFollowupButton(sb:any,jobId:string,senderId:string,numberId:string,clickedAt:string){
 const claim=await sb.rpc('live_followup_button_claim',{p_job_id:jobId,p_sender_id:senderId,p_number_id:numberId,p_clicked_at:clickedAt});
 if(claim.error)throw claim.error;
 if(!claim.data)return {claimed:false};
 const id=claim.data;
 let started=false;
 try{
  const {data:c,error}=await sb.rpc('live_followup_job_context',{p_job_id:id});if(error)throw error;
  if(!c?.global_enabled || !c.type_enabled || !c.event?.live_followup_enabled || c.customer_replied || c.manual_recent || c.opted_out || c.linked_closed || c.order?.is_paid || c.order?.paid_externally || !c.instagram_context?.window_open)throw new Error('click_context_closed');
  const {data:job}=await sb.from('live_followup_jobs').select('instagram,order_id,event_id,whatsapp_number_id').eq('id',id).single();
  if(!job || !c.event?.self_service_slug || !job.order_id)throw new Error('missing_cart');
  const cart=`https://checkout.bananacalcados.com.br/pedido/${c.event.self_service_slug}/carrinho/${job.order_id.replace(/-/g,'')}`;
  const text=renderFollowup('Aqui está seu carrinho, {primeiro_nome} 🛍️\n{link_carrinho}',c.registration?.full_name || c.customer?.full_name || '', '',cart);
  started=true;
  const r=await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/instagram-dm-send`,{method:'POST',headers:{...(await internalCallHeaders()),'Content-Type':'application/json'},body:JSON.stringify({username:job.instagram,message:text,eventId:job.event_id,whatsapp_number_id:numberId,liveFollowup:true,followupStep:1}),signal:AbortSignal.timeout(20000)});
  const out=await r.json();if(!r.ok || out.error || !out.messageId)throw new Error('cart_send_unconfirmed');
  const finish=await sb.rpc('live_followup_button_finish',{p_job_id:id,p_message_id:out.messageId});if(finish.error || !finish.data)throw new Error('cart_finish_unconfirmed');
  return {claimed:true,sent:true};
 }catch(e){await sb.rpc('live_followup_failure',{p_job_id:id,p_reason:e instanceof Error?e.message:'click_failed',p_uncertain:started});return {claimed:true,sent:false};}
}