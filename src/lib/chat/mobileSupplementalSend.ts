import { supabase } from '@/integrations/supabase/client';
import { posSendMedia, posSendText } from '@/lib/pos/posWhatsappSend';
import type { AttemptPayload } from './mobileSendAttempt';
/** Same endpoints/persistence as the desktop catalog and approved-template widgets. No retries. */
export async function sendMobileSupplemental(phone:string,numberId:string|null,provider:string,p:AttemptPayload) {
  let messageId:string|null=null;
  if(p.template){
    const {data,error}=await supabase.functions.invoke('meta-whatsapp-send-template',{body:{phone,templateName:p.template.name,language:p.template.language,components:p.template.components,whatsappNumberId:numberId}});
    if(error||data?.error||data?.success===false)throw error||new Error(data.error||'Envio não confirmado');
    messageId=data?.messageId||null;
  }else messageId=p.mediaUrl?await posSendMedia({provider,phone,numberId,mediaUrl:p.mediaUrl,mediaType:'image',caption:p.text}):await posSendText({provider,phone,numberId,message:p.text});
  const {error}=await supabase.from('whatsapp_messages').insert({phone,message:p.text,direction:'outgoing',status:'sent',message_id:messageId,whatsapp_number_id:numberId,...(p.mediaUrl?{media_url:p.mediaUrl,media_type:p.mediaType}:{})});
  if(error)console.error('[mobile catalog/template] persistence failed',error);
  return {success:true,messageId};
}
