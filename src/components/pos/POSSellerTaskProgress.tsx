import { useEffect, useState, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ClipboardList, CheckCircle2, Clock, Users, ChevronDown, ChevronRight,
  CalendarDays, CalendarRange, CalendarClock, Loader2, RefreshCw,
} from "lucide-react";

interface StoreOpt { id: string; name: string }

interface Props { stores: StoreOpt[] }

interface Seller {
  id: string;
  name: string;
  store_id: string;
  is_manager: boolean;
}

interface Definition {
  id: string;
  store_id: string;
  title: string;
  category: string;
  recurrence: string;
  recurrence_config: any;
  assignment: string;
  assigned_seller_ids: string[];
}

interface Instance {
  definition_id: string;
  seller_id: string;
  due_date: string;
  status: string;
  progress_current: number;
  progress_target: number;
}

// A row shown in the dashboard = a task definition that applies to a seller,
// overlaid with the latest instance (progress) when one exists.
interface TaskRow {
  definition_id: string;
  title: string;
  recurrence: string;
  recurrence_config: any;
  status: string;
  progress_current: number;
  progress_target: number;
}

// Map recurrence -> group bucket
type GroupKey = "daily" | "weekly" | "monthly" | "custom";
function groupOf(recurrence: string): GroupKey {
  switch (recurrence) {
    case "daily":
    case "weekdays":
      return "daily";
    case "weekly":
    case "weekly_specific":
      return "weekly";
    case "monthly":
    case "monthly_specific":
      return "monthly";
    default:
      return "custom";
  }
}

const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

// Human label describing the recurrence filter of a task.
function recurrenceLabel(recurrence: string, cfg: any): string {
  cfg = cfg || {};
  switch (recurrence) {
    case "daily": return "Todo dia";
    case "weekdays": return "Dias úteis (seg-sex)";
    case "weekly":
      return cfg.weekday != null ? `Semanal · ${WEEKDAYS[Number(cfg.weekday)] || ""}` : "Semanal";
    case "weekly_specific":
      return `Semana ${cfg.week_of_month || "?"} do mês${cfg.weekday != null ? ` · ${WEEKDAYS[Number(cfg.weekday)] || ""}` : ""}`;
    case "monthly":
      return cfg.day_of_month ? `Mensal · dia ${cfg.day_of_month}` : "Mensal";
    case "monthly_specific":
      return `${MONTHS[Number(cfg.month) - 1] || "?"}${cfg.day_of_month ? ` · dia ${cfg.day_of_month}` : ""}`;
    case "once":
      return cfg.date ? `Data: ${cfg.date}` : "Data específica";
    case "custom_range":
      return `${cfg.start_date || "?"} → ${cfg.end_date || "?"}`;
    default: return recurrence;
  }
}

const GROUPS: { key: GroupKey; label: string; icon: any; tint: string }[] = [
  { key: "daily", label: "Diárias", icon: CalendarDays, tint: "text-orange-400" },
  { key: "weekly", label: "Semanais", icon: CalendarRange, tint: "text-blue-400" },
  { key: "monthly", label: "Mensais", icon: CalendarClock, tint: "text-fuchsia-400" },
  { key: "custom", label: "Personalizadas", icon: ClipboardList, tint: "text-cyan-400" },
];

function todaySaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}
function monthStartSaoPaulo(): string {
  return todaySaoPaulo().slice(0, 7) + "-01";
}

function appliesToSeller(def: Definition, seller: Seller): boolean {
  if (def.assignment === "all") return true;
  if (def.assignment === "managers") return !!seller.is_manager;
  if (def.assignment === "specific") return (def.assigned_seller_ids || []).includes(seller.id);
  return false;
}

// per-task completion ratio 0..1
function rowRatio(r: TaskRow): number {
  if (r.status === "completed") return 1;
  if (r.progress_target > 0) return Math.min(r.progress_current / r.progress_target, 1);
  return 0;
}

