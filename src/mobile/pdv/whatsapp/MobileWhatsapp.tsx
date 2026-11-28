import { useEffect,useRef,useState } from 'react';
import { Link,useLocation,useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft,Search,RefreshCw,User,CheckCheck,Loader2,MoreVertical,ArrowRightLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useCurrentUserId } from '@/hooks/useCurrentUserId';
import { CHAT_LANE_META,type ChatLane } from '@/lib/chat/conversationLanes';
import { fetchMobileConversationPage,type MobileConversation,type MobileMessage } from '@/lib/chat/mobileWhatsappReads';
import { mobileConversationKey,type AttemptPayload,type MobileSendAttempt } from '@/lib/chat/mobileSendAttempt';
import type { SendBaseParams,SendProvider } from '@/hooks/chat/useChatSender';
import { assignMobileConversation,markMobileConversationRead,moveMobileConversationLane,reopenMobileConversation,recordMobileReply } from '@/lib/chat/mobileWhatsappActions';
import { isVirtualSeller } from '@/lib/pos/virtualSellers';
import { useMobileWhatsapp } from './useMobileWhatsapp';
import { useMobileSend } from './useMobileSend';
import { MobileWhatsappMessages } from './MobileWhatsappMessages';
import { MobileWhatsappComposer } from './MobileWhatsappComposer';
import { MobileWhatsappCatalog } from './MobileWhatsappCatalog';
import { MobileWhatsappCustomer } from './MobileWhatsappCustomer';
import { MobileWhatsappReplies } from './MobileWhatsappReplies';
import { toast } from 'sonner';
import './whatsapp.css';

