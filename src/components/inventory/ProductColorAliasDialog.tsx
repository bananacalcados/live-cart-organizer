import { useCallback, useEffect, useState } from "react";
import { Loader2, Palette, Save } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PushColorToShopifyButton } from "@/components/inventory/PushColorToShopifyButton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const db = supabase as any;

type MissingColorRow = {
  code: string;
  master_id: string;
  product_name: string | null;
  color: string | null;
  total_stock: number | null;
  shopify_product_id: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
};

export function ProductColorAliasDialog({ open, onOpenChange, onSaved }: Props) {
  const [rows, setRows] = useState<MissingColorRow[]>([]);
  const [colors, setColors] = useState<Record<string, string[]>>({});
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await db.from("v_product_color_codes")
        .select("code,master_id,product_name,color,total_stock,shopify_product_id")
        .eq("shopify_status", "color_missing").order("code").limit(200);
      if (error) throw error;
      const nextRows = (data || []) as MissingColorRow[];
      const productIds = [...new Set(nextRows.map((r) => r.shopify_product_id).filter(Boolean))] as string[];
      const grouped: Record<string, Set<string>> = {};
      if (productIds.length) {
        const { data: variants, error: variantsError } = await db.from("shopify_variant_mirror")
          .select("shopify_product_id,option_color")
          .in("shopify_product_id", productIds).not("option_color", "is", null).limit(2000);
        if (variantsError) throw variantsError;
        for (const variant of variants || []) {
          const color = String(variant.option_color || "").trim();
          if (!color) continue;
          (grouped[variant.shopify_product_id] ||= new Set()).add(color);
        }
      }
      setRows(nextRows);
      setColors(Object.fromEntries(Object.entries(grouped).map(([id, values]) => [
        id,
        [...values].sort((a, b) => a.localeCompare(b, "pt-BR")),
      ])));
      setChoices({});
    } catch (error: any) {
      toast.error(`Erro ao carregar o de-para: ${error?.message || error}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const save = async (row: MissingColorRow) => {
    const shopifyColor = choices[row.code];
    if (!shopifyColor) {
      toast.warning("Escolha a cor correspondente na Shopify.");
      return;
    }
    setSaving(row.code);
    try {
      const { data: auth, error: authError } = await supabase.auth.getSession();
      if (authError) throw authError;
      const user = auth.session?.user;
      if (!user) throw new Error("Sessão expirada. Entre novamente.");
      const { error } = await db.from("product_color_shopify_alias").upsert({
        master_id: row.master_id,
        erp_color_key: (row.color || "").trim().toLowerCase(),
        shopify_color: shopifyColor,
        created_by: user.id,
      }, { onConflict: "master_id,erp_color_key" });
      if (error) throw error;
      const { error: relinkError } = await db.rpc("relink_products_from_shopify_mirror");
      if (relinkError) throw relinkError;
      toast.success(`${row.code}: cor vinculada e códigos recalculados.`);
      onSaved();
      await load();
    } catch (error: any) {
      toast.error(`Não foi possível salvar: ${error?.message || error}`);
    } finally {
      setSaving(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Palette className="h-5 w-5" /> De-para de cores</DialogTitle>
          <DialogDescription>
            {loading ? "Carregando códigos…" : `${rows.length} código${rows.length === 1 ? "" : "s"} com cor faltando na Shopify`}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {loading ? (
            <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : rows.length === 0 ? (
            <p className="rounded-md bg-muted/50 p-6 text-center text-sm text-muted-foreground">Nenhuma cor pendente de de-para.</p>
          ) : (
            <div className="space-y-2">
              {rows.map((row, index) => {
                const options = row.shopify_product_id ? colors[row.shopify_product_id] || [] : [];
                return (
                  <div key={row.code} className="grid gap-3 rounded-lg border p-3 md:grid-cols-[minmax(0,1fr)_220px_auto] md:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>{index + 1} de {rows.length}</span>
                        <span>Estoque: <b className="text-foreground">{row.total_stock ?? 0}</b></span>
                      </div>
                      <div className="mt-1 truncate text-sm font-semibold"><span className="mr-2 font-mono text-primary">{row.code}</span>{row.product_name}</div>
                      <div className="mt-1 text-sm">Cor no ERP: <b>{row.color || "sem cor"}</b></div>
                    </div>
                    <Select
                      value={choices[row.code] || ""}
                      onValueChange={(value) => setChoices((current) => ({ ...current, [row.code]: value }))}
                      disabled={!options.length || saving === row.code}
                    >
                      <SelectTrigger aria-label={`Cor da Shopify para ${row.code}`}>
                        <SelectValue placeholder={options.length ? "Cor na Shopify" : "Nenhuma cor encontrada"} />
                      </SelectTrigger>
                      <SelectContent>
                        {options.map((color) => <SelectItem key={color} value={color}>{color}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <div className="flex flex-col gap-2">
                      <Button size="sm" onClick={() => save(row)} disabled={!choices[row.code] || saving !== null}>
                        {saving === row.code ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
                        Salvar
                      </Button>
                      <span className="text-center text-xs text-muted-foreground">A cor não existe na Shopify?</span>
                      <PushColorToShopifyButton code={row.code} onDone={() => { onSaved(); void load(); }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving !== null}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
