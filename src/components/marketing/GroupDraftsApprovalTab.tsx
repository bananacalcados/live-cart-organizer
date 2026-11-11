import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { CheckCircle, Clock, Loader2, Pencil, RefreshCw, Trash2, Unlink, Upload, XCircle, AlertTriangle, BarChart2, Contact } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  DRAFT_REASON_LABELS, buildApproval, copyState, defaultChecked, defaultEditCampaigns, isPast, sanitizePatch, validatePatch,
  type DraftBlock, type DraftCard,
} from "@/lib/marketing/groupDraftCards";
import { summarizeByCampaign, type SyncApproveRow } from "@/lib/marketing/groupDraftSync";

const PAGE = 50;
const rpc = (fn: string, args: Record<string, unknown>) => (supabase as any).rpc(fn, args);
const fmtTime = (s: string | null) => s ? new Date(s).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'sem horário';
const reasonLabel = (r: string) => DRAFT_REASON_LABELS[r] || r;
const MEDIA = ['image', 'video', 'audio', 'document'];

function BlockPreview({ b, onEdit, onMedia, busy }: { b: DraftBlock; onEdit: () => void; onMedia: () => void; busy: boolean }) {
  return (
    <div className="rounded-md border bg-muted/30 p-2 text-xs space-y-1">
      <div className="flex items-center gap-1">
        <Badge variant="outline" className="text-[10px]">Bloco {b.block_order + 1} · {b.message_type}</Badge>
        {b.mention_all && <Badge variant="secondary" className="text-[10px]">marcar todos</Badge>}
        <div className="ml-auto flex gap-1">
          {MEDIA.includes(b.message_type) && (
            <Button size="sm" variant="ghost" className="h-6 px-2" onClick={onMedia} disabled={busy}>
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}<span className="ml-1">Trocar mídia</span>
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-6 px-2" onClick={onEdit}><Pencil className="h-3 w-3" /></Button>
        </div>
      </div>
      {MEDIA.includes(b.message_type) && (b.media_url
        ? (b.message_type === 'image' ? <img src={b.media_url} alt="" className="h-24 rounded object-cover" loading="lazy" /> : <a href={b.media_url} target="_blank" rel="noreferrer" className="underline">ver arquivo</a>)
        : <div className="text-destructive font-medium">Sem mídia</div>)}
      {b.message_type === 'poll' && <div className="flex items-center gap-1"><BarChart2 className="h-3 w-3" />{(b.poll_options || []).join(' · ') || 'sem opções'}</div>}
      {b.message_type === 'contact' && <div className="flex items-center gap-1"><Contact className="h-3 w-3" />{b.contact_name || '—'} {b.contact_phone || 'sem número'}</div>}
      {b.message_content && <p className="whitespace-pre-wrap line-clamp-6">{b.message_content}</p>}
    </div>
  );
}

export function GroupDraftsApprovalTab() {
  const [cards, setCards] = useState<DraftCard[]>([]);
  const [total, setTotal] = useState(0);
  const [batches, setBatches] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [batch, setBatch] = useState('all');
  const [status, setStatus] = useState('all');
  const [day, setDay] = useState('');
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [approve, setApprove] = useState<DraftCard[] | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [pastOk, setPastOk] = useState(false);
  const [working, setWorking] = useState(false);
  const [edit, setEdit] = useState<{ card: DraftCard; block: DraftBlock } | null>(null);
  const [mediaFor, setMediaFor] = useState<{ card: DraftCard; block: DraftBlock } | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<DraftCard[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (offset: number) => {
    setLoading(true);
    const { data, error } = await rpc('group_draft_cards', {
      p_batch: batch === 'all' ? null : batch, p_status: status === 'all' ? null : status,
      p_day: day || null, p_limit: PAGE, p_offset: offset,
    });
    setLoading(false);
    if (error) { toast.error(error.message.includes('forbidden') ? 'Sem permissão para ver a aprovação' : error.message); return; }
    const next = (data?.cards || []) as DraftCard[];
    setCards(prev => offset === 0 ? next : [...prev, ...next]);
    setTotal(data?.total || 0);
    setBatches(data?.batches || []);
    if (offset === 0) setSelected({});
  }, [batch, status, day]);

  useEffect(() => { load(0); }, [load]);

  const openApprove = (list: DraftCard[]) => {
    const ch: Record<string, boolean> = {};
    list.forEach(c => c.copies.forEach(cp => { ch[cp.id] = defaultChecked(cp); }));
    setChecked(ch); setPastOk(false); setApprove(list);
  };

  const pastChecked = (approve || []).flatMap(c => c.copies).filter(cp => checked[cp.id] && !cp.reason && isPast(cp));

  const doApprove = async () => {
    if (!approve) return;
    const calls = approve.map(c => buildApproval(c, checked)).filter(Boolean) as { anchor: string; siblings: string[] }[];
    if (calls.length === 0) { toast.error('Nenhuma cópia marcada'); return; }
    setWorking(true);
    const { data, error } = await rpc('approve_group_drafts_synced', {
      p_anchor_ids: calls.map(c => c.anchor), p_sibling_ids: calls.flatMap(c => c.siblings), p_approved_by: 'usuario',
    });
    setWorking(false);
    if (error) { toast.error(error.message); return; }
    const names: Record<string, string> = {};
    approve.forEach(c => c.copies.forEach(cp => { names[cp.campaign_id] = cp.campaign_name || 'Campanha'; }));
    const summary = summarizeByCampaign((data || []) as SyncApproveRow[]);
    const lines = Array.from(summary.entries()).map(([cid, v]) =>
      `${names[cid] || 'Campanha'}: ${v.ok} aprovada(s)${v.blocked.length ? `, ${v.blocked.length} bloqueada(s) (${v.blocked.map(reasonLabel).join('; ')})` : ''}`);
    const anyBlocked = Array.from(summary.values()).some(v => v.blocked.length > 0);
    (anyBlocked ? toast.warning : toast.success)(lines.join(' · ') || 'Nada aprovado', { duration: 10000 });
    setApprove(null);
    load(0);
  };

  const applyPatch = async (card: DraftCard, block: DraftBlock, patch: Record<string, unknown>, campaigns: string[]) => {
    const clean = sanitizePatch(patch);
    const bad = validatePatch(block, clean);
    if (bad) { toast.error(reasonLabel(bad)); return false; }
    const { data, error } = await rpc('update_group_drafts_synced', { p_block_id: block.id, p_patch: clean, p_only_ids: campaigns });
    if (error) { toast.error(error.message); return false; }
    const rows = (data || []) as { campaign_id: string; ok: boolean; reason: string }[];
    const names: Record<string, string> = {};
    card.copies.forEach(cp => { names[cp.campaign_id] = cp.campaign_name || 'Campanha'; });
    const okN = rows.filter(r => r.ok && r.reason === 'ok').length;
    const fail = rows.filter(r => !r.ok);
    if (fail.length) toast.warning(`${okN} cópia(s) alterada(s). Não alteradas: ${fail.map(f => `${names[f.campaign_id] || 'cópia'} (${reasonLabel(f.reason)})`).join('; ')}`, { duration: 10000 });
    else toast.success(`${okN} cópia(s) alterada(s)`);
    load(0);
    return true;
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = '';
    const target = mediaFor; setMediaFor(null);
    if (!file || !target) return;
    const { getMaxSizeForType, getMaxSizeLabel, getMediaTypeLabel } = await import('@/constants/mediaLimits');
    if (file.size > getMaxSizeForType(file.type)) { toast.error(`${getMediaTypeLabel(file.type)} muito grande. O limite é ${getMaxSizeLabel(file.type)}.`); return; }
    setUploadingId(target.block.id);
    try {
      const ext = file.name.split('.').pop();
      const path = `group-messages/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage.from('marketing-attachments').upload(path, file, { contentType: file.type });
      if (error) throw error;
      const url = supabase.storage.from('marketing-attachments').getPublicUrl(path).data.publicUrl;
      await applyPatch(target.card, target.block, { media_url: url }, target.card.copies.map(c => c.campaign_id));
    } catch (err: any) { toast.error(err.message || 'Erro ao subir mídia'); }
    finally { setUploadingId(null); }
  };

  const unlink = async (copyId: string) => {
    const { data, error } = await rpc('unlink_group_draft', { p_id: copyId });
    if (error || !data) { toast.error(error?.message || 'Não foi possível desvincular (já não é rascunho)'); return; }
    toast.success('Cópia desvinculada'); load(0);
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    setWorking(true);
    const ids = confirmDelete.flatMap(c => c.copies.map(cp => cp.id));
    const { data, error } = await rpc('delete_group_drafts', { p_ids: ids });
    setWorking(false); setConfirmDelete(null);
    if (error) { toast.error(error.message); return; }
    toast.success(`${data || 0} rascunho(s) excluído(s)`); load(0);
  };

  const selectedCards = cards.filter(c => selected[c.card_key]);

  return (
    <div className="space-y-3">
      <input ref={fileRef} type="file" className="hidden" accept="image/*,video/*,audio/*,application/pdf" onChange={onFile} />
      <div className="flex flex-wrap items-end gap-2">
        <div><Label className="text-xs">Lote</Label>
          <Select value={batch} onValueChange={setBatch}><SelectTrigger className="h-8 w-56"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">Todos os lotes</SelectItem>{batches.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent></Select></div>
        <div><Label className="text-xs">Status</Label>
          <Select value={status} onValueChange={setStatus}><SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem><SelectItem value="ready">Prontos</SelectItem>
              <SelectItem value="blocked">Bloqueados</SelectItem><SelectItem value="differs">Conteúdo diferente</SelectItem>
              <SelectItem value="past">Horário passado</SelectItem>
            </SelectContent></Select></div>
        <div><Label className="text-xs">Dia</Label><Input type="date" className="h-8 w-40" value={day} onChange={e => setDay(e.target.value)} /></div>
        <Button size="sm" variant="outline" onClick={() => load(0)} disabled={loading}><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /><span className="ml-1">Atualizar</span></Button>
        <div className="ml-auto flex gap-2 items-center">
          <span className="text-xs text-muted-foreground">{total} mensagem(ns)</span>
          <Button size="sm" variant="ghost" onClick={() => { const s: Record<string, boolean> = {}; cards.forEach(c => { s[c.card_key] = true; }); setSelected(s); }}>Marcar todos da página</Button>
          {status === 'past' && <Button size="sm" variant="destructive" disabled={!selectedCards.length} onClick={() => setConfirmDelete(selectedCards)}><Trash2 className="h-3.5 w-3.5 mr-1" />Excluir selecionados</Button>}
          <Button size="sm" disabled={!selectedCards.length} onClick={() => openApprove(selectedCards)}><CheckCircle className="h-3.5 w-3.5 mr-1" />Aprovar selecionados ({selectedCards.length})</Button>
        </div>
      </div>

      {cards.length === 0 && !loading && <p className="text-sm text-muted-foreground py-8 text-center">Nenhum rascunho com esses filtros.</p>}

      {cards.map(card => (
        <Card key={card.card_key}>
          <CardContent className="p-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Checkbox checked={!!selected[card.card_key]} onCheckedChange={v => setSelected(s => ({ ...s, [card.card_key]: !!v }))} />
              {card.draft_batch && <Badge variant="outline">{card.draft_batch}</Badge>}
              <Badge variant="secondary">{card.created_by?.toLowerCase().includes('claude') ? 'Claude' : (card.created_by || 'Equipe')}</Badge>
              {card.copies.some(c => c.content_differs) && <Badge variant="outline" className="border-warning text-warning"><AlertTriangle className="h-3 w-3 mr-1" />conteúdo diferente</Badge>}
              <div className="ml-auto flex gap-1">
                {status === 'past' && <Button size="sm" variant="ghost" onClick={() => setConfirmDelete([card])}><Trash2 className="h-3.5 w-3.5" /></Button>}
                <Button size="sm" onClick={() => openApprove([card])}><CheckCircle className="h-3.5 w-3.5 mr-1" />Aprovar</Button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              {card.copies.map(cp => {
                const st = copyState(cp); const past = isPast(cp);
                return (
                  <DropdownMenu key={cp.id}>
                    <DropdownMenuTrigger asChild>
                      <button className={`text-xs rounded-full border px-2 py-0.5 flex items-center gap-1 ${st === 'blocked' ? 'border-destructive text-destructive' : st === 'differs' ? 'border-warning text-warning' : 'border-primary/40 text-foreground'}`}>
                        {st === 'blocked' ? <XCircle className="h-3 w-3" /> : <CheckCircle className="h-3 w-3" />}
                        {cp.campaign_name || 'Campanha'} {fmtTime(cp.scheduled_at)} · {st === 'blocked' ? reasonLabel(cp.reason!) : st === 'differs' ? 'conteúdo diferente' : 'pronta'}
                        {past && <span className="flex items-center gap-0.5 text-muted-foreground"><Clock className="h-3 w-3" />passado</span>}
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem disabled={card.copies.length < 2} onClick={() => unlink(cp.id)}><Unlink className="h-3.5 w-3.5 mr-2" />Desvincular desta mensagem</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                );
              })}
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {(card.blocks || []).map(b => (
                <BlockPreview key={b.id} b={b} busy={uploadingId === b.id}
                  onEdit={() => setEdit({ card, block: b })}
                  onMedia={() => { setMediaFor({ card, block: b }); fileRef.current?.click(); }} />
              ))}
            </div>
          </CardContent>
        </Card>
      ))}

      {cards.length < total && (
        <div className="text-center"><Button variant="outline" size="sm" disabled={loading} onClick={() => load(cards.length)}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Carregar mais'}</Button></div>
      )}

      {/* Aprovação */}
      <Dialog open={!!approve} onOpenChange={o => !o && setApprove(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Aprovar {approve?.length} mensagem(ns)</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {(approve || []).map(card => (
              <div key={card.card_key} className="rounded border p-2 space-y-1">
                <p className="text-xs line-clamp-2 text-muted-foreground">{card.blocks?.find(b => b.message_content)?.message_content || card.blocks?.[0]?.message_type}</p>
                {card.copies.map(cp => (
                  <label key={cp.id} className="flex items-center gap-2 text-sm">
                    {cp.reason ? <XCircle className="h-4 w-4 text-destructive" /> :
                      <Checkbox checked={!!checked[cp.id]} onCheckedChange={v => setChecked(s => ({ ...s, [cp.id]: !!v }))} />}
                    <span>{cp.campaign_name || 'Campanha'} · {fmtTime(cp.scheduled_at)}</span>
                    {cp.reason && <span className="text-destructive text-xs">{reasonLabel(cp.reason)}</span>}
                    {!cp.reason && cp.content_differs && <span className="text-warning text-xs">conteúdo diferente</span>}
                    {isPast(cp) && <span className="text-muted-foreground text-xs">horário passado</span>}
                  </label>
                ))}
              </div>
            ))}
            {pastChecked.length > 0 && (
              <label className="flex items-start gap-2 rounded border border-warning p-2 text-sm">
                <Checkbox checked={pastOk} onCheckedChange={v => setPastOk(!!v)} />
                <span>Entendi: {pastChecked.length} cópia(s) com horário no passado serão enviadas assim que aprovadas.</span>
              </label>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApprove(null)}>Cancelar</Button>
            <Button disabled={working || (pastChecked.length > 0 && !pastOk)} onClick={doApprove}>
              {working && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Confirmar aprovação
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {edit && <EditBlockDialog card={edit.card} block={edit.block} onClose={() => setEdit(null)} onSave={applyPatch} />}

      <Dialog open={!!confirmDelete} onOpenChange={o => !o && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Excluir rascunhos</DialogTitle></DialogHeader>
          <p className="text-sm">Vai excluir {confirmDelete?.reduce((n, c) => n + c.copies.length, 0)} rascunho(s) (todas as cópias de {confirmDelete?.length} mensagem(ns)). Mensagens aprovadas ou enviadas não são tocadas.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancelar</Button>
            <Button variant="destructive" disabled={working} onClick={doDelete}>Excluir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EditBlockDialog({ card, block, onClose, onSave }: {
  card: DraftCard; block: DraftBlock; onClose: () => void;
  onSave: (card: DraftCard, block: DraftBlock, patch: Record<string, unknown>, campaigns: string[]) => Promise<boolean>;
}) {
  const [text, setText] = useState(block.message_content || '');
  const [poll, setPoll] = useState((block.poll_options || []).join('\n'));
  const [mention, setMention] = useState(!!block.mention_all);
  const [noPreview, setNoPreview] = useState(!!block.disable_link_preview);
  const [cName, setCName] = useState(block.contact_name || '');
  const [cPhone, setCPhone] = useState(block.contact_phone || '');
  const [camps, setCamps] = useState<Record<string, boolean>>(() => {
    const d = new Set(defaultEditCampaigns(card)); const o: Record<string, boolean> = {};
    card.copies.forEach(c => { o[c.campaign_id] = d.has(c.campaign_id); }); return o;
  });
  const [saving, setSaving] = useState(false);
  const chosen = Object.keys(camps).filter(k => camps[k]);

  const save = async () => {
    const patch: Record<string, unknown> = {};
    if (text !== (block.message_content || '')) patch.message_content = text;
    if (mention !== !!block.mention_all) patch.mention_all = mention;
    if (noPreview !== !!block.disable_link_preview) patch.disable_link_preview = noPreview;
    if (block.message_type === 'poll') {
      const opts = poll.split('\n').map(s => s.trim()).filter(Boolean);
      if (opts.join('\n') !== (block.poll_options || []).join('\n')) patch.poll_options = opts;
    }
    if (block.message_type === 'contact') {
      if (cName !== (block.contact_name || '')) patch.contact_name = cName;
      if (cPhone !== (block.contact_phone || '')) patch.contact_phone = cPhone;
    }
    if (!Object.keys(patch).length) { onClose(); return; }
    if (!chosen.length) { toast.error('Escolha ao menos uma campanha'); return; }
    setSaving(true);
    const ok = await onSave(card, block, patch, chosen);
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>Editar bloco {block.block_order + 1}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>{MEDIA.includes(block.message_type) ? 'Legenda' : 'Texto'}</Label><Textarea rows={6} value={text} onChange={e => setText(e.target.value)} /></div>
          {block.message_type === 'poll' && <div><Label>Opções da enquete (uma por linha)</Label><Textarea rows={4} value={poll} onChange={e => setPoll(e.target.value)} /></div>}
          {block.message_type === 'contact' && <div className="grid grid-cols-2 gap-2"><Input placeholder="Nome" value={cName} onChange={e => setCName(e.target.value)} /><Input placeholder="Telefone" value={cPhone} onChange={e => setCPhone(e.target.value)} /></div>}
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={mention} onCheckedChange={v => setMention(!!v)} />Marcar todos</label>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={noPreview} onCheckedChange={v => setNoPreview(!!v)} />Sem prévia de link</label>
          <div className="rounded border p-2 space-y-1">
            <p className="text-xs font-medium">Aplicar em ({chosen.length} cópia(s)):</p>
            {card.copies.map(c => (
              <label key={c.campaign_id} className="flex items-center gap-2 text-sm">
                <Checkbox checked={!!camps[c.campaign_id]} onCheckedChange={v => setCamps(s => ({ ...s, [c.campaign_id]: !!v }))} />
                {c.campaign_name || 'Campanha'} · {fmtTime(c.scheduled_at)}
                {c.content_differs && <span className="text-warning text-xs">conteúdo diferente</span>}
              </label>
            ))}
            <p className="text-[11px] text-muted-foreground">O horário de cada campanha não muda.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={saving} onClick={save}>{saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Salvar em {chosen.length} cópia(s)</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
