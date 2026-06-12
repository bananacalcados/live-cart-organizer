// Projeção client-side de quais definições de tarefa se aplicam a uma data/vendedora.
// Espelha a lógica de supabase/functions/pos-tasks-generate/index.ts (appliesToday / appliesToSeller)
// para podermos exibir tarefas futuras e marcar dias no mini-calendário SEM gerar instâncias no banco.

export interface TaskDefinitionLite {
  id: string;
  title: string;
  description?: string | null;
  category: string;
  verification_mode: "manual" | "auto";
  target_count: number;
  recurrence: string;
  recurrence_config: any;
  assignment: "all" | "managers" | "specific" | string;
  assigned_seller_ids: string[];
  points_reward: number;
  is_active: boolean;
}

export interface SellerLite {
  id: string;
  name: string;
  is_manager?: boolean;
}

/** Data de hoje (YYYY-MM-DD) no fuso de São Paulo. */
export function todaySaoPaulo(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}

/** Desloca uma data (YYYY-MM-DD) em N dias. */
export function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00-03:00");
  d.setDate(d.getDate() + days);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(d);
}

/** Dia da semana (0=domingo..6=sábado) para uma data YYYY-MM-DD. */
function weekday(dateStr: string): number {
  const d = new Date(dateStr + "T12:00:00-03:00");
  return d.getDay();
}

/** Dia do mês 1..31. */
function dayOfMonth(dateStr: string): number {
  return Number(dateStr.slice(8, 10));
}

/** Mês 1..12. */
function monthOf(dateStr: string): number {
  return Number(dateStr.slice(5, 7));
}

/** A definição se aplica nesta data conforme a recorrência? */
export function appliesOnDate(def: TaskDefinitionLite, dateStr: string): boolean {
  if (!def.is_active) return false;
  const cfg = def.recurrence_config || {};
  switch (def.recurrence) {
    case "daily":
      return true;
    case "weekdays": {
      const wd = weekday(dateStr);
      return wd >= 1 && wd <= 5;
    }
    case "once":
      return cfg.date === dateStr;
    case "custom_range": {
      if (cfg.start_date && dateStr < cfg.start_date) return false;
      if (cfg.end_date && dateStr > cfg.end_date) return false;
      return true;
    }
    case "weekly": {
      if (cfg.weekday === undefined || cfg.weekday === null) return true;
      return weekday(dateStr) === Number(cfg.weekday);
    }
    case "weekly_specific": {
      const weekOfMonth = Math.ceil(dayOfMonth(dateStr) / 7);
      if (cfg.week_of_month && weekOfMonth !== Number(cfg.week_of_month)) return false;
      if (cfg.weekday !== undefined && cfg.weekday !== null && weekday(dateStr) !== Number(cfg.weekday)) return false;
      return true;
    }
    case "monthly": {
      if (!cfg.day_of_month) return true;
      return dayOfMonth(dateStr) === Number(cfg.day_of_month);
    }
    case "monthly_specific": {
      if (cfg.month && monthOf(dateStr) !== Number(cfg.month)) return false;
      if (cfg.day_of_month && dayOfMonth(dateStr) !== Number(cfg.day_of_month)) return false;
      return true;
    }
    default:
      return true;
  }
}

/** A definição se aplica a esta vendedora? */
export function appliesToSeller(def: TaskDefinitionLite, seller: SellerLite): boolean {
  if (def.assignment === "all") return true;
  if (def.assignment === "managers") return !!seller.is_manager;
  if (def.assignment === "specific") return (def.assigned_seller_ids || []).includes(seller.id);
  return false;
}

/** Definições aplicáveis a (vendedora, data). */
export function projectTasks(
  defs: TaskDefinitionLite[],
  seller: SellerLite,
  dateStr: string,
): TaskDefinitionLite[] {
  return defs.filter((d) => appliesToSeller(d, seller) && appliesOnDate(d, dateStr));
}

/** Mapa dia(YYYY-MM-DD) -> definições, para um mês inteiro e uma vendedora. */
export function projectMonth(
  defs: TaskDefinitionLite[],
  seller: SellerLite,
  year: number,
  month0: number, // 0-based
): Record<string, TaskDefinitionLite[]> {
  const out: Record<string, TaskDefinitionLite[]> = {};
  const daysInMonth = new Date(year, month0 + 1, 0).getDate();
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month0 + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const matches = projectTasks(defs, seller, dateStr);
    if (matches.length) out[dateStr] = matches;
  }
  return out;
}

/** Cor estável para uma definição (para os marcadores do calendário). */
const TASK_COLORS = [
  "#f97316", // orange
  "#3b82f6", // blue
  "#10b981", // green
  "#a855f7", // purple
  "#ec4899", // pink
  "#eab308", // yellow
  "#06b6d4", // cyan
  "#ef4444", // red
];

export function colorForDefinition(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return TASK_COLORS[hash % TASK_COLORS.length];
}

const CONTACT_CATEGORIES = new Set(["contact_old_customers", "post_sale", "cold_leads"]);
export function isContactCategory(category: string): boolean {
  return CONTACT_CATEGORIES.has(category);
}