export function MobileWhatsapp({storeId,sellerId}:{storeId:string;sellerId:string|null}){
 const navigate=useNavigate(),location=useLocation();const currentUserId=useCurrentUserId();
 const [term,setTerm]=useState('');const [query,setQuery]=useState('');const [numberId,setNumberId]=useState<string|null>(null);const [lane,setLane]=useState('all');const [quoted,setQuoted]=useState<MobileMessage|null>(null);
 const parts=location.pathname.replace(/^\/m\/pdv\/whatsapp\/?/,'').split('/').filter(Boolean);
 const phone=parts[0]?decodeURIComponent(parts[0]):null,routeNumber=parts[1]==='none'?null:parts[1]||null,action=parts[2]||null;
 const [chosen,setChosen]=useState<MobileConversation|null>(null);
 const target=phone&&chosen?.phone===phone&&chosen.whatsapp_number_id===routeNumber?chosen:null;
 const api=useMobileWhatsapp(storeId,sellerId,query,numberId,lane,target);
 const {attempts,send:dispatch}=useMobileSend(api.messages);
 const [online,setOnline]=useState(navigator.onLine);const [extraBusy,setExtraBusy]=useState(false);const extraLock=useRef(false);const [routingNumber,setRoutingNumber]=useState<string|null>(null);
 const seller=useQuery({queryKey:['m-wa-seller',sellerId],enabled:!!sellerId,staleTime:300000,queryFn:async()=>{const {data,error}=await supabase.from('pos_sellers').select('id,name,linked_user_id').eq('id',sellerId||'').eq('store_id',storeId).eq('is_active',true).maybeSingle();if(error)throw error;return data;}});
 const colleagues=useQuery({queryKey:['m-wa-colleagues',storeId],enabled:action==='atendente',staleTime:300000,queryFn:async()=>{const {data,error}=await supabase.from('pos_sellers').select('id,name,linked_user_id').eq('store_id',storeId).eq('is_active',true).order('name').limit(100);if(error)throw error;return (data||[]).filter(s=>!isVirtualSeller(s.name));}});
 useEffect(()=>{const t=setTimeout(()=>setQuery(term.trim()),400);return()=>clearTimeout(t);},[term]);
 useEffect(()=>{const update=()=>setOnline(navigator.onLine);window.addEventListener('online',update);window.addEventListener('offline',update);return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update);};},[]);
 const targetKey=phone?mobileConversationKey(phone,routeNumber):'';
 useEffect(()=>{setQuoted(null);setRoutingNumber(null);if(!phone){setChosen(null);return;}let alive=true;
  const known=api.rows.find(c=>c.phone===phone&&c.whatsapp_number_id===routeNumber);if(known){setChosen(known);return;}
  void fetchMobileConversationPage(storeId,sellerId,phone,routeNumber,'all',0).then(rows=>{if(alive)setChosen(rows.find(c=>c.phone===phone&&c.whatsapp_number_id===routeNumber)||null);}).catch(()=>{if(alive)setChosen(null);});
  return()=>{alive=false;};
 },[targetKey,storeId,sellerId]);
 // Keep headers/assignment current after a message refresh without rebuilding targets every render.
 useEffect(()=>{if(!phone)return;const row=api.rows.find(c=>c.phone===phone&&c.whatsapp_number_id===routeNumber);if(row)setChosen(prev=>JSON.stringify(prev)===JSON.stringify(row)?prev:row);},[api.rows,phone,routeNumber]);
 useEffect(()=>{document.body.setAttribute('data-mobile-pdv-whatsapp','');return()=>document.body.removeAttribute('data-mobile-pdv-whatsapp');},[]);
 const frame=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const viewport=window.visualViewport;const resize=()=>{frame.current?.style.setProperty('--m-wa-height',`${viewport?.height||window.innerHeight}px`);frame.current?.style.setProperty('--m-wa-top',`${viewport?.offsetTop||0}px`);};
  resize();viewport?.addEventListener('resize',resize);viewport?.addEventListener('scroll',resize);return()=>{viewport?.removeEventListener('resize',resize);viewport?.removeEventListener('scroll',resize);};
 },[phone]);
 const sendNumber=api.numbers.find(n=>n.id===(target?.whatsapp_number_id||routingNumber))||(target&&!target.whatsapp_number_id&&api.numbers.length===1?api.numbers[0]:null);
 const provider:SendProvider=sendNumber?.provider==='meta'?'meta':sendNumber?.provider==='uazapi'?'uazapi':sendNumber?.provider==='wasender'?'wasender':'zapi';
 const activeKey=target?mobileConversationKey(target.phone,sendNumber?.id||target.whatsapp_number_id):'';
 const busy=attempts.some(a=>a.state==='sending'&&mobileConversationKey(a.phone,a.numberId)===activeKey);
 const open=(c:MobileConversation)=>{setChosen(c);navigate(`/m/pdv/whatsapp/${encodeURIComponent(c.phone)}/${c.whatsapp_number_id||'none'}`);};
 const baseUrl=target?`/m/pdv/whatsapp/${encodeURIComponent(target.phone)}/${target.whatsapp_number_id||'none'}`:'/m/pdv/whatsapp';
 const send=async(p:AttemptPayload,retryId?:string)=>{
  const t=target,n=sendNumber;if(!t||!n||!online){toast.error(!online?'Sem internet. Nada será enviado ao reconectar.':'Escolha a instância da conversa.');return false;}
  if(!retryId&&attempts.some(a=>!a.superseded&&a.state==='uncertain'&&a.phone===t.phone&&a.numberId===n.id&&a.text===p.text&&(a.mediaUrl||'')===(p.mediaUrl||''))){toast.error('Confira a conversa e use Reenviar na mensagem não confirmada.');return false;}
  const channel=t.channel==='instagram'?'instagram':t.channel==='messenger'?'messenger':'whatsapp';
  const params:SendBaseParams={phone:t.phone,route:{channel,provider,numberId:n.id},senderUserId:seller.data?.linked_user_id||currentUserId,senderName:seller.data?.name||null,
   hooks:{onBeforeSend:()=>reopenMobileConversation(t.phone,t.whatsapp_number_id),onAfterSend:()=>recordMobileReply(t.phone,sellerId)}};
  const ok=await dispatch(params,p,retryId);
  if(ok){
   if(!t.assigned_to){const owner=seller.data?.linked_user_id||sellerId||currentUserId;if(owner)void assignMobileConversation(t.phone,t.whatsapp_number_id,owner,seller.data?.name||null).catch(()=>undefined);}
   void api.refreshMessages();void api.refresh();
  }return ok;
 };
 const retry=(a:MobileSendAttempt)=>{if(window.confirm('A confirmação pode ter se perdido e a mensagem já pode ter chegado. Você conferiu na conversa e quer reenviar mesmo assim?'))void send(a,a.id);};
 const perform=async(run:()=>Promise<unknown>)=>{if(extraLock.current||!online)return;extraLock.current=true;setExtraBusy(true);try{await run();void api.refresh();toast.success('Atualizado.');}catch(e){toast.error(e instanceof Error?e.message:'Não consegui atualizar.');}finally{extraLock.current=false;setExtraBusy(false);}};
 const touch=useRef<number|null>(null);
 if(!phone)return <div className="m-wa-list mx-auto min-h-screen w-full max-w-md bg-background pb-24">
  <header className="sticky top-0 z-10 flex min-h-14 items-center gap-2 border-b bg-background px-3"><Button asChild variant="ghost" size="icon" className="h-11 w-11" aria-label="Voltar ao PDV"><Link to="/m/pdv/mais"><ArrowLeft/></Link></Button><h1 className="flex-1 text-lg font-bold">WhatsApp</h1><Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Atualizar conversas" onClick={()=>void api.refresh()}><RefreshCw className={api.loading?'animate-spin':''}/></Button></header>
  <div className="space-y-3 border-b p-3"><div className="relative"><Search className="absolute left-3 top-4 h-4 w-4 text-muted-foreground"/><Input className="h-12 pl-10 text-base" aria-label="Buscar conversa" placeholder="Nome ou telefone" value={term} onChange={e=>setTerm(e.target.value)}/></div>
  <Select value={numberId||'all'} onValueChange={v=>setNumberId(v==='all'?null:v)}><SelectTrigger className="h-12" aria-label="Instância"><SelectValue placeholder="Todas as instâncias"/></SelectTrigger><SelectContent><SelectItem value="all">Todas as instâncias</SelectItem>{api.numbers.map(n=><SelectItem key={n.id} value={n.id}>{n.label}</SelectItem>)}</SelectContent></Select>
  <Select value={lane} onValueChange={setLane}><SelectTrigger className="h-12" aria-label="Linha de atendimento"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">Todas as linhas</SelectItem>{Object.entries(CHAT_LANE_META).map(([k,v])=><SelectItem key={k} value={k}>{v.title}</SelectItem>)}<SelectItem value="awaiting_payment">Aguardando pagamento</SelectItem><SelectItem value="archived">Arquivadas</SelectItem><SelectItem value="dispatch">Disparos</SelectItem></SelectContent></Select>
  </div>
  {!online&&<p role="status" className="border-b bg-muted p-3 text-sm">Sem internet. Envio indisponível.</p>}{api.error&&<p role="alert" className="p-3 text-sm text-destructive">{api.error}</p>}
  <ul className="divide-y" onTouchStart={e=>{touch.current=e.touches[0]?.clientY||null;}} onTouchEnd={e=>{if(touch.current!==null&&e.changedTouches[0]&&e.changedTouches[0].clientY-touch.current>80&&window.scrollY===0)void api.refresh();touch.current=null;}}>
  {api.rows.map(c=><li key={mobileConversationKey(c.phone,c.whatsapp_number_id)}><Button variant="ghost" className="h-auto min-h-24 w-full justify-start gap-3 rounded-none p-3 text-left" onClick={()=>open(c)}>
  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-muted font-bold">{c.customer_name?.[0]?.toUpperCase()||'?'}</span><span className="min-w-0 flex-1"><span className="flex justify-between gap-2"><strong className="truncate text-sm">{c.customer_name}</strong><time className="shrink-0 text-xs font-normal text-muted-foreground">{new Date(c.last_message_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</time></span><span className="block truncate text-sm font-normal text-muted-foreground">{c.last_message}</span><span className="block truncate text-xs font-normal">{CHAT_LANE_META[c.lane]?.title} · {api.numbers.find(n=>n.id===c.whatsapp_number_id)?.label||'Sem instância'}{c.assigned_name?` · ${c.assigned_name}`:''}</span></span>{c.unread_count>0&&<span aria-label={`${c.unread_count} não lidas`} className="flex h-7 min-w-7 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-xs text-primary-foreground">{c.unread_count}</span>}
  </Button></li>)}
  </ul>{(api.loading||api.scopeLoading)&&<Loader2 className="mx-auto my-6 animate-spin"/>}{!api.loading&&!api.scopeLoading&&!api.rows.length&&!api.error&&<p className="p-6 text-center text-muted-foreground">Nenhuma conversa encontrada.</p>}{api.hasMore&&<Button variant="outline" className="mx-3 my-4 h-12 w-[calc(100%-24px)]" disabled={api.loading} onClick={()=>void api.refresh(true)}>Carregar mais conversas</Button>}
 </div>;
 return <div ref={frame} className="m-wa-frame fixed inset-x-0 z-50 mx-auto flex w-full max-w-md flex-col bg-background">
  <header className="flex h-14 shrink-0 items-center gap-2 border-b px-2"><Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Voltar às conversas" onClick={()=>navigate(action?baseUrl:'/m/pdv/whatsapp')}><ArrowLeft/></Button><div className="min-w-0 flex-1"><h1 className="truncate text-sm font-bold">{target?.customer_name||'Conversa'}</h1><p className="truncate text-xs text-muted-foreground">{sendNumber?.label||target?.phone}</p></div><Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Ações da cliente" onClick={()=>navigate(`${baseUrl}/cliente`)}><User/></Button><Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Atendente e linha" onClick={()=>navigate(`${baseUrl}/atendente`)}><MoreVertical/></Button></header>
  {!online&&<p role="status" className="shrink-0 bg-muted p-2 text-sm">Sem internet. Não haverá reenvio automático.</p>}
  {!target?<div className="p-6"><p>Conversa indisponível nesta loja ou para este atendente.</p><Button variant="outline" className="mt-4 h-12" onClick={()=>navigate('/m/pdv/whatsapp')}>Voltar à lista</Button></div>:action?<main className="min-h-0 flex-1 overflow-y-auto p-4">
   {attempts.some(a=>!a.superseded&&a.state==='uncertain'&&mobileConversationKey(a.phone,a.numberId)===activeKey)&&<Button variant="outline" className="mb-4 h-auto min-h-12 w-full whitespace-normal text-destructive" onClick={()=>navigate(baseUrl)}>Não confirmada — confira na conversa antes de reenviar</Button>}
   {action==='catalogo'?<MobileWhatsappCatalog provider={provider} send={p=>send(p)} onDone={()=>navigate(baseUrl)}/>:action==='respostas'||action==='modelos'?<MobileWhatsappReplies templates={action==='modelos'} numberId={sendNumber?.id||null} name={target.customer_name} send={p=>send(p)} onDone={()=>navigate(baseUrl)}/>:action==='atendente'?<div className="space-y-4"><h2 className="font-bold">Atendente e linha</h2><p>{target.assigned_name||'Sem atendente'}</p><Button variant="outline" className="h-12 w-full" disabled={extraBusy||!online} onClick={()=>void perform(()=>markMobileConversationRead(target.phone,target.whatsapp_number_id))}><CheckCheck className="mr-2 h-5 w-5"/>Marcar como lida</Button><Select disabled={extraBusy||!online} onValueChange={v=>void perform(()=>moveMobileConversationLane(target.phone,target.whatsapp_number_id,v as 'new'|'unread'|'followup'|'live'|'support'))}><SelectTrigger className="h-12" aria-label="Mover de linha"><SelectValue placeholder="Mover de linha"/></SelectTrigger><SelectContent>{(['new','unread','followup','live','support'] as ChatLane[]).map(k=><SelectItem key={k} value={k}>{CHAT_LANE_META[k].title}</SelectItem>)}</SelectContent></Select><h3 className="font-bold">Atribuir atendimento</h3>{colleagues.data?.map(s=><Button key={s.id} variant="outline" className="h-12 w-full justify-start" disabled={extraBusy||!online} onClick={()=>void perform(()=>assignMobileConversation(target.phone,target.whatsapp_number_id,s.linked_user_id||s.id,s.name))}><ArrowRightLeft className="mr-2 h-4 w-4"/>{s.name}</Button>)}</div>:<MobileWhatsappCustomer key={`${targetKey}:${action}:${parts[3]||''}`} target={target} action={action} saleId={parts[3]} sellerId={sellerId} sellerName={seller.data?.name||null} provider={provider} send={p=>send(p)}/>}
  </main>:<>
   {api.error&&<p role="alert" className="p-2 text-sm text-destructive">{api.error}</p>}
   {!sendNumber&&<Select value={routingNumber||undefined} onValueChange={setRoutingNumber}><SelectTrigger className="h-12" aria-label="Instância de envio"><SelectValue placeholder="Escolha a instância"/></SelectTrigger><SelectContent>{api.numbers.map(n=><SelectItem key={n.id} value={n.id}>{n.label}</SelectItem>)}</SelectContent></Select>}
   <MobileWhatsappMessages messages={api.messages} attempts={attempts.filter(a=>mobileConversationKey(a.phone,a.numberId)===activeKey)} older={api.hasOlder} loading={api.olderLoading} loadOlder={api.loadOlder} quote={setQuoted} retry={retry}/>
   <MobileWhatsappComposer key={targetKey} disabled={!online||busy||!sendNumber} quoted={quoted} cancelQuote={()=>setQuoted(null)} send={p=>send(p)} openCatalog={()=>navigate(`${baseUrl}/catalogo`)} openReplies={()=>navigate(`${baseUrl}/respostas`)} openTemplates={provider==='meta'?()=>navigate(`${baseUrl}/modelos`):undefined}/>
  </>}
 </div>;
}
