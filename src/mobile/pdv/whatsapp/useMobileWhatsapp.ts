import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { useWaMessageBroadcast } from '@/hooks/useWaMessageBroadcast';
import { fetchMobileConversationPage, fetchMobileMessagePage, fetchMobileMessageUpdates, mergeMobileMessages, type MobileConversation, type MobileMessage } from '@/lib/chat/mobileWhatsappReads';

export function useMobileWhatsapp(storeId: string, sellerId: string | null, query: string, numberId: string | null, lane: string, target: MobileConversation | null) {
  const scope = useQuery({ queryKey: ['m-wa-scope', storeId], staleTime: 300000, queryFn: async () => {
    const [{data: links,error: linkError},{data:numbers,error: numberError}] = await Promise.all([
      supabase.from('pos_store_whatsapp_numbers').select('whatsapp_number_id').eq('store_id',storeId),
      supabase.from('whatsapp_numbers_safe').select('id,label,provider,is_active').eq('is_active',true).order('label'),
    ]);
    if (linkError || numberError) throw linkError || numberError;
    const ids = links?.map(n=>n.whatsapp_number_id) || [];
    return (numbers || []).filter(n=>!ids.length || ids.includes(n.id));
  }});
  const [rows,setRows] = useState<MobileConversation[]>([]);
  const [messages,setMessages] = useState<MobileMessage[]>([]);
  const [loading,setLoading] = useState(false);
  const [olderLoading,setOlderLoading] = useState(false);
  const [hasMore,setHasMore] = useState(false);
  const [hasOlder,setHasOlder] = useState(true);
  const [error,setError] = useState('');
  const archive = useRef(false), listBusy = useRef(false), listDirty = useRef(false), messageBusy = useRef(false), messageDirty=useRef(false), olderBusy=useRef(false);
  const listVersion = `${storeId}|${sellerId}|${query}|${numberId}|${lane}`;
  const versionRef = useRef(listVersion); versionRef.current=listVersion;
  const targetRef=useRef(target); targetRef.current=target;
  const rowsRef=useRef(rows); rowsRef.current=rows;
  const messagesRef=useRef(messages); messagesRef.current=messages;
  const refreshRef=useRef<(more?:boolean)=>Promise<void>>(async()=>undefined);
  const refreshList=useCallback(async (more=false) => {
    if (!scope.data) return;
    if(listBusy.current){listDirty.current=true;return;}
    listBusy.current=true; setLoading(true); const version=listVersion;
    try{
      const batch=await fetchMobileConversationPage(storeId,sellerId,query,numberId,lane,more?rowsRef.current.length:0);
      if(versionRef.current!==version)return;
      setRows(prev=>more?[...prev,...batch.filter(b=>!prev.some(p=>p.phone===b.phone&&p.whatsapp_number_id===b.whatsapp_number_id))]:JSON.stringify(prev)===JSON.stringify(batch)?prev:batch);
      setHasMore(batch.length===50);setError('');
    }catch(e){setError((e as {message?:string})?.message||'Não consegui carregar as conversas.');}
    finally{listBusy.current=false;setLoading(false);if(listDirty.current&&!document.hidden){listDirty.current=false;queueMicrotask(()=>void refreshRef.current());}}
  },[scope.data,storeId,sellerId,query,numberId,lane,listVersion]);
  refreshRef.current=refreshList;
  useEffect(()=>{void refreshList();},[refreshList]);
  const sameTarget=(t:MobileConversation)=>targetRef.current?.phone===t.phone&&targetRef.current?.whatsapp_number_id===t.whatsapp_number_id;
  const refreshMessages=useCallback(async()=>{
    const t=targetRef.current;if(!t)return;if(messageBusy.current){messageDirty.current=true;return;}
    messageBusy.current=true;
    try{
      let cursor=messagesRef.current.at(-1);
      if(!cursor){const batch=await fetchMobileMessagePage(t);if(sameTarget(t)){messagesRef.current=batch;setMessages(batch);}}
      else {
        // Incremental cursor pages prevent a burst >50 from leaving a hole in the history.
        let batch:MobileMessage[];
        do {batch=await fetchMobileMessagePage(t,false,undefined,cursor);if(!sameTarget(t))return;
          const merged=mergeMobileMessages(messagesRef.current,batch);messagesRef.current=merged;setMessages(merged);cursor=batch.at(-1);
        } while(batch.length===50&&cursor&&!document.hidden);
      }
    }catch(e){setError((e as {message?:string})?.message||'Não consegui carregar as mensagens.');}
    finally{messageBusy.current=false;if(messageDirty.current&&!document.hidden){messageDirty.current=false;queueMicrotask(()=>void refreshMessages());}}
  },[]);
  const targetKey=target?`${target.phone}|${target.whatsapp_number_id}`:'';
  useEffect(()=>{archive.current=false;messagesRef.current=[];setMessages([]);setHasOlder(true);void refreshMessages();},[targetKey,refreshMessages]);
  const loadOlder=useCallback(async()=>{
    const t=targetRef.current;if(!t||olderBusy.current||!hasOlder)return;olderBusy.current=true;setOlderLoading(true);
    try{
      let batch=await fetchMobileMessagePage(t,archive.current,messagesRef.current[0]);
      if(!sameTarget(t))return;
      if(batch.length<50&&!archive.current){archive.current=true; const older=await fetchMobileMessagePage(t,true,batch[0]||messagesRef.current[0]);batch=[...older,...batch];if(!sameTarget(t))return;setHasOlder(older.length===50);}else setHasOlder(batch.length===50);
      const merged=mergeMobileMessages(messagesRef.current,batch);messagesRef.current=merged;setMessages(merged);
    }catch(e){setError((e as {message?:string})?.message||'Não consegui carregar o histórico antigo.');}finally{olderBusy.current=false;setOlderLoading(false);}
  },[hasOlder]);
  const pendingList=useRef(false),pendingChat=useRef(false),statusIds=useRef(new Set<string>());
  useWaMessageBroadcast(()=>{
    if(document.hidden)return;
    if(pendingList.current){pendingList.current=false;void refreshRef.current();}
    if(pendingChat.current){pendingChat.current=false;void refreshMessages();}
    const t=targetRef.current;const ids=[...statusIds.current];statusIds.current.clear();
    if(t&&ids.length)void fetchMobileMessageUpdates(t,ids).then(batch=>{if(sameTarget(t)){const merged=mergeMobileMessages(messagesRef.current,batch);messagesRef.current=merged;setMessages(merged);}}).catch(()=>undefined);
  },{debounceMs:750,filter:p=>{
    const ids=scope.data?.map(n=>n.id);if(!ids)return false;
    const t=targetRef.current;const isChat=!!t&&p.phone===t.phone&&(t.is_group||p.whatsapp_number_id===t.whatsapp_number_id);
    const inScope=(p.whatsapp_number_id?ids.includes(p.whatsapp_number_id):ids.length!==1)||isChat;
    if(!inScope)return false;
    // Accumulate BEFORE coalescing: another conversation cannot swallow an open-chat event.
    if(p.event!=='wa_msg_update')pendingList.current=true;
    if(isChat){if(p.event==='wa_msg_update'&&p.id&&messagesRef.current.some(m=>m.id===p.id))statusIds.current.add(p.id);else pendingChat.current=true;}
    return true;
  }});
  useEffect(()=>{
    const reload=()=>{if(document.hidden)return;void refreshRef.current();void refreshMessages();};
    const visible=()=>{if(!document.hidden)reload();};
    window.addEventListener('online',reload);document.addEventListener('visibilitychange',visible);
    return()=>{window.removeEventListener('online',reload);document.removeEventListener('visibilitychange',visible);};
  },[refreshMessages]);
  return { rows,messages,numbers:scope.data||[],scopeLoading:scope.isLoading,loading,olderLoading,hasMore,hasOlder,error: error || (scope.error?'Não consegui carregar as instâncias.':''),refresh:refreshList,refreshMessages,loadOlder };
}
