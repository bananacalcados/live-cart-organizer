import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, Printer, Copy, XCircle, Tag } from 'lucide-react';
import { toast } from 'sonner';
import { freightCall } from '@/lib/saleFreight';

export interface CorreiosShipment { id: string; codigo_objeto: string | null; servico_nome: string | null; status: string; error_message: string | null; combined_url?: string | null; label_url?: string | null; sale_ids?: string[] }
interface Summary { ok: boolean; problems: string[]; summary: { servico: string; price: number; package: { peso_g: number; c: number; l: number; a: number }; nfes: { numero: string; chave: string }[]; destinatario: { nome: string; endereco: Record<string, string> } } }
interface Props { saleId: string; refreshKey?: unknown; onTracking?: (code: string) => void }
const STATUS: Record<string, string> = { criada: 'Pré-postagem criada', rotulo_emitido: 'Etiqueta emitida', postada: 'Postada' };

export function ExpCorreiosShipmentPanel({ saleId, refreshKey, onTracking }: Props) {
  const [shipment, setShipment] = useState<CorreiosShipment | null>(null);
  const [correiosSelected, setCorreiosSelected] = useState(false);
  const [preview, setPreview] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [reason, setReason] = useState(''), [cancelOpen, setCancelOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    setPreview(null); setError('');
    Promise.all([
      supabase.from('correios_shipments').select('id,codigo_objeto,servico_nome,status,error_message,sale_ids').contains('sale_ids', [saleId]).not('status', 'in', '(cancelada,erro)').order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('sale_freight_quotes').select('selected_option').contains('sale_ids', [saleId]).order('quoted_at', { ascending: false }).order('id', { ascending: false }).limit(1).maybeSingle(),
    ]).then(([s, q]) => {
      if (!alive) return;
      setShipment((s.data as CorreiosShipment) || null);
      setCorreiosSelected((q.data?.selected_option as any)?.source === 'correios');
    });
    return () => { alive = false; };
  }, [saleId, refreshKey]);

  const run = async <T,>(fn: () => Promise<T>) => { if (busy) return; setBusy(true); setError(''); try { return await fn(); } catch (e) { setError(e instanceof Error ? e.message : 'Falha'); } finally { setBusy(false); } };
  const apply = (s: CorreiosShipment) => { setShipment(s); if (s.codigo_objeto) onTracking?.(s.codigo_objeto); if (s.error_message) setError(s.error_message); };
  const openPreview = () => run(async () => setPreview(await freightCall<Summary>('correios-shipment', { action: 'create', sale_id: saleId, dry_run: true })));
  const create = () => run(async () => { const r = await freightCall<{ shipment: CorreiosShipment }>('correios-shipment', { action: 'create', sale_id: saleId }); setPreview(null); apply(r.shipment); if (r.shipment.codigo_objeto) toast.success('Etiqueta Correios gerada'); });
  const open = (kind: 'combined_url' | 'label_url') => run(async () => {
    const r = await freightCall<{ shipment: CorreiosShipment }>('correios-shipment', { action: 'label', shipment_id: shipment!.id });
    apply(r.shipment);
    const url = r.shipment[kind];
    if (url) window.open(url, '_blank', 'noopener'); else setError('PDF ainda não disponível');
  });
  const cancel = () => run(async () => { const r = await freightCall<{ shipment: CorreiosShipment }>('correios-shipment', { action: 'cancel', shipment_id: shipment!.id, reason }); setShipment(null); setCancelOpen(false); setReason(''); toast.success(r.shipment.status === 'cancelada' ? 'Pré-postagem cancelada' : 'Atualizado'); });

  if (!shipment && !correiosSelected) return null;
  return <div className="space-y-3 rounded-md border border-border p-3">
    <p className="font-bold flex items-center gap-2"><Tag className="h-4 w-4" />Correios (contrato)</p>
    {error && <p role="alert" className="text-sm text-destructive break-words">{error}</p>}
    {!shipment && !preview && <Button onClick={openPreview} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Tag className="h-4 w-4 mr-2" />}Gerar etiqueta Correios</Button>}
    {!shipment && preview && <div className="space-y-2 text-sm">
      <p><b>Serviço:</b> {preview.summary.servico} · {Number(preview.summary.price).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
      <p><b>Pacote:</b> {preview.summary.package.peso_g} g · {preview.summary.package.c}×{preview.summary.package.l}×{preview.summary.package.a} cm</p>
      <p><b>Destinatário:</b> {preview.summary.destinatario.nome} — {Object.values(preview.summary.destinatario.endereco).filter(Boolean).join(', ')}</p>
      <p><b>NF-e:</b> {preview.summary.nfes.length ? preview.summary.nfes.map((n) => `Nº ${n.numero}`).join(', ') : 'nenhuma encontrada'}</p>
      {preview.problems.map((p) => <p key={p} role="alert" className="text-destructive break-words">{p}</p>)}
      <div className="flex flex-wrap gap-2"><Button onClick={create} disabled={busy || !preview.ok}>{busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Confirmar e gerar</Button><Button variant="outline" onClick={() => setPreview(null)} disabled={busy}>Voltar</Button></div>
    </div>}
    {shipment && <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2"><Badge variant="secondary">{STATUS[shipment.status] || shipment.status}</Badge>{shipment.servico_nome && <Badge variant="outline">{shipment.servico_nome}</Badge>}
        {shipment.codigo_objeto && <Button size="sm" variant="outline" onClick={() => { void navigator.clipboard.writeText(shipment.codigo_objeto!); toast.success('Código copiado'); }}><Copy className="h-3.5 w-3.5 mr-1" />{shipment.codigo_objeto}</Button>}</div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => open('combined_url')} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Printer className="h-4 w-4 mr-2" />}{shipment.status === 'criada' ? 'Emitir e imprimir etiqueta + DANFE' : 'Imprimir etiqueta + DANFE'}</Button>
        <Button variant="outline" onClick={() => open('label_url')} disabled={busy}>Só rótulo</Button>
        {shipment.status !== 'postada' && <Button variant="outline" onClick={() => setCancelOpen((v) => !v)} disabled={busy}><XCircle className="h-4 w-4 mr-2" />Cancelar pré-postagem</Button>}
      </div>
      {cancelOpen && <div className="flex flex-wrap gap-2"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo do cancelamento" className="max-w-sm" /><Button variant="destructive" onClick={cancel} disabled={busy || reason.trim().length < 3}>Confirmar cancelamento</Button></div>}
    </div>}
  </div>;
}
