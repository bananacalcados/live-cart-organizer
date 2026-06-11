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

interface Instance {
  id: string;
  definition_id: string;
  seller_id: string;
  store_id: string;
  due_date: string;
  status: string;
  progress_current: number;
  progress_target: number;
  title: string;
  recurrence: string;
  category: string;
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
      return "monthly";
    default:
      return "custom";
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

// per-task completion ratio 0..1
function taskRatio(i: Instance): number {
  if (i.status === "completed") return 1;
  if (i.progress_target > 0) return Math.min(i.progress_current / i.progress_target, 1);
  return 0;
}

export function POSSellerTaskProgress({ stores }: Props) {
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [loading, setLoading] = useState(false);
  const [storeFilter, setStoreFilter] = useState<string>("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: sd }, { data: idata }] = await Promise.all([
        supabase
          .from("pos_sellers")
          .select("id, name, store_id, is_manager")
          .eq("is_active", true),
        supabase
          .from("pos_seller_task_instances" as any)
          .select("id, definition_id, seller_id, store_id, due_date, status, progress_current, progress_target, pos_task_definitions(title, recurrence, category)")
          .gte("due_date", monthStartSaoPaulo()),
      ]);
      setSellers((sd || []) as Seller[]);
      const mapped: Instance[] = ((idata || []) as any[]).map((i) => ({
        id: i.id,
        definition_id: i.definition_id,
        seller_id: i.seller_id,
        store_id: i.store_id,
        due_date: i.due_date,
        status: i.status,
        progress_current: i.progress_current ?? 0,
        progress_target: i.progress_target ?? 0,
        title: i.pos_task_definitions?.title || "Tarefa",
        recurrence: i.pos_task_definitions?.recurrence || "daily",
        category: i.pos_task_definitions?.category || "custom",
      }));
      setInstances(mapped);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const storesById = useMemo(
    () => Object.fromEntries(stores.map((s) => [s.id, s.name])),
    [stores],
  );

  const visibleSellers = useMemo(() => {
    const list = storeFilter === "all" ? sellers : sellers.filter((s) => s.store_id === storeFilter);
    // only sellers that have at least one instance
    const withTasks = new Set(instances.map((i) => i.seller_id));
    return list
      .filter((s) => withTasks.has(s.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [sellers, instances, storeFilter]);

  const instancesBySeller = useMemo(() => {
    const m: Record<string, Instance[]> = {};
    for (const i of instances) (m[i.seller_id] ||= []).push(i);
    return m;
  }, [instances]);

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

      {loading && instances.length === 0 ? (
        <div className="flex items-center justify-center py-8 text-zinc-500 text-sm gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando tarefas...
        </div>
      ) : visibleSellers.length === 0 ? (
        <p className="text-zinc-500 text-sm text-center py-6">Nenhuma tarefa gerada para as vendedoras ainda.</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {visibleSellers.map((seller) => (
            <SellerCard
              key={seller.id}
              seller={seller}
              storeName={storesById[seller.store_id] || ""}
              instances={instancesBySeller[seller.id] || []}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SellerCard({ seller, storeName, instances }: { seller: Seller; storeName: string; instances: Instance[] }) {
  const overall = useMemo(() => {
    if (!instances.length) return 0;
    const sum = instances.reduce((acc, i) => acc + taskRatio(i), 0);
    return (sum / instances.length) * 100;
  }, [instances]);

  const completedCount = instances.filter((i) => i.status === "completed").length;

  const grouped = useMemo(() => {
    const m: Record<GroupKey, Instance[]> = { daily: [], weekly: [], monthly: [], custom: [] };
    for (const i of instances) m[groupOf(i.recurrence)].push(i);
    return m;
  }, [instances]);

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
          <p className="text-[10px] text-zinc-500">{completedCount}/{instances.length} concluídas</p>
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

function TaskGroup({ group, items }: { group: { key: GroupKey; label: string; icon: any; tint: string }; items: Instance[] }) {
  const [open, setOpen] = useState(true);
  const Icon = group.icon;
  const ratio = items.reduce((a, i) => a + taskRatio(i), 0) / items.length * 100;
  // unique by title (newest instance wins) so weekly/monthly don't list duplicate days
  const rows = useMemo(() => {
    const byTitle = new Map<string, Instance>();
    for (const i of [...items].sort((a, b) => b.due_date.localeCompare(a.due_date))) {
      if (!byTitle.has(i.title)) byTitle.set(i.title, i);
    }
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
          {rows.map((i) => {
            const pct = taskRatio(i) * 100;
            const done = i.status === "completed";
            return (
              <div key={i.id} className="flex items-center gap-2">
                {done
                  ? <CheckCircle2 className="h-3.5 w-3.5 text-green-400 shrink-0" />
                  : <Clock className="h-3.5 w-3.5 text-zinc-600 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-[11px] truncate ${done ? "text-zinc-500 line-through" : "text-zinc-200"}`}>
                      {i.title}
                    </span>
                    <span className="text-[10px] text-zinc-400 shrink-0">
                      {i.progress_target > 1 ? `${i.progress_current}/${i.progress_target}` : `${pct.toFixed(0)}%`}
                    </span>
                  </div>
                  <Progress value={pct} className="h-1 bg-zinc-800 mt-0.5" />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
