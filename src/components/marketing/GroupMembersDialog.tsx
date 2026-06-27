import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Users, RefreshCw, Loader2, Crown, UserPlus, UserMinus,
  ArrowUpCircle, ArrowDownCircle, Star, ShieldCheck, EyeOff, Eye, Flame,
  BarChart3, MessageCircle, Heart,
} from "lucide-react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Member {
  id: string;
  phone: string;
  status: string;
  is_admin: boolean;
  is_internal: boolean;
  customer_id: string | null;
  display_name: string | null;
  joined_at: string | null;
  left_at: string | null;
  last_event_at: string;
}

interface MemberEvent {
  id: string;
  phone: string;
  event_type: string;
  is_internal: boolean;
  customer_id: string | null;
  display_name: string | null;
  created_at: string;
}

interface Activity {
  poll_votes: number;
  messages: number;
  reactions: number;
  total: number;
  last_activity_at: string | null;
}

interface Props {
  group: { id: string; group_id: string; name: string };
  instanceId: string | null;
  canSync: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const EVENT_META: Record<string, { label: string; icon: typeof UserPlus; cls: string }> = {
  joined: { label: "entrou", icon: UserPlus, cls: "text-emerald-600 dark:text-emerald-400" },
  left: { label: "saiu", icon: UserMinus, cls: "text-red-600 dark:text-red-400" },
  promoted: { label: "virou admin", icon: ArrowUpCircle, cls: "text-amber-600 dark:text-amber-400" },
  demoted: { label: "rebaixado", icon: ArrowDownCircle, cls: "text-muted-foreground" },
};

/** Pontos de engajamento (votar > comentar > reagir). Voto = intenção forte. */
function engagementScore(a: Activity | undefined): number {
  if (!a) return 0;
  const poll = Math.min(25, a.poll_votes * 8);
  const msg = Math.min(14, a.messages * 3);
  const react = Math.min(8, a.reactions * 2);
  return Math.min(35, poll + msg + react);
}

/** Lead score 0–100: vínculo CRM, permanência, cargo, histórico e ENGAJAMENTO. */
function leadScore(m: Member, joinCounts: Map<string, number>, a: Activity | undefined): number {
  let s = 0;
  if (m.status === "member") s += 18;
  if (m.customer_id) s += 25;
  if (m.is_admin) s += 8;
  if (m.joined_at) {
    const days = (Date.now() - new Date(m.joined_at).getTime()) / 86_400_000;
    if (days > 0) s += Math.min(12, Math.round(days / 5));
  }
  if ((joinCounts.get(m.phone) || 0) > 1) s += 6; // re-entrou = engajado
  s += engagementScore(a); // votou/comentou/reagiu no grupo
  if (m.status === "left") s -= 25;
  return Math.max(0, Math.min(100, s));
}

function scoreColor(score: number): string {
  if (score >= 70) return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30";
  if (score >= 40) return "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30";
  return "bg-muted text-muted-foreground";
}

function fmtPhone(p: string): string {
  const d = p.replace(/\D/g, "");
  if (d.length >= 12) {
    const ddd = d.slice(2, 4);
    const rest = d.slice(4);
    return `(${ddd}) ${rest.slice(0, rest.length - 4)}-${rest.slice(-4)}`;
  }
  return p;
}

function fmtDate(s: string): string {
  return new Date(s).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function GroupMembersDialog({ group, instanceId, canSync, open, onOpenChange }: Props) {
  const [members, setMembers] = useState<Member[]>([]);
  const [events, setEvents] = useState<MemberEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [search, setSearch] = useState("");
  const [showInternal, setShowInternal] = useState(false);

  const groupDigits = useMemo(() => String(group.group_id || "").replace(/\D/g, ""), [group.group_id]);

  const fetchData = useCallback(async () => {
    if (!groupDigits) return;
    setIsLoading(true);
    try {
      const [mRes, eRes] = await Promise.all([
        supabase
          .from("whatsapp_group_members")
          .select("id, phone, status, is_admin, is_internal, customer_id, display_name, joined_at, left_at, last_event_at")
          .eq("group_id", groupDigits)
          .order("last_event_at", { ascending: false }),
        supabase
          .from("whatsapp_group_member_events")
          .select("id, phone, event_type, is_internal, customer_id, display_name, created_at")
          .eq("group_id", groupDigits)
          .order("created_at", { ascending: false })
          .limit(150),
      ]);
      setMembers((mRes.data || []) as Member[]);
      setEvents((eRes.data || []) as MemberEvent[]);
    } catch {
      toast.error("Erro ao carregar membros");
    } finally {
      setIsLoading(false);
    }
  }, [groupDigits]);

  useEffect(() => {
    if (open) fetchData();
  }, [open, fetchData]);

  const syncMembers = async () => {
    if (!instanceId) {
      toast.error("Selecione a instância uazapi do grupo para atualizar membros");
      return;
    }
    setIsSyncing(true);
    toast.info("Buscando membros atuais no WhatsApp...");
    try {
      const { data, error } = await supabase.functions.invoke("uazapi-groups", {
        body: { action: "syncMembers", whatsapp_number_id: instanceId, groupIds: [group.id] },
      });
      if (error) throw error;
      if (data?.success) {
        const r = data.results?.[0];
        if (r?.error) toast.error("Não foi possível ler os membros deste grupo (sem permissão ou fora do grupo).");
        else toast.success(`${r?.resolved ?? 0} membros sincronizados${r?.customers ? ` · ${r.customers} clientes` : ""}`);
        fetchData();
      } else {
        toast.error(data?.error || "Erro ao sincronizar membros");
      }
    } catch {
      toast.error("Erro ao sincronizar membros");
    } finally {
      setIsSyncing(false);
    }
  };

  const joinCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of events) {
      if (e.event_type === "joined") m.set(e.phone, (m.get(e.phone) || 0) + 1);
    }
    return m;
  }, [events]);

  const visibleMembers = useMemo(() => {
    let list = members.filter((m) => showInternal || !m.is_internal);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((m) => (m.display_name || "").toLowerCase().includes(q) || m.phone.includes(q.replace(/\D/g, "")));
    }
    return list
      .map((m) => ({ m, score: leadScore(m, joinCounts) }))
      .sort((a, b) => {
        // membros atuais primeiro, depois por score
        if ((a.m.status === "member") !== (b.m.status === "member")) return a.m.status === "member" ? -1 : 1;
        return b.score - a.score;
      });
  }, [members, showInternal, search, joinCounts]);

  const stats = useMemo(() => {
    const real = members.filter((m) => !m.is_internal);
    return {
      current: real.filter((m) => m.status === "member").length,
      customers: real.filter((m) => m.status === "member" && m.customer_id).length,
      admins: real.filter((m) => m.status === "member" && m.is_admin).length,
      left: real.filter((m) => m.status === "left").length,
    };
  }, [members]);

  const visibleEvents = events.filter((e) => showInternal || !e.is_internal);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-4 w-4" /> Membros · {group.name}
          </DialogTitle>
        </DialogHeader>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          <Input placeholder="Buscar por nome ou telefone..." value={search} onChange={(e) => setSearch(e.target.value)} className="flex-1 min-w-[180px] h-9" />
          <Button variant="outline" size="sm" onClick={() => setShowInternal((v) => !v)} className="gap-1">
            {showInternal ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            {showInternal ? "Ocultar internos" : "Mostrar internos"}
          </Button>
          <Button variant="outline" size="sm" onClick={syncMembers} disabled={isSyncing || !canSync} className="gap-1"
            title={canSync ? "Lê os membros atuais do grupo via WhatsApp" : "Selecione a instância deste grupo para atualizar"}>
            {isSyncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Atualizar membros
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-2">
          <StatBox label="Membros" value={stats.current} icon={Users} />
          <StatBox label="Clientes" value={stats.customers} icon={Star} cls="text-amber-500" />
          <StatBox label="Admins" value={stats.admins} icon={Crown} cls="text-amber-500" />
          <StatBox label="Saíram" value={stats.left} icon={UserMinus} cls="text-red-500" />
        </div>

        <Tabs defaultValue="members">
          <TabsList>
            <TabsTrigger value="members" className="gap-1"><Flame className="h-3.5 w-3.5" />Lead Scoring</TabsTrigger>
            <TabsTrigger value="events" className="gap-1"><RefreshCw className="h-3.5 w-3.5" />Movimentação</TabsTrigger>
          </TabsList>

          {/* MEMBERS / LEAD SCORING */}
          <TabsContent value="members">
            {isLoading ? (
              <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : visibleMembers.length === 0 ? (
              <EmptyState onSync={syncMembers} canSync={canSync} />
            ) : (
              <ScrollArea className="h-[340px] pr-3">
                <div className="space-y-1.5">
                  {visibleMembers.map(({ m, score }) => (
                    <div key={m.id} className={`flex items-center gap-2 p-2 rounded-md border ${m.status === "left" ? "opacity-60" : "bg-card"}`}>
                      <Badge variant="outline" className={`text-[11px] font-semibold tabular-nums w-9 justify-center ${scoreColor(score)}`}>{score}</Badge>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate flex items-center gap-1">
                          {m.display_name || fmtPhone(m.phone)}
                          {m.customer_id && <Star className="h-3 w-3 text-amber-500 fill-amber-500 shrink-0" />}
                          {m.is_admin && <ShieldCheck className="h-3 w-3 text-amber-500 shrink-0" />}
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[11px] text-muted-foreground">{fmtPhone(m.phone)}</span>
                          {m.joined_at && <span className="text-[11px] text-muted-foreground">· entrou {fmtDate(m.joined_at)}</span>}
                          {m.is_internal && <Badge variant="secondary" className="text-[9px]">interno</Badge>}
                        </div>
                      </div>
                      {m.status === "left" ? (
                        <Badge variant="outline" className="text-[10px] border-red-500/40 text-red-600 dark:text-red-400">saiu</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-600 dark:text-emerald-400">no grupo</Badge>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </TabsContent>

          {/* EVENTS */}
          <TabsContent value="events">
            {isLoading ? (
              <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : visibleEvents.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">Nenhuma movimentação registrada ainda.</div>
            ) : (
              <ScrollArea className="h-[340px] pr-3">
                <div className="space-y-1">
                  {visibleEvents.map((e) => {
                    const meta = EVENT_META[e.event_type] || EVENT_META.joined;
                    const Icon = meta.icon;
                    return (
                      <div key={e.id} className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50">
                        <Icon className={`h-4 w-4 shrink-0 ${meta.cls}`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm truncate">
                            <span className="font-medium">{e.display_name || fmtPhone(e.phone)}</span>{" "}
                            <span className={meta.cls}>{meta.label}</span>
                            {e.customer_id && <Star className="h-3 w-3 text-amber-500 fill-amber-500 inline ml-1" />}
                          </p>
                        </div>
                        <span className="text-[11px] text-muted-foreground shrink-0">{fmtDate(e.created_at)}</span>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function StatBox({ label, value, icon: Icon, cls }: { label: string; value: number; icon: typeof Users; cls?: string }) {
  return (
    <div className="rounded-md border bg-card p-2 text-center">
      <Icon className={`h-4 w-4 mx-auto mb-0.5 ${cls || "text-muted-foreground"}`} />
      <p className="text-base font-semibold tabular-nums leading-none">{value}</p>
      <p className="text-[10px] text-muted-foreground mt-0.5">{label}</p>
    </div>
  );
}

function EmptyState({ onSync, canSync }: { onSync: () => void; canSync: boolean }) {
  return (
    <div className="py-10 text-center">
      <Users className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
      <p className="text-sm text-muted-foreground mb-1">Nenhum membro registrado ainda.</p>
      <p className="text-xs text-muted-foreground mb-4">
        Tire a "foto inicial" dos membros atuais. Depois, entradas e saídas são rastreadas automaticamente.
      </p>
      <Button variant="outline" size="sm" onClick={onSync} disabled={!canSync} className="gap-1">
        <RefreshCw className="h-3.5 w-3.5" />Atualizar membros agora
      </Button>
    </div>
  );
}
