import { useEffect, useRef, useState } from 'react';
import { useChatSender, type SendBaseParams } from '@/hooks/chat/useChatSender';
import { MobileSendGate, mobileConversationKey, reconcileMobileAttempts, type AttemptPayload, type MobileSendAttempt } from '@/lib/chat/mobileSendAttempt';
import type { Message } from '@/components/chat/ChatTypes';
import { sendMobileSupplemental } from '@/lib/chat/mobileSupplementalSend';
const STORAGE='m-pdv-wa-uncertain';
function restore():MobileSendAttempt[]{try{return JSON.parse(sessionStorage.getItem(STORAGE)||'[]').map((a:MobileSendAttempt)=>({...a,state:a.state==='sending'?'uncertain':a.state}));}catch{return [];}}
export function useMobileSend(messages: Message[]) {
  const sender=useChatSender();const gate=useRef(new MobileSendGate());
  const [attempts,setAttempts]=useState<MobileSendAttempt[]>(restore);
  useEffect(()=>{setAttempts(prev=>reconcileMobileAttempts(prev,messages));},[messages]);
  useEffect(()=>{try{sessionStorage.setItem(STORAGE,JSON.stringify(attempts.filter(a=>a.state!=='confirmed').slice(-50)));}catch{/* storage denial never blocks send */}},[attempts]);
  const send=async(base:SendBaseParams,payload:AttemptPayload,explicitRetryId?:string)=>{
    const key=mobileConversationKey(base.phone,base.route.numberId);
    if(!navigator.onLine||!gate.current.enter(key))return false;
    const attempt:MobileSendAttempt={...payload,id:crypto.randomUUID(),phone:base.phone,numberId:base.route.numberId,senderUserId:base.senderUserId||null,startedAt:new Date().toISOString(),state:'sending'};
    setAttempts(prev=>[...prev.map(a=>a.id===explicitRetryId?{...a,superseded:true}:a),attempt]);
    const update=(state:MobileSendAttempt['state'],messageId?:string|null)=>setAttempts(prev=>prev.map(a=>a.id===attempt.id && !(state==='uncertain'&&a.state==='confirmed')?{...a,state,messageId}:a));
    // Client-only deadline. It does NOT retry or cancel a possibly accepted send.
    let deadline:ReturnType<typeof setTimeout>|undefined;
    try{
      const request=payload.mode ? sendMobileSupplemental(base.phone,base.route.numberId,base.route.provider,payload) : payload.mediaUrl?sender.sendMedia({...base,mediaUrl:payload.mediaUrl,mediaType:payload.mediaType||'document',caption:payload.text,quotedMessageId:payload.quotedMessageId}):sender.sendText({...base,message:payload.text,quotedMessageId:payload.quotedMessageId});
      const uncertain=new Promise<null>(resolve=>{deadline=setTimeout(()=>resolve(null),30000);});
      void request.then(result=>{if(result.success)update('confirmed',result.messageId);},()=>undefined);
      const result=await Promise.race([request,uncertain]);
      if(result?.success){update('confirmed',result.messageId);return true;}
      update('uncertain');return false;
    }catch{update('uncertain');return false;}finally{if(deadline)clearTimeout(deadline);gate.current.leave(key);}
  };
  return {attempts,send};
}
