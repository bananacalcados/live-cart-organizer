// Treino do agente: o dono revisa, uma a uma, as conversas reais que a IA leu (nada foi enviado nem movido).
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { deskCall } from "./api";
import { ACTION, ETAPA, TRIAGE } from "./AutoSuggestionsPanel";

interface Item {
  id: string; phone: string; channel: string; instance_name: string | null; last_incoming_at: string | null; customer_name: string | null;
  conversation: { from: string; text: string; at: string; instance?: string }[] | null; triage_category: string | null; triage_confidence: number | null;
  triage: { justificativa?: string } | null; agent_text: string | null; agent_actions: { acao: string; pedido: unknown; resultado: unknown }[] | null;
  decision: string | null; reason: string | null; handoff_summary: string | null; would_route_support: boolean | null;
  tracking_info: { etapa?: string; enviado_em?: string | null; url?: string | null } | null;
  review_class_ok: boolean | null; review_correct_category: string | null; review_reply_ok: boolean | null; review_comment: string | null; review_ideal_reply: string | null; reviewed_at: string | null;
  replay_status?: string | null; replay_result?: { decision?: string; agent_text?: string; link_type?: string; triage_category?: string; conversation?: Item["conversation"]; other_instances?: { id: string; label: string }[]; cpf_different_phone?: boolean; tokens_in?: number; tokens_out?: number; review?: { class_ok?: boolean | null; correct_category?: string | null; reply_ok?: boolean | null; comment?: string | null; ideal_reply?: string | null; at?: string | null } } | null;
}
interface Stats { total: number; ok: number; erro: number; pendente: number; por_tipo: Record<string, number>; suporte: number; amostra: number; revisadas: number; class_ok: number; class_err: number; reply_ok: number; reply_err: number }
const DECISION: Record<string, string> = { enviar_link: "Mandar link", presencial: "Compra na loja", fila: "Passar para pessoa", conversa: "Seguir conversa", consolidar_em_outra_instancia: "Manter no outro número" };
interface Comparison { before: Record<string, number>; after: Record<string, number>; pending: number; tokens_in: number; tokens_out: number }
const pct = (a: number, b: number) => (a + b ? `${Math.round((a / (a + b)) * 100)}%` : "—");

