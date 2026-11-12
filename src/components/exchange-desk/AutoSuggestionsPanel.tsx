// Fase 4 — Sugestões automáticas (modo sombra): nada sai sem clique de um atendente.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useChatSender, type SendProvider } from "@/hooks/chat/useChatSender";
import { deskCall } from "./api";
import { REASON_TEXT } from "@/lib/supportAuto/intent";

interface Suggestion {
  mode_at_creation: string;
  id: string; created_at: string; phone: string; channel: string; whatsapp_number_id: string | null; customer_name: string | null;
  incoming_text: string | null; intent: string; decision: string; reason: string; link_type: string | null;
  suggested_text: string | null; status: string; sent_text: string | null; discard_reason: string | null;
  triage_category?: string | null; triage_confidence?: number | null; triage?: { justificativa?: string } | null;
  agent_actions?: { acao: string; pedido: Record<string, unknown>; resultado: unknown }[]; handoff_summary?: string | null; ai_status?: string | null;
  would_route_support?: boolean; routed_at?: string | null; routed_auto?: boolean; tracking_info?: { pedido?: string; url?: string | null; etapa?: string; enviado_em?: string | null } | null;
  other_instances?: { id: string; label: string }[]; consolidation_target?: { id: string; label: string } | null; cpf_different_phone?: boolean;
}
const PAGE = 50;
const INTENT: Record<string, string> = { troca: "Troca", devolucao: "Devolução", rastreio: "Rastreio", indefinido: "Indefinido" };
export const ETAPA: Record<string, string> = { em_separacao: "em separação", separado: "separado", enviado: "enviado", entregue: "entregue", sem_envio: "sem envio" };
const DECISION: Record<string, string> = { enviar_link: "Mandar link", presencial: "Compra na loja", instagram_whatsapp: "Levar pro WhatsApp", fila: "Precisa de você", conversa: "Conversa da IA", consolidar_em_outra_instancia: "Manter no outro número" };
export const TRIAGE: Record<string, string> = { venda: "Venda", troca: "Troca", devolucao: "Devolução", troca_ou_devolucao_ambiguo: "Troca ou devolução?", rastreio: "Rastreio", outro_suporte: "Outro suporte", nada: "Nada" };
export const ACTION: Record<string, string> = { buscar_pedidos: "Buscou pedidos", checar_elegibilidade: "Conferiu prazo", consultar_numeracoes: "Consultou numerações", registrar_oferta_troca: "Ofereceu troca", preparar_link: "Preparou link", consultar_rastreio: "Consultou rastreio", escalar_humano: "Passou para pessoa" };

