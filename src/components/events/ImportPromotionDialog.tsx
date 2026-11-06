import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Import, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  formatPromotionEventDate,
  nextPromotionCopyName,
  normalizePromotionTiers,
  numericShopifyId,
  planPromotionLinks,
  promotionCopyPayload,
  promotionProductIds,
  samePromotionName,
} from "@/lib/livePromotionImport";
import type { LivePromotion } from "./LivePromotionsManager";

const db = supabase as any;

interface ImportablePromotion extends LivePromotion {
  event_id: string;
  created_at: string;
  shopify_collection_handle?: string | null;
  eventName: string;
  eventDate: string | null;
}

interface ImportResult {
  name: string;
  linkedCount: number;
  catalogCount: number;
  crosssellCount: number;
  missing: { id: string; name: string }[];
}

export function ImportPromotionDialog({
  eventId,
  existingPromotions,
  onClose,
  onSaved,
}: {
  eventId: string;
  existingPromotions: LivePromotion[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ImportablePromotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [duplicate, setDuplicate] = useState<{ source: ImportablePromotion; existing: LivePromotion } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      const term = query.trim();
      let request = db.from("event_promotions")
        .select("id,event_id,name,shopify_collection_handle,shopify_product_ids,tiers,free_shipping,blocks_cashback,is_active,created_at,events!inner(name,start_date)")
        .neq("event_id", eventId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (term) request = request.ilike("name", `%${term.replace(/[\\%_]/g, "\\$&")}%`);
      const { data, error } = await request;
      if (!active) return;
      if (error) {
        toast.error("Não foi possível buscar as promoções");
        setItems([]);
      } else {
        setItems((data || []).map((row: any) => {
          const event = Array.isArray(row.events) ? row.events[0] : row.events;
          return {
            ...row,
            tiers: normalizePromotionTiers(row.tiers),
            eventName: event?.name || "Live sem nome",
            eventDate: event?.start_date || null,
          };
        }));
      }
      setLoading(false);
    }, query.trim() ? 300 : 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [eventId, query]);

  const choose = (source: ImportablePromotion) => {
    setResult(null);
    const existing = existingPromotions.find((promotion) => samePromotionName(promotion.name, source.name));
    if (existing) {
      setDuplicate({ source, existing });
      return;
    }
    setDuplicate(null);
    void importPromotion(source, "insert");
  };

  const importPromotion = async (source: ImportablePromotion, mode: "insert" | "replace" | "copy", existing?: LivePromotion) => {
    setBusy(true);
    setDuplicate(null);
    setResult(null);
    let copiedId: string | null = null;
    try {
      const finalName = mode === "copy"
        ? nextPromotionCopyName(source.name, existingPromotions.map((promotion) => promotion.name))
        : source.name;
      const payload = promotionCopyPayload(source, eventId, finalName);
      const response = mode === "replace" && existing
        ? await db.from("event_promotions").update(payload).eq("id", existing.id).eq("event_id", eventId).select("id").single()
        : await db.from("event_promotions").insert(payload).select("id").single();
      if (response.error) throw response.error;
      copiedId = response.data.id;

      const [catalog, crosssell] = await Promise.all([
        db.from("event_catalog_products").select("id,shopify_product_id,promotion_id").eq("event_id", eventId).limit(200),
        db.from("event_crossell_offers").select("id,shopify_product_id,promotion_id").eq("event_id", eventId).limit(200),
      ]);
      if (catalog.error) throw catalog.error;
      if (crosssell.error) throw crosssell.error;
      const plan = planPromotionLinks(copiedId, payload.shopify_product_ids, catalog.data || [], crosssell.data || []);
      const operations: Promise<any>[] = [];
      if (plan.catalogIds.length) operations.push(db.from("event_catalog_products").update({ promotion_id: copiedId }).in("id", plan.catalogIds).eq("event_id", eventId));
      if (plan.crosssellIds.length) operations.push(db.from("event_crossell_offers").update({ promotion_id: copiedId }).in("id", plan.crosssellIds).eq("event_id", eventId));
      if (plan.catalogOffIds.length) operations.push(db.from("event_catalog_products").update({ promotion_id: null }).in("id", plan.catalogOffIds).eq("event_id", eventId));
      if (plan.crosssellOffIds.length) operations.push(db.from("event_crossell_offers").update({ promotion_id: null }).in("id", plan.crosssellOffIds).eq("event_id", eventId));
      const updates = await Promise.all(operations);
      const updateError = updates.find((operation: any) => operation.error)?.error;
      if (updateError) throw updateError;

      const names = new Map<string, string>();
      if (plan.missingProductIds.length) {
        const [sourceCatalog, sourceCrosssell, masters] = await Promise.all([
          db.from("event_catalog_products").select("shopify_product_id,title").eq("event_id", source.event_id).limit(200),
          db.from("event_crossell_offers").select("shopify_product_id,product_title").eq("event_id", source.event_id).limit(200),
          db.from("products_master").select("shopify_product_id,name").in("shopify_product_id", plan.missingProductIds.flatMap((id) => [id, `gid://shopify/Product/${id}`])).limit(100),
        ]);
        for (const row of sourceCatalog.data || []) names.set(numericShopifyId(row.shopify_product_id), row.title);
        for (const row of sourceCrosssell.data || []) {
          if (!names.has(numericShopifyId(row.shopify_product_id))) names.set(numericShopifyId(row.shopify_product_id), row.product_title);
        }
        for (const row of masters.data || []) {
          if (!names.has(numericShopifyId(row.shopify_product_id))) names.set(numericShopifyId(row.shopify_product_id), row.name);
        }
      }

      setResult({
        name: finalName,
        linkedCount: plan.linkedCount,
        catalogCount: plan.catalogCount,
        crosssellCount: plan.crosssellCount,
        missing: plan.missingProductIds.map((id) => ({ id, name: names.get(id) || `Produto Shopify ${id}` })),
      });
      toast.success(`Promoção importada: ${plan.linkedCount} produto(s) vinculado(s)`);
      onSaved();
    } catch (error: any) {
      if (copiedId) {
        toast.error("A cópia foi criada, mas os vínculos falharam. Abra a promoção e salve para tentar de novo.");
        onSaved();
      } else {
        toast.error(error?.message || "Não foi possível importar a promoção");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>Importar promoção de outra live</DialogTitle></DialogHeader>
        {result ? (
          <div className="space-y-4">
            <div className="rounded-md border border-primary/30 bg-primary/5 p-4">
              <p className="flex items-center gap-2 font-medium"><CheckCircle2 className="h-5 w-5 text-primary" />“{result.name}” importada</p>
              <p className="mt-2 text-sm">A original não foi alterada.</p>
              <p className="mt-1 text-sm font-medium">{result.linkedCount} produto(s) vinculado(s): {result.catalogCount} no catálogo e {result.crosssellCount} nas ofertas de cross-sell.</p>
            </div>
            {result.missing.length > 0 ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                <p className="text-sm font-medium">Não estão no catálogo nem nas ofertas desta live:</p>
                <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-muted-foreground">
                  {result.missing.map((product) => <li key={product.id}>{product.name}</li>)}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Todos os produtos da promoção estão nesta live.</p>
            )}
            <div className="flex justify-end"><Button onClick={onClose}>Concluir</Button></div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={query} onChange={(event) => { setQuery(event.target.value); setDuplicate(null); }} placeholder="Buscar pelo nome da promoção" className="pl-9" autoFocus />
            </div>
            {duplicate && (
              <div className="space-y-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
                <p className="flex items-start gap-2 text-sm"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />Já existe “{duplicate.existing.name}” nesta live. Quer substituir a atual ou criar outra?</p>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void importPromotion(duplicate.source, "copy")}>Criar outra</Button>
                  <Button size="sm" variant="destructive" disabled={busy} onClick={() => void importPromotion(duplicate.source, "replace", duplicate.existing)}>Substituir atual</Button>
                </div>
              </div>
            )}
            {busy && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Copiando e conferindo os vínculos...</p>}
            {loading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
            ) : items.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma promoção encontrada em outras lives.</p>
            ) : (
              <div className="space-y-2">
                {items.map((promotion) => (
                  <div key={promotion.id} className="flex items-start justify-between gap-3 rounded-md border p-3">
                    <div className="min-w-0 space-y-1">
                      <p className="text-sm font-medium">{promotion.name}</p>
                      <p className="text-xs text-muted-foreground">{promotion.eventName} · {formatPromotionEventDate(promotion.eventDate)}</p>
                      <div className="flex flex-wrap gap-1">
                        {promotion.tiers.map((tier, index) => <Badge key={index} variant="secondary" className="text-[10px]">{tier.qty} un = R$ {tier.price.toFixed(2)}</Badge>)}
                        <Badge variant="outline" className="text-[10px]">{promotionProductIds(promotion.shopify_product_ids).length} produto(s)</Badge>
                        {promotion.free_shipping && <Badge variant="outline" className="text-[10px]">frete grátis</Badge>}
                      </div>
                    </div>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => choose(promotion)}><Import className="mr-1 h-4 w-4" />Importar</Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
