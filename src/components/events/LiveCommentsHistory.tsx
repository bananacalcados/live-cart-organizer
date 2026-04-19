import { useEffect, useState, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Instagram, ShoppingCart, HelpCircle, MessageSquare, Sparkles,
  Send, Search, Users, Filter, CheckCheck, AlertCircle, History, Plus,
} from "lucide-react";
import { toast } from "sonner";
import { OrderDialogDb } from "@/components/OrderDialogDb";

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

interface UserGroup {
  username: string;
  handle: string;
  profile_pic_url: string | null;
  comments: LiveComment[];
  hasOrder: boolean;
  hasQuestion: boolean;
  hasPurchased: boolean;
  latestCommentId: string;
  latestCommentAt: string;
}

interface DmLog {
  id: string;
  comment_id: string;
  username: string;
  message: string;
  status: string;
  created_at: string;
}

const cleanHandle = (h: string) => (h || "").replace(/^@/, "").trim().toLowerCase();

const classificationConfig: Record<string, { label: string; color: string }> = {
  order: { label: "🛒 Pedido", color: "bg-green-500/20 text-green-700 dark:text-green-300 border-green-500/30" },
  question: { label: "❓ Dúvida", color: "bg-blue-500/20 text-blue-700 dark:text-blue-300 border-blue-500/30" },
  engagement: { label: "✨ Engaj.", color: "bg-pink-500/20 text-pink-700 dark:text-pink-300 border-pink-500/30" },
  comment: { label: "💬", color: "bg-zinc-500/20 text-zinc-600 dark:text-zinc-400 border-zinc-500/30" },
  spam: { label: "🚫", color: "bg-zinc-700/20 text-zinc-500 border-zinc-700/30" },
};

interface Props {
  eventId: string;
}

