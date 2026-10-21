import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, Truck, RefreshCw } from 'lucide-react';
import { freightCall, freightDate, type FreightOption, type SaleFreightQuote } from '@/lib/saleFreight';
import { toast } from 'sonner';
interface Props { saleId:string; open:boolean; onSelected:(option:FreightOption)=>void; onQuoted?:()=>void }
export function ExpFreightQuotePanel({saleId,open,onSelected,onQuoted}:Props) {
  const [quote,setQuote]=useState<SaleFreightQuote|null>(null),[visible,setVisible]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [edited,setEdited]=useState(false),[form,setForm]=useState({peso_g:'700',c:'30',l:'20',a:'12'});
  useEffect(()=>{
    if(!open)return;
    let alive=true;
    setQuote(null);setVisible(false);setEdited(false);setError('');
    supabase.from('sale_freight_quotes').select('id,sale_id,quoted_at,package,options,errors,selected_option').eq('sale_id',saleId).order('quoted_at',{ascending:false}).order('id',{ascending:false}).limit(1).maybeSingle().then(({data,error:loadError})=>{
      if(!alive)return;
      if(loadError){setError('Não foi possível carregar a última cotação');return;}
      if(data){const q=data as unknown as SaleFreightQuote;setQuote(q);setForm({peso_g:String(q.package.peso_g),c:String(q.package.c),l:String(q.package.l),a:String(q.package.a)});}
    });
    return ()=>{alive=false;};
  },[open,saleId]);
  const recote=async()=>{
    if(busy)return;setBusy(true);setError('');setVisible(true);
    try{
      const q=await freightCall<SaleFreightQuote>('sale-freight-quote',{sale_id:saleId,...(edited?{package:Object.fromEntries(Object.entries(form).map(([k,v])=>[k,Number(v)]))}:{})});
      setQuote(q);setEdited(false);setForm({peso_g:String(q.package.peso_g),c:String(q.package.c),l:String(q.package.l),a:String(q.package.a)});onQuoted?.();
    }catch(e){setError(e instanceof Error?e.message:'Não foi possível cotar');}finally{setBusy(false);}
  };
  const select=async(index:number)=>{
    if(!quote||busy||edited)return;setBusy(true);setError('');
    try{const r=await freightCall<{selected_option:FreightOption}>('sale-freight-quote',{action:'select',sale_id:saleId,quote_id:quote.id,option_index:index});setQuote({...quote,selected_option:r.selected_option});onSelected(r.selected_option);toast.success('Frete selecionado');}catch(e){setError(e instanceof Error?e.message:'Não foi possível selecionar');}finally{setBusy(false);}
  };
  const options=quote?.options||[];
  const minPrice=options.length?Math.min(...options.map(o=>o.price)):null;
  const delivery=options.map(o=>o.delivery_days).filter((v):v is number=>v!=null);
  const minDays=delivery.length?Math.min(...delivery):null;
  return <div className="space-y-3 border-t border-border pt-4">
    <div className="flex items-center gap-3 flex-wrap"><Button variant="outline" onClick={()=>{if(quote&&!visible){setVisible(true);}else void recote();}} disabled={busy}>{busy?<Loader2 className="h-4 w-4 animate-spin mr-2"/>:<Truck className="h-4 w-4 mr-2"/>}Cotar fretes</Button>{quote&&<p className="text-sm text-muted-foreground">Última cotação: {freightDate(quote.quoted_at)}</p>}</div>
    {error&&<p role="alert" className="text-destructive break-words">{error}</p>}
    {(visible||error)&&<div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">{([['peso_g','Peso (g)'],['c','Comprimento (cm)'],['l','Largura (cm)'],['a','Altura (cm)']] as const).map(([k,label])=><div key={k} className="space-y-1.5"><Label htmlFor={`freight-${k}`}>{label}</Label><Input id={`freight-${k}`} type="number" min="1" value={form[k]} onChange={(e)=>{setForm({...form,[k]:e.target.value});setEdited(true);}} disabled={busy}/></div>)}</div>
      {quote&&<p className="text-sm text-muted-foreground">{quote.package.itens} pares · {quote.package.origem==='produtos'?'Medidas dos produtos':'Pacote padrão / ajustado'}</p>}
      <Button variant="outline" onClick={recote} disabled={busy}><RefreshCw className="h-4 w-4 mr-2"/>Recotar fretes</Button>
      {quote&&Object.entries(quote.errors).map(([source,msg])=><p key={source} role="alert" className="text-sm text-destructive break-words">{source==='frenet'?'Frenet':'Correios'}: {msg.replace(/^(Correios|Frenet):\s*/,'')}</p>)}
      {options.map((option,index)=><div key={`${option.source}-${option.service_code}-${index}`} className="border border-border rounded-md p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-1"><p className="font-semibold break-words">{option.carrier} · {option.service}</p><div className="flex flex-wrap gap-2">{option.source==='correios'&&<Badge variant="outline">Contrato</Badge>}{option.price===minPrice&&<Badge variant="secondary">Mais barato</Badge>}{option.delivery_days!=null&&option.delivery_days===minDays&&<Badge variant="secondary">Mais rápido</Badge>}</div><p>{option.price.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})} · {option.delivery_days!=null?`${option.delivery_days} dias úteis`:'Prazo não informado'}</p>{option.note&&<p className="text-sm text-muted-foreground break-words">{option.note}</p>}</div>
        <Button onClick={()=>select(index)} disabled={busy||edited}>{quote?.selected_option?.source===option.source&&quote.selected_option.service_code===option.service_code?'Selecionado':'Usar esta opção'}</Button>
      </div>)}
      {visible&&!busy&&!options.length&&quote&&<p className="text-muted-foreground">Nenhum frete disponível.</p>}
    </div>}
  </div>;
}