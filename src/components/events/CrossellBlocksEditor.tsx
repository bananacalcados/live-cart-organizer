import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Image, File, Mic, Video, MessageSquare, MousePointerClick, Trash2, Plus, Save, Send, Square, RotateCcw, Loader2, Eye, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { uploadMediaToStorage } from "@/components/MediaAttachmentPicker";
import { fetchProducts, type ShopifyProduct } from "@/lib/shopify";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { validateCrossellBlocks, type CrossellBlock, type CrossellKind } from "../../../supabase/functions/_shared/crossell-blocks";
import { toast } from "sonner";

type History = { id: string; send_id: string; crossell_state: string; crossell_interest_at: string | null; reason: string | null; crossell_progress: { block: number; sent: { messageId: string }[]; reviews?: {at:string}[] }; event_bulk_sends: { template_label: string; base_components: CrossellBlock[] } };
const kinds = [{ kind:"text",label:"Texto",Icon:MessageSquare },{ kind:"image",label:"Fotos",Icon:Image },{ kind:"document",label:"Arquivo",Icon:File },{ kind:"audio",label:"Áudio",Icon:Mic },{ kind:"video",label:"Vídeo",Icon:Video },{ kind:"buttons",label:"Botões",Icon:MousePointerClick }] as const;
const labels: Record<string,string> = { pending:"Aguardando próximo bloco",sending:"Enviando",done:"Enviado",paused:"Pausado",review:"Confira o envio na conversa",cancelled:"Cancelado" };
async function call(body: Record<string,unknown>) {
  const {data,error} = await supabase.functions.invoke("live-crossell-blocks",{body});
  if (error instanceof FunctionsHttpError) {
    const detail = await error.context.clone().json().catch(()=>null);
    throw new Error(detail?.error || error.message);
  }
  if (error || data?.error) throw new Error(data?.error || error?.message);
  return data;
}