function Review({ it, onSaved }: { it: Item; onSaved: () => void }) {
  const [classOk, setClassOk] = useState<boolean | null>(it.review_class_ok);
  const [correct, setCorrect] = useState(it.review_correct_category || "");
  const [replyOk, setReplyOk] = useState<boolean | null>(it.review_reply_ok);
  const [comment, setComment] = useState(it.review_comment || "");
  const [ideal, setIdeal] = useState(it.review_ideal_reply || "");
  const [busy, setBusy] = useState(false);
  const hasReply = !!it.agent_text;
  const save = async () => {
    if (classOk === null) { toast.error("Marque se a classificação está certa"); return; }
    if (classOk === false && !correct) { toast.error("Escolha a classificação certa"); return; }
    if (hasReply && replyOk === null) { toast.error("Marque se a resposta está aprovada"); return; }
    setBusy(true);
    try {
      await deskCall(it.replay_result ? "support_training_replay_review" : "support_training_review", { p_id: it.id, p_class_ok: classOk, p_correct_category: classOk ? null : correct, p_reply_ok: hasReply ? replyOk : null, p_comment: comment, p_ideal_reply: ideal });
      toast.success("Revisão salva"); onSaved();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-2 border-t pt-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>Classificação:</span>
        <Button size="sm" variant={classOk === true ? "default" : "outline"} onClick={() => setClassOk(true)}>Certa</Button>
        <Button size="sm" variant={classOk === false ? "destructive" : "outline"} onClick={() => setClassOk(false)}>Errada</Button>
        {classOk === false && (
          <Select value={correct} onValueChange={setCorrect}>
            <SelectTrigger className="w-52 h-9"><SelectValue placeholder="Qual é a certa?" /></SelectTrigger>
            <SelectContent>{Object.entries(TRIAGE).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
          </Select>
        )}
      </div>
      {hasReply && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>Resposta:</span>
          <Button size="sm" variant={replyOk === true ? "default" : "outline"} onClick={() => setReplyOk(true)}>Aprovada</Button>
          <Button size="sm" variant={replyOk === false ? "destructive" : "outline"} onClick={() => setReplyOk(false)}>Reprovada</Button>
        </div>
      )}
      <Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Comentário (opcional)" />
      <Textarea rows={2} value={ideal} onChange={(e) => setIdeal(e.target.value)} placeholder="Resposta ideal (opcional — vira exemplo para o roteiro)" />
      <Button size="sm" disabled={busy} onClick={save}>{it.reviewed_at ? "Atualizar revisão" : "Salvar revisão"}</Button>
    </div>
  );
}

function ItemCard({ it, onSaved }: { it: Item; onSaved: () => void }) {
  return (
    <div className="rounded-lg border bg-card p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{TRIAGE[it.triage_category || ""] || it.triage_category || "—"}</Badge>
        {it.triage_confidence != null && <span className="text-xs">{Math.round(Number(it.triage_confidence) * 100)}%</span>}
        {it.decision && <Badge variant="outline">{DECISION[it.decision] || it.decision}</Badge>}
        {it.reviewed_at && <Badge variant="secondary">Revisada</Badge>}
        <span className="font-medium">{it.customer_name || "Cliente"}</span>
        <span className="text-xs text-muted-foreground">{it.channel === "instagram" ? "Instagram" : it.instance_name || "WhatsApp"} · final {it.phone.replace(/\D/g, "").slice(-4)}</span>
        <span className="ml-auto text-xs text-muted-foreground">{it.last_incoming_at ? new Date(it.last_incoming_at).toLocaleString("pt-BR") : ""}</span>
      </div>
      <div className="max-h-56 overflow-y-auto rounded bg-muted/40 p-2 space-y-1 text-sm">
        {(it.replay_result?.conversation || it.conversation || []).map((m, i) => (
          <div key={i} className={m.from === "cliente" ? "" : "text-right text-muted-foreground"}><b>{m.from === "cliente" ? "Cliente" : "Loja"}{m.instance ? ` · ${m.instance}` : ""}:</b> {m.text}</div>
        ))}
      </div>
      {it.triage?.justificativa && <p className="text-sm text-muted-foreground">Por quê: {it.triage.justificativa}</p>}
      {it.agent_text && <p className="text-sm"><b>Resposta sugerida:</b> {it.agent_text}</p>}
      {it.replay_result && <div className="grid gap-3 border-y py-3 md:grid-cols-2 text-sm">
        <div><h3 className="font-semibold">Antes · {DECISION[it.decision || ""] || "—"}</h3><p className="whitespace-pre-wrap break-words">{it.agent_text || "Sem resposta"}</p></div>
        <div><h3 className="font-semibold">Depois · {it.replay_result.link_type ? `Link de ${it.replay_result.link_type === "troca" ? "troca" : "devolução"}` : DECISION[it.replay_result.decision || ""] || "—"}</h3><p className="whitespace-pre-wrap break-words">{it.replay_result.agent_text || "Sem resposta"}</p></div>
      </div>}
      {!!it.replay_result?.other_instances?.length && <p className="text-xs">Outros números: {it.replay_result.other_instances.map(i => i.label).join(" · ")}</p>}
      {it.replay_result?.cpf_different_phone && <Badge variant="outline">Pedido localizado por CPF (telefone diferente)</Badge>}
      {it.handoff_summary && <p className="text-sm">Resumo para o atendente: {it.handoff_summary}</p>}
      {it.tracking_info && <p className="text-xs">Rastreio: {ETAPA[it.tracking_info.etapa || ""] || it.tracking_info.etapa}{it.tracking_info.enviado_em ? ` · enviado em ${it.tracking_info.enviado_em}` : ""}</p>}
      {it.would_route_support && <p className="text-xs">Moveria para a linha SUPORTE (não foi movida).</p>}
      {!!it.agent_actions?.length && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Ações que a IA pediu ({it.agent_actions.length})</summary>
          {it.agent_actions.map((a, i) => <div key={i}>{ACTION[a.acao] || a.acao} → {JSON.stringify(a.resultado).slice(0, 300)}</div>)}
        </details>
      )}
      {it.replay_result && <p className="text-xs font-medium">Revisar resultado novo</p>}
      <Review it={it.replay_result ? { ...it, agent_text: it.replay_result.agent_text ?? null, review_class_ok: it.replay_result.review?.class_ok ?? null, review_correct_category: it.replay_result.review?.correct_category ?? null, review_reply_ok: it.replay_result.review?.reply_ok ?? null, review_comment: it.replay_result.review?.comment ?? null, review_ideal_reply: it.replay_result.review?.ideal_reply ?? null, reviewed_at: it.replay_result.review?.at ?? null } : it} onSaved={onSaved} />
    </div>
  );
}

