import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Loader2, Users } from "lucide-react";
import { MultiSelectFilter } from "./MultiSelectFilter";

export interface AudienceFilterBlock {
  sizes?: string[];
  cities?: string[];
  ddds?: string[];
  categories?: string[];
  brands?: string[];
  stores?: string[];
  payment_methods?: string[];
  min_avg_ticket?: string;
  max_avg_ticket?: string;
  min_total_orders?: string;
  max_total_orders?: string;
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
};

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

  return (
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
    return out;
  };
  return { include: clean(f.include), exclude: clean(f.exclude) };
}

interface Props {
  value: AudienceFilter;
  onChange: (next: AudienceFilter) => void;
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
