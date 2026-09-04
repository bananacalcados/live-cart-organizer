import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Order } from "@/types/order";
import { WhatsAppChatDialog } from "@/components/WhatsAppChatDialog";
import { OrderDialogDb } from "@/components/OrderDialogDb";
import { cn } from "@/lib/utils";
import { MessageCircle, Phone, Plus, RefreshCw, UserPlus } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import { ptBR } from "date-fns/locale";

interface LiveNewContactsLaneProps {
  eventId: string;
  /** Sufixos (DDD + 8 dígitos) de telefones que JÁ possuem pedido neste evento. */
  excludeKeys: Set<string>;
  /** Texto de busca da aba Pedidos. */
  search?: string;
  onCountChange?: (count: number) => void;
}

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
  talked: boolean;
  createdAt: string;
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
 * Linha "NOVOS CONTATOS" da aba Pedidos: quem digitou o WhatsApp no link
 * redirecionador DESTE evento e ainda não tem pedido criado. Inclui quem
 * confirmou o número e não chegou a mandar mensagem.
 */
export function LiveNewContactsLane({
  eventId,
  excludeKeys,
  search,
  onCountChange,
}: LiveNewContactsLaneProps) {
  const [rows, setRows] = useState<ClickRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [chatOrder, setChatOrder] = useState<Order | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [prefill, setPrefill] = useState<{ phone: string; name?: string } | null>(null);
  const [orderOpen, setOrderOpen] = useState(false);

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

  // Tempo real: novos cliques confirmados entram na linha sem recarregar a tela.
  useEffect(() => {
    if (!eventId) return;
    const channel = supabase
      .channel(`live-new-contacts-${eventId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "live_whatsapp_clicks" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId, load]);

  const contacts: NewContact[] = useMemo(() => {
    const byKey = new Map<string, NewContact>();
    for (const r of rows) {
      const phone = r.real_phone || r.phone || r.entered_phone || "";
      const key = suffix8(phone);
      if (!key || key.length < 8) continue;
      if (excludeKeys.has(key)) continue;
      const existing = byKey.get(key);
      const contact: NewContact = {
        key,
        phone,
        name: r.lead?.name && !/^lead whatsapp$/i.test(r.lead.name) ? r.lead.name : null,
        talked: !!r.phone,
        createdAt: r.created_at,
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
            c.phone.replace(/\D/g, "").includes(q.replace(/\D/g, "")),
        )
      : list;
    return filtered.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }, [rows, excludeKeys, search]);

  useEffect(() => {
    onCountChange?.(contacts.length);
  }, [contacts.length, onCountChange]);

  const openChat = (c: NewContact) => {
    setChatOrder({
      id: `live-contact-${c.key}`,
      instagramHandle: "",
      whatsapp: c.phone,
      products: [],
      stage: "new" as Order["stage"],
      createdAt: new Date(c.createdAt),
      updatedAt: new Date(c.createdAt),
    } as Order);
    setChatOpen(true);
  };

  return (
    <div>
      {contacts.length === 0 ? (
        <div className="flex items-center gap-2 px-1 py-2 text-xs text-muted-foreground">
          Ninguém digitou o WhatsApp no link desta live ainda.
          <button type="button" onClick={load} className="inline-flex items-center gap-1 hover:text-foreground">
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} /> atualizar
          </button>
        </div>
      ) : (
        <div className="flex items-stretch gap-2 overflow-x-auto pb-2 scrollbar-thin">
          {contacts.map((c) => (
            <div
              key={c.key}
              role="button"
              tabIndex={0}
              onClick={() => openChat(c)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") openChat(c);
              }}
              title="Abrir conversa"
              className="group relative flex min-h-[104px] w-[210px] shrink-0 cursor-pointer flex-col gap-1 rounded-lg border border-y-neutral-700 border-r-neutral-700 border-l-4 border-l-sky-400 bg-neutral-900 px-3 py-2 text-left text-white transition-colors hover:bg-neutral-800"
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-400/20 text-sky-300">
                  <UserPlus className="h-3 w-3" />
                </span>
                <span className="truncate text-xs font-semibold">{c.name || "Novo contato"}</span>
              </div>
              <span className="flex items-center gap-1 truncate text-[11px] text-white/70">
                <Phone className="h-3 w-3 shrink-0" />
                {formatPhone(c.phone)}
              </span>
              <span className="text-[12px] font-bold text-sky-300">
                {c.talked ? "Falou com a gente" : "Digitou e não falou"}
              </span>
              <span className="text-[10px] text-white/50">
                há {formatDistanceToNowStrict(new Date(c.createdAt), { locale: ptBR })}
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
                    setPrefill({ phone: c.phone, name: c.name || undefined });
                    setOrderOpen(true);
                  }}
                  className="inline-flex items-center gap-1 rounded-md border border-sky-400/50 bg-sky-400/15 px-2 py-1 text-[10px] font-semibold text-sky-200 hover:bg-sky-400/25"
                >
                  <Plus className="h-3 w-3" /> Pedido
                </button>
              </div>
            </div>
          ))}
        </div>
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
        />
      )}
    </div>
  );
}