export function LiveCommentsHistory({ eventId }: Props) {
  const [comments, setComments] = useState<LiveComment[]>([]);
  const [purchasedHandles, setPurchasedHandles] = useState<Set<string>>(new Set());
  const [dms, setDms] = useState<DmLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterIntent, setFilterIntent] = useState(false);
  const [filterQuestion, setFilterQuestion] = useState(false);
  const [filterMulti, setFilterMulti] = useState(false);
  const [filterExcludeBuyers, setFilterExcludeBuyers] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set()); // handles
  const [dmModalOpen, setDmModalOpen] = useState(false);
  const [dmMessage, setDmMessage] = useState("");
  const [dmTargets, setDmTargets] = useState<UserGroup[]>([]);
  const [sending, setSending] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const loadAll = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);

    // Comentários (até 2000 — cobre lives longas)
    const { data: cmts } = await supabase
      .from("live_comments")
      .select("id, comment_id, username, comment_text, profile_pic_url, is_order, ai_classification, created_at")
      .eq("event_id", eventId)
      .order("created_at", { ascending: false })
      .limit(2000);

    // Pedidos pagos do evento → handles que compraram
    const { data: paidOrders } = await supabase
      .from("orders")
      .select("customer_id, is_paid, stage")
      .eq("event_id", eventId)
      .or("is_paid.eq.true,stage.in.(paid,shipped,delivered,completed,concluido,pago)");

    const buyerHandles = new Set<string>();
    if (paidOrders && paidOrders.length > 0) {
      const ids = [...new Set(paidOrders.map((o: any) => o.customer_id).filter(Boolean))];
      if (ids.length > 0) {
        const { data: custs } = await supabase
          .from("customers")
          .select("id, instagram_handle")
          .in("id", ids);
        (custs || []).forEach((c: any) => {
          const h = cleanHandle(c.instagram_handle || "");
          if (h) buyerHandles.add(h);
        });
      }
    }

    // Histórico de DMs do evento
    const { data: dmLog } = await supabase
      .from("live_comment_dms")
      .select("id, comment_id, username, message, status, created_at")
      .eq("event_id", eventId)
      .order("created_at", { ascending: false })
      .limit(500);

    setComments((cmts as LiveComment[]) || []);
    setPurchasedHandles(buyerHandles);
    setDms((dmLog as DmLog[]) || []);
    setLoading(false);
  }, [eventId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Realtime: novos comentários entram automaticamente
  useEffect(() => {
    if (!eventId) return;
    const ch = supabase
      .channel(`live-history-${eventId}-${Date.now()}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "live_comments",
        filter: `event_id=eq.${eventId}`,
      }, (payload) => {
        const c = payload.new as LiveComment;
        setComments(prev => {
          if (prev.some(x => x.id === c.id || x.comment_id === c.comment_id)) return prev;
          return [c, ...prev];
        });
      })
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "live_comments",
        filter: `event_id=eq.${eventId}`,
      }, (payload) => {
        const upd = payload.new as LiveComment;
        setComments(prev => prev.map(c => c.id === upd.id ? { ...c, ...upd } : c));
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [eventId]);

  // Agrupa por usuário
  const userGroups = useMemo<UserGroup[]>(() => {
    const map = new Map<string, UserGroup>();
    for (const c of comments) {
      const handle = cleanHandle(c.username);
      if (!handle) continue;
      let g = map.get(handle);
      if (!g) {
        g = {
          username: c.username,
          handle,
          profile_pic_url: c.profile_pic_url,
          comments: [],
          hasOrder: false,
          hasQuestion: false,
          hasPurchased: purchasedHandles.has(handle),
          latestCommentId: c.comment_id,
          latestCommentAt: c.created_at,
        };
        map.set(handle, g);
      }
      g.comments.push(c);
      if (c.is_order || c.ai_classification === "order") g.hasOrder = true;
      if (c.ai_classification === "question") g.hasQuestion = true;
      if (!g.profile_pic_url && c.profile_pic_url) g.profile_pic_url = c.profile_pic_url;
      if (c.created_at > g.latestCommentAt) {
        g.latestCommentAt = c.created_at;
        g.latestCommentId = c.comment_id;
      }
    }
    return Array.from(map.values());
  }, [comments, purchasedHandles]);

  // Filtros
  const filtered = useMemo(() => {
    let list = userGroups;
    const q = search.trim().toLowerCase();
    if (q) list = list.filter(g => g.handle.includes(q) || g.comments.some(c => c.comment_text.toLowerCase().includes(q)));
    if (filterIntent) list = list.filter(g => g.hasOrder);
    if (filterQuestion) list = list.filter(g => g.hasQuestion);
    if (filterMulti) list = list.filter(g => g.comments.length >= 3);
    if (filterExcludeBuyers) list = list.filter(g => !g.hasPurchased);
    return list.sort((a, b) => b.latestCommentAt.localeCompare(a.latestCommentAt));
  }, [userGroups, search, filterIntent, filterQuestion, filterMulti, filterExcludeBuyers]);

  const stats = useMemo(() => ({
    totalUsers: userGroups.length,
    intentUsers: userGroups.filter(g => g.hasOrder).length,
    questionUsers: userGroups.filter(g => g.hasQuestion).length,
    multiUsers: userGroups.filter(g => g.comments.length >= 3).length,
    buyersUsers: userGroups.filter(g => g.hasPurchased).length,
  }), [userGroups]);

  const allFilteredSelected = filtered.length > 0 && filtered.every(g => selected.has(g.handle));
  const toggleAll = () => {
    if (allFilteredSelected) {
      const next = new Set(selected);
      filtered.forEach(g => next.delete(g.handle));
      setSelected(next);
    } else {
      const next = new Set(selected);
      filtered.forEach(g => next.add(g.handle));
      setSelected(next);
    }
  };

  const toggleOne = (handle: string) => {
    const next = new Set(selected);
    if (next.has(handle)) next.delete(handle); else next.add(handle);
    setSelected(next);
  };

  const openDmIndividual = (group: UserGroup) => {
    setDmTargets([group]);
    setDmMessage(`Oi @${group.handle}! Vi que você comentou na nossa live 💛 `);
    setDmModalOpen(true);
  };

  const openDmBulk = () => {
    const targets = filtered.filter(g => selected.has(g.handle));
    if (targets.length === 0) {
      toast.error("Selecione pelo menos um usuário");
      return;
    }
    setDmTargets(targets);
    setDmMessage("Oi @{username}! Vi que você comentou na nossa live 💛 ");
    setDmModalOpen(true);
  };

  const sendDms = async () => {
    if (!dmMessage.trim()) {
      toast.error("Digite uma mensagem");
      return;
    }
    setSending(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const { data, error } = await supabase.functions.invoke("instagram-send-bulk-dm", {
        body: {
          event_id: eventId,
          message_template: dmMessage,
          sent_by: auth?.user?.id || null,
          targets: dmTargets.map(g => ({
            comment_id: g.latestCommentId,
            username: g.handle,
          })),
        },
      });
      if (error) throw error;
      const sent = data?.sent ?? 0;
      const failed = data?.failed ?? 0;
      if (failed > 0) {
        toast.warning(`${sent} enviadas, ${failed} falharam. (DMs só funcionam até 7 dias após o comentário)`);
      } else {
        toast.success(`${sent} DM(s) enviada(s)!`);
      }
      setDmModalOpen(false);
      setSelected(new Set());
      loadAll();
    } catch (e) {
      console.error(e);
      toast.error("Erro ao enviar DMs");
    } finally {
      setSending(false);
    }
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Card><CardContent className="p-3">
          <div className="text-xs text-muted-foreground">Usuários</div>
          <div className="text-2xl font-bold">{stats.totalUsers}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-xs text-muted-foreground">🛒 Intenção</div>
          <div className="text-2xl font-bold text-green-600 dark:text-green-400">{stats.intentUsers}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-xs text-muted-foreground">❓ Dúvidas</div>
          <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{stats.questionUsers}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-xs text-muted-foreground">🔥 Múltiplos</div>
          <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">{stats.multiUsers}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-xs text-muted-foreground">✅ Compraram</div>
          <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{stats.buyersUsers}</div>
        </CardContent></Card>
      </div>

      {/* Toolbar */}
      <Card>
        <CardContent className="p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por @usuário ou texto..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-9"
              />
            </div>
            <Button variant="outline" size="sm" onClick={() => setHistoryOpen(true)} className="gap-1">
              <History className="h-4 w-4" /> Histórico DMs ({dms.length})
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={openDmBulk}
              disabled={selected.size === 0}
              className="gap-1"
            >
              <Send className="h-4 w-4" /> Enviar DM ({selected.size})
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Filter className="h-3 w-3" /> Filtros:
            </span>
            <Button
              variant={filterIntent ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterIntent(!filterIntent)}
              className="h-7 text-xs"
            >
              🛒 Intenção compra
            </Button>
            <Button
              variant={filterQuestion ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterQuestion(!filterQuestion)}
              className="h-7 text-xs"
            >
              ❓ Fez pergunta
            </Button>
            <Button
              variant={filterMulti ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterMulti(!filterMulti)}
              className="h-7 text-xs"
            >
              🔥 3+ comentários
            </Button>
            <Button
              variant={filterExcludeBuyers ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterExcludeBuyers(!filterExcludeBuyers)}
              className="h-7 text-xs"
            >
              🚫 Excluir compradores
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Lista */}
      <Card>
        <CardContent className="p-0">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
            <Checkbox checked={allFilteredSelected} onCheckedChange={toggleAll} />
            <span className="text-xs text-muted-foreground">
              <Users className="inline h-3 w-3 mr-1" />
              {filtered.length} usuário(s) {selected.size > 0 && `· ${selected.size} selecionado(s)`}
            </span>
          </div>

          <ScrollArea className="h-[calc(100vh-440px)] min-h-[400px]">
            {loading && <div className="p-6 text-center text-muted-foreground">Carregando...</div>}
            {!loading && filtered.length === 0 && (
              <div className="p-6 text-center text-muted-foreground text-sm">
                Nenhum usuário encontrado com os filtros atuais.
              </div>
            )}
            <div className="divide-y divide-border">
              {filtered.map(group => {
                const isSelected = selected.has(group.handle);
                return (
                  <div
                    key={group.handle}
                    className={`p-3 hover:bg-muted/30 transition ${isSelected ? "bg-primary/5" : ""}`}
                  >
                    <div className="flex items-start gap-3">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleOne(group.handle)}
                        className="mt-1"
                      />

                      {group.profile_pic_url ? (
                        <img
                          src={group.profile_pic_url}
                          alt={group.handle}
                          className="w-10 h-10 rounded-full object-cover border border-border shrink-0"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center text-sm font-bold text-white shrink-0">
                          {group.handle.charAt(0).toUpperCase()}
                        </div>
                      )}

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="font-bold text-sm text-pink-600 dark:text-pink-300">
                            @{group.handle}
                          </span>
                          <Badge variant="secondary" className="text-[10px]">
                            {group.comments.length} coment.
                          </Badge>
                          {group.hasOrder && (
                            <Badge className="text-[10px] bg-green-500/20 text-green-700 dark:text-green-300 border-green-500/30">
                              <ShoppingCart className="h-2.5 w-2.5 mr-0.5" /> Intenção
                            </Badge>
                          )}
                          {group.hasQuestion && (
                            <Badge className="text-[10px] bg-blue-500/20 text-blue-700 dark:text-blue-300 border-blue-500/30">
                              <HelpCircle className="h-2.5 w-2.5 mr-0.5" /> Dúvida
                            </Badge>
                          )}
                          {group.hasPurchased && (
                            <Badge className="text-[10px] bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">
                              <CheckCheck className="h-2.5 w-2.5 mr-0.5" /> Comprou
                            </Badge>
                          )}
                          <span className="text-[10px] text-muted-foreground ml-auto">
                            {formatTime(group.latestCommentAt)}
                          </span>
                        </div>

                        <div className="space-y-1 mb-2">
                          {group.comments.slice(0, 3).map(c => {
                            const cfg = classificationConfig[c.ai_classification || "comment"] || classificationConfig.comment;
                            return (
                              <div key={c.id} className="flex items-start gap-2 text-xs">
                                <Badge variant="outline" className={`${cfg.color} text-[9px] py-0 shrink-0`}>
                                  {cfg.label}
                                </Badge>
                                <span className="text-foreground break-words">{c.comment_text}</span>
                              </div>
                            );
                          })}
                          {group.comments.length > 3 && (
                            <div className="text-[10px] text-muted-foreground italic">
                              + {group.comments.length - 3} comentário(s)
                            </div>
                          )}
                        </div>

                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs gap-1"
                          onClick={() => openDmIndividual(group)}
                        >
                          <Instagram className="h-3 w-3" /> Enviar DM
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Modal DM */}
      <Dialog open={dmModalOpen} onOpenChange={setDmModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Instagram className="h-5 w-5 text-pink-500" />
              Enviar DM no Instagram
            </DialogTitle>
            <DialogDescription>
              {dmTargets.length === 1
                ? `Mensagem direta para @${dmTargets[0]?.handle}`
                : `Disparo em massa para ${dmTargets.length} usuário(s). Use {username} para personalizar.`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <Textarea
              value={dmMessage}
              onChange={(e) => setDmMessage(e.target.value)}
              rows={5}
              placeholder="Digite a mensagem..."
              className="resize-none"
            />
            <div className="flex items-start gap-2 text-xs text-muted-foreground bg-amber-500/10 border border-amber-500/30 rounded p-2">
              <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <strong>Limite Meta:</strong> DM via comentário só funciona até 7 dias depois do comentário.
                Cada usuário recebe no máximo 1 DM por comentário.
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDmModalOpen(false)} disabled={sending}>
              Cancelar
            </Button>
            <Button onClick={sendDms} disabled={sending} className="gap-1">
              <Send className="h-4 w-4" />
              {sending ? "Enviando..." : `Enviar (${dmTargets.length})`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Histórico de DMs */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5" /> Histórico de DMs enviadas
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="h-[60vh]">
            {dms.length === 0 && (
              <div className="text-center text-muted-foreground py-8 text-sm">
                Nenhuma DM enviada ainda neste evento.
              </div>
            )}
            <div className="space-y-2">
              {dms.map(d => (
                <Card key={d.id}>
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-sm text-pink-600 dark:text-pink-300">
                        @{cleanHandle(d.username)}
                      </span>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className={d.status === "sent"
                            ? "bg-green-500/20 text-green-700 dark:text-green-300 border-green-500/30 text-[10px]"
                            : "bg-red-500/20 text-red-700 dark:text-red-300 border-red-500/30 text-[10px]"
                          }
                        >
                          {d.status === "sent" ? "✓ Enviada" : "✗ Erro"}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">{formatTime(d.created_at)}</span>
                      </div>
                    </div>
                    <p className="text-sm text-foreground">{d.message}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
