import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Trophy, Loader2, ShoppingBag, MessageSquare, Radio, Calendar, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface ParticipantRow {
  handle: string;
  comment_count: number;
  live_count: number;
  paid_orders: number;
  cancelled_orders: number;
  total_spent: number;
  avg_ticket: number;
  last_participation: string | null;
  live_dates: string[];
  score: number;
  category: string;
}

const CATEGORY_META: Record<string, { label: string; className: string }> = {
  vip: { label: "VIP", className: "bg-purple-600 text-white" },
  engajado: { label: "Engajado", className: "bg-blue-600 text-white" },
  ativo: { label: "Ativo", className: "bg-teal-600 text-white" },
  frio: { label: "Frio", className: "bg-neutral-400 text-white" },
};

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function ParticipantScorePanel() {
  const [rows, setRows] = useState<ParticipantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.rpc("participant_score_ranking", {
        p_handles: null,
      });
      if (cancelled) return;
      if (!error && data) setRows(data as unknown as ParticipantRow[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase().replace(/^@/, "");
    return rows.filter((r) => {
      if (filter !== "all" && r.category !== filter) return false;
      if (q && !r.handle.includes(q)) return false;
      return true;
    });
  }, [rows, search, filter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length, vip: 0, engajado: 0, ativo: 0, frio: 0 };
    rows.forEach((r) => (c[r.category] = (c[r.category] || 0) + 1));
    return c;
  }, [rows]);

  return (
    <Card className="p-4">
      <div className="mb-4 flex items-center gap-2">
        <Trophy className="h-5 w-5 text-amber-500" />
        <h2 className="text-lg font-bold">Participante Score</h2>
        <span className="ml-2 text-sm text-muted-foreground">
          Ranking de engajamento de quem comenta nas lives
        </span>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar @..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {(["all", "vip", "engajado", "ativo", "frio"] as const).map((key) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                filter === key ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:bg-muted/70",
              )}
            >
              {key === "all" ? "Todos" : CATEGORY_META[key].label} ({counts[key] || 0})
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando ranking...
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          Nenhum participante encontrado.
        </div>
      ) : (
        <ScrollArea className="h-[60vh]">
          <div className="space-y-2 pr-3">
            {filtered.map((r, i) => {
              const meta = CATEGORY_META[r.category] || CATEGORY_META.frio;
              return (
                <div
                  key={r.handle}
                  className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/40"
                >
                  <div className="w-7 shrink-0 text-center text-sm font-bold text-muted-foreground">
                    {i + 1}
                  </div>
                  <Avatar className="h-10 w-10 shrink-0">
                    <AvatarFallback className="bg-amber-500/20 text-amber-700 text-xs">
                      {r.handle.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-sm">@{r.handle}</span>
                      <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase", meta.className)}>
                        {meta.label}
                      </span>
                      <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                        {r.score} pts
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Radio className="h-3 w-3" /> {r.live_count} live(s)
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <MessageSquare className="h-3 w-3" /> {r.comment_count} coment.
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <ShoppingBag className="h-3 w-3" /> {r.paid_orders} compra(s)
                      </span>
                      {r.cancelled_orders > 0 && (
                        <span className="inline-flex items-center gap-1 text-destructive">
                          <XCircle className="h-3 w-3" /> {r.cancelled_orders} cancel.
                        </span>
                      )}
                      <span>Gasto: {brl(r.total_spent)}</span>
                      <span>Ticket: {brl(r.avg_ticket)}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        Última: {r.last_participation ? new Date(r.last_participation).toLocaleDateString("pt-BR") : "—"}
                      </span>
                      {r.live_dates?.length > 0 && (
                        <span title={r.live_dates.join(" • ")}>
                          Lives: {r.live_dates.slice(0, 5).join(", ")}
                          {r.live_dates.length > 5 ? ` +${r.live_dates.length - 5}` : ""}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </Card>
  );
}