function SuggestionCard({ s, instances, onDone }: { s: Suggestion; instances: Record<string, { provider: string; label: string }>; onDone: () => void }) {
  const [text, setText] = useState(s.suggested_text || "");
  const [busy, setBusy] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [why, setWhy] = useState("");
  const { sendText } = useChatSender();
  const inst = s.whatsapp_number_id ? instances[s.whatsapp_number_id] : undefined;

  const send = async () => {
    const cfg = await deskCall<{ mode: string }>("support_auto_reply_settings_get");
    if (cfg.mode === "shadow" || s.mode_at_creation === "shadow") { toast.error("Modo sombra: envio bloqueado"); return; }
    if (!text.trim()) { toast.error("Escreva a mensagem"); return; }
    setBusy(true);
    try {
      let msg = text;
      let linkId: string | null = null;
      if (msg.includes("{{link}}")) {
        const link = await deskCall<{ id: string; url: string } | null>("support_suggestion_prepare_link", { p_id: s.id });
        if (!link?.url) throw new Error("Não foi possível gerar o link");
        msg = msg.split("{{link}}").join(link.url); linkId = link.id;
      }
      const { data: u } = await supabase.auth.getUser();
      const res = await sendText({
        phone: s.phone, message: msg, senderUserId: u.user?.id || null,
        route: { channel: s.channel === "instagram" ? "instagram" : "whatsapp", provider: (inst?.provider || "uazapi") as SendProvider, numberId: s.whatsapp_number_id },
      });
      if (!res.success) throw new Error(res.error || "Falha ao enviar");
      await deskCall("support_suggestion_mark_sent", { p_id: s.id, p_text: msg, p_link_id: linkId });
      toast.success("Mensagem enviada");
      onDone();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
    finally { setBusy(false); }
  };
  const [routed, setRouted] = useState(!!s.routed_at);
  const route = async () => {
    const cfg = await deskCall<{ mode: string }>("support_auto_reply_settings_get");
    if (cfg.mode === "shadow" || s.mode_at_creation === "shadow") { toast.error("Modo sombra: movimento bloqueado"); return; }
    setBusy(true);
    try { await deskCall("support_suggestion_route", { p_id: s.id }); setRouted(true); toast.success("Conversa movida para Suporte"); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
    finally { setBusy(false); }
  };
  const discard = async () => {
    if (!why.trim()) { toast.error("Diga por que a sugestão está errada"); return; }
    setBusy(true);
    try { await deskCall("support_suggestion_discard", { p_id: s.id, p_reason: why, p_wrong: true }); onDone(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
    finally { setBusy(false); }
  };

  return (
    <div className="rounded-lg border bg-card p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={s.intent === "troca" ? "default" : "secondary"}>{INTENT[s.intent] || s.intent}</Badge>
        <Badge variant="outline">{DECISION[s.decision] || s.decision}</Badge>
        <span className="font-medium">{s.customer_name || s.phone}</span>
        <span className="text-xs text-muted-foreground">{s.channel === "instagram" ? "Instagram" : inst?.label || "WhatsApp"}</span>
        <span className="ml-auto text-xs text-muted-foreground">{new Date(s.created_at).toLocaleString("pt-BR")}</span>
      </div>
      <p className="text-sm">“{s.incoming_text}”</p>
      {!!s.other_instances?.length && <p className="text-xs">Também conversou em: {s.other_instances.map(i => i.label).join(" · ")}</p>}
      {s.consolidation_target && <p className="text-sm">Atendimento em andamento: {s.consolidation_target.label}</p>}
      {s.cpf_different_phone && <Badge variant="outline">Pedido localizado por CPF (telefone diferente)</Badge>}
      {s.triage_category && (
        <p className="text-sm">Triagem da IA: <b>{TRIAGE[s.triage_category] || s.triage_category}</b>{s.triage_confidence != null ? ` (${Math.round(Number(s.triage_confidence) * 100)}%)` : ""}{s.triage?.justificativa ? ` — ${s.triage.justificativa}` : ""}</p>
      )}
      {s.ai_status === "falhou_reserva" && <p className="text-xs text-muted-foreground">A IA falhou; sugestão feita pela regra de palavras.</p>}
      <p className="text-sm text-muted-foreground">Motivo: {s.reason?.startsWith("ia_escalou:") ? `IA passou para pessoa — ${s.reason.slice(11)}` : REASON_TEXT[s.reason] || s.reason}</p>
      {s.handoff_summary && <p className="text-sm">Resumo para o atendente: {s.handoff_summary}</p>}
      {!!s.agent_actions?.length && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Ações que a IA pediu ({s.agent_actions.length})</summary>
          {s.agent_actions.map((a, i) => <div key={i}>{ACTION[a.acao] || a.acao} {JSON.stringify(a.pedido)} → {JSON.stringify(a.resultado).slice(0, 300)}</div>)}
        </details>
      )}
      {s.tracking_info && <p className="text-xs">Rastreio do pedido: {ETAPA[s.tracking_info.etapa || ""] || s.tracking_info.etapa}{s.tracking_info.enviado_em ? ` · enviado em ${new Date(s.tracking_info.enviado_em + "T12:00:00").toLocaleDateString("pt-BR")}` : ""}{s.tracking_info.url ? " · com link" : " · sem link"}</p>}
      {s.would_route_support && s.channel === "whatsapp" && (
        <div className="flex items-center gap-2 text-xs">
          {routed ? <span>Movida para a linha Suporte{s.routed_auto ? " (automático)" : ""}.</span> : <>
            <span>Moveria para a linha SUPORTE do WhatsApp do PDV.</span>
            <Button size="sm" variant="outline" disabled={busy || s.mode_at_creation === "shadow"} onClick={route}>Mover para Suporte</Button>
          </>}
        </div>
      )}
      {s.link_type && s.decision === "enviar_link" && <p className="text-xs">Link que seria enviado: Central de {s.link_type === "troca" ? "troca" : "devolução"} (gerado só ao clicar em enviar)</p>}
      {s.status === "nova" ? (
        <>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Escreva a resposta para a cliente" />
          {text.includes("{{link}}") && <p className="text-xs text-muted-foreground">O link da Central entra no lugar de {"{{link}}"} na hora do envio.</p>}
          {discarding ? (
            <div className="flex gap-2">
              <Input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Por que a sugestão está errada?" autoComplete="off" />
              <Button variant="destructive" disabled={busy} onClick={discard}>Descartar</Button>
              <Button variant="ghost" onClick={() => setDiscarding(false)}>Voltar</Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button disabled={busy || s.mode_at_creation === "shadow"} onClick={send}>Enviar pela conversa</Button>
              <Button variant="outline" disabled={busy} onClick={() => setDiscarding(true)}>Sugestão errada</Button>
            </div>
          )}
        </>
      ) : s.status === "enviada" ? (
        <p className="text-sm">Enviado: {s.sent_text}</p>
      ) : (
        <p className="text-sm text-muted-foreground">Descartada: {s.discard_reason}</p>
      )}
    </div>
  );
}

export function AutoSuggestionsPanel() {
  const [status, setStatus] = useState("nova");
  const [rows, setRows] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [instances, setInstances] = useState<Record<string, { provider: string; label: string }>>({});

  useEffect(() => {
    (supabase as any).from("whatsapp_numbers_safe").select("id,label,provider").limit(100)
      .then(({ data }: any) => setInstances(Object.fromEntries((data || []).map((n: any) => [n.id, { provider: n.provider, label: n.label }]))));
  }, []);
  const load = useCallback(async (offset: number) => {
    setLoading(true);
    try {
      const data = await deskCall<Suggestion[]>("support_suggestions_list", { p_status: status, p_limit: PAGE, p_offset: offset });
      setRows((p) => (offset === 0 ? data : [...p, ...data])); setHasMore(data.length === PAGE);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro ao carregar"); }
    finally { setLoading(false); }
  }, [status]);
  useEffect(() => { load(0); }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {[["nova", "Novas"], ["enviada", "Enviadas"], ["descartada", "Descartadas"]].map(([k, l]) => (
          <Button key={k} size="sm" variant={status === k ? "default" : "outline"} onClick={() => setStatus(k)}>{l}</Button>
        ))}
      </div>
      {rows.map((s) => <SuggestionCard key={s.id} s={s} instances={instances} onDone={() => load(0)} />)}
      {!loading && rows.length === 0 && <p className="text-sm text-muted-foreground py-8 text-center">Nenhuma sugestão por aqui.</p>}
      {loading && <p className="text-sm text-muted-foreground py-4 text-center">Carregando…</p>}
      {hasMore && !loading && <Button variant="outline" className="w-full" onClick={() => load(rows.length)}>Carregar mais</Button>}
    </div>
  );
}
