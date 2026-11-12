import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ArrowRight, Package, CheckCircle2, FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { centralCall, type CentralContext, type CentralOption, type CentralResult, type CentralType } from '@/lib/centralApi';

const labels: Record<string, string> = {
  aprovado: 'Solicitação aprovada', escalado: 'Em análise pela equipe', solicitado: 'Solicitação recebida',
  aguardando_postagem: 'Aguardando postagem', em_transito: 'Produto em transporte', recebido: 'Recebido na loja', concluido: 'Concluído',
};
const money = (value?: number) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const brDate = (iso?: string) => iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '';

export default function CentralPublicPage({ type }: { type: CentralType }) {
  const { token } = useParams();
  const [context, setContext] = useState<CentralContext | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [item, setItem] = useState('');
  const [reason, setReason] = useState('');
  const [detail, setDetail] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [unused, setUnused] = useState(false);
  const [options, setOptions] = useState<CentralOption[]>([]);
  const [chosen, setChosen] = useState('');
  const [stage, setStage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [optionQuery, setOptionQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [desired, setDesired] = useState('');
  const [receivedDate, setReceivedDate] = useState('');
  const [result, setResult] = useState<CentralResult | null>(null);
  const [showExchangeOffer, setShowExchangeOffer] = useState(false);

  useEffect(() => {
    document.title = `Central de ${type === 'troca' ? 'Trocas' : 'Devoluções'} | Banana Calçados`;
    let active = true;
    setLoading(true); setError('');
    if (!token) {
      setError('Este link não está disponível. Peça um novo link à equipe.'); setLoading(false); return;
    }
    centralCall<CentralContext>('central-resolve', { token, type })
      .then(d => { if (active) setContext(d); })
      .catch(e => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token, type]);

  const freeItems = context?.items.filter(x => !x.open) ?? [];
  const allBusy = !!context && context.items.length > 0 && freeItems.length === 0;
  const selected = freeItems.find(x => x.id === item);
  const overlap = context?.progress.find(x => x.item_id === item);
  const choice = type === 'troca' && context?.require_product_choice !== false;
  const valid = Boolean(selected && reason && detail.trim().length >= 3 && quantity >= 1 && quantity <= (selected?.quantity || 0) && (!context?.requires_received_date || receivedDate));
  const simulation = result?.simulation || context?.test_simulation || null;

  async function loadOptions(query = '', page = 0) {
    if (!selected) return;
    setBusy(true); setError('');
    try {
      setOptions(await centralCall<CentralOption[]>('central-resolve', { token, type, item_id: item, search: query, offset: page }));
      setOptionQuery(query); setOffset(page); setStage(2);
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível continuar.'); }
    finally { setBusy(false); }
  }

  async function submit(replacement = chosen) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const submitted = await centralCall<CentralResult>('central-submit', {
        token, type, item_id: item, quantity, reason, detail, unused,
        replacement_id: type === 'troca' && choice && replacement ? replacement : null,
        desired: type === 'troca' && !choice ? desired.trim().slice(0, 200) || null : null,
        received_date: context?.requires_received_date ? receivedDate : null,
      });
      setResult(submitted);
      setShowExchangeOffer(type === 'devolucao' && (reason === 'tamanho' || reason === 'nao_gostou'));
      setContext(await centralCall<CentralContext>('central-resolve', { token, type }));
      setItem(''); setReason(''); setDetail(''); setQuantity(1); setUnused(false); setStage(1); setChosen(''); setDesired(''); setReceivedDate('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível enviar.'); }
    finally { setBusy(false); }
  }

  return <div className="min-h-screen bg-background text-foreground">
    <header className="border-b"><div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-4">
      <img src="/images/banana-logo.png" alt="Banana Calçados" className="h-12 w-12 object-contain" />
      <span className="font-bold text-lg">Banana Calçados</span>
      {context?.is_test && <Badge variant="destructive" className="ml-auto">TESTE</Badge>}
    </div></header>
    <main className="mx-auto max-w-xl space-y-6 px-4 py-7">
      <h1 className="text-2xl font-bold">Central de {type === 'troca' ? 'Trocas' : 'Devoluções'}</h1>
      <p className="border-l-4 border-primary bg-primary/10 p-4 text-sm leading-relaxed">
        {type === 'troca' ? 'O produto novo só será enviado depois que o produto devolvido chegar à nossa loja e for conferido.' : 'O reembolso será analisado pela equipe depois que o produto devolvido chegar à nossa loja e for conferido.'}
      </p>
      {loading ? <p role="status">Carregando seu pedido…</p> : <>
        {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-4">{error}</p>}
        {context && <>
          <p>Olá, <strong>{context.first_name}</strong>.</p>
          {context.delivered_at && <p className="text-sm text-muted-foreground">Entrega: {new Date(context.delivered_at).toLocaleDateString('pt-BR')}</p>}
          {context.eligibility !== 'eligible' && !allBusy && !result && <p className="bg-muted p-4">Vamos analisar com carinho, um atendente falará com você. Você pode enviar sua solicitação abaixo.</p>}
          {result && <section className="space-y-2">
            <CheckCircle2 className="h-9 w-9 text-primary" />
            <h2 className="text-xl font-bold">{result.existing ? 'Solicitação já em andamento' : 'Solicitação recebida'}</h2>
            {result.reason && simulation?.status !== 'success' && <p>{result.reason}</p>}
          </section>}
          {simulation && <section className="space-y-3 rounded-lg border border-primary bg-primary/5 p-4" aria-label="Resultado da simulação">
            <div className="flex items-center gap-2 font-bold"><FlaskConical className="h-5 w-5" />SIMULAÇÃO — nada real foi gerado</div>
            {simulation.status === 'running' && <p>A simulação já está em andamento. Aguarde alguns instantes.</p>}
            {simulation.status === 'failed' && <p>Não foi possível concluir a simulação. A solicitação ficou com a equipe para análise.</p>}
            {simulation.status === 'success' && <>
              <p className="text-sm">No pedido real, este seria o fluxo automático. Aqui não houve nota, etiqueta nem envio de WhatsApp.</p>
              <div className="rounded-md bg-background p-3"><span className="block text-sm">Código fictício</span><strong className="text-lg tracking-wider">{simulation.code}</strong><span className="block text-sm">Validade simulada: {brDate(simulation.valid_until)}</span></div>
              <div className="text-sm space-y-1">
                <p><strong>Valor da nota simulada:</strong> {money(simulation.nfe?.valor_novo)}</p>
                <p><strong>Destinatário:</strong> {simulation.nfe?.destinatario?.nome || 'Confirmado na nota original'}</p>
                <p><strong>Origem dos dados:</strong> {simulation.nfe?.destinatario?.fonte === 'xml' ? 'XML da nota original' : simulation.nfe?.destinatario?.fonte || 'Nota original'}</p>
                {(simulation.nfe?.destinatario?.Municipio || simulation.nfe?.destinatario?.Uf) && <p><strong>Cidade/UF:</strong> {simulation.nfe?.destinatario?.Municipio || '—'}/{simulation.nfe?.destinatario?.Uf || '—'}</p>}
              </div>
              <div><p className="mb-1 text-sm font-semibold">Mensagem que seria enviada (não enviada):</p><Textarea readOnly aria-label="Mensagem simulada de WhatsApp" value={simulation.whatsapp_message || ''} className="min-h-56 bg-background text-xs" /></div>
            </>}
          </section>}
          {showExchangeOffer && <aside className="rounded-md border bg-muted p-4 text-sm">
            <strong>Antes de postar:</strong> se preferir trocar por outro tamanho ou modelo em vez de devolver, fale com a nossa equipe.
          </aside>}
          {context.progress.length > 0 && <section className="space-y-3"><h2 className="text-lg font-bold">Andamento</h2>
            {context.progress.map(p => <div key={p.id} className="space-y-1 rounded-md border p-4">
              {p.item_name && <p className="text-sm text-muted-foreground">{p.item_name}{p.item_size ? ` · ${p.item_size}` : ''}</p>}
              <p className="font-semibold">{labels[p.status] || 'Em acompanhamento'}</p>
              {p.reason && <p className="text-sm text-muted-foreground">{p.reason}</p>}
              {p.reverse_code ? <div className="mt-2 space-y-1 bg-primary/10 p-3">
                <p className="text-sm">Código de postagem:</p><p className="text-lg font-bold tracking-wider">{p.reverse_code}</p>
                <p className="text-sm">Coloque o produto em uma caixa (pode ser a original), embale bem e lacre. Leve a uma agência dos Correios e apresente este código. A postagem é gratuita.{p.reverse_valid_until ? ` Use até ${brDate(p.reverse_valid_until)}.` : ''}</p>
                <p className="text-sm font-medium">{p.type === 'troca' ? 'O envio da troca é feito em até 2 dias úteis após o recebimento do produto em nossa loja.' : 'O estorno da compra é feito em até 2 dias úteis após o recebimento do produto em nossa loja.'}</p>
              </div> : <p className="text-sm">Aguarde as orientações da nossa equipe para devolver o produto.</p>}
            </div>)}
          </section>}
          {!allBusy && <section className="space-y-5">
            {context.progress.length > 0 && <h2 className="text-lg font-bold">Solicitar para outro item</h2>}
            <div className="space-y-2"><label className="font-semibold" htmlFor="central-item">Qual produto?</label>
              <Select value={item} onValueChange={v => { setItem(v); setResult(null); setChosen(''); setQuantity(1); setStage(1); setOptions([]); setShowExchangeOffer(false); }}>
                <SelectTrigger id="central-item" className="h-auto min-h-10 text-left whitespace-normal"><SelectValue placeholder="Escolha um item do pedido" /></SelectTrigger>
                <SelectContent>{freeItems.map(i => <SelectItem key={i.id} value={i.id}>{i.name} · {i.size || 'Único'}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {overlap ? <div className="bg-muted p-4"><p className="font-bold">Este item já tem uma solicitação em andamento.</p><p>{labels[overlap.status] || 'Em acompanhamento'}</p></div> : <>
              <div className="space-y-2"><label className="font-semibold" htmlFor="central-reason">Por que deseja {type === 'troca' ? 'trocar' : 'devolver'}?</label>
                <Select value={reason} onValueChange={v => { setReason(v); setStage(1); setChosen(''); }}>
                  <SelectTrigger id="central-reason"><SelectValue placeholder="Escolha o motivo" /></SelectTrigger>
                  <SelectContent><SelectItem value="tamanho">O tamanho não ficou bom</SelectItem><SelectItem value="nao_gostou">Não gostei / arrependimento</SelectItem><SelectItem value="defeito">O produto tem defeito</SelectItem><SelectItem value="produto_errado">Recebi outro produto</SelectItem><SelectItem value="outro">Outro motivo</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><label htmlFor="central-detail" className="font-semibold">Conte um pouco mais</label><Textarea id="central-detail" maxLength={1000} value={detail} onChange={e => setDetail(e.target.value)} /></div>
              <div className="space-y-2"><label htmlFor="central-quantity" className="font-semibold">Quantidade</label><Input id="central-quantity" type="number" min={1} max={selected?.quantity || 1} value={quantity} onChange={e => setQuantity(Number(e.target.value))} className="w-24" /></div>
              <label className="flex items-start gap-3 text-sm"><Checkbox checked={unused} onCheckedChange={v => setUnused(v === true)} />O produto está sem uso, com etiquetas e embalagem original.</label>
              {context.requires_received_date && <div className="space-y-2"><label htmlFor="central-received-date" className="font-semibold">Em qual dia você recebeu o pedido?</label><Input id="central-received-date" type="date" required min={context.received_date_min || undefined} max={context.received_date_max || undefined} value={receivedDate} onChange={e => setReceivedDate(e.target.value)} /><p className="text-sm text-muted-foreground">Como a transportadora ainda não confirmou a entrega, vamos usar a data informada por você para conferir o prazo.</p></div>}
              {type === 'troca' && !choice && <div className="space-y-2"><label htmlFor="central-desired" className="font-semibold">Qual tamanho ou modelo você procura? (opcional)</label><Input id="central-desired" maxLength={200} value={desired} onChange={e => setDesired(e.target.value)} placeholder="Ex.: número 37, mesma cor" /><p className="text-sm text-muted-foreground">Nossa equipe vai escolher e separar o produto pra você.</p></div>}
              {choice && stage === 1 && <Button disabled={!valid || busy} onClick={() => loadOptions()} className="w-full">Ver outras numerações<ArrowRight className="ml-2 h-4 w-4" /></Button>}
              {type === 'troca' && stage === 2 && <div className="space-y-4">
                <h2 className="text-lg font-bold">{optionQuery ? 'Outras opções' : 'Outras numerações do mesmo produto'}</h2>
                {!options.length && <p>Nenhuma opção encontrada. Você pode pedir ajuda à equipe.</p>}
                <div className="space-y-2">{options.map(o => <Button key={o.id} variant={chosen === o.id ? 'default' : 'outline'} className="h-auto w-full justify-start gap-3 py-3 text-left whitespace-normal" onClick={() => setChosen(o.id)}>
                  {o.image_url ? <img src={o.image_url} alt="" className="h-14 w-14 shrink-0 rounded-md object-contain" /> : <Package className="h-6 w-6 shrink-0" />}
                  <span className="min-w-0 break-words"><strong className="block">{o.name}</strong><span className="block">{o.color} · {o.size || 'Único'} · {o.in_stock ? 'Disponível' : 'Sob conferência da equipe'}</span></span>
                </Button>)}</div>
                <form className="flex gap-2" onSubmit={e => { e.preventDefault(); if (search.trim().length >= 3) loadOptions(search.trim()); }}><Input aria-label="Buscar outro produto" placeholder="Buscar outro produto" value={search} onChange={e => setSearch(e.target.value)} /><Button type="submit" variant="outline" disabled={busy || search.trim().length < 3}>Buscar</Button></form>
                <div className="flex gap-2"><Button variant="outline" disabled={busy || offset === 0} onClick={() => loadOptions(optionQuery, Math.max(0, offset - 50))}>Anterior</Button><Button variant="outline" disabled={busy || options.length < 50} onClick={() => loadOptions(optionQuery, offset + 50)}>Mais opções</Button></div>
                <Button variant="outline" disabled={busy || !valid} onClick={() => submit('')}>Prefiro ajuda de um atendente</Button>
              </div>}
              {(type === 'devolucao' || !choice || stage === 2 && chosen) && <Button className="w-full" disabled={!valid || busy} onClick={() => submit()}>{busy ? 'Enviando…' : 'Enviar solicitação'}</Button>}
            </>}
          </section>}
        </>}
      </>}
    </main>
  </div>;
}
