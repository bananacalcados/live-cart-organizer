import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Check, ChevronsUpDown, Plus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { sanitizeColorInput, sanitizeSizeInput } from "@/lib/variantValidation";
import { invalidateColorSizeCache } from "@/components/inventory/ColorSizeCombobox";

type Kind = "color" | "size";

interface DictRow { id: string; name: string; slug: string; hex?: string | null; numeric?: number | null }

function slugify(v: string): string {
  return (v || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().trim().replace(/\s+/g, " ");
}

async function loadDict(kind: Kind): Promise<DictRow[]> {
  if (kind === "color") {
    const { data } = await supabase.from("product_colors").select("id, name, slug, hex").order("name");
    return ((data || []) as any[]).map((r) => ({ id: r.id, name: r.name, slug: r.slug, hex: r.hex }));
  }
  const { data } = await supabase
    .from("product_sizes").select("id, label, slug, numeric_value")
    .order("numeric_value", { ascending: true, nullsFirst: false });
  return ((data || []) as any[]).map((r) => ({ id: r.id, name: r.label, slug: r.slug, numeric: r.numeric_value }));
}

interface Props {
  kind: Kind;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  className?: string;
}

export function ColorSizeMultiCombobox({ kind, values, onChange, placeholder, className }: Props) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<DictRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    loadDict(kind).then((r) => { setRows(r); setLoading(false); });
  }, [open, kind]);

  const selectedSlugs = useMemo(() => new Set(values.map(slugify)), [values]);
  const normalizedQuery = slugify(query);
  const existing = rows.find((r) => r.slug === normalizedQuery);

  const filtered = useMemo(() => {
    if (!query.trim()) return rows.slice(0, 300);
    const q = normalizedQuery;
    return rows.filter((r) => r.slug.includes(q) || r.name.toLowerCase().includes(query.toLowerCase())).slice(0, 300);
  }, [rows, query, normalizedQuery]);

  const toggle = (name: string) => {
    const s = slugify(name);
    if (selectedSlugs.has(s)) {
      onChange(values.filter((v) => slugify(v) !== s));
    } else {
      onChange([...values, name]);
    }
  };

  const remove = (name: string) => {
    const s = slugify(name);
    onChange(values.filter((v) => slugify(v) !== s));
  };

  const create = async () => {
    const raw = kind === "color" ? sanitizeColorInput(query) : sanitizeSizeInput(query);
    const clean = raw.trim();
    if (!clean) return;
    setCreating(true);
    try {
      if (kind === "color") {
        const { error } = await supabase.from("product_colors").insert({ name: clean, slug: slugify(clean) });
        if (error && !/duplicate/i.test(error.message)) throw error;
      } else {
        const numeric = /^[0-9]+$/.test(clean) ? Number(clean) : null;
        const { error } = await supabase.from("product_sizes").insert({
          label: clean, slug: slugify(clean), numeric_value: numeric,
          size_group: numeric != null ? "adulto" : "outro",
        } as any);
        if (error && !/duplicate/i.test(error.message)) throw error;
      }
      invalidateColorSizeCache(kind);
      const fresh = await loadDict(kind);
      setRows(fresh);
      if (!selectedSlugs.has(slugify(clean))) onChange([...values, clean]);
      setQuery("");
      toast.success(kind === "color" ? "Cor criada" : "Tamanho criado");
    } catch (e: any) {
      toast.error("Erro: " + (e.message || e));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className={cn("space-y-1.5", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            className="h-9 w-full justify-between font-normal"
          >
            <span className={cn("truncate", values.length === 0 && "text-muted-foreground")}>
              {values.length === 0
                ? (placeholder || (kind === "color" ? "Selecionar cores..." : "Selecionar tamanhos..."))
                : `${values.length} ${kind === "color" ? "cor(es)" : "tamanho(s)"} selecionada(s)`}
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 opacity-50 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-72" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder={kind === "color" ? "Buscar ou criar cor..." : "Buscar ou criar tamanho..."}
              value={query} onValueChange={setQuery}
            />
            <CommandList className="max-h-72">
              {loading ? (
                <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Carregando...
                </div>
              ) : (
                <>
                  {filtered.length === 0 && <CommandEmpty>Nada encontrado.</CommandEmpty>}
                  <CommandGroup>
                    {filtered.map((r) => {
                      const active = selectedSlugs.has(r.slug);
                      return (
                        <CommandItem key={r.id} value={r.slug} onSelect={() => toggle(r.name)}>
                          {kind === "color" && r.hex && (
                            <span className="inline-block w-3 h-3 rounded-full border mr-2 shrink-0"
                              style={{ backgroundColor: r.hex }} />
                          )}
                          <span className="flex-1 truncate">{r.name}</span>
                          {active && <Check className="h-3.5 w-3.5" />}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                  {query.trim() && !existing && (
                    <div className="border-t p-2">
                      <Button type="button" size="sm" variant="secondary" className="w-full h-8"
                        onClick={create} disabled={creating}>
                        {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
                        Criar "{query.trim()}"
                      </Button>
                    </div>
                  )}
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {values.map((v) => {
            const row = rows.find((r) => r.slug === slugify(v));
            return (
              <Badge key={v} variant="secondary" className="gap-1 pr-1">
                {kind === "color" && row?.hex && (
                  <span className="inline-block w-2.5 h-2.5 rounded-full border" style={{ backgroundColor: row.hex }} />
                )}
                {v}
                <button type="button" onClick={() => remove(v)} className="ml-0.5 hover:text-destructive">
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            );
          })}
        </div>
      )}
    </div>
  );
}