export function POSSellerTaskProgress({ stores }: Props) {
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [definitions, setDefinitions] = useState<Definition[]>([]);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [loading, setLoading] = useState(false);
  const [storeFilter, setStoreFilter] = useState<string>("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: sd }, { data: dd }, { data: idata }] = await Promise.all([
        supabase
          .from("pos_sellers")
          .select("id, name, store_id, is_manager")
          .eq("is_active", true),
        supabase
          .from("pos_task_definitions" as any)
          .select("id, store_id, title, category, recurrence, recurrence_config, assignment, assigned_seller_ids")
          .eq("is_active", true),
        supabase
          .from("pos_seller_task_instances" as any)
          .select("definition_id, seller_id, due_date, status, progress_current, progress_target")
          .gte("due_date", monthStartSaoPaulo()),
      ]);
      setSellers((sd || []) as Seller[]);
      setDefinitions(((dd || []) as any[]).map((d) => ({
        id: d.id,
        store_id: d.store_id,
        title: d.title || "Tarefa",
        category: d.category || "custom",
        recurrence: d.recurrence || "daily",
        recurrence_config: d.recurrence_config || {},
        assignment: d.assignment || "all",
        assigned_seller_ids: d.assigned_seller_ids || [],
      })));
      setInstances(((idata || []) as any[]).map((i) => ({
        definition_id: i.definition_id,
        seller_id: i.seller_id,
        due_date: i.due_date,
        status: i.status,
        progress_current: i.progress_current ?? 0,
        progress_target: i.progress_target ?? 0,
      })));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const storesById = useMemo(
    () => Object.fromEntries(stores.map((s) => [s.id, s.name])),
    [stores],
  );

  const defsByStore = useMemo(() => {
    const m: Record<string, Definition[]> = {};
    for (const d of definitions) (m[d.store_id] ||= []).push(d);
    return m;
  }, [definitions]);

  // latest instance per (definition_id, seller_id)
  const latestInstance = useMemo(() => {
    const m: Record<string, Instance> = {};
    for (const i of instances) {
      const key = `${i.definition_id}|${i.seller_id}`;
      const cur = m[key];
      if (!cur || i.due_date > cur.due_date) m[key] = i;
    }
    return m;
  }, [instances]);

  const visibleSellers = useMemo(() => {
    const list = storeFilter === "all" ? sellers : sellers.filter((s) => s.store_id === storeFilter);
    // only sellers in a store that has task definitions, and that have at least one applicable task
    return list
      .filter((s) => {
        const defs = defsByStore[s.store_id] || [];
        return defs.some((d) => appliesToSeller(d, s));
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [sellers, defsByStore, storeFilter]);

  const rowsForSeller = useCallback((seller: Seller): TaskRow[] => {
    const defs = (defsByStore[seller.store_id] || []).filter((d) => appliesToSeller(d, seller));
    return defs.map((d) => {
      const inst = latestInstance[`${d.id}|${seller.id}`];
      return {
        definition_id: d.id,
        title: d.title,
        recurrence: d.recurrence,
        recurrence_config: d.recurrence_config,
        status: inst?.status || "pending",
        progress_current: inst?.progress_current ?? 0,
        progress_target: inst?.progress_target ?? 1,
      };
    });
  }, [defsByStore, latestInstance]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Select value={storeFilter} onValueChange={setStoreFilter}>
            <SelectTrigger className="h-8 w-[160px] bg-zinc-900 border-zinc-700 text-zinc-200 text-xs">
              <SelectValue placeholder="Loja" />
            </SelectTrigger>
            <SelectContent className="bg-zinc-900 border-zinc-700 text-zinc-200">
              <SelectItem value="all">Todas as lojas</SelectItem>
              {stores.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            onClick={load}
            className="h-8 px-2 rounded-md bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 flex items-center gap-1 text-xs"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Atualizar
          </button>
        </div>
      </div>

      {loading && sellers.length === 0 ? (
        <div className="flex items-center justify-center py-8 text-zinc-500 text-sm gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando tarefas...
        </div>
      ) : visibleSellers.length === 0 ? (
        <p className="text-zinc-500 text-sm text-center py-6">Nenhuma vendedora com tarefas atribuídas.</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {visibleSellers.map((seller) => (
            <SellerCard
              key={seller.id}
              seller={seller}
              storeName={storesById[seller.store_id] || ""}
              rows={rowsForSeller(seller)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SellerCard({ seller, storeName, rows }: { seller: Seller; storeName: string; rows: TaskRow[] }) {
  const overall = useMemo(() => {
    if (!rows.length) return 0;
    const sum = rows.reduce((acc, r) => acc + rowRatio(r), 0);
    return (sum / rows.length) * 100;
  }, [rows]);

  const completedCount = rows.filter((r) => r.status === "completed").length;

  const grouped = useMemo(() => {
    const m: Record<GroupKey, TaskRow[]> = { daily: [], weekly: [], monthly: [], custom: [] };
    for (const r of rows) m[groupOf(r.recurrence)].push(r);
    return m;
  }, [rows]);

  return (
    <div className="bg-gradient-to-br from-zinc-900/90 to-zinc-950/90 border border-zinc-800 rounded-xl p-4 shadow-lg">
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        <div className="h-10 w-10 rounded-full bg-orange-500/20 flex items-center justify-center text-orange-400 font-bold">
          {seller.name.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-bold text-zinc-100 truncate">{seller.name}</p>
            {seller.is_manager && (
              <Badge variant="outline" className="border-orange-500/40 text-orange-400 text-[10px] gap-1">
                <Users className="h-2.5 w-2.5" /> Gerente
              </Badge>
            )}
          </div>
          <p className="text-[11px] text-zinc-500 truncate">{storeName}</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-zinc-100 drop-shadow">{overall.toFixed(0)}%</p>
          <p className="text-[10px] text-zinc-500">{completedCount}/{rows.length} concluídas</p>
        </div>
      </div>

      {/* Overall bar */}
      <Progress value={overall} className="h-2 bg-zinc-800 mb-3" />

      {/* Groups */}
      <div className="space-y-2">
        {GROUPS.map((g) => {
          const items = grouped[g.key];
          if (!items.length) return null;
          return <TaskGroup key={g.key} group={g} items={items} />;
        })}
      </div>
    </div>
  );
}

function TaskGroup({ group, items }: { group: { key: GroupKey; label: string; icon: any; tint: string }; items: TaskRow[] }) {
  const [open, setOpen] = useState(true);
  const Icon = group.icon;
  const ratio = items.reduce((a, r) => a + rowRatio(r), 0) / items.length * 100;
  // unique by title (newest instance wins) so weekly/monthly don't list duplicate days
  const rows = useMemo(() => {
    const byTitle = new Map<string, TaskRow>();
    for (const r of items) if (!byTitle.has(r.title)) byTitle.set(r.title, r);
    return [...byTitle.values()];
  }, [items]);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 text-zinc-500" /> : <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />}
        <Icon className={`h-3.5 w-3.5 ${group.tint}`} />
        <span className="text-xs font-semibold text-zinc-200">{group.label}</span>
        <span className="text-[10px] text-zinc-500">({rows.length})</span>
        <span className="ml-auto text-[11px] font-bold text-zinc-300">{ratio.toFixed(0)}%</span>
      </button>
      {open && (
        <div className="px-3 pb-2 space-y-1.5">
          {rows.map((r) => {
            const pct = rowRatio(r) * 100;
            const done = r.status === "completed";
            return (
              <div key={r.definition_id} className="flex items-center gap-2">
                {done
                  ? <CheckCircle2 className="h-3.5 w-3.5 text-green-400 shrink-0" />
                  : <Clock className="h-3.5 w-3.5 text-zinc-600 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-[11px] truncate ${done ? "text-zinc-500 line-through" : "text-zinc-200"}`}>
                      {r.title}
                    </span>
                    <span className="text-[10px] text-zinc-400 shrink-0">
                      {r.progress_target > 1 ? `${r.progress_current}/${r.progress_target}` : `${pct.toFixed(0)}%`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="border-zinc-700 text-zinc-500 text-[9px] px-1 py-0 h-4 shrink-0">
                      {recurrenceLabel(r.recurrence, r.recurrence_config)}
                    </Badge>
                    <Progress value={pct} className="h-1 bg-zinc-800 flex-1" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
