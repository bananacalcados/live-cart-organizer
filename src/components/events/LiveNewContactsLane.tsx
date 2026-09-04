import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Order } from "@/types/order";
import { WhatsAppChatDialog } from "@/components/WhatsAppChatDialog";
import { OrderDialogDb } from "@/components/OrderDialogDb";
import { cn } from "@/lib/utils";
import { HelpCircle, MessageCircle, MoreVertical, Phone, Plus, RefreshCw, Undo2, UserPlus } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { ContactLaneMark } from "@/hooks/useEventContactLanes";
import { LiveCardMessageActions } from "@/components/events/LiveCardMessageActions";
import { useEventStore } from "@/stores/eventStore";

interface ClickRow {
  id: string;
  created_at: string;
  entered_phone: string | null;
  phone: string | null;
  real_phone: string | null;
  superseded: boolean | null;
  lead?: { name: string | null } | null;
}

export interface NewContact {
  key: string;
  phone: string;
  name: string | null;
  /** @ do Instagram já conhecido na base (clientes da live / CRM). */
  instagramHandle: string | null;
  talked: boolean;
  createdAt: string;
  /** Há mensagem da cliente mais recente que a última resposta nossa e que a última abertura do chat. */
  unread: boolean;
  lastIncomingAt: string | null;
}

interface KnownIdentity {
  name: string | null;
  handle: string | null;
}

/**
 * Cache (por sessão) de identidades já resolvidas na base — evita repetir a
 * consulta a cada atualização em tempo real. `null` = consultado e não encontrado.
 */
const identityCache = new Map<string, KnownIdentity | null>();

/** Uma única chamada indexada (RPC) para todas as chaves ainda não conhecidas. */
async function resolveIdentities(keys: string[]): Promise<Map<string, KnownIdentity | null>> {
  const missing = [...new Set(keys)].filter((k) => k.length === 8 && !identityCache.has(k));
  if (missing.length > 0) {
    for (let i = 0; i < missing.length; i += 300) {
      const batch = missing.slice(i, i + 300);
      const { data, error } = await supabase.rpc("live_resolve_contact_identities", { p_suffixes: batch });
      if (error) {
        console.warn("[LiveNewContacts] identidade:", error.message);
        break;
      }
      const found = new Set<string>();
      for (const r of (data || []) as { suffix8: string; name: string | null; instagram_handle: string | null }[]) {
        identityCache.set(r.suffix8, { name: r.name, handle: r.instagram_handle });
        found.add(r.suffix8);
      }
      for (const k of batch) if (!found.has(k)) identityCache.set(k, null);
    }
  }
  const out = new Map<string, KnownIdentity | null>();
  for (const k of keys) out.set(k, identityCache.get(k) ?? null);
  return out;
}

/** Última vez que o chat deste contato foi aberto neste aparelho (por evento). */
const seenKey = (eventId: string) => `live-contact-seen:${eventId}`;
function readSeen(eventId: string): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(seenKey(eventId)) || "{}");
  } catch {
    return {};
  }
}
function markSeen(eventId: string, key: string) {
  const m = readSeen(eventId);
  m[key] = Date.now();
  try {
    localStorage.setItem(seenKey(eventId), JSON.stringify(m));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent("live-contact-seen", { detail: { eventId } }));
}

const suffix8 = (phone?: string | null) => {
  const d = (phone || "").replace(/\D/g, "");
  return d ? d.slice(-8) : "";
};

function formatPhone(phone?: string | null): string {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  const local = digits.length > 11 ? digits.slice(-11) : digits;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return digits;
}

/**
 * Contatos que digitaram o WhatsApp no link redirecionador DESTE evento e
 * ainda não têm pedido criado (inclui quem confirmou e nunca mandou mensagem).
 * Dedup por DDD + 8 dígitos; mais recente primeiro.
 */
