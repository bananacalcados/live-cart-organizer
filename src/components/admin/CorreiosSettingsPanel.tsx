import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Loader2, Save, Plug } from 'lucide-react';
import { toast } from 'sonner';
import { freightCall, freightDate, type FreightOption } from '@/lib/saleFreight';
interface Config { usuario:string; codigo_acesso:{configured:boolean;last4:string}; cartao_postagem:string; contrato:string|null; ambiente:string; enabled:boolean; remetente:Record<string,string>; servicos:{codigo:string;nome:string;ativo:boolean}[] }
interface ConnectionResult { ambiente?:string; cnpj?:string; contrato?:string; dr?:string; apis?:unknown[]; expiraEm?:string; options?:FreightOption[]; error?:string }
const senderFields = [['nome','Nome'],['cnpj','CNPJ'],['telefone','Telefone'],['email','Email'],['cep','CEP'],['logradouro','Logradouro'],['numero','Número'],['complemento','Complemento'],['bairro','Bairro'],['cidade','Cidade'],['uf','UF']];
export function CorreiosSettingsPanel() {
  const [config,setConfig] = useState<Config|null>(null), [code,setCode] = useState('');
  const [busy,setBusy] = useState<'load'|'save'|'test'|null>('load'), [result,setResult] = useState<ConnectionResult|null>(null), [error,setError] = useState(''), [dirty,setDirty] = useState(false);
  useEffect(() => {
    let alive=true;
    freightCall<{config:Config}>('correios-admin',{action:'get_config'}).then((r)=>{ if(alive)setConfig(r.config); }).catch((e)=>{ if(alive)setError(e.message); }).finally(()=>{if(alive)setBusy(null);});
    return ()=>{alive=false;};
  },[]);
  const change = (patch:Partial<Config>) => { setConfig((c)=>c?{...c,...patch}:c);setDirty(true);setResult(null); };
  const save = async () => {
    if(!config)return;
    setBusy('save');setError('');
    try {
      const {codigo_acesso:_,...fields}=config;
      delete (fields as Partial<Config> & {updated_at?:string}).updated_at;
      const r=await freightCall<{config:Config}>('correios-admin',{action:'set_config',config:{...fields,codigo_acesso:code}});
      setConfig(r.config);setCode('');setDirty(false);toast.success('Configuração Correios salva');
    } catch(e){setError(e instanceof Error?e.message:'Não foi possível salvar');}finally{setBusy(null);}
  };
  const test = async () => {
    setBusy('test');setError('');setResult(null);
    try{setResult(await freightCall<ConnectionResult>('correios-admin',{action:'test_connection'}));}catch(e){setError(e instanceof Error?e.message:'Conexão falhou');}finally{setBusy(null);}
  };
  if(!config)return <section className="space-y-3"><h2 className="text-xl font-bold">Correios (contrato)</h2>{busy?<Loader2 className="h-5 w-5 animate-spin"/>:<p className="text-destructive">{error}</p>}</section>;
  return <section className="space-y-6 max-w-4xl">
    <div className="flex items-center justify-between gap-4"><h2 className="text-xl font-bold">Correios (contrato)</h2><Label className="flex items-center gap-3"><Switch checked={config.enabled} onCheckedChange={(enabled)=>change({enabled})}/>Ativar</Label></div>
    <div className="grid sm:grid-cols-2 gap-4">
      <div className="space-y-1.5"><Label htmlFor="correios-user">Usuário Meu Correios</Label><Input id="correios-user" value={config.usuario} autoComplete="off" onChange={(e)=>change({usuario:e.target.value})}/></div>
      <div className="space-y-1.5"><Label htmlFor="correios-code">Código de acesso à API</Label><Input id="correios-code" type="password" autoComplete="new-password" value={code} placeholder={config.codigo_acesso.configured?`configurado ••••${config.codigo_acesso.last4}`:'Código gerado no portal CWS'} onChange={(e)=>{setCode(e.target.value);setDirty(true);setResult(null);}}/></div>
      <div className="space-y-1.5"><Label htmlFor="correios-card">Cartão de postagem</Label><Input id="correios-card" inputMode="numeric" value={config.cartao_postagem} onChange={(e)=>change({cartao_postagem:e.target.value.replace(/\D/g,'')})}/></div>
      <div className="space-y-1.5"><Label htmlFor="correios-contract">Contrato (opcional)</Label><Input id="correios-contract" value={config.contrato||''} onChange={(e)=>change({contrato:e.target.value})}/></div>
      <div className="space-y-1.5"><Label>Ambiente</Label><Select value={config.ambiente} onValueChange={(ambiente)=>change({ambiente})}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="producao">Produção</SelectItem><SelectItem value="homologacao">Homologação</SelectItem></SelectContent></Select></div>
    </div>
    <div className="border-t border-border pt-5 space-y-4"><h3 className="font-semibold text-lg">Remetente</h3><div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">{senderFields.map(([key,label])=><div key={key} className="space-y-1.5"><Label htmlFor={`correios-sender-${key}`}>{label}</Label><Input id={`correios-sender-${key}`} value={config.remetente[key]||''} onChange={(e)=>{let value=e.target.value;if(['cep','cnpj','telefone'].includes(key))value=value.replace(/\D/g,'');if(key==='uf')value=value.toUpperCase();change({remetente:{...config.remetente,[key]:value}});}}/></div>)}</div></div>
    <div className="border-t border-border pt-5 space-y-3"><h3 className="font-semibold text-lg">Serviços do contrato</h3><div className="flex flex-wrap gap-6">{config.servicos.map((s)=><Label key={s.codigo} className="flex items-center gap-2"><Checkbox checked={s.ativo} onCheckedChange={(v)=>change({servicos:config.servicos.map((a)=>a.codigo===s.codigo?{...a,ativo:v===true}:a)})}/>{s.nome} · {s.codigo}</Label>)}</div></div>
    <div className="flex flex-wrap gap-3"><Button onClick={save} disabled={!!busy}><Save className="h-4 w-4 mr-2"/>{busy==='save'?'Salvando…':'Salvar'}</Button><Button variant="outline" onClick={test} disabled={!!busy||dirty} title={dirty?'Salve as alterações antes de testar':undefined}>{busy==='test'?<Loader2 className="h-4 w-4 animate-spin mr-2"/>:<Plug className="h-4 w-4 mr-2"/>}Testar conexão</Button></div>
    {error&&<p role="alert" className="text-destructive break-words">{error}</p>}
    {result&&<div className="border-t border-border pt-5 space-y-3"><h3 className="font-semibold">Resultado da conexão</h3><dl className="grid sm:grid-cols-2 gap-2 text-sm">{[['Ambiente',result.ambiente||config.ambiente],['CNPJ',result.cnpj],['Contrato',result.contrato],['DR',result.dr],['Token válido até',result.expiraEm?freightDate(result.expiraEm):'—']].map(([k,v])=><div key={k}><dt className="text-muted-foreground">{k}</dt><dd className="font-medium break-words">{v||'—'}</dd></div>)}</dl><div><p className="text-sm text-muted-foreground">APIs liberadas</p><ul className="text-sm space-y-1">{(result.apis||[]).map((api,i)=><li className="break-words" key={i}>{typeof api==='object'?JSON.stringify(api):String(api)}</li>)}</ul></div><p className="font-medium text-sm">Teste 35051520 → 01310100 · 500 g · 30 × 20 × 12 cm</p>{(result.options||[]).map((o)=><p key={o.service_code}>{o.service} · {o.price.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})} · {o.delivery_days!=null?`${o.delivery_days} dias úteis`:'Prazo indisponível'}</p>)}{result.error&&<p role="alert" className="text-destructive break-words">{result.error}</p>}</div>}
  </section>;
}