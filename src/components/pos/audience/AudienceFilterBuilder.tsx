import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Users, List } from "lucide-react";
import { MultiSelectFilter } from "./MultiSelectFilter";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

export type LastPurchaseOp = "" | "gt_days" | "lt_days" | "after" | "before" | "between";

export interface AudienceFilterBlock {
  sizes?: string[];
  cities?: string[];
  ddds?: string[];
  categories?: string[];
  brands?: string[];
  stores?: string[];
  payment_methods?: string[];
  rfm_segments?: string[];
  min_avg_ticket?: string;
  max_avg_ticket?: string;
  min_total_orders?: string;
  max_total_orders?: string;
  last_purchase_op?: LastPurchaseOp;
  last_purchase_days?: string;
  last_purchase_from?: string;
  last_purchase_to?: string;
}

export interface AudienceFilter {
  include: AudienceFilterBlock;
  exclude: AudienceFilterBlock;
}

interface Options {
  cities: string[];
  ddds: string[];
  states: string[];
  sizes: string[];
  categories: string[];
  brands: string[];
  stores: string[];
  payment_methods: string[];
  rfm_segments: string[];
}

const EMPTY_OPTIONS: Options = {
  cities: [],
  ddds: [],
  states: [],
  sizes: [],
  categories: [],
  brands: [],
  stores: [],
  payment_methods: [],
  rfm_segments: [],
};

// Rótulos amigáveis para a Matriz RFM (PT-BR).
export const RFM_LABELS: Record<string, string> = {
  champions: "Campeões",
  loyal_customers: "Clientes fiéis",
  promising: "Promissores",
  new_customers: "Novos clientes",
  at_risk: "Em risco",
  cant_lose: "Não posso perder",
  hibernating: "Hibernando",
  lost: "Perdidos",
  leads: "Leads",
  others: "Outros",
};

const LAST_PURCHASE_OPTS: { value: LastPurchaseOp; label: string }[] = [
  { value: "", label: "Sem filtro de período" },
  { value: "gt_days", label: "Comprou há mais de N dias" },
  { value: "lt_days", label: "Comprou há menos de N dias" },
  { value: "after", label: "Última compra depois de uma data" },
  { value: "before", label: "Última compra antes de uma data" },
  { value: "between", label: "Comprou entre duas datas" },
];

export const emptyAudienceFilter = (): AudienceFilter => ({ include: {}, exclude: {} });

interface BlockProps {
  tone: "include" | "exclude";
  block: AudienceFilterBlock;
  options: Options;
  onChange: (next: AudienceFilterBlock) => void;
}

