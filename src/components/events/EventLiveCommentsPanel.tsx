import { useEffect, useState, useCallback, useMemo, useRef, memo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Radio, Search, Ban, ShoppingBag, Instagram, MessageCircle, CheckCircle2, AlertTriangle, Sparkles, Tag, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { OrderDialogDb } from "@/components/OrderDialogDb";
import { WhatsAppChatDialog } from "@/components/WhatsAppChatDialog";
import { InstagramDMChat } from "@/components/events/InstagramDMChat";
import { useDbOrderStore } from "@/stores/dbOrderStore";
import { DbOrder } from "@/types/database";
import { Order } from "@/types/order";
import { isOrderMarkedPaid, isPaidOrderStage } from "@/lib/orderPaymentStages";
import { format, isToday, isYesterday } from "date-fns";
import { ptBR } from "date-fns/locale";

interface LiveComment {
  id: string;
  comment_id: string;
  username: string;
  comment_text: string;
  profile_pic_url: string | null;
  is_order: boolean | null;
  ai_classification: string | null;
  created_at: string;
}

interface HandleOrderStats {
  paidThisEvent: number;
  paidPast: number;
  paidDates: string[];
  openPast: number;
  openDates: string[];
}


interface LeadTag {
  thisEvent: boolean;
  otherEvent: boolean;
  otherEventName?: string | null;
  otherSource?: string | null;
}

// Rótulo amigável para o tipo de captação do lead
const LEAD_SOURCE_LABEL: Record<string, string> = {
  lp: "Página",
  typebot: "Typebot",
  referral: "Indicação",
  manual: "Manual",
};

interface ParticipantScore {
  score: number;
  category: string;
  liveCount: number;
}

// Categoria de score -> rótulo/estilo do badge de engajamento
const SCORE_META: Record<string, { label: string; className: string }> = {
  vip: { label: "VIP", className: "bg-purple-600 text-white" },
  engajado: { label: "Engajado", className: "bg-blue-600 text-white" },
  ativo: { label: "Ativo", className: "bg-teal-600 text-white" },
  frio: { label: "Frio", className: "bg-neutral-400 text-white" },
};

// Chave de telefone: DDD + 8 últimos dígitos (ignora DDI/9), igual à RPC bc_phone_key
const phoneKey = (p: string): string => {
  let d = (p || "").replace(/\D/g, "");
  if (d.length > 11) d = d.slice(-11);
  if (d.length >= 10) return d.slice(0, 2) + d.slice(-8);
  return d;
};


const cleanHandle = (h: string) => (h || "").replace(/^@/, "").trim().toLowerCase();

// Compara duas listas de comentários por identidade (id + ordem). Usado para
// evitar substituir o array (e resetar o scroll) quando nada mudou no refresh.
const sameComments = (a: LiveComment[], b: LiveComment[]): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id) return false;
  }
  return true;
};

// Remove o prefixo "💬 Comentário no Live/Reel/post: " salvo em whatsapp_messages
const stripCommentPrefix = (m: string) =>
  (m || "").replace(/^💬\s*Coment[áa]rio\s+no\s+[^:]+:\s*/i, "").trim();

function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (isToday(d)) return format(d, "HH:mm");
  if (isYesterday(d)) return `Ontem ${format(d, "HH:mm")}`;
  return format(d, "dd/MM/yyyy HH:mm", { locale: ptBR });
}

interface Props {
  eventId: string | null;
}

// Linha de comentário isolada e MEMOIZADA. Sem isso, qualquer mudança de estado
// no painel (abrir o modal de WhatsApp/pedido, digitar na busca, cada comentário
// novo em tempo real, o polling de 60s) re-renderizava TODAS as centenas de
// linhas de uma vez — deixando ações como abrir o modal do WhatsApp lentas.
// Com o memo, uma linha só re-renderiza quando os SEUS dados mudam.
interface CommentRowProps {
  comment: LiveComment;
  isBanned: boolean;
  hasUnpaid: boolean;
  hasWhatsapp: boolean;
  stats?: HandleOrderStats;
  leadTag?: LeadTag;
  score?: ParticipantScore;
  onOpenOrder: (username: string) => void;
  onOpenInstagram: (username: string) => void;
  onOpenWhatsapp: (username: string) => void;
}

