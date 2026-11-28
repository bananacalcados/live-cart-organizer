import { useEffect,useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';
import type { AttemptPayload } from '@/lib/chat/mobileSendAttempt';
interface Template{name:string;language:string;status:string;components:{type:string;text?:string}[]}
export function MobileWhatsappReplies({send,templates,numberId,name,onDone}:{send:(p:AttemptPayload)=>Promise<boolean>;templates:boolean;numberId:string|null;name:string;onDone:()=>void}){
 const [query,setQuery]=useState('');const [term,setTerm]=useState('');const [page,setPage]=useState(0);const [rows,setRows]=useState<{id:string;title:string;message:string}[]>([]);const [models,setModels]=useState<Template[]>([]);const [model,setModel]=useState<Template|null>(null);const [values,setValues]=useState<Record<string,string>>({});const [loading,setLoading]=useState(false);const [error,setError]=useState('');
 useEffect(()=>{const t=setTimeout(()=>{setTerm(query);setPage(0);},400);return()=>clearTimeout(t);},[query]);
 useEffect(()=>{let alive=true;setLoading(true);const load=async()=>{
  if(templates){const {data,error}=await supabase.functions.invoke('meta-whatsapp-get-templates',{body:{whatsappNumberId:numberId,status:'APPROVED'}});if(error)throw error;if(alive)setModels((data?.templates||[]).filter((t:Template)=>t.status==='APPROVED'));}
  else{let q=supabase.from('quick_replies').select('id,title,message').order('sort_order').order('title').range(page*50,page*50+49);if(term.trim())q=q.ilike('title',`%${term.trim()}%`);const {data,error}=await q;if(error)throw error;if(alive)setRows(data||[]);}
 };void load().catch(()=>{if(alive)setError('Não consegui carregar as mensagens prontas.');}).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false;};},[templates,numberId,term,page]);
 const variables=[...new Set((model?.components.find(c=>c.type==='BODY')?.text||'').match(/\{\{\d+\}\}/g)||[])].sort();
 const submit=async()=>{
 if(!model)return;let preview=model.components.find(c=>c.type==='BODY')?.text||'';variables.forEach(v=>{preview=preview.split(v).join(values[v]||'');});
 if(await send({mode:'template',text:`[Template: ${model.name}] ${preview}`,template:{name:model.name,language:model.language,components:variables.length?[{type:'body',parameters:variables.map(v=>({type:'text',text:values[v]||''}))}]:[]}}))onDone();
 };
 return <div className="space-y-3"><Input aria-label="Buscar mensagem pronta" className="h-12 text-base" placeholder="Buscar mensagem pronta" value={query} onChange={e=>setQuery(e.target.value)}/>{loading&&<Loader2 className="animate-spin"/>}{error&&<p role="alert">{error}</p>}
 {templates?<>{model?<><h3 className="font-bold">{model.name}</h3><p className="whitespace-pre-wrap text-sm">{model.components.find(c=>c.type==='BODY')?.text}</p>{variables.map(v=><label key={v} className="block text-sm">{v}<Input className="h-12 text-base" value={values[v]||''} onChange={e=>setValues(p=>({...p,[v]:e.target.value}))}/></label>)}<Button className="h-12 w-full" disabled={variables.some(v=>!values[v]?.trim())} onClick={submit}>Enviar modelo aprovado</Button><Button variant="outline" className="h-12 w-full" onClick={()=>setModel(null)}>Voltar aos modelos</Button></>:models.filter(t=>t.name.toLowerCase().includes(term.toLowerCase())).map(t=><Button key={t.name} variant="outline" className="h-14 w-full justify-start" onClick={()=>{setModel(t);setValues({'{{1}}':name.split(' ')[0]});}}>{t.name}</Button>)}</>:<>{rows.map(r=><Button key={r.id} variant="outline" className="h-auto min-h-16 w-full justify-start whitespace-normal p-3 text-left" onClick={()=>void send({text:r.message}).then(ok=>{if(ok)onDone();})}><span><strong className="block">{r.title}</strong><span className="block line-clamp-3 text-sm font-normal">{r.message}</span></span></Button>)}{rows.length===50&&<Button variant="outline" className="h-12 w-full" onClick={()=>setPage(p=>p+1)}>Mais mensagens</Button>}</>}
 </div>;
}
