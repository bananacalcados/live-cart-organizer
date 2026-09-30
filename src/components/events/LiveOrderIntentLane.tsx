import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Instagram, Plus, Trash2, MessageCircle, RefreshCw } from "lucide-react";
import { formatDistanceToNowStrict, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { OrderDialogDb } from "@/components/OrderDialogDb";
import { InstagramDMChat } from "@/components/events/InstagramDMChat";
import { toast } from "sonner";

const QUERO_RE = /quero/i;
const norm = (h?: string | null) => (h || "").replace(/^@+/, "").trim().toLowerCase();

interface LiveComment {
  id: string;
  comment_id: string | null;
  username: string;
  comment_text: string;
  created_at: string;
  profile_pic_url: string | null;
}

export interface OrderIntentCard {
  username: string;
  comments: LiveComment[]; // todos do dia, ordem cronológica
  queroCount: number;
  lastQuero: LiveComment;
  profilePic: string | null;
}

function highlight(text: string) {
  const parts = text.split(/(quero)/gi);
  return parts.map((p, i) =>
    /^quero$/i.test(p) ? (
      <mark key={i} className="rounded bg-amber-300 px-0.5 font-bold text-foreground">{p}</mark>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

/** Cards da linha PEDIDOS: quem comentou QUERO na live de hoje e ainda não tem pedido. */
export function useLiveOrderIntents(eventId: string | undefined, orderHandles: Set<string>) {
  const [comments, setComments] = useState<LiveComment[]>([]);
  const [dismissals, setDismissals] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const all: LiveComment[] = [];
    for (let from = 0; from < 20000; from += 1000) {
      const { data, error } = await supabase
        .from("live_comments")
        .select("id, comment_id, username, comment_text, created_at, profile_pic_url")
        .eq("event_id", eventId)
        .gte("created_at", start.toISOString())
        .order("created_at", { ascending: true })
        .range(from, from + 999);
      if (error || !data) break;
      all.push(...(data as LiveComment[]));
      if (data.length < 1000) break;
    }
    const { data: dis } = await supabase
      .from("live_order_intent_dismissals")
      .select("username, dismissed_at")
      .eq("event_id", eventId);
    setComments(all);
    setDismissals(new Map((dis || []).map((d: any) => [norm(d.username), d.dismissed_at])));
    setLoading(false);
  }, [eventId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!eventId) return;
    const ch = supabase
      .channel(`live-order-intents-${eventId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "live_comments", filter: `event_id=eq.${eventId}` },
        (payload) => {
          const c = payload.new as LiveComment;
          setComments((prev) => (prev.some((p) => p.id === c.id) ? prev : [...prev, c]));
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "live_order_intent_dismissals", filter: `event_id=eq.${eventId}` },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [eventId, load]);

  const cards = useMemo<OrderIntentCard[]>(() => {
    const byUser = new Map<string, LiveComment[]>();
    for (const c of comments) {
      const u = norm(c.username);
      if (!u) continue;
      if (!byUser.has(u)) byUser.set(u, []);
      byUser.get(u)!.push(c);
    }
    const out: OrderIntentCard[] = [];
    byUser.forEach((list, u) => {
      if (orderHandles.has(u)) return;
      const queros = list.filter((c) => QUERO_RE.test(c.comment_text || ""));
      if (queros.length === 0) return;
      const dismissedAt = dismissals.get(u);
      const lastQuero = queros[queros.length - 1];
      if (dismissedAt && new Date(lastQuero.created_at) <= new Date(dismissedAt)) return;
      out.push({
        username: u,
        comments: list,
        queroCount: queros.length,
        lastQuero,
        profilePic: list.find((c) => c.profile_pic_url)?.profile_pic_url || null,
      });
    });
    return out.sort((a, b) => b.lastQuero.created_at.localeCompare(a.lastQuero.created_at));
  }, [comments, dismissals, orderHandles]);

  const dismiss = useCallback(
    async (username: string) => {
      if (!eventId) return;
      const now = new Date().toISOString();
      setDismissals((prev) => new Map(prev).set(username, now));
      const { error } = await supabase
        .from("live_order_intent_dismissals")
        .upsert({ event_id: eventId, username, dismissed_at: now }, { onConflict: "event_id,username" });
      if (error) {
        toast.error("Não foi possível excluir o card");
        load();
      }
    },
    [eventId, load],
  );

  return { cards, loading, reload: load, dismiss };
}

interface Props {
  eventId: string;
  cards: OrderIntentCard[];
  loading: boolean;
  onReload: () => void;
  onDismiss: (username: string) => void;
}

export function LiveOrderIntentCards({ eventId, cards, loading, onReload, onDismiss }: Props) {
  const [openUser, setOpenUser] = useState<string | null>(null);
  const [orderOpen, setOrderOpen] = useState(false);
  const [dmOpen, setDmOpen] = useState(false);
  const [confirmUser, setConfirmUser] = useState<string | null>(null);

  const active = cards.find((c) => c.username === openUser) || null;

  const openCard = (u: string) => {
    setOpenUser(u);
    setOrderOpen(false);
  };

  return (
    <>
      {cards.length === 0 ? (
        <div className="flex items-center gap-2 px-1 py-2 text-xs text-muted-foreground">
          Ninguém comentou "QUERO" na live de hoje ainda.
          <button type="button" onClick={onReload} className="inline-flex items-center gap-1 hover:text-foreground">
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} /> atualizar
          </button>
        </div>
      ) : (
        <div className="flex items-stretch gap-2 overflow-x-auto pb-2 scrollbar-thin">
          {cards.map((c) => (
            <div
              key={c.username}
              role="button"
              tabIndex={0}
              onClick={() => openCard(c.username)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && openCard(c.username)}
              className="group relative flex min-h-[104px] w-[230px] shrink-0 cursor-pointer flex-col gap-1 rounded-lg border border-l-4 border-l-amber-400 bg-card px-3 py-2 text-left transition-colors hover:bg-accent"
            >
              <button
                type="button"
                title="Excluir card"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmUser(c.username);
                }}
                className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <div className="flex min-w-0 items-center gap-1.5 pr-7">
                <Instagram className="h-4 w-4 shrink-0 text-pink-500" />
                <span className="truncate text-xs font-semibold">@{c.username}</span>
              </div>
              <span className="line-clamp-2 text-[11px] text-muted-foreground">{highlight(c.lastQuero.comment_text)}</span>
              <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400">
                {c.queroCount} QUERO · {c.comments.length} comentário{c.comments.length !== 1 ? "s" : ""}
              </span>
              <span className="mt-auto text-[10px] text-muted-foreground">
                há {formatDistanceToNowStrict(new Date(c.lastQuero.created_at), { locale: ptBR })}
              </span>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!active} onOpenChange={(v) => !v && setOpenUser(null)}>
        <DialogContent className={cn("max-h-[92vh] p-0", orderOpen ? "max-w-[1200px]" : "max-w-lg")}>
          {active && (
            <div className="flex h-[85vh]">
              <div className={cn("flex min-w-0 flex-col", orderOpen ? "w-[420px] shrink-0 border-r" : "flex-1")}>
                <DialogHeader className="border-b p-4">
                  <DialogTitle className="flex items-center gap-2">
                    <Instagram className="h-5 w-5 text-pink-500" /> @{active.username}
                  </DialogTitle>
                  <p className="text-xs text-muted-foreground">Comentários na live de hoje</p>
                </DialogHeader>
                <ScrollArea className="flex-1 p-3">
                  <div className="space-y-1.5">
                    {active.comments.map((m) => {
                      const q = QUERO_RE.test(m.comment_text);
                      return (
                        <div
                          key={m.id}
                          className={cn(
                            "rounded-md border px-3 py-2 text-sm",
                            q && "border-amber-400/60 bg-amber-400/15",
                          )}
                        >
                          <div className="text-[10px] text-muted-foreground">{format(new Date(m.created_at), "HH:mm:ss")}</div>
                          <div className="break-words">{highlight(m.comment_text)}</div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
                <div className="flex gap-2 border-t p-3">
                  <Button className="flex-1 gap-1.5" onClick={() => setOrderOpen((v) => !v)}>
                    <Plus className="h-4 w-4" /> {orderOpen ? "Fechar pedido" : "Montar pedido"}
                  </Button>
                  <Button variant="outline" className="gap-1.5" onClick={() => setDmOpen(true)}>
                    <MessageCircle className="h-4 w-4" /> Direct
                  </Button>
                </div>
              </div>
              {orderOpen && (
                <div className="min-w-0 flex-1 overflow-y-auto">
                  <OrderDialogDb
                    embedded
                    open
                    onOpenChange={(v) => {
                      if (!v) {
                        setOrderOpen(false);
                        onReload();
                      }
                    }}
                    eventId={eventId}
                    prefillInstagram={active.username}
                    prefillCommentId={active.lastQuero.comment_id || undefined}
                  />
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {active && (
        <InstagramDMChat
          open={dmOpen}
          onOpenChange={setDmOpen}
          username={active.username}
          eventId={eventId}
          fallbackCommentId={active.lastQuero.comment_id || undefined}
          profilePicUrl={active.profilePic}
        />
      )}

      <Dialog open={!!confirmUser} onOpenChange={(v) => !v && setConfirmUser(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Excluir card de @{confirmUser}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            O card some da linha PEDIDOS. Se ela comentar QUERO de novo, ele volta com todos os comentários de hoje.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmUser(null)}>Cancelar</Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (confirmUser) onDismiss(confirmUser);
                if (confirmUser === openUser) setOpenUser(null);
                setConfirmUser(null);
                toast.success("Card excluído");
              }}
            >
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