function FilterBlock({ tone, block, options, onChange }: BlockProps) {
  const set = (key: keyof AudienceFilterBlock, value: string[] | string) =>
    onChange({ ...block, [key]: value });

  const op = (block.last_purchase_op || "") as LastPurchaseOp;
  const rfmOpts = options.rfm_segments.map((s) => ({ value: s, label: RFM_LABELS[s] || s }));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <MultiSelectFilter label="Tamanho" tone={tone} options={options.sizes}
          value={block.sizes || []} onChange={(v) => set("sizes", v)} />
        <MultiSelectFilter label="Cidade" tone={tone} options={options.cities}
          value={block.cities || []} onChange={(v) => set("cities", v)} />
        <MultiSelectFilter label="DDD" tone={tone} options={options.ddds}
          value={block.ddds || []} onChange={(v) => set("ddds", v)} />
        <MultiSelectFilter label="Categoria de produtos" tone={tone} options={options.categories}
          value={block.categories || []} onChange={(v) => set("categories", v)} />
        <MultiSelectFilter label="Marcas" tone={tone} options={options.brands}
          value={block.brands || []} onChange={(v) => set("brands", v)} />
        <MultiSelectFilter label="Lojas" tone={tone} options={options.stores}
          value={block.stores || []} onChange={(v) => set("stores", v)} />
        <MultiSelectFilter label="Formas de pagamento" tone={tone} options={options.payment_methods}
          value={block.payment_methods || []} onChange={(v) => set("payment_methods", v)} />
        <MultiSelectFilter
          label="Matriz RFM"
          tone={tone}
          options={rfmOpts.map((o) => o.value)}
          renderLabel={(v) => RFM_LABELS[v] || v}
          value={block.rfm_segments || []}
          onChange={(v) => set("rfm_segments", v)}
        />

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-neutral-600">Ticket médio (R$)</label>
          <div className="flex items-center gap-2">
            <Input type="number" inputMode="decimal" placeholder="mín" className="h-9 text-xs bg-white"
              value={block.min_avg_ticket || ""} onChange={(e) => set("min_avg_ticket", e.target.value)} />
            <span className="text-neutral-400 text-xs">a</span>
            <Input type="number" inputMode="decimal" placeholder="máx" className="h-9 text-xs bg-white"
              value={block.max_avg_ticket || ""} onChange={(e) => set("max_avg_ticket", e.target.value)} />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-neutral-600">Quantidade de compras</label>
          <div className="flex items-center gap-2">
            <Input type="number" inputMode="numeric" placeholder="mín" className="h-9 text-xs bg-white"
              value={block.min_total_orders || ""} onChange={(e) => set("min_total_orders", e.target.value)} />
            <span className="text-neutral-400 text-xs">a</span>
            <Input type="number" inputMode="numeric" placeholder="máx" className="h-9 text-xs bg-white"
              value={block.max_total_orders || ""} onChange={(e) => set("max_total_orders", e.target.value)} />
          </div>
        </div>
      </div>

      {/* Período da última compra */}
      <div className="space-y-1.5 rounded-lg border border-neutral-200 bg-white/60 p-2.5">
        <label className="text-xs font-medium text-neutral-600">Período da última compra</label>
        <Select value={op} onValueChange={(v) => set("last_purchase_op", v === "none" ? "" : v)}>
          <SelectTrigger className="h-9 text-xs bg-white">
            <SelectValue placeholder="Sem filtro de período" />
          </SelectTrigger>
          <SelectContent>
            {LAST_PURCHASE_OPTS.map((o) => (
              <SelectItem key={o.value || "none"} value={o.value || "none"}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {(op === "gt_days" || op === "lt_days") && (
          <div className="flex items-center gap-2 pt-1">
            <Input type="number" inputMode="numeric" placeholder="dias" className="h-9 text-xs bg-white w-28"
              value={block.last_purchase_days || ""} onChange={(e) => set("last_purchase_days", e.target.value)} />
            <span className="text-neutral-400 text-xs">dias</span>
          </div>
        )}
        {op === "after" && (
          <Input type="date" className="h-9 text-xs bg-white mt-1"
            value={block.last_purchase_from || ""} onChange={(e) => set("last_purchase_from", e.target.value)} />
        )}
        {op === "before" && (
          <Input type="date" className="h-9 text-xs bg-white mt-1"
            value={block.last_purchase_to || ""} onChange={(e) => set("last_purchase_to", e.target.value)} />
        )}
        {op === "between" && (
          <div className="flex items-center gap-2 pt-1">
            <Input type="date" className="h-9 text-xs bg-white"
              value={block.last_purchase_from || ""} onChange={(e) => set("last_purchase_from", e.target.value)} />
            <span className="text-neutral-400 text-xs">a</span>
            <Input type="date" className="h-9 text-xs bg-white"
              value={block.last_purchase_to || ""} onChange={(e) => set("last_purchase_to", e.target.value)} />
          </div>
        )}
      </div>
    </div>
  );
}

/** Remove empty arrays / blank strings so the JSON stays clean for the RPC. */
export function cleanAudienceFilter(f: AudienceFilter): AudienceFilter {
  const clean = (b: AudienceFilterBlock): AudienceFilterBlock => {
    const out: AudienceFilterBlock = {};
    (Object.keys(b) as (keyof AudienceFilterBlock)[]).forEach((k) => {
      const v = b[k];
      if (Array.isArray(v)) {
        if (v.length > 0) (out[k] as string[]) = v;
      } else if (typeof v === "string" && v.trim() !== "") {
        (out[k] as string) = v.trim();
      }
    });
    // Drop incomplete period filters so the RPC doesn't get partial data.
    const op = out.last_purchase_op;
    if (!op) {
      delete out.last_purchase_op;
      delete out.last_purchase_days;
      delete out.last_purchase_from;
      delete out.last_purchase_to;
    } else if ((op === "gt_days" || op === "lt_days") && !out.last_purchase_days) {
      delete out.last_purchase_op;
    } else if (op === "after" && !out.last_purchase_from) {
      delete out.last_purchase_op;
    } else if (op === "before" && !out.last_purchase_to) {
      delete out.last_purchase_op;
    } else if (op === "between" && (!out.last_purchase_from || !out.last_purchase_to)) {
      delete out.last_purchase_op;
    }
    return out;
  };
  return { include: clean(f.include), exclude: clean(f.exclude) };
}

interface Props {
  value: AudienceFilter;
  onChange: (next: AudienceFilter) => void;
}

interface AudienceMember {
  cliente_id: string;
  nome: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  tamanhos: string[] | null;
  avg_ticket: number | null;
  total_orders: number | null;
  last_purchase_at: string | null;
}

const PAGE = 100;

const fmtMoney = (v?: number | null) =>
  typeof v === "number"
    ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    : "—";
const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("pt-BR") : "—";
const fmtPhone = (p?: string | null) => {
  if (!p) return "—";
  const d = p.replace(/\D/g, "");
  const local = d.length > 11 ? d.slice(-11) : d;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return p;
};

function AudienceListDialog({
  open, onOpenChange, filtro, total,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  filtro: AudienceFilter;
  total: number | null;
}) {
  const [rows, setRows] = useState<AudienceMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRows([]);
    setPage(0);
    setDone(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.rpc("list_campaign_audience", {
        p_filtro: filtro as unknown as never,
        p_limit: PAGE,
        p_offset: page * PAGE,
      });
      if (!active) return;
      if (!error && Array.isArray(data)) {
        setRows((prev) => (page === 0 ? data : [...prev, ...data]) as AudienceMember[]);
        if (data.length < PAGE) setDone(true);
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [open, page]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-4 w-4 text-blue-600" />
            Clientes do público
            {total != null && (
              <span className="text-sm font-normal text-neutral-500">
                ({total.toLocaleString("pt-BR")} no total)
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-auto -mx-2 px-2">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-white">
              <tr className="text-left text-neutral-500 border-b">
                <th className="py-2 pr-2">#</th>
                <th className="py-2 pr-2">Nome</th>
                <th className="py-2 pr-2">Telefone</th>
                <th className="py-2 pr-2">Cidade/UF</th>
                <th className="py-2 pr-2">Tamanhos</th>
                <th className="py-2 pr-2 text-right">Compras</th>
                <th className="py-2 pr-2 text-right">Ticket méd.</th>
                <th className="py-2 pr-2">Últ. compra</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.cliente_id} className="border-b border-neutral-100 hover:bg-blue-50/40">
                  <td className="py-1.5 pr-2 text-neutral-400">{i + 1}</td>
                  <td className="py-1.5 pr-2 font-medium text-neutral-800">{r.nome || "—"}</td>
                  <td className="py-1.5 pr-2 tabular-nums">{fmtPhone(r.phone)}</td>
                  <td className="py-1.5 pr-2 text-neutral-600">
                    {[r.city, r.state].filter(Boolean).join(" / ") || "—"}
                  </td>
                  <td className="py-1.5 pr-2 text-neutral-600">
                    {(r.tamanhos || []).join(", ") || "—"}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{r.total_orders ?? 0}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{fmtMoney(r.avg_ticket)}</td>
                  <td className="py-1.5 pr-2 text-neutral-600">{fmtDate(r.last_purchase_at)}</td>
                </tr>
              ))}
              {rows.length === 0 && !loading && (
                <tr><td colSpan={8} className="py-8 text-center text-neutral-400">
                  Nenhum cliente neste público.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-center pt-2">
          {loading ? (
            <span className="flex items-center gap-2 text-sm text-blue-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
            </span>
          ) : !done && rows.length > 0 ? (
            <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)}>
              Carregar mais
            </Button>
          ) : rows.length > 0 ? (
            <span className="text-xs text-neutral-400">{rows.length} clientes carregados</span>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AudienceFilterBuilder({ value, onChange }: Props) {
  const [options, setOptions] = useState<Options>(EMPTY_OPTIONS);
  const [count, setCount] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc("audience_filter_options");
      if (data) setOptions({ ...EMPTY_OPTIONS, ...(data as Partial<Options>) });
    })();
  }, []);

  const cleaned = useMemo(() => cleanAudienceFilter(value), [value]);
  const cleanedKey = useMemo(() => JSON.stringify(cleaned), [cleaned]);

  useEffect(() => {
    let active = true;
    setCounting(true);
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc("count_campaign_audience", {
        p_filtro: cleaned as unknown as never,
      });
      if (!active) return;
      if (!error) setCount(typeof data === "number" ? data : 0);
      setCounting(false);
    }, 450);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [cleanedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
        <h4 className="text-sm font-bold text-emerald-700 mb-3 flex items-center gap-2">
          ✅ Incluir clientes que atendem
        </h4>
        <FilterBlock tone="include" block={value.include} options={options}
          onChange={(b) => onChange({ ...value, include: b })} />
      </section>

      <section className="rounded-xl border border-rose-200 bg-rose-50/40 p-4">
        <h4 className="text-sm font-bold text-rose-700 mb-3 flex items-center gap-2">
          🚫 Excluir clientes que atendem
        </h4>
        <FilterBlock tone="exclude" block={value.exclude} options={options}
          onChange={(b) => onChange({ ...value, exclude: b })} />
      </section>

      <div className="sticky bottom-0 flex items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700 shadow-sm">
        <Users className="h-4 w-4" />
        {counting ? (
          <span className="flex items-center gap-2 text-blue-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Calculando público...
          </span>
        ) : (
          <span>
            Público estimado:{" "}
            <span className="text-blue-900">{(count ?? 0).toLocaleString("pt-BR")}</span> clientes
          </span>
        )}
      </div>
    </div>
  );
}
