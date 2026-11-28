import { useEffect,useRef,useState } from 'react';
import { Loader2,Check,ImageOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { searchErpCatalog } from '@/lib/liveProductSource';
import { erpColorCards,erpCardCaption,resolveSendableImage,erpStoreStock,cardStoreStock,type ErpColorCard } from '@/lib/whatsapp/erpProductPhotos';
import type { AttemptPayload } from '@/lib/chat/mobileSendAttempt';
export function MobileWhatsappCatalog({provider,send,onDone}:{provider:string;send:(p:AttemptPayload)=>Promise<boolean>;onDone:()=>void}){
 const [term,setTerm]=useState('');const [query,setQuery]=useState('');const [cards,setCards]=useState<ErpColorCard[]>([]);const [selected,setSelected]=useState<string[]>([]);const [loading,setLoading]=useState(false);const [more,setMore]=useState(false);const [offset,setOffset]=useState(0);const [stock,setStock]=useState<Awaited<ReturnType<typeof erpStoreStock>>>(new Map());const [error,setError]=useState('');const [sending,setSending]=useState(false);const lock=useRef(false);
 useEffect(()=>{const t=setTimeout(()=>{setQuery(term.trim());setOffset(0);setSelected([]);},400);return()=>clearTimeout(t);},[term]);
 useEffect(()=>{let alive=true;setLoading(true);searchErpCatalog({term:query||null,limit:20,offset}).then(async({items})=>{const next=erpColorCards(items);const s=await erpStoreStock(next.flatMap(c=>c.variants.map(v=>v.sku)));if(!alive)return;setStock(prev=>new Map([...prev,...s]));setCards(prev=>offset?[...prev,...next]:next);setMore(items.length===20);setError('');}).catch(()=>{if(alive)setError('Não consegui carregar o catálogo.');}).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false;};},[query,offset]);
 const submit=async()=>{if(lock.current||!navigator.onLine)return;lock.current=true;setSending(true);try{
  const chosen=cards.filter(c=>selected.includes(c.id));
  for(let i=0;i<chosen.length;i++){
   const c=chosen[i];const url=await resolveSendableImage(c.image,provider);
   const ok=await send({text:erpCardCaption(c),mediaUrl:url||undefined,mediaType:url?'image':undefined,mode:'catalog'});
   if(!ok){setError('Envio não confirmado. Confira na conversa; as próximas cores não foram enviadas.');return;}
   setSelected(prev=>prev.filter(id=>id!==c.id));
   if(i<chosen.length-1)await new Promise(r=>setTimeout(r,1500)); // same desktop catalog interval
  }onDone();
 }finally{setSending(false);lock.current=false;}};
 return <div className="space-y-3"><Input aria-label="Buscar produto" className="h-12 text-base" placeholder="Nome, SKU, etiqueta ou código" value={term} onChange={e=>setTerm(e.target.value)}/>
 {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
 {cards.map(c=><Button key={c.id} variant="outline" className="h-auto min-h-28 w-full justify-start gap-3 whitespace-normal p-3 text-left" disabled={sending} onClick={()=>setSelected(prev=>prev.includes(c.id)?prev.filter(id=>id!==c.id):[...prev,c.id])}>
  {c.image?<img src={c.image} alt={c.productName} loading="lazy" className="h-20 w-20 shrink-0 rounded-md bg-muted object-contain" onError={e=>{e.currentTarget.hidden=true;}}/>:<span className="flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-md bg-muted text-xs text-muted-foreground"><ImageOff/>Sem foto</span>}
  <span className="min-w-0 flex-1"><span className="block font-bold">{c.productName}</span><span className="block">{c.color} · {c.liveCode}</span><span className="block text-xs">Tamanhos {c.sizes.join(', ')}</span><span className="block">{c.price.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}</span><span className="block text-xs text-muted-foreground">{cardStoreStock(c,stock).map(s=>`${s.store}: ${s.stock}`).join(' · ')}</span></span>{selected.includes(c.id)&&<Check className="h-5 w-5 shrink-0 text-primary"/>}
 </Button>)}
 {loading&&<Loader2 className="mx-auto animate-spin"/>}{more&&<Button variant="outline" className="h-12 w-full" disabled={loading||sending} onClick={()=>setOffset(o=>o+20)}>Carregar mais produtos</Button>}
 <Button className="sticky bottom-2 h-12 w-full" onClick={submit} disabled={!selected.length||sending||!navigator.onLine}>{sending?'Enviando…':`Enviar ${selected.length} cor(es)`}</Button>
 </div>;
}
