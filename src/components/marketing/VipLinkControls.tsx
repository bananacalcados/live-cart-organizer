import { useEffect, useState } from "react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useIsAdmin } from "@/hooks/useIsAdmin";

export type VipLinkMode = "none" | "product" | "general";
export interface VipLinkProduct {
  source: "shopify" | "avulso";
  shopify_product_id?: string | null;
  title: string;
  variant?: string | null;
  price?: string | number | null;
  image_url?: string | null;
}

export const VIP_LINK_PLACEHOLDER = "{{link_atendimento}}";

/** Prévia do texto final com o link (o código real é gerado por grupo no envio). */
export function previewWithVipLink(text: string) {
  const url = "https://checkout.bananacalcados.com.br/g/abc123";
  if (text.includes(VIP_LINK_PLACEHOLDER)) return text.split(VIP_LINK_PLACEHOLDER).join(url);
  return `${text}${text ? "\n\n" : ""}👉 Para pedir, toque aqui: ${url}`;
}

export function VipLinkBlockControls({
  mode, product, text, onChange, onInsertPlaceholder, onPickShopify,
}: {
  mode: VipLinkMode;
  product: VipLinkProduct | null;
  text: string;
  onChange: (mode: VipLinkMode, product: VipLinkProduct | null) => void;
  onInsertPlaceholder: () => void;
  onPickShopify: () => void;
}) {
  return (
    <div className="rounded-md border border-border bg-muted/40 p-2 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium whitespace-nowrap">Link de atendimento</span>
        <Select value={mode} onValueChange={(v) => onChange(v as VipLinkMode, v === "product" ? product : null)}>
          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Sem link</SelectItem>
            <SelectItem value="product">Link do produto</SelectItem>
            <SelectItem value="general">Link geral (sem produto)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {mode === "product" && (
        <div className="space-y-1.5">
          {product?.source === "shopify" ? (
            <div className="flex items-center gap-2 text-xs">
              {product.image_url && <img src={product.image_url} alt="" className="h-8 w-8 rounded object-cover" />}
              <span className="flex-1 truncate">{product.title}</span>
              <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={() => onChange("product", null)}>Trocar</Button>
            </div>
          ) : (
            <>
              <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={onPickShopify}>Vincular produto da Shopify</Button>
              <div className="grid grid-cols-3 gap-1">
                <Input className="h-7 text-xs col-span-3" placeholder="Nome do produto (obrigatório)" value={product?.title || ""}
                  onChange={(e) => onChange("product", { ...(product || { source: "avulso" }), source: "avulso", title: e.target.value })} />
                <Input className="h-7 text-xs" placeholder="Preço" value={String(product?.price ?? "")}
                  onChange={(e) => onChange("product", { ...(product || { source: "avulso", title: "" }), source: "avulso", price: e.target.value })} />
                <Input className="h-7 text-xs col-span-2" placeholder="Cor (opcional)" value={product?.variant || ""}
                  onChange={(e) => onChange("product", { ...(product || { source: "avulso", title: "" }), source: "avulso", variant: e.target.value })} />
              </div>
            </>
          )}
        </div>
      )}
      {mode !== "none" && (
        <>
          <Button variant="outline" size="sm" className="h-6 text-[11px]" onClick={onInsertPlaceholder}>
            Inserir {VIP_LINK_PLACEHOLDER} no texto
          </Button>
          <pre className="whitespace-pre-wrap text-[11px] text-muted-foreground bg-background rounded p-2 border">{previewWithVipLink(text)}</pre>
          <p className="text-[10px] text-muted-foreground">Cada grupo recebe um link próprio, para sabermos de onde a cliente veio.</p>
        </>
      )}
    </div>
  );
}

interface NumberOpt { id: string; label: string; provider: string; phone: string }

/** Trava do dia: todos os links do dia levam à mesma instância. */
export function VipDayLock({ day, onState, contactPhones, onUseForContacts }: {
  day: Date;
  onState: (locked: boolean) => void;
  contactPhones: string[];
  onUseForContacts: (phone: string, label: string) => void;
}) {
  const dayStr = format(day, "yyyy-MM-dd");
  const { isAdmin } = useIsAdmin() as any;
  const [current, setCurrent] = useState<string | null | undefined>(undefined);
  const [numbers, setNumbers] = useState<NumberOpt[]>([]);
  const [choice, setChoice] = useState("");
  const [changing, setChanging] = useState(false);

  const load = async () => {
    const { data } = await supabase.from("vip_link_daily_destination").select("whatsapp_number_id").eq("day", dayStr).maybeSingle();
    setCurrent(data?.whatsapp_number_id ?? null);
    onState(!!data?.whatsapp_number_id);
  };
  useEffect(() => { load(); }, [dayStr]);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("whatsapp_numbers_safe")
        .select("id, label, provider, phone_display, uazapi_owner, wasender_phone_number")
        .eq("is_active", true).in("provider", ["meta", "uazapi", "wasender"]);
      setNumbers((data || []).map((n: any) => ({
        id: n.id, label: n.label || "Número", provider: n.provider,
        phone: String(n.phone_display || n.uazapi_owner || n.wasender_phone_number || "").replace(/\D/g, ""),
      })));
    })();
  }, []);

  const save = async (force: boolean) => {
    if (!choice) { toast.error("Escolha a instância"); return; }
    if (force && !confirm(`Isso muda o destino de TODOS os links de ${format(day, "dd/MM")}, inclusive os já enviados. Continuar?`)) return;
    const { error } = await supabase.rpc("vip_set_daily_destination", { p_day: dayStr, p_number_id: choice, p_force: force });
    if (error) { toast.error(error.message); return; }
    toast.success("Instância do dia definida");
    setChanging(false);
    load();
  };

  const cur = numbers.find((n) => n.id === current);
  const norm = (p: string) => { const d = p.replace(/\D/g, ""); return d.length >= 10 ? d.slice(-8) : d; };
  const mismatch = cur && contactPhones.some((p) => p && norm(p) !== norm(cur.phone));

  return (
    <div className="rounded-md border border-primary/40 bg-primary/5 p-2 space-y-2 text-xs">
      <div className="font-medium">Instância de atendimento de {format(day, "dd/MM")}:</div>
      {current === undefined ? <span className="text-muted-foreground">Carregando…</span>
        : current && !changing ? (
          <div className="flex items-center gap-2">
            <span className="font-semibold">{cur?.label || current}</span>
            <span className="text-muted-foreground">({cur?.provider})</span>
            {isAdmin && <Button variant="outline" size="sm" className="h-6 text-[11px] ml-auto" onClick={() => setChanging(true)}>Trocar instância do dia inteiro</Button>}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Select value={choice} onValueChange={setChoice}>
              <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Escolha uma vez para o dia" /></SelectTrigger>
              <SelectContent>
                {numbers.map((n) => <SelectItem key={n.id} value={n.id}>{n.label} ({n.provider})</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" className="h-7 text-[11px]" onClick={() => save(!!current)}>Definir</Button>
            {changing && <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={() => setChanging(false)}>Cancelar</Button>}
          </div>
        )}
      {mismatch && cur && (
        <div className="flex items-center gap-2 text-destructive">
          <span>O cartão de contato aponta para outro número.</span>
          <Button variant="outline" size="sm" className="h-6 text-[11px]" onClick={() => onUseForContacts(cur.phone, cur.label)}>
            Usar a instância de atendimento do dia
          </Button>
        </div>
      )}
    </div>
  );
}