export function useLiveNewContacts(eventId: string | null | undefined, excludeKeys: Set<string>, search?: string) {
  const [rows, setRows] = useState<ClickRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [activity, setActivity] = useState<Map<string, { lastIn: string | null; lastOut: string | null }>>(new Map());
  const [seen, setSeen] = useState<Record<string, number>>({});
  const eventStart = useEventStore((st) => (st.events.find((ev) => ev.id === eventId) as any)?.start_date as string | undefined);

  const load = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    try {
      const { data: links } = await supabase
        .from("live_whatsapp_links")
        .select("id")
        .eq("event_id", eventId);
      const linkIds = ((links || []) as { id: string }[]).map((l) => l.id);
      if (linkIds.length === 0) {
        setRows([]);
        return;
      }
      const { data } = await supabase
        .from("live_whatsapp_clicks")
        .select("id, created_at, entered_phone, phone, real_phone, superseded, lead:event_leads(name)")
        .in("link_id", linkIds)
        .not("entered_phone", "is", null)
        .order("created_at", { ascending: false })
        .limit(500);
      setRows(((data || []) as unknown as ClickRow[]).filter((r) => !r.superseded));
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    load();
  }, [load]);

  // Atividade de conversa (última mensagem recebida/enviada) dos contatos que já falaram.
  const talkedPhones = useMemo(
    () => [...new Set(rows.map((r) => r.phone).filter((p): p is string => !!p))],
    [rows],
  );
  const loadActivity = useCallback(async () => {
    if (!eventId || talkedPhones.length === 0) {
      setActivity(new Map());
      return;
    }
    const since = eventStart || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const map = new Map<string, { lastIn: string | null; lastOut: string | null }>();
    for (let i = 0; i < talkedPhones.length; i += 200) {
      const batch = talkedPhones.slice(i, i + 200);
      const { data } = await supabase
        .from("whatsapp_messages")
        .select("phone, direction, created_at")
        .in("phone", batch)
        .gte("created_at", since)
        .not("message", "ilike", "💬 Comentário%")
        .order("created_at", { ascending: false })
        .limit(3000);
      for (const m of (data || []) as { phone: string; direction: string; created_at: string }[]) {
        const k = suffix8(m.phone);
        const cur = map.get(k) || { lastIn: null, lastOut: null };
        if (m.direction === "incoming" && !cur.lastIn) cur.lastIn = m.created_at;
        if (m.direction === "outgoing" && !cur.lastOut) cur.lastOut = m.created_at;
        map.set(k, cur);
      }
    }
    setActivity(map);
  }, [eventId, talkedPhones, eventStart]);

  useEffect(() => {
    loadActivity();
  }, [loadActivity]);

  useEffect(() => {
    if (!eventId) return;
    setSeen(readSeen(eventId));
    const onSeen = (e: Event) => {
      if ((e as CustomEvent).detail?.eventId === eventId) setSeen(readSeen(eventId));
    };
    window.addEventListener("live-contact-seen", onSeen);
    return () => window.removeEventListener("live-contact-seen", onSeen);
  }, [eventId]);

  // Tempo real: novos cliques confirmados e novas mensagens entram na linha sem recarregar a tela.
  useEffect(() => {
    if (!eventId) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const bump = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => loadActivity(), 800);
    };
    const channel = supabase
      .channel(`live-new-contacts-${eventId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "live_whatsapp_clicks" }, () => load())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "whatsapp_messages" }, bump)
      .subscribe();
    return () => {
      if (t) clearTimeout(t);
      supabase.removeChannel(channel);
    };
  }, [eventId, load, loadActivity]);

  // Identidade conhecida na base (clientes da live, CRM, cadastros, leads, contatos) — 1 RPC indexada, com cache.
  const [identities, setIdentities] = useState<Map<string, KnownIdentity | null>>(new Map());
  const rowKeys = useMemo(
    () => [...new Set(rows.map((r) => suffix8(r.real_phone || r.phone || r.entered_phone)).filter((k) => k.length === 8))],
    [rows],
  );
  useEffect(() => {
    let cancelled = false;
    if (rowKeys.length === 0) {
      setIdentities(new Map());
      return;
    }
    resolveIdentities(rowKeys).then((m) => {
      if (!cancelled) setIdentities(m);
    });
    return () => {
      cancelled = true;
    };
  }, [rowKeys]);

  const contacts: NewContact[] = useMemo(() => {
    const byKey = new Map<string, NewContact>();
    for (const r of rows) {
      const phone = r.real_phone || r.phone || r.entered_phone || "";
      const key = suffix8(phone);
      if (!key || key.length < 8) continue;
      if (excludeKeys.has(key)) continue;
      const existing = byKey.get(key);
      const act = activity.get(key);
      const lastIn = act?.lastIn ? +new Date(act.lastIn) : 0;
      const lastOut = act?.lastOut ? +new Date(act.lastOut) : 0;
      const unread = lastIn > 0 && lastIn > lastOut && lastIn > (seen[key] || 0);
      const known = identities.get(key);
      const leadName = r.lead?.name && !/^lead whatsapp$/i.test(r.lead.name) ? r.lead.name : null;
      const contact: NewContact = {
        key,
        phone,
        name: known?.name || leadName,
        instagramHandle: known?.handle || null,
        talked: !!r.phone,
        createdAt: r.created_at,
        unread,
        lastIncomingAt: act?.lastIn || null,
      };
      if (!existing) byKey.set(key, contact);
      else if (!existing.name && contact.name) byKey.set(key, { ...existing, name: contact.name });
    }
    const list = [...byKey.values()];
    const q = (search || "").trim().toLowerCase();
    const filtered = q
      ? list.filter(
          (c) =>
            (c.name || "").toLowerCase().includes(q) ||
            (c.instagramHandle || "").toLowerCase().includes(q.replace(/^@/, "")) ||
            c.phone.replace(/\D/g, "").includes(q.replace(/\D/g, "")),
        )
      : list;
    // Não lidas primeiro; depois mais recentes.
    return filtered.sort((a, b) => {
      if (a.unread !== b.unread) return a.unread ? -1 : 1;
      return +new Date(b.createdAt) - +new Date(a.createdAt);
    });
  }, [rows, excludeKeys, search, activity, seen, identities]);

  return { contacts, loading, reload: load };
}

interface LiveContactCardsProps {
  eventId: string;
  contacts: NewContact[];
  /** "new" = linha Novos contatos; "doubts" = linha Dúvidas & cancelamentos. */
  variant: "new" | "doubts";
  /** Marcação manual (motivo) por chave de telefone. */
  marks?: Map<string, ContactLaneMark>;
  onMoveToDoubts?: (contact: NewContact, reason: string) => void;
  onBackToNew?: (contact: NewContact) => void;
  emptyText?: string;
  loading?: boolean;
  onReload?: () => void;
  /** Quando true, renderiza só os cards (sem wrapper de rolagem/vazio). */
  inline?: boolean;
}

/** Cards de contato (sem pedido) usados nas linhas Novos contatos e Dúvidas. */
export function LiveContactCards({
  eventId,
  contacts,
  variant,
  marks,
  onMoveToDoubts,
  onBackToNew,
  emptyText,
  loading,
  onReload,
  inline = false,
}: LiveContactCardsProps) {
  const [chatOrder, setChatOrder] = useState<Order | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [prefill, setPrefill] = useState<{ phone: string; name?: string; handle?: string } | null>(null);
  const [orderOpen, setOrderOpen] = useState(false);
  const [moving, setMoving] = useState<NewContact | null>(null);
  const [reason, setReason] = useState("");

  const openChat = (c: NewContact) => {
    markSeen(eventId, c.key);
    setChatOrder({
      id: `live-contact-${c.key}`,
      instagramHandle: c.instagramHandle || c.name || "",
      whatsapp: c.phone,
      products: [],
      stage: "new" as Order["stage"],
      createdAt: new Date(c.createdAt),
      updatedAt: new Date(c.createdAt),
    } as Order);
    setChatOpen(true);
  };

  const isDoubts = variant === "doubts";

  const cards = contacts.map((c) => {
    const mark = marks?.get(c.key);
    return (
      <div
        key={c.key}
        role="button"
        tabIndex={0}
        onClick={() => openChat(c)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") openChat(c);
        }}
        title={c.unread ? "Mensagem não lida — abrir conversa" : "Abrir conversa"}
        className={cn(
          "group relative flex min-h-[104px] w-[230px] shrink-0 cursor-pointer flex-col gap-1 rounded-lg border border-y-neutral-700 border-r-neutral-700 border-l-4 bg-neutral-900 px-3 py-2 text-left text-white transition-colors hover:bg-neutral-800",
          isDoubts ? "border-l-neutral-400" : "border-l-sky-400",
          c.unread && "animate-pulse ring-2 ring-yellow-400 ring-offset-2 ring-offset-background",
        )}
      >
        {c.unread && (
          <>
            <span className="absolute -left-1.5 -top-1.5 flex h-3.5 w-3.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-400 opacity-75" />
              <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-yellow-400" />
            </span>
            <span className="absolute right-9 top-1.5 rounded-full bg-yellow-400 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-black">
              Não lida
            </span>
          </>
        )}
        {(onMoveToDoubts || onBackToNew) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                onClick={(e) => e.stopPropagation()}
                title="Mais ações"
                className="absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-white/60 hover:bg-white/20 hover:text-white"
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              {!isDoubts && onMoveToDoubts && (
                <DropdownMenuItem
                  onClick={() => {
                    setReason("");
                    setMoving(c);
                  }}
                >
                  <HelpCircle className="mr-2 h-3.5 w-3.5" /> Mover para Dúvidas & cancelamentos
                </DropdownMenuItem>
              )}
              {isDoubts && onBackToNew && (
                <DropdownMenuItem onClick={() => onBackToNew(c)}>
                  <Undo2 className="mr-2 h-3.5 w-3.5" /> Voltar para Novos contatos
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <div className="flex min-w-0 items-center gap-1.5 pr-7">
          <span
            className={cn(
              "flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
              isDoubts ? "bg-white/15 text-white/70" : "bg-sky-400/20 text-sky-300",
            )}
          >
            {isDoubts ? <HelpCircle className="h-3 w-3" /> : <UserPlus className="h-3 w-3" />}
          </span>
          <span className="truncate text-xs font-semibold">{c.name || "Novo contato"}</span>
        </div>
        {c.instagramHandle && (
          <span className="truncate text-[11px] text-white/60">@{c.instagramHandle.replace(/^@+/, "")}</span>
        )}
        <span className="flex items-center gap-1 truncate text-[11px] text-white/70">
          <Phone className="h-3 w-3 shrink-0" />
          {formatPhone(c.phone)}
        </span>
        <span className={cn("text-[12px] font-bold", isDoubts ? "text-white/80" : "text-sky-300")}>
          {isDoubts ? "Dúvida" : c.talked ? "Falou com a gente" : "Digitou e não falou"}
        </span>
        {isDoubts && mark?.reason && (
          <span className="truncate text-[10px] italic text-white/60" title={mark.reason}>
            “{mark.reason}”
          </span>
        )}
        <span className="text-[10px] text-white/50">
          há {formatDistanceToNowStrict(new Date(isDoubts && mark ? mark.movedAt : c.createdAt), { locale: ptBR })}
        </span>
        <div className="mt-auto flex items-center gap-1 pt-0.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              openChat(c);
            }}
            className="inline-flex items-center gap-1 rounded-md border border-white/20 bg-white/10 px-2 py-1 text-[10px] font-semibold hover:bg-white/20"
          >
            <MessageCircle className="h-3 w-3" /> Conversar
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setPrefill({ phone: c.phone, name: c.name || undefined, handle: c.instagramHandle || undefined });
              setOrderOpen(true);
            }}
            className="inline-flex items-center gap-1 rounded-md border border-sky-400/50 bg-sky-400/15 px-2 py-1 text-[10px] font-semibold text-sky-200 hover:bg-sky-400/25"
          >
            <Plus className="h-3 w-3" /> Pedido
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <LiveCardMessageActions eventId={eventId} phone={c.phone} name={c.name} />
        </div>
      </div>
    );
  });

  return (
    <>
      {inline ? (
        cards
      ) : contacts.length === 0 ? (
        <div className="flex items-center gap-2 px-1 py-2 text-xs text-muted-foreground">
          {emptyText || "Ninguém digitou o WhatsApp no link desta live ainda."}
          {onReload && (
            <button type="button" onClick={onReload} className="inline-flex items-center gap-1 hover:text-foreground">
              <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} /> atualizar
            </button>
          )}
        </div>
      ) : (
        <div className="flex items-stretch gap-2 overflow-x-auto pb-2 scrollbar-thin">{cards}</div>
      )}

      {chatOrder?.whatsapp && (
        <WhatsAppChatDialog open={chatOpen} onOpenChange={setChatOpen} order={chatOrder} wide />
      )}

      {prefill && (
        <OrderDialogDb
          open={orderOpen}
          onOpenChange={(v) => {
            setOrderOpen(v);
            if (!v) setPrefill(null);
          }}
          eventId={eventId}
          prefillWhatsapp={prefill.phone}
          prefillName={prefill.name}
          prefillInstagram={prefill.handle}
        />
      )}

      <Dialog open={!!moving} onOpenChange={(v) => !v && setMoving(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Mover para Dúvidas & cancelamentos</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {moving?.name || formatPhone(moving?.phone)} sai de Novos contatos. Se depois um pedido for criado para
            este telefone, o card volta sozinho para Aguardando pagamento.
          </p>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 80))}
            placeholder="Motivo (opcional) — ex.: só perguntou o preço"
            onKeyDown={(e) => {
              if (e.key === "Enter" && moving) {
                onMoveToDoubts?.(moving, reason);
                setMoving(null);
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoving(null)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                if (moving) onMoveToDoubts?.(moving, reason);
                setMoving(null);
              }}
            >
              Mover
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