const CommentRow = memo(function CommentRow({
  comment: c,
  isBanned,
  hasUnpaid,
  hasWhatsapp,
  stats,
  leadTag,
  score,
  onOpenOrder,
  onOpenInstagram,
  onOpenWhatsapp,
}: CommentRowProps) {
  const handle = cleanHandle(c.username);
  const scoreMeta = score ? SCORE_META[score.category] : undefined;
  return (
    <div className="flex gap-2.5 px-3 py-2.5 hover:bg-muted/40">
      <Avatar className="h-9 w-9 shrink-0">
        {c.profile_pic_url && <AvatarImage src={c.profile_pic_url} alt={handle} />}
        <AvatarFallback className="bg-pink-500/20 text-pink-600 text-xs">
          {handle.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => onOpenOrder(c.username)}
            title="Abrir / criar pedido deste cliente"
            className="flex items-center gap-1 text-sm font-semibold text-pink-600 hover:underline dark:text-pink-300"
          >
            <ShoppingBag className="h-3 w-3" />@{handle}
          </button>
          {scoreMeta && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase",
                scoreMeta.className,
              )}
              title={`Score de participação: ${score!.score} • ${score!.liveCount} live(s)`}
            >
              <Sparkles className="h-2.5 w-2.5" />
              {scoreMeta.label} {score!.score}
            </span>
          )}
          {leadTag?.thisEvent && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-pink-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white"
              title="Captado pela LP/Typebot deste evento"
            >
              <Tag className="h-2.5 w-2.5" />
              Lead
            </span>
          )}
          {leadTag && !leadTag.thisEvent && leadTag.otherEvent && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-fuchsia-500 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white"
              title={
                leadTag.otherEventName
                  ? `Captado em: ${leadTag.otherEventName}${
                      leadTag.otherSource
                        ? ` (via ${LEAD_SOURCE_LABEL[leadTag.otherSource] || leadTag.otherSource})`
                        : ""
                    }`
                  : "Já captado em outra campanha/evento de marketing"
              }
            >
              <Tag className="h-2.5 w-2.5" />
              {leadTag.otherEventName
                ? `Lead: ${leadTag.otherEventName}`
                : "Lead de outra campanha"}
            </span>
          )}
          {isBanned && (
            <span className="inline-flex items-center gap-1 rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-bold uppercase text-destructive-foreground">
              <Ban className="h-2.5 w-2.5" />
              Banido
            </span>
          )}
          {hasUnpaid && (
            <span className="rounded-full bg-neutral-900 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
              Pedido aberto
            </span>
          )}
          {stats && stats.paidThisEvent > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-green-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
              <CheckCircle2 className="h-2.5 w-2.5" />
              Concluído neste evento
            </span>
          )}
          {stats && stats.paidPast > 0 && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white"
              title={stats.paidDates.length ? `Eventos: ${stats.paidDates.join(" • ")}` : undefined}
            >
              <CheckCircle2 className="h-2.5 w-2.5" />
              {stats.paidPast} {stats.paidPast === 1 ? "compra anterior" : "compras anteriores"}
              {stats.paidDates.length > 0 && ` (${stats.paidDates.slice(0, 3).join(", ")}${stats.paidDates.length > 3 ? "…" : ""})`}
            </span>
          )}
          {stats && stats.openPast > 0 && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold uppercase text-black"
              title={stats.openDates.length ? `Eventos: ${stats.openDates.join(" • ")}` : "Pedidos feitos em lives anteriores que nunca foram pagos"}
            >
              <AlertTriangle className="h-2.5 w-2.5" />
              {stats.openPast} {stats.openPast === 1 ? "não finalizado" : "não finalizados"}
              {stats.openDates.length > 0 && ` (${stats.openDates.slice(0, 3).join(", ")}${stats.openDates.length > 3 ? "…" : ""})`}
            </span>
          )}
          <span className="ml-auto text-[10px] text-muted-foreground">{timeLabel(c.created_at)}</span>
        </div>
        <p className="mt-0.5 break-words text-sm text-foreground/90">{c.comment_text}</p>
        {/* Ações: abrir chat do Instagram / WhatsApp */}
        <div className="mt-1.5 flex items-center gap-1.5">
          <button
            onClick={() => onOpenInstagram(c.username)}
            title="Abrir DM do Instagram"
            className="inline-flex items-center gap-1 rounded-md bg-pink-500/10 px-2 py-1 text-[11px] font-medium text-pink-600 hover:bg-pink-500/20 dark:text-pink-300"
          >
            <Instagram className="h-3 w-3" />
            Instagram
          </button>
          {hasWhatsapp && (
            <button
              onClick={() => onOpenWhatsapp(c.username)}
              title="Abrir conversa no WhatsApp"
              className="inline-flex items-center gap-1 rounded-md bg-green-500/10 px-2 py-1 text-[11px] font-medium text-green-600 hover:bg-green-500/20 dark:text-green-400"
            >
              <MessageCircle className="h-3 w-3" />
              WhatsApp
            </button>
          )}
        </div>
      </div>
    </div>
  );
});


/**
 * Painel lateral do módulo Eventos: mostra os comentários da Live
 * (vídeo ao vivo do Instagram).
 *
 * Fontes de dados (mescladas):
 *  1) Tabela `live_comments` (quando o evento foi marcado como "Ativar Live").
 *  2) Tabela `whatsapp_messages` (canal Instagram) — onde TODO comentário de
 *     live/reel chega via webhook do Meta, mesmo sem "Ativar Live" ligado.
 *     É aqui que ficam os históricos das lives passadas.
 *
 * Como os comentários do webhook não têm event_id, eles são filtrados por
 * PERÍODO. O padrão vai da data de criação do evento até hoje, e pode ser
 * ajustado para fazer o pente fino de qualquer faixa de datas.
 *
 * - Clicar no @ de quem comentou abre o modal de pedido (editar não pago ou criar novo).
 * - Clientes BANIDOS recebem uma TAG vermelha de "BANIDO".
 */
export function EventLiveCommentsPanel({ eventId }: Props) {
  const { orders } = useDbOrderStore();
  const [comments, setComments] = useState<LiveComment[]>([]);
  const [bannedHandles, setBannedHandles] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [liveSyncing, setLiveSyncing] = useState(false);
  const [liveSyncStatus, setLiveSyncStatus] = useState<string>("");
  const [search, setSearch] = useState("");
  // Só mostra "Carregando..." na primeira carga; refreshes silenciosos não piscam o painel
  const firstLoadRef = useRef(true);
  const liveSyncInFlightRef = useRef(false);

  // Faixa de datas (pente fino)
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>(format(new Date(), "yyyy-MM-dd"));

  // Modal de pedido
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<DbOrder | null>(null);
  const [prefillHandle, setPrefillHandle] = useState<string>("");

  // Chats (Instagram DM / WhatsApp) abertos a partir de um comentário
  const [igChatHandle, setIgChatHandle] = useState<string | null>(null);
  const [igChatOpen, setIgChatOpen] = useState(false);
  const [waChatOrder, setWaChatOrder] = useState<Order | null>(null);
  const [waChatOpen, setWaChatOpen] = useState(false);

  // Mapa handle(limpo) -> whatsapp cadastrado (para o botão de WhatsApp)
  const [whatsappByHandle, setWhatsappByHandle] = useState<Map<string, string>>(new Map());

  // Mapa handle(limpo) -> estatísticas de pedidos (concluídos/abertos no histórico)
  const [orderStatsByHandle, setOrderStatsByHandle] = useState<Map<string, HandleOrderStats>>(new Map());

  // Mapa handle(limpo) -> situação de Lead (captado neste evento / em outra campanha)
  const [leadTagByHandle, setLeadTagByHandle] = useState<Map<string, LeadTag>>(new Map());

  // Mapa handle(limpo) -> score de participação na live (engajamento)
  const [scoreByHandle, setScoreByHandle] = useState<Map<string, ParticipantScore>>(new Map());

  // Define o início padrão da faixa = data de criação/início do evento
  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("events")
        .select("created_at, start_date")
        .eq("id", eventId)
        .maybeSingle();
      if (cancelled) return;
      const base = (data?.start_date as string) || (data?.created_at as string);
      if (base) setFromDate(format(new Date(base), "yyyy-MM-dd"));
      setToDate(format(new Date(), "yyyy-MM-dd"));
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const loadComments = useCallback(async (opts?: { silent?: boolean }) => {
    if (!eventId || !fromDate) {
      setComments([]);
      firstLoadRef.current = false;
      setLoading(false);
      return;
    }
    // Refresh em background (polling) não deve piscar o painel nem resetar o scroll
    if (!opts?.silent && firstLoadRef.current) setLoading(true);

    const startIso = new Date(`${fromDate}T00:00:00`).toISOString();
    const endIso = new Date(`${toDate}T23:59:59.999`).toISOString();

    const [lcRes, waRes] = await Promise.all([
      // 1) live_comments do evento (quando "Ativar Live" foi usado)
      supabase
        .from("live_comments")
        .select("id, comment_id, username, comment_text, profile_pic_url, is_order, ai_classification, created_at")
        .eq("event_id", eventId)
        .order("created_at", { ascending: false })
        .limit(2000),
      // 2) Comentários de vídeo que chegaram pelo webhook do Meta.
      //    IMPORTANTE: o Meta classifica de forma INCONSISTENTE os comentários de
      //    uma live — muitos chegam rotulados como "Reel"/"post" (media_product_type
      //    REELS/post) mesmo tendo sido feitos no vídeo AO VIVO. Por isso NÃO dá para
      //    filtrar só "💬 Comentário no Live:%": isso derruba comentários reais da live.
      //    Puxamos todos os prefixos "💬 Comentário no <surface>:" dentro da faixa de
      //    datas do evento (que já delimita o período da live). Story reply não usa
      //    esse prefixo, então continua de fora.
      supabase
        .from("whatsapp_messages")
        .select("id, sender_name, message, created_at")
        .eq("channel", "instagram")
        .eq("direction", "incoming")
        .ilike("message", "💬 Comentário no %")
        .gte("created_at", startIso)
        .lte("created_at", endIso)
        .order("created_at", { ascending: false })
        .limit(5000),

    ]);

    const merged: LiveComment[] = [];
    const seen = new Set<string>();

    const pushUnique = (c: LiveComment) => {
      const key = `${cleanHandle(c.username)}|${(c.comment_text || "").toLowerCase().trim()}|${c.created_at.slice(0, 16)}`;
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(c);
    };

    for (const row of (lcRes.data as LiveComment[]) || []) pushUnique(row);

    for (const row of (waRes.data as any[]) || []) {
      const username = (row.sender_name || "").toString();
      if (!username.startsWith("@")) continue;
      pushUnique({
        id: row.id,
        comment_id: row.id,
        username,
        comment_text: stripCommentPrefix(row.message),
        profile_pic_url: null,
        is_order: null,
        ai_classification: null,
        created_at: row.created_at,
      });
    }

    merged.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    // Só troca o array (e re-renderiza/reseta scroll) quando o conteúdo realmente mudou
    setComments((prev) => (sameComments(prev, merged) ? prev : merged));
    firstLoadRef.current = false;
    setLoading(false);
  }, [eventId, fromDate, toDate]);

  const syncLiveCommentsFromMeta = useCallback(async (opts?: { silent?: boolean }) => {
    if (!eventId || liveSyncInFlightRef.current) return;
    liveSyncInFlightRef.current = true;
    if (!opts?.silent) {
      setLiveSyncing(true);
      setLiveSyncStatus("Sincronizando live...");
    }
    try {
      const { data, error } = await supabase.functions.invoke("instagram-live-sync", {
        body: { eventId },
      });
      if (error) throw error;
      const found = Number((data as any)?.comments_found || 0);
      const inserted = Number((data as any)?.live_comments_inserted || 0);
      if (!opts?.silent) {
        setLiveSyncStatus(found > 0
          ? `Live localizada: ${found} comentários (${inserted} novos).`
          : "Live localizada, sem comentário novo agora.");
      }
      await loadComments({ silent: true });
    } catch (e: any) {
      console.error("instagram-live-sync failed", e);
      if (!opts?.silent) setLiveSyncStatus("Não consegui sincronizar direto da Meta agora.");
    } finally {
      liveSyncInFlightRef.current = false;
      if (!opts?.silent) setLiveSyncing(false);
    }
  }, [eventId, loadComments]);

  useEffect(() => {
    loadComments();
  }, [loadComments]);

  // Redundância definitiva para Live ao vivo: além do webhook, consulta direto o
  // endpoint de vídeos ao vivo da Meta enquanto o painel está aberto. A Meta só
  // permite ler comentários de live enquanto a transmissão está acontecendo.
  useEffect(() => {
    if (!eventId) return;
    const isToToday = toDate === format(new Date(), "yyyy-MM-dd");
    if (!isToToday) return;
    syncLiveCommentsFromMeta({ silent: true });
    const t = setInterval(() => syncLiveCommentsFromMeta({ silent: true }), 15000);
    return () => clearInterval(t);
  }, [eventId, toDate, syncLiveCommentsFromMeta]);

  // Clientes banidos (instagram_handle) — para a TAG de BANIDO
  const loadBanned = useCallback(async () => {
    const { data } = await supabase
      .from("customers")
      .select("instagram_handle")
      .eq("is_banned", true);
    const set = new Set<string>();
    (data || []).forEach((c: any) => {
      const h = cleanHandle(c.instagram_handle || "");
      if (h) set.add(h);
    });
    setBannedHandles(set);
  }, []);

  useEffect(() => {
    loadBanned();
  }, [loadBanned]);

  // Carrega o WhatsApp cadastrado dos @ que comentaram (para o botão de WhatsApp)
  useEffect(() => {
    const handles = Array.from(new Set(comments.map((c) => cleanHandle(c.username)).filter(Boolean)));
    if (handles.length === 0) {
      setWhatsappByHandle(new Map());
      return;
    }
    let cancelled = false;
    (async () => {
      const map = new Map<string, string>();
      // 1) Aproveita o WhatsApp dos pedidos já carregados deste evento
      for (const o of orders) {
        const h = cleanHandle(o.customer?.instagram_handle || "");
        const wa = (o.customer?.whatsapp || "").replace(/\D/g, "");
        if (h && wa) map.set(h, o.customer!.whatsapp!);
      }
      // 2) Busca na tabela de clientes os handles ainda sem WhatsApp
      const variants: string[] = [];
      handles.forEach((h) => {
        if (!map.has(h)) {
          variants.push(h, `@${h}`, `@ ${h}`);
        }
      });
      if (variants.length > 0) {
        const batchSize = 200;
        for (let i = 0; i < variants.length; i += batchSize) {
          const batch = variants.slice(i, i + batchSize);
          const { data } = await supabase
            .from("customers")
            .select("instagram_handle, whatsapp")
            .in("instagram_handle", batch);
          (data || []).forEach((c: any) => {
            const h = cleanHandle(c.instagram_handle || "");
            const wa = (c.whatsapp || "").replace(/\D/g, "");
            if (h && wa && !map.has(h)) map.set(h, c.whatsapp);
          });
        }
      }
      if (!cancelled) setWhatsappByHandle(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [comments, orders]);

  // Carrega o histórico de pedidos (concluídos x abertos) dos @ que comentaram.
  // Serve para sinalizar no painel quem já comprou e quem costuma deixar pedidos sem pagar.
  useEffect(() => {
    const handles = Array.from(new Set(comments.map((c) => cleanHandle(c.username)).filter(Boolean)));
    if (handles.length === 0 || !eventId) {
      setOrderStatsByHandle(new Map());
      return;
    }
    let cancelled = false;
    (async () => {
      // 1) Resolve customer_id -> handle (limpo) para todos os @ presentes.
      const handlesSet = new Set(handles);
      const idToHandle = new Map<string, string>();

      // 1a) Resolve via pedidos já carregados (robusto: pega o @ direto do pedido,
      //     mesmo quando o cadastro do cliente está com formato divergente).
      for (const o of orders) {
        const h = cleanHandle(o.customer?.instagram_handle || "");
        const cid = o.customer_id || (o.customer as any)?.id;
        if (h && cid && handlesSet.has(h)) idToHandle.set(cid, h);
      }

      // 1b) Resolve via tabela de clientes. Inclui variantes "@h" e "@ h"
      //     (alguns handles foram salvos com espaço depois do @).
      const variants: string[] = [];
      handles.forEach((h) => variants.push(h, `@${h}`, `@ ${h}`));
      const cBatch = 200;
      for (let i = 0; i < variants.length; i += cBatch) {
        const batch = variants.slice(i, i + cBatch);
        const { data } = await supabase
          .from("customers")
          .select("id, instagram_handle")
          .in("instagram_handle", batch);
        (data || []).forEach((c: any) => {
          const h = cleanHandle(c.instagram_handle || "");
          if (h && c.id && handlesSet.has(h)) idToHandle.set(c.id, h);
        });
      }


      const customerIds = Array.from(idToHandle.keys());
      const stats = new Map<string, HandleOrderStats>();
      const ensure = (h: string): HandleOrderStats => {
        let s = stats.get(h);
        if (!s) {
          s = { paidThisEvent: 0, paidPast: 0, paidDates: [], openPast: 0, openDates: [] };
          stats.set(h, s);
        }
        return s;
      };

      if (customerIds.length > 0) {
        const oBatch = 100;
        const paidDatesByHandle = new Map<string, Set<string>>();
        const openDatesByHandle = new Map<string, Set<string>>();
        for (let i = 0; i < customerIds.length; i += oBatch) {
          const batch = customerIds.slice(i, i + oBatch);
          const { data } = await supabase
            .from("orders")
            .select("id, customer_id, event_id, stage, is_paid, paid_externally, paid_at, created_at, events(name, start_date, created_at)")
            .in("customer_id", batch);
          (data || []).forEach((o: any) => {
            const h = idToHandle.get(o.customer_id);
            if (!h) return;
            const s = ensure(h);
            const paid = Boolean(o.is_paid || o.paid_externally || isPaidOrderStage(o.stage));
            const isThisEvent = o.event_id === eventId;
            const ev = o.events;
            const evDate = ev?.start_date || ev?.created_at || o.created_at;
            if (paid) {
              if (isThisEvent) {
                s.paidThisEvent += 1;
              } else {
                s.paidPast += 1;
                if (evDate) {
                  const set = paidDatesByHandle.get(h) || new Set<string>();
                  set.add(format(new Date(evDate), "dd/MM/yyyy"));
                  paidDatesByHandle.set(h, set);
                }
              }
            } else if (!isThisEvent && o.stage !== "cancelled") {
              s.openPast += 1;
              if (evDate) {
                const set = openDatesByHandle.get(h) || new Set<string>();
                set.add(format(new Date(evDate), "dd/MM/yyyy"));
                openDatesByHandle.set(h, set);
              }
            }
          });
        }
        const sortDates = (set: Set<string>) => Array.from(set).sort((a, b) => {
          const [da, ma, ya] = a.split("/").map(Number);
          const [db, mb, yb] = b.split("/").map(Number);
          return new Date(yb, mb - 1, db).getTime() - new Date(ya, ma - 1, da).getTime();
        });
        paidDatesByHandle.forEach((set, h) => {
          const s = stats.get(h);
          if (s) s.paidDates = sortDates(set);
        });
        openDatesByHandle.forEach((set, h) => {
          const s = stats.get(h);
          if (s) s.openDates = sortDates(set);
        });
      }

      if (!cancelled) setOrderStatsByHandle(stats);
    })();
    return () => {
      cancelled = true;
    };
  }, [comments, eventId, orders]);

  // Tags de LEAD: descobre quais @ foram captados pela LP/Typebot deste evento
  // ou de outras campanhas. Faz o match pelo WhatsApp (DDD + 9 dígitos) já que
  // os comentários não trazem o telefone diretamente.
  useEffect(() => {
    if (!eventId || whatsappByHandle.size === 0) {
      setLeadTagByHandle(new Map());
      return;
    }
    let cancelled = false;
    (async () => {
      // monta phone -> [handles] e a lista de telefones únicos
      const phones = Array.from(new Set(Array.from(whatsappByHandle.values())));
      const keyToHandles = new Map<string, string[]>();
      whatsappByHandle.forEach((wa, h) => {
        const k = phoneKey(wa);
        if (!k) return;
        const arr = keyToHandles.get(k) || [];
        arr.push(h);
        keyToHandles.set(k, arr);
      });
      const { data, error } = await supabase.rpc("match_event_leads", {
        p_event_id: eventId,
        p_phones: phones,
      });
      if (cancelled || error || !data) return;
      const map = new Map<string, LeadTag>();
      (data as any[]).forEach((row) => {
        const handles = keyToHandles.get(row.phone_key) || [];
        handles.forEach((h) =>
          map.set(h, {
            thisEvent: !!row.this_event,
            otherEvent: !!row.other_event,
            otherEventName: row.other_event_name ?? null,
            otherSource: row.other_source ?? null,
          }),
        );
      });
      setLeadTagByHandle(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, whatsappByHandle]);

  // Score de participação (engajamento) dos @ presentes no painel
  useEffect(() => {
    const handles = Array.from(new Set(comments.map((c) => cleanHandle(c.username)).filter(Boolean)));
    if (handles.length === 0) {
      setScoreByHandle(new Map());
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc("participant_score_ranking", {
        p_handles: handles,
      });
      if (cancelled || error || !data) return;
      const map = new Map<string, ParticipantScore>();
      (data as any[]).forEach((row) => {
        map.set(cleanHandle(row.handle), {
          score: row.score ?? 0,
          category: row.category || "frio",
          liveCount: row.live_count ?? 0,
        });
      });
      setScoreByHandle(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [comments]);






  // Realtime: novos comentários (live_comments) entram automaticamente
  useEffect(() => {
    if (!eventId) return;
    const ch = supabase
      .channel(`live-panel-${eventId}-${Date.now()}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "live_comments", filter: `event_id=eq.${eventId}` },
        (payload) => {
          const c = payload.new as LiveComment;
          setComments((prev) => {
            if (prev.some((x) => x.id === c.id || x.comment_id === c.comment_id)) return prev;
            return [c, ...prev];
          });
        },
      )
      // Comentários da LIVE chegam pelo webhook do Meta em whatsapp_messages.
      // Inserimos em tempo real (sem recarregar tudo), preservando o scroll.
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "whatsapp_messages", filter: "channel=eq.instagram" },
        (payload) => {
          const row = payload.new as any;
          if (row?.direction !== "incoming") return;
          const message = (row?.message || "").toString();
          // O Meta rotula os comentários da live de forma INCONSISTENTE
          // ("Live", "Reel" ou "post"). Aceitamos qualquer prefixo
          // "💬 Comentário no <surface>:" — igual à consulta inicial —
          // senão comentários reais da live entram só no polling de 60s
          // (é o que causava os comentários "defasados").
          if (!/^💬\s*Coment[áa]rio\s+no\s+[^:]+:/i.test(message)) return;
          const username = (row?.sender_name || "").toString();
          if (!username.startsWith("@")) return;
          const created = (row?.created_at as string) || new Date().toISOString();
          // Respeita a faixa de datas selecionada (pente fino)
          if (fromDate && created < new Date(`${fromDate}T00:00:00`).toISOString()) return;
          if (toDate && created > new Date(`${toDate}T23:59:59.999`).toISOString()) return;
          const nc: LiveComment = {
            id: row.id,
            comment_id: row.id,
            username,
            comment_text: stripCommentPrefix(message),
            profile_pic_url: null,
            is_order: null,
            ai_classification: null,
            created_at: created,
          };
          setComments((prev) => {
            const dupKey = `${cleanHandle(nc.username)}|${(nc.comment_text || "").toLowerCase().trim()}|${nc.created_at.slice(0, 16)}`;
            const exists = prev.some(
              (x) =>
                x.id === nc.id ||
                `${cleanHandle(x.username)}|${(x.comment_text || "").toLowerCase().trim()}|${x.created_at.slice(0, 16)}` === dupKey,
            );
            if (exists) return prev;
            const next = [nc, ...prev];
            next.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
            return next;
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [eventId, fromDate, toDate]);

  // Polling de segurança (60s) como fallback do realtime quando o "Até" é hoje.
  // Silencioso: não pisca o painel nem reseta o scroll (só troca o array se mudou).
  useEffect(() => {
    if (!eventId) return;
    const isToToday = toDate === format(new Date(), "yyyy-MM-dd");
    if (!isToToday) return;
    const t = setInterval(() => loadComments({ silent: true }), 60000);
    return () => clearInterval(t);
  }, [eventId, toDate, loadComments]);

  // Mapa handle -> pedido NÃO PAGO mais recente deste evento
  const unpaidOrderByHandle = useMemo(() => {
    const map = new Map<string, DbOrder>();
    for (const o of orders) {
      const h = cleanHandle(o.customer?.instagram_handle || "");
      if (!h) continue;
      if (isOrderMarkedPaid(o) || o.stage === "cancelled") continue;
      const existing = map.get(h);
      if (!existing || new Date(o.updated_at) > new Date(existing.updated_at)) {
        map.set(h, o);
      }
    }
    return map;
  }, [orders]);

  const openForHandle = useCallback((rawHandle: string) => {
    const clean = cleanHandle(rawHandle);
    const unpaid = unpaidOrderByHandle.get(clean);
    if (unpaid) {
      setEditingOrder(unpaid);
      setPrefillHandle("");
    } else {
      setEditingOrder(null);
      setPrefillHandle(clean);
    }
    setDialogOpen(true);
  }, [unpaidOrderByHandle]);

  // Abre a DM do Instagram do @ que comentou
  const openInstagramChat = useCallback((rawHandle: string) => {
    const clean = cleanHandle(rawHandle);
    if (!clean) return;
    setIgChatHandle(clean);
    setIgChatOpen(true);
  }, []);

  // Abre o chat de WhatsApp (se o cliente tiver telefone cadastrado)
  const openWhatsappChat = useCallback((rawHandle: string) => {
    const clean = cleanHandle(rawHandle);
    const whatsapp = whatsappByHandle.get(clean);
    if (!whatsapp) return;
    setWaChatOrder({
      id: clean,
      instagramHandle: `@${clean}`,
      whatsapp,
      products: [],
      stage: "awaiting_payment" as Order["stage"],
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Order);
    setWaChatOpen(true);
  }, [whatsappByHandle]);




  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return comments;
    return comments.filter(
      (c) =>
        cleanHandle(c.username).includes(q.replace(/^@/, "")) ||
        (c.comment_text || "").toLowerCase().includes(q),
    );
  }, [comments, search]);

  return (
    <div className="flex h-full w-full flex-col border-l border-border bg-card">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Radio className="h-5 w-5 text-pink-500" />
        <h2 className="text-sm font-bold">Comentários da Live</h2>
        <button
          type="button"
          onClick={() => syncLiveCommentsFromMeta()}
          disabled={liveSyncing}
          className="ml-1 inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
          title="Buscar comentários direto no vídeo ao vivo do Instagram"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", liveSyncing && "animate-spin")} />
          Sync
        </button>
        <span className="ml-auto rounded-full bg-pink-500/15 px-2 py-0.5 text-xs font-semibold text-pink-600 dark:text-pink-300">
          {comments.length}
        </span>
      </div>

      {liveSyncStatus && (
        <div className="border-b border-border px-4 py-1 text-[11px] text-muted-foreground">
          {liveSyncStatus}
        </div>
      )}

      {/* Faixa de datas (pente fino) */}
      <div className="grid grid-cols-2 gap-2 border-b border-border p-2">
        <label className="flex flex-col gap-0.5 text-[10px] font-medium text-muted-foreground">
          De
          <Input
            type="date"
            value={fromDate}
            max={toDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="h-8 text-xs"
          />
        </label>
        <label className="flex flex-col gap-0.5 text-[10px] font-medium text-muted-foreground">
          Até
          <Input
            type="date"
            value={toDate}
            min={fromDate}
            onChange={(e) => setToDate(e.target.value)}
            className="h-8 text-xs"
          />
        </label>
      </div>

      {/* Busca */}
      <div className="border-b border-border p-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar @ ou texto do comentário..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
      </div>

      {/* Lista de comentários */}
      <ScrollArea className="flex-1">
        {loading ? (
          <div className="p-6 text-center text-sm text-muted-foreground">Carregando comentários...</div>
        ) : filtered.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            {comments.length === 0
              ? "Nenhum comentário da live neste período. Ajuste as datas acima."
              : "Nenhum comentário encontrado para a busca."}
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {filtered.map((c) => {
              const handle = cleanHandle(c.username);
              return (
                <CommentRow
                  key={c.id}
                  comment={c}
                  isBanned={bannedHandles.has(handle)}
                  hasUnpaid={unpaidOrderByHandle.has(handle)}
                  hasWhatsapp={whatsappByHandle.has(handle)}
                  stats={orderStatsByHandle.get(handle)}
                  leadTag={leadTagByHandle.get(handle)}
                  score={scoreByHandle.get(handle)}
                  onOpenOrder={openForHandle}
                  onOpenInstagram={openInstagramChat}
                  onOpenWhatsapp={openWhatsappChat}
                />
              );
            })}


          </div>
        )}
      </ScrollArea>

      {eventId && (
        <OrderDialogDb
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          editingOrder={editingOrder}
          eventId={eventId}
          prefillInstagram={prefillHandle || undefined}
        />
      )}

      {igChatHandle && (
        <InstagramDMChat
          open={igChatOpen}
          onOpenChange={setIgChatOpen}
          username={igChatHandle}
          eventId={eventId}
        />
      )}

      {waChatOrder && (
        <WhatsAppChatDialog
          open={waChatOpen}
          onOpenChange={setWaChatOpen}
          order={waChatOrder}
          wide
        />
      )}

    </div>
  );
}
