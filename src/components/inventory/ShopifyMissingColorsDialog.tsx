import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, Loader2, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const PAGE_SIZE = 50;

type ShopifyVariant = {
  shopify_variant_id: string;
  sku: string | null;
  size: string | null;
  price: number | null;
  barcode: string | null;
};

type MissingColorRow = {
  master_id: string;
  shopify_product_id: string;
  product_name: string;
  shopify_color: string;
  variants: ShopifyVariant[];
  possible_erp_colors: string[];
  kind: "missing" | "spelling";
  synced_at: string;
  total_count: number;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
};

const brl = (value: number | null) => Number(value ?? 0).toLocaleString("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function ShopifyMissingColorsDialog({ open, onOpenChange, onImported }: Props) {
  const [rows, setRows] = useState<MissingColorRow[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(0);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("shopify_missing_colors", {
      p_limit: PAGE_SIZE,
      p_offset: page * PAGE_SIZE,
      p_search: debouncedSearch || null,
    });
    if (error) {
      toast.error(`Erro ao carregar cores: ${error.message}`);
      setRows([]);
      setTotal(0);
    } else {
      const list = (data || []) as MissingColorRow[];
      setRows(list);
      setTotal(Number(list[0]?.total_count || 0));
    }
    setLoading(false);
  }, [debouncedSearch, page]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const importColor = async (row: MissingColorRow) => {
    if (row.kind === "spelling") {
      const confirmed = window.confirm(
        `O ERP já tem uma cor parecida (${row.possible_erp_colors.join(", ")}). Confira se não é a mesma cor. Deseja importar ${row.shopify_color} mesmo assim?`,
      );
      if (!confirmed) return;
    }
    const key = `${row.master_id}|${row.shopify_color}`;
    setImporting(key);
    try {
      const { data, error } = await supabase.rpc("import_shopify_missing_color", {
        p_master_id: row.master_id,
        p_shopify_product_id: row.shopify_product_id,
        p_shopify_color: row.shopify_color,
      });
      if (error) throw error;
      const result = data as { code?: string; variants_created?: number; already_exists?: boolean };
      if (result.already_exists) {
        toast.info(`Essa cor já estava cadastrada. Código ${result.code}.`);
      } else {
        toast.success(`${result.variants_created} variações importadas. Código ${result.code} gerado.`);
      }
      onImported();
      await load();
    } catch (error: any) {
      toast.error(`Não foi possível importar: ${error?.message || error}`, { duration: 10000 });
    } finally {
      setImporting(null);
    }
  };

  const missingRows = useMemo(() => rows.filter((row) => row.kind === "missing"), [rows]);
  const spellingRows = useMemo(() => rows.filter((row) => row.kind === "spelling"), [rows]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const renderRow = (row: MissingColorRow) => {
    const key = `${row.master_id}|${row.shopify_color}`;
    return (
      <div key={key} className="rounded-lg border p-4 space-y-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <p className="font-semibold">{row.product_name}</p>
            <p className="mt-1 text-sm">Cor na Shopify: <b>{row.shopify_color}</b></p>
            {row.possible_erp_colors.length > 0 && (
              <p className="mt-1 flex items-start gap-1.5 text-sm text-amber-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                Pode ser só grafia diferente de: <b>{row.possible_erp_colors.join(", ")}</b>
              </p>
            )}
          </div>
          <Button
            size="sm"
            variant={row.kind === "spelling" ? "outline" : "default"}
            onClick={() => void importColor(row)}
            disabled={importing !== null}
            className="shrink-0"
          >
            {importing === key ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            {row.kind === "spelling" ? "Importar mesmo assim" : "Importar cor"}
          </Button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {(row.variants || []).map((variant) => (
            <div key={variant.shopify_variant_id} className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs">
              <span className="font-mono font-medium">{variant.sku || "Sem SKU"}</span>
              <Badge variant="secondary">Nº {variant.size || "—"}</Badge>
              <span>{brl(variant.price)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-5xl flex-col">
        <DialogHeader>
          <DialogTitle>Cores na Shopify sem cadastro no ERP</DialogTitle>
          <DialogDescription>
            {total} {total === 1 ? "cor encontrada" : "cores encontradas"} em produtos ativos. A importação usa os dados do último espelho e começa com estoque zero.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar produto, cor ou SKU"
              className="pl-8"
            />
          </div>
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Atualizar
          </Button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
          {loading ? (
            <div className="flex justify-center p-12"><Loader2 className="h-7 w-7 animate-spin text-muted-foreground" /></div>
          ) : rows.length === 0 ? (
            <p className="rounded-lg bg-muted/50 p-10 text-center text-sm text-muted-foreground">Nenhuma cor ausente para este filtro.</p>
          ) : (
            <>
              {missingRows.length > 0 && (
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold">Cores ausentes <Badge variant="secondary" className="ml-1">{missingRows.length} nesta página</Badge></h3>
                  {missingRows.map(renderRow)}
                </section>
              )}
              {spellingRows.length > 0 && (
                <section className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                  <h3 className="text-sm font-semibold text-amber-800">Possíveis diferenças de grafia — confira antes de importar <Badge variant="secondary" className="ml-1">{spellingRows.length} nesta página</Badge></h3>
                  {spellingRows.map(renderRow)}
                </section>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-between border-t pt-3 text-sm">
          <span className="text-muted-foreground">Página {page + 1} de {pages}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0 || loading} onClick={() => setPage((value) => value - 1)}>Anterior</Button>
            <Button variant="outline" size="sm" disabled={page + 1 >= pages || loading} onClick={() => setPage((value) => value + 1)}>Próxima</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