export function CrossellBlocksEditor({ orderId, phone, instanceId, provider, instanceLabel }: { orderId?: string; phone:string;instanceId: string | null; provider: string; instanceLabel: string }) {
  const [blocks,setBlocks]=useState<CrossellBlock[]>([]);
  const [name,setName]=useState("");
  const [offers,setOffers]=useState<{id:string;name:string;payload:CrossellBlock[]}[]>([]);
  const [offerId,setOfferId]=useState<string | undefined>();
  const [busy,setBusy]=useState(false);
  const [uploading,setUploading]=useState<string | null>(null);
  const [history,setHistory]=useState<History[]>([]);
  const [preview,setPreview]=useState(false);
  const [catalogBlock,setCatalogBlock]=useState<string | null>(null);
  const [catalogSearch,setCatalogSearch]=useState("");
  const [catalog,setCatalog]=useState<ShopifyProduct[]>([]);
  const [catalogBusy,setCatalogBusy]=useState(false);
  const requestId=useRef<string | null>(null);
  const sendingRef=useRef(false);
  const refresh=useCallback(async()=>{
    if (!orderId) return;
    try { const data=await call({action:"history",orderId}); setHistory((prev)=>JSON.stringify(prev)===JSON.stringify(data.history || [])?prev:data.history || []); } catch(e) { console.warn("[crossell]",e); }
  },[orderId]);
  useEffect(()=>{
    let cancelled=false;
    call({action:"list"}).then((data)=>{if(!cancelled) setOffers(data.offers || []);}).catch((e)=>toast.error(e.message));
    void refresh();
    const timer=setInterval(()=>{ if(!document.hidden) void refresh(); },30000);
    const visibility=()=>{if(!document.hidden) void refresh();};
    document.addEventListener("visibilitychange",visibility);
    return ()=>{cancelled=true;clearInterval(timer);document.removeEventListener("visibilitychange",visibility);};
  },[refresh]);
  useEffect(()=>{
    if (!catalogBlock) return;
    let cancelled=false;
    const timer=setTimeout(async()=>{
      setCatalogBusy(true);
      const products=await fetchProducts(50,catalogSearch.trim() || undefined);
      if(!cancelled){setCatalog(products);setCatalogBusy(false);}
    },300);
    return ()=>{cancelled=true;clearTimeout(timer);};
  },[catalogBlock,catalogSearch]);
  const edit=(id:string,change:Partial<CrossellBlock>)=>{ requestId.current=null;setBlocks((prev)=>prev.map((b)=>b.id===id ? {...b,...change}:b)); };
  const add=(kind:CrossellKind)=>{requestId.current=null;setBlocks((prev)=>[...prev,{id:crypto.randomUUID(),kind,text:"",media:[],buttons:kind==="buttons" ? [{title:"Tenho interesse",interest:true}] : []}]);};
  const move=(index:number,step:number)=>{
    requestId.current=null;
    setBlocks((prev)=>{const next=[...prev];const a=next[index],b=next[index+step];if(!a||!b)return prev;next[index]=b;next[index+step]=a;return next;});
  };
  const upload=async(block:CrossellBlock,files:FileList | null)=>{
    if(!files?.length)return;
    setUploading(block.id);
    try {
      const media=[...block.media];
      for(const file of Array.from(files)) {
        const candidate={url:"https://upload.invalid/file",name:file.name,mime:file.type,size:file.size};
        const error=validateCrossellBlocks([{...block,media:[candidate]}],provider);
        if(error)throw new Error(error);
        const url=await uploadMediaToStorage(file);
        if(!url)throw new Error("Não foi possível carregar o arquivo.");
        if(block.kind!=="image")media.length=0;
        media.push({...candidate,url});
      }
      edit(block.id,{media});
    } catch(e){toast.error(e instanceof Error?e.message:"Erro no arquivo");}
    finally{setUploading(null);}
  };
  const save=async()=>{
    if(!name.trim())return toast.error("Dê um nome à oferta.");
    const error=validateCrossellBlocks(blocks,"uazapi");if(error)return toast.error(error);
    setBusy(true);
    try{const data=await call({action:"save",name:name.trim(),blocks,presetId:offerId});setOfferId(data.id);const list=await call({action:"list"});setOffers(list.offers||[]);toast.success("Oferta salva");}
    catch(e){toast.error(e instanceof Error?e.message:"Erro ao salvar");}finally{setBusy(false);}
  };
  const send=async()=>{
    if(sendingRef.current)return;
    const error=validateCrossellBlocks(blocks,provider);if(error)return toast.error(error);
    if(!instanceId || !orderId)return toast.error("Selecione a instância da conversa e um pedido.");
    sendingRef.current=true;setBusy(true);
    if(!requestId.current)requestId.current=crypto.randomUUID();
    try{await call({action:"start",orderId,phone,instanceId,blocks,name:name||"Crossell",requestId:requestId.current});toast.success("Envio iniciado");await refresh();}
    catch(e){toast.error(e instanceof Error?e.message:"Erro ao iniciar");}finally{sendingRef.current=false;setBusy(false);}
  };
  const command=async(action:"resume"|"cancel"|"retry_review",sendId:string)=>{
    if(action==="retry_review" && !window.confirm("Confira o histórico do WhatsApp primeiro. Reenviar pode duplicar uma mensagem já recebida. Você confirma que deseja reenviar somente a parte não confirmada?"))return;
    setBusy(true);try{await call({action,sendId,confirmRetry:action==="retry_review"});await refresh();}catch(e){toast.error(e instanceof Error?e.message:"Erro no envio");}finally{setBusy(false);}
  };
  const active=history.some((h)=>["pending","sending"].includes(h.crossell_state));
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex-1 space-y-4 overflow-y-auto p-4">
      <div className="text-sm">Enviar por <strong>{instanceLabel}</strong> <Badge variant="outline">{provider==="meta"?"Meta API":provider}</Badge></div>
      <div className="flex gap-2">
        <Select value={offerId || "new"} onValueChange={(id)=>{requestId.current=null;const offer=offers.find((o)=>o.id===id);setOfferId(offer?.id);setName(offer?.name||"");setBlocks(offer?.payload||[]);}}><SelectTrigger><SelectValue placeholder="Oferta salva"/></SelectTrigger><SelectContent><SelectItem value="new">Nova oferta</SelectItem>{offers.map((o)=><SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent></Select>
        <Button size="icon" variant="outline" title="Prévia" aria-label="Prévia dos blocos" onClick={()=>setPreview(true)} disabled={!blocks.length}><Eye className="h-4 w-4"/></Button>
      </div>
      <Input aria-label="Nome da oferta" placeholder="Nome da oferta" value={name} onChange={(e)=>setName(e.target.value)}/>
      <div className="flex flex-wrap gap-1">{kinds.map(({kind,label,Icon})=><Button key={kind} variant="outline" size="sm" onClick={()=>add(kind)} disabled={busy || blocks.length>=50}><Icon className="mr-1 h-4 w-4"/>{label}</Button>)}</div>
      {blocks.map((block,index)=><section key={block.id} className="space-y-3 rounded-md border border-border p-3">
        <div className="flex items-center gap-1"><span className="mr-auto text-sm font-semibold">{index+1}. {kinds.find((k)=>k.kind===block.kind)?.label}</span>
          <Button size="icon" variant="ghost" aria-label={`Subir bloco ${index+1}`} disabled={!index || busy} onClick={()=>move(index,-1)}><ArrowUp className="h-4 w-4"/></Button>
          <Button size="icon" variant="ghost" aria-label={`Descer bloco ${index+1}`} disabled={index===blocks.length-1 || busy} onClick={()=>move(index,1)}><ArrowDown className="h-4 w-4"/></Button>
          <Button size="icon" variant="ghost" aria-label={`Remover bloco ${index+1}`} disabled={busy} onClick={()=>{requestId.current=null;setBlocks((prev)=>prev.filter((b)=>b.id!==block.id));}}><Trash2 className="h-4 w-4"/></Button>
        </div>
        {block.kind!=="audio" && <Textarea aria-label={`Texto do bloco ${index+1}`} placeholder={block.kind==="text" || block.kind==="buttons" ? "Mensagem" : "Legenda (opcional)"} value={block.text} onChange={(e)=>edit(block.id,{text:e.target.value})} disabled={busy}/>}
        {!["text","buttons"].includes(block.kind) && <>
          <Input type="file" aria-label={`Arquivos do bloco ${index+1}`} multiple={block.kind==="image"} accept={block.kind==="image"?"image/jpeg,image/png":block.kind==="audio"?"audio/mpeg,audio/mp4,audio/ogg,audio/aac,audio/amr":block.kind==="video"?"video/mp4,video/3gpp":undefined} disabled={busy || uploading!==null} onChange={(e)=>void upload(block,e.target.files)}/>
          {uploading===block.id && <Loader2 className="h-4 w-4 animate-spin"/>}
          {block.kind==="image" && <Button variant="outline" size="sm" onClick={()=>setCatalogBlock(block.id)}><BookOpen className="mr-1 h-4 w-4"/>Fotos do catálogo</Button>}
          {block.media.map((m,i)=><div key={`${m.url}-${i}`} className="flex items-center gap-2">
            {block.kind==="image" && <img src={m.url} alt={m.name} className="h-14 w-14 rounded object-cover"/>}
            {block.kind==="audio" ? <audio controls src={m.url} className="w-full min-w-0"/> : <span className="min-w-0 flex-1 truncate text-xs">{m.name}</span>}
            <Button variant="ghost" size="icon" aria-label={`Remover arquivo ${i+1} do bloco ${index+1}`} onClick={()=>edit(block.id,{media:block.media.filter((_,j)=>j!==i)})}><Trash2 className="h-4 w-4"/></Button>
          </div>)}
        </>}
        {block.kind==="buttons" && <div className="space-y-2">{block.buttons.map((button,i)=><div key={i} className="space-y-1"><div className="flex gap-1"><Input aria-label={`Título do botão ${i+1}`} maxLength={20} value={button.title} onChange={(e)=>edit(block.id,{buttons:block.buttons.map((v,j)=>j===i?{...v,title:e.target.value}:v)})}/><Button variant="ghost" size="icon" aria-label={`Remover botão ${i+1}`} onClick={()=>edit(block.id,{buttons:block.buttons.filter((_,j)=>j!==i)})}><Trash2 className="h-4 w-4"/></Button></div><Label className="flex items-center gap-2 text-xs"><Checkbox checked={button.interest} onCheckedChange={(checked)=>edit(block.id,{buttons:block.buttons.map((v,j)=>j===i?{...v,interest:checked===true}:v)})}/>Sinalizar interesse ao clicar</Label></div>)}<Button variant="outline" size="sm" disabled={block.buttons.length>=3} onClick={()=>edit(block.id,{buttons:[...block.buttons,{title:"",interest:true}]})}><Plus className="mr-1 h-4 w-4"/>Botão</Button></div>}
      </section>)}
      {history.length>0 && <div className="space-y-2 border-t border-border pt-4"><h3 className="text-sm font-semibold">Envios desta conversa</h3>{history.map((h)=><div key={h.id} className="space-y-1 border-b border-border py-2"><div className="flex flex-wrap items-center gap-2"><strong className="text-xs">{h.event_bulk_sends.template_label}</strong><Badge variant={h.crossell_state==="review"?"destructive":"outline"}>{labels[h.crossell_state]||h.crossell_state}</Badge>{h.crossell_interest_at && <Badge>INTERESSE EM CROSSELL</Badge>}</div><p className="text-xs text-muted-foreground">{h.crossell_progress.block} de {h.event_bulk_sends.base_components.length} blocos · {h.crossell_progress.sent.length} mensagens confirmadas</p>{h.crossell_progress.reviews?.map((r,i)=><p key={i} className="text-xs text-muted-foreground">Reenvio manual autorizado em {new Date(r.at).toLocaleString("pt-BR")}</p>)}{h.reason && <p className="text-xs text-destructive">{h.reason}</p>}<div className="flex flex-wrap gap-1">{h.crossell_state==="review" && <Button variant="outline" size="sm" disabled={busy} onClick={()=>void command("retry_review",h.send_id)}><RotateCcw className="mr-1 h-3 w-3"/>Conferi a conversa: reenviar</Button>}{["paused","pending"].includes(h.crossell_state) && <Button variant="outline" size="sm" disabled={busy} onClick={()=>void command("resume",h.send_id)}><RotateCcw className="mr-1 h-3 w-3"/>Continuar pendentes</Button>}{["pending","sending","paused"].includes(h.crossell_state)&&<Button variant="outline" size="sm" disabled={busy} onClick={()=>void command("cancel",h.send_id)}><Square className="mr-1 h-3 w-3"/>Cancelar restantes</Button>}</div></div>)}</div>}
    </div>
    <div className="flex gap-2 border-t border-border p-4"><Button variant="outline" onClick={()=>void save()} disabled={busy || uploading!==null}><Save className="mr-1 h-4 w-4"/>Salvar</Button><Button className="flex-1" onClick={()=>void send()} disabled={busy || active || uploading!==null || !blocks.length || !instanceId}>{busy?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<Send className="mr-2 h-4 w-4"/>}ENVIAR</Button></div>
    <Dialog open={preview} onOpenChange={setPreview}><DialogContent className="max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle>{name||"Prévia"}</DialogTitle><DialogDescription>{instanceLabel}</DialogDescription></DialogHeader><div className="space-y-3">{blocks.map((b)=><div key={b.id} className="space-y-2 border-b border-border pb-3">{b.text&&<p className="whitespace-pre-wrap text-sm">{b.text}</p>}{b.media.map((m)=>b.kind==="image"?<img key={m.url} src={m.url} alt={m.name} className="max-h-64 max-w-full rounded object-contain"/>:b.kind==="audio"?<audio key={m.url} src={m.url} controls className="w-full"/>:b.kind==="video"?<video key={m.url} src={m.url} controls className="max-h-64 w-full"/>:<a key={m.url} href={m.url} target="_blank" rel="noreferrer" className="text-sm text-primary underline">{m.name}</a>)}{b.buttons.map((button)=><Button key={button.title} variant="outline" className="mr-1" disabled>{button.title}</Button>)}</div>)}</div></DialogContent></Dialog>
    <Dialog open={catalogBlock!==null} onOpenChange={(value)=>{if(!value)setCatalogBlock(null);}}><DialogContent className="max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle>Fotos do catálogo</DialogTitle><DialogDescription>{catalog.length} produtos</DialogDescription></DialogHeader><Input aria-label="Buscar produto no catálogo" placeholder="Nome, SKU ou código de barras" value={catalogSearch} onChange={(e)=>setCatalogSearch(e.target.value)}/>{catalogBusy?<Loader2 className="h-5 w-5 animate-spin"/>:catalog.map((p)=><div key={p.node.id} className="space-y-2"><h4 className="text-sm font-semibold">{p.node.title}</h4><div className="grid grid-cols-4 gap-2">{p.node.images.edges.map(({node:m})=><Button key={m.url} variant="outline" className="h-auto p-0" aria-label={`Selecionar foto de ${p.node.title}`} onClick={()=>{const block=blocks.find((b)=>b.id===catalogBlock);if(block)edit(block.id,{media:[...block.media,{url:m.url,name:p.node.title,mime:"",size:0}]});setCatalogBlock(null);}}><img src={m.url} alt={m.altText||p.node.title} className="aspect-square w-full object-cover"/></Button>)}</div></div>)}</DialogContent></Dialog>
  </div>;
}