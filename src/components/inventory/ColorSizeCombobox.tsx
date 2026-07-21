import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Check, ChevronsUpDown, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { sanitizeColorInput, sanitizeSizeInput } from "@/lib/variantValidation";

/**
 * Combobox linked to product_colors / product_sizes dictionaries.
 * - Search + select existing entries
 * - Inline "criar" for new values (upserts into dictionary immediately)
 * - Emits the string value (name/label) to keep compatibility with existing text-based flows.
 *   The DB trigger `auto_link_color_size_variants` links the FK on save.
 */

type Kind = "color" | "size";

interface DictRow {
  id: string;
  name: string;   // color: name; size: label (mapped)
  slug: string;
  hex?: string | null;
}

let colorCache: { at: number; rows: DictRow[] } | null = null;
let sizeCache: { at: number; rows: DictRow[] } | null = null;
const CACHE_MS = 60_000;

function slugify(v: string): string {
  return (v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

async function loadDict(kind: Kind, force = false): Promise<DictRow[]> {
  const cache = kind === "color" ? colorCache : sizeCache;
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.rows;
  if (kind === "color") {
    const { data } = await supabase.from("product_colors").select("id, name, slug, hex").order("name");
    const rows = ((data || []) as any[]).map((r) => ({ id: r.id, name: r.name, slug: r.slug, hex: r.hex }));
    colorCache = { at: Date.now(), rows };
    return rows;
  } else {
    const { data } = await supabase
      .from("product_sizes")
      .select("id, label, slug, numeric_value")
      .order("numeric_value", { ascending: true, nullsFirst: false });
    const rows = ((data || []) as any[]).map((r) => ({ id: r.id, name: r.label, slug: r.slug }));
    sizeCache = { at: Date.now(), rows };
    return rows;
  }
}

export function invalidateColorSizeCache(kind?: Kind) {
  if (!kind || kind === "color") colorCache = null;
  if (!kind || kind === "size") sizeCache = null;
}

interface Props {
  kind: Kind;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export function ColorSizeCombobox({ kind, value, onChange, placeholder, className, disabled }: Props) {
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

  const normalizedQuery = useMemo(() => slugify(query), [query]);
  const existing = useMemo(
    () => rows.find((r) => r.slug === normalizedQuery),
    [rows, normalizedQuery]
  );

  const filtered = useMemo(() => {
    if (!query.trim()) return rows.slice(0, 200);
    const q = normalizedQuery;
    return rows
      .filter((r) => r.slug.includes(q) || r.name.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 200);
  }, [rows, query, normalizedQuery]);

  const currentRow = useMemo(
    () => rows.find((r) => r.slug === slugify(value)),
    [rows, value]
  );

  const create = async () => {
    const raw = kind === "color" ? sanitizeColorInput(query) : sanitizeSizeInput(query);
    const clean = raw.trim();
    if (!clean) return;
    setCreating(true);
    try {
      if (kind === "color") {
        const payload = { name: clean, slug: slugify(clean) };
        const { error } = await supabase.from("product_colors").insert(payload);
        if (error && !/duplicate/i.test(error.message)) throw error;
      } else {
        const numeric = /^[0-9]+$/.test(clean) ? Number(clean) : null;
        const payload = {
          label: clean,
          slug: slugify(clean),
          numeric_value: numeric,
          size_group: numeric != null ? "adulto" : "outro",
        } as any;
        const { error } = await supabase.from("product_sizes").insert(payload);
        if (error && !/duplicate/i.test(error.message)) throw error;
      }
      invalidateColorSizeCache(kind);
      const fresh = await loadDict(kind, true);
      setRows(fresh);
      onChange(clean);
      setOpen(false);
      setQuery("");
      toast.success(kind === "color" ? "Cor criada" : "Tamanho criado");
    } catch (e: any) {
      toast.error("Erro: " + (e.message || e));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          disabled={disabled}
          className={cn("h-8 w-full justify-between font-normal", className)}
        >
          <span className="flex items-center gap-1.5 truncate">
            {kind === "color" && currentRow?.hex && (
              <span
                className="inline-block w-3 h-3 rounded-full border shrink-0"
                style={{ backgroundColor: currentRow.hex }}
              />
            )}
            <span className={cn("truncate", !value && "text-muted-foreground")}>
              {value || placeholder || (kind === "color" ? "Selecionar cor" : "Selecionar tamanho")}
            </span>
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-64" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={kind === "color" ? "Buscar cor..." : "Buscar tamanho..."}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList className="max-h-60">
            {loading ? (
              <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Carregando...
              </div>
            ) : (
              <>
                {filtered.length === 0 && <CommandEmpty>Nada encontrado.</CommandEmpty>}
                <CommandGroup>
                  {filtered.map((r) => (
                    <CommandItem
                      key={r.id}
                      value={r.slug}
                      onSelect={() => {
                        onChange(r.name);
                        setOpen(false);
                        setQuery("");
                      }}
                    >
                      {kind === "color" && r.hex && (
                        <span
                          className="inline-block w-3 h-3 rounded-full border mr-2 shrink-0"
                          style={{ backgroundColor: r.hex }}
                        />
                      )}
                      <span className="flex-1 truncate">{r.name}</span>
                      {slugify(value) === r.slug && <Check className="h-3.5 w-3.5" />}
                    </CommandItem>
                  ))}
                </CommandGroup>
                {query.trim() && !existing && (
                  <div className="border-t p-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="w-full h-8"
                      onClick={create}
                      disabled={creating}
                    >
                      {creating ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                      ) : (
                        <Plus className="h-3.5 w-3.5 mr-1" />
                      )}
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
  );
}
