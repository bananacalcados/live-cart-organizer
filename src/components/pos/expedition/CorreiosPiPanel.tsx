import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2, RefreshCw, MessageSquarePlus, RotateCcw, List, ChevronLeft, ChevronRight } from 'lucide-react';
import { freightCall, freightDate } from '@/lib/saleFreight';
import { toast } from 'sonner';

interface Pi {
  id: string; sale_id: string; codigo_objeto: string; motivo_descricao: string;
  status: string; protocolo: string | null; opened_at: string; last_checked_at: string | null;
  resposta_texto: string | null; error_message: string | null; pos_sales?: { customer_name: string | null } | null;
}
interface PiPage { requests: Pi[]; has_more: boolean; own_object: string | null }
const FN = 'correios-pedido-informacao';
const statusNames: Record<string, string> = { aberto: 'Aberto', respondido: 'Respondido', reativado: 'Reativado', encerrado: 'Encerrado', erro: 'Erro na abertura' };
const motives = [['211', 'Objeto não entregue'], ['135', 'Entregue com atraso'], ['132', 'Entregue em local divergente'], ['133', 'Objeto violado'], ['134', 'Objeto avariado'], ['136', 'Devolvido indevidamente']];
const date = (v: string | null) => v ? freightDate(v) : '—';

function PiDetail({ pi, onChanged }: { pi: Pi; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false), [text, setText] = useState(''), [reactivating, setReactivating] = useState(false);
  const run = async (body: unknown) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await freightCall<{ ok?: boolean; message?: string; results?: { ok: boolean; message?: string; error?: string }[] }>(FN, body);
      const rejected = result.results?.find(r => !r.ok);
      if (result.ok === false || rejected) throw new Error(rejected?.message || rejected?.error || result.message || 'Os Correios não confirmaram a operação');
      setReactivating(false); setText('');
      toast.success('Chamado atualizado');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Falha ao consultar chamado'); }
    finally { await onChanged(); setBusy(false); }
  };
  return <div className="space-y-2 text-sm min-w-0">
    <div className="flex gap-2 flex-wrap items-center"><Badge variant="secondary">{statusNames[pi.status] || pi.status}</Badge><span className="font-semibold break-all">{pi.codigo_objeto}</span></div>
    <p className="break-words">{pi.motivo_descricao} · Protocolo: <b>{pi.protocolo || 'Ainda não confirmado'}</b></p>
    <p className="text-muted-foreground">Abertura: {date(pi.opened_at)}<br />Última consulta: {date(pi.last_checked_at)}</p>
    {pi.resposta_texto && <p className="whitespace-pre-wrap break-words">{pi.resposta_texto}</p>}
    {pi.error_message && <p role="alert" className="text-destructive break-words">{pi.error_message}</p>}
    <div className="flex gap-2 flex-wrap">
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void run({ action: 'check', id: pi.id })}>{busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}Atualizar</Button>
      {pi.protocolo && ['respondido', 'encerrado'].includes(pi.status) && <Button size="sm" variant="outline" disabled={busy} onClick={() => setReactivating(v => !v)}><RotateCcw className="h-4 w-4 mr-2" />Reativar</Button>}
    </div>
    {reactivating && <div className="space-y-2"><Textarea aria-label="Motivo da reativação" value={text} maxLength={4000} onChange={e => setText(e.target.value)} placeholder="Por que o chamado precisa ser reativado?" /><Button disabled={busy || text.trim().length < 3} onClick={() => void run({ action: 'reactivate', id: pi.id, texto: text })}><RotateCcw className="h-4 w-4 mr-2" />Confirmar reativação</Button></div>}
  </div>;
}