export function TrainingPanel() {
  const [runs, setRuns] = useState<{ id: string; label: string; created_at: string; eligible_conversations: number; selected_conversations: number }[]>([]);
  const [run, setRun] = useState("");
  const [group, setGroup] = useState("suporte");
  const [pendingOnly, setPendingOnly] = useState(true);
  const [rows, setRows] = useState<Item[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    (supabase as any).from("support_training_runs").select("id,label,created_at,eligible_conversations,selected_conversations").order("created_at", { ascending: false }).limit(20)
      .then(({ data }: any) => { setRuns(data || []); if (data?.[0]) setRun(data[0].id); });
  }, []);
  const loadStats = useCallback(() => { if (run) { deskCall<Stats>("support_training_stats", { p_run: run }).then(setStats).catch(() => setStats(null)); deskCall<Comparison>("support_training_comparison", { p_run: run }).then(setComparison).catch(() => setComparison(null)); } }, [run]);
  const load = useCallback(async (offset: number) => {
    if (!run) return;
    setLoading(true);
    try {
      const data = await deskCall<Item[]>("support_training_list", { p_run: run, p_group: group, p_pending_only: pendingOnly, p_limit: 30, p_offset: offset });
      setRows((p) => (offset === 0 ? data : [...p, ...data])); setHasMore(data.length === 30);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
    finally { setLoading(false); }
  }, [run, group, pendingOnly]);
  useEffect(() => { load(0); loadStats(); }, [load, loadStats]);

  const cur = runs.find((r) => r.id === run);
  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-card p-3 text-sm space-y-1">
        <p className="font-medium">Treino do agente — nada foi enviado nem movido. Só conversas reais lidas para você conferir.</p>
        {cur && <p className="text-muted-foreground">{cur.label}: {cur.selected_conversations} conversas lidas de {cur.eligible_conversations} com mensagem nos últimos 7 dias.</p>}
        {stats && <>
          <p>Por tipo: {Object.entries(stats.por_tipo).map(([k, v]) => `${TRIAGE[k] || k} ${v}`).join(" · ")}</p>
          <p>Revisadas: {stats.revisadas} de {stats.suporte + stats.amostra} · Classificação certa: {pct(stats.class_ok, stats.class_err)} ({stats.class_ok}/{stats.class_ok + stats.class_err}) · Resposta aprovada: {pct(stats.reply_ok, stats.reply_err)} ({stats.reply_ok}/{stats.reply_ok + stats.reply_err})</p>
          {stats.pendente > 0 && <p className="text-muted-foreground">Ainda processando: {stats.pendente}</p>}
        </>}
      </div>
      {comparison && <section className="border-y py-3 text-sm space-y-2">
        <h2 className="font-semibold">Antes × depois</h2>
        {[["link_troca", "Link de troca"], ["link_devolucao", "Link de devolução"], ["conversa", "Conversa"], ["fila", "Pessoa"], ["consolidar_em_outra_instancia", "Manter no outro número"], ["presencial", "Presencial"], ["sem", "Sem resposta de suporte"]].map(([key, label]) => <p key={key}>{label}: {comparison.before[key] || 0} → {comparison.after[key] || 0}</p>)}
        <p>Tokens do reprocessamento: {comparison.tokens_in.toLocaleString("pt-BR")} de entrada · {comparison.tokens_out.toLocaleString("pt-BR")} de saída</p>
        {comparison.pending > 0 && <p>Aguardando: {comparison.pending}</p>}
      </section>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={group === "suporte" ? "default" : "outline"} onClick={() => setGroup("suporte")}>Suporte ({stats?.suporte ?? 0})</Button>
        <Button size="sm" variant={group === "amostra_nao_suporte" ? "default" : "outline"} onClick={() => setGroup("amostra_nao_suporte")}>Amostra não-suporte ({stats?.amostra ?? 0})</Button>
        <Button size="sm" variant="ghost" onClick={() => setPendingOnly(!pendingOnly)}>{pendingOnly ? "Mostrar revisadas também" : "Só as não revisadas"}</Button>
      </div>
      {rows.map((it) => <ItemCard key={it.id} it={it} onSaved={() => { loadStats(); if (pendingOnly) setRows((p) => p.filter((x) => x.id !== it.id)); }} />)}
      {!loading && rows.length === 0 && <p className="text-sm text-muted-foreground py-8 text-center">Nada para revisar aqui.</p>}
      {loading && <p className="text-sm text-muted-foreground py-4 text-center">Carregando…</p>}
      {hasMore && !loading && <Button variant="outline" className="w-full" onClick={() => load(rows.length)}>Carregar mais</Button>}
    </div>
  );
}