function PiList() {
  const [page, setPage] = useState(0), [items, setItems] = useState<Pi[]>([]), [more, setMore] = useState(false), [busy, setBusy] = useState(true), [error, setError] = useState(''), [expanded, setExpanded] = useState<string | null>(null);
  const load = async (offset: number) => {
    setBusy(true); setError('');
    try { const r = await freightCall<PiPage>(FN, { action: 'list', limit: 50, offset }); setItems(r.requests); setMore(r.has_more); }
    catch (e) { setError(e instanceof Error ? e.message : 'Falha ao listar chamados'); }
    finally { setBusy(false); }
  };
  useEffect(() => { let alive = true; setBusy(true); setError('');
    void freightCall<PiPage>(FN, { action: 'list', limit: 50, offset: page * 50 }).then(r => { if (alive) { setItems(r.requests); setMore(r.has_more); } }).catch(e => { if (alive) setError(e instanceof Error ? e.message : 'Falha ao listar chamados'); }).finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [page]);
  return <div className="space-y-3 min-w-0">
    {error && <p role="alert" className="text-destructive break-words">{error}</p>}
    {busy && <Loader2 className="h-5 w-5 animate-spin" aria-label="Carregando chamados" />}
    {!busy && !error && !items.length && <p className="text-muted-foreground">Nenhum chamado registrado.</p>}
    {items.map(pi => <div key={pi.id} className="border-b border-border py-3 space-y-2 min-w-0">
      <Button variant="ghost" className="h-auto w-full text-left justify-start whitespace-normal" onClick={() => setExpanded(v => v === pi.id ? null : pi.id)}><span className="min-w-0 break-words"><b>{pi.pos_sales?.customer_name || 'Cliente'}</b> · {pi.codigo_objeto}<br />{pi.motivo_descricao} · {statusNames[pi.status]}</span></Button>
      {expanded === pi.id ? <PiDetail pi={pi} onChanged={() => load(page * 50)} /> : pi.resposta_texto && <p className="text-sm whitespace-pre-wrap break-words">{pi.resposta_texto}</p>}
    </div>)}
    <div className="flex items-center justify-between gap-2"><Button variant="outline" size="icon" title="Página anterior" aria-label="Página anterior" disabled={busy || page === 0} onClick={() => setPage(v => v - 1)}><ChevronLeft className="h-4 w-4" /></Button><span className="text-sm">Página {page + 1}</span><Button variant="outline" size="icon" title="Próxima página" aria-label="Próxima página" disabled={busy || !more} onClick={() => setPage(v => v + 1)}><ChevronRight className="h-4 w-4" /></Button></div>
  </div>;
}

export function CorreiosPiPanel({ saleId }: { saleId: string }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [items, setItems] = useState<Pi[]>([]), [own, setOwn] = useState<string | null>(null), [busy, setBusy] = useState(true), [error, setError] = useState(''), [opening, setOpening] = useState(false), [reason, setReason] = useState('211'), [listOpen, setListOpen] = useState(false);
  const load = async () => {
    const r = await freightCall<PiPage>(FN, { action: 'list', sale_id: saleId, limit: 50, offset: 0 });
    setItems(r.requests); setOwn(r.own_object);
  };
  useEffect(() => { let alive = true; setBusy(true); setError('');
    void freightCall<PiPage>(FN, { action: 'list', sale_id: saleId, limit: 50, offset: 0 }).then(r => { if (alive) { setItems(r.requests); setOwn(r.own_object); } }).catch(e => { if (alive) setError(e instanceof Error ? e.message : 'Falha ao consultar chamados'); }).finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [saleId]);
  const open = async () => {
    if (busy || !own) return;
    setBusy(true); setError('');
    try {
      const r = await freightCall<{ ok: boolean; message: string }>(FN, { action: 'open', sale_id: saleId, codigo_objeto: own, motivo_codigo: Number(reason), tipo_manifestacao: 'R' });
      if (!r.ok) throw new Error(r.message || 'Os Correios não confirmaram a abertura');
      setOpening(false); toast.success('Chamado aberto nos Correios');
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao abrir chamado'); }
    finally { try { await load(); } catch { /* Keep the action error visible. */ } setBusy(false); }
  };
  if (!busy && !error && !own) return null;
  const active = items.find(p => ['aberto', 'respondido', 'reativado'].includes(p.status));
  const current = active || items[0];
  const content = <section aria-label="Chamado nos Correios" className="border-t border-border pt-3 space-y-3 min-w-0">
    <div className="flex justify-between items-center flex-wrap gap-2"><h4 className="font-semibold">Chamado nos Correios</h4><Button variant="outline" size="sm" onClick={() => setListOpen(true)}><List className="h-4 w-4 mr-2" />Chamados Correios</Button></div>
    {busy && <Loader2 aria-label="Carregando chamado" className="h-4 w-4 animate-spin" />}
    {error && <p role="alert" className="text-sm text-destructive break-words">{error}</p>}
    {current && <PiDetail pi={current} onChanged={load} />}
    {!active && own && !opening && <Button disabled={busy} onClick={() => setOpening(true)}><MessageSquarePlus className="h-4 w-4 mr-2" />Abrir chamado</Button>}
    {opening && !active && <div className="space-y-2"><Select value={reason} onValueChange={setReason}><SelectTrigger aria-label="Motivo do chamado"><SelectValue /></SelectTrigger><SelectContent>{motives.map(([value,label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select><div className="flex gap-2 flex-wrap"><Button disabled={busy} onClick={() => void open()}><MessageSquarePlus className="h-4 w-4 mr-2" />Confirmar abertura</Button><Button variant="outline" disabled={busy} onClick={() => setOpening(false)}>Cancelar</Button></div></div>}
  </section>;
  return <>
    <div className="hidden md:block">{content}</div>
    <Button className="md:hidden" variant="outline" onClick={() => setMobileOpen(true)}><MessageSquarePlus className="h-4 w-4 mr-2" />Chamado nos Correios</Button>
    <Dialog open={mobileOpen} onOpenChange={setMobileOpen}><DialogContent className="max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle>Chamado nos Correios</DialogTitle></DialogHeader>{mobileOpen && content}</DialogContent></Dialog>
    <Dialog open={listOpen} onOpenChange={setListOpen}><DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle>Chamados Correios</DialogTitle></DialogHeader>{listOpen && <PiList />}</DialogContent></Dialog>
  </>;
}