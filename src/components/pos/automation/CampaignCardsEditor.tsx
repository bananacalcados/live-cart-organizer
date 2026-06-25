import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ImageCropDialog } from "@/components/ImageCropDialog";
import { ProductSelector } from "@/components/ProductSelector";
import { Loader2, Trash2, Upload, Store, ImageIcon, Link2, Phone, MessageSquare } from "lucide-react";
import type { ParsedTplButton } from "@/lib/pos/carouselTemplate";
import type { DbOrderProduct } from "@/types/database";

export interface CampaignCard {
  id?: string;
  ordem: number;
  imagem_url: string | null;
  legenda: string;
  shopify_product_id?: string | null;
  shopify_variant_id?: string | null;
}

export function emptyCard(ordem: number): CampaignCard {
  return { ordem, imagem_url: null, legenda: "", shopify_product_id: null, shopify_variant_id: null };
}

interface Props {
  cards: CampaignCard[];
  onChange: (cards: CampaignCard[]) => void;
  /** Approved card body text (positional vars) — shown for reference. */
  cardBodyText: string | null;
  /** Buttons configured per card in the approved template (read-only). */
  buttonsPerCard: ParsedTplButton[][];
  /** Whether any card variable was mapped to the per-card "legenda". */
  showLegenda: boolean;
  /** True once a template/qtd is selected: card count is fixed by the template. */
  templateLoaded: boolean;
}

async function uploadCardImage(blob: Blob): Promise<string> {
  const path = `carousel-campaigns/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  const { error } = await supabase.storage
    .from("marketing-attachments")
    .upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from("marketing-attachments").getPublicUrl(path);
  return data.publicUrl;
}

function ButtonBadge({ b }: { b: ParsedTplButton }) {
  const Icon = b.type === "URL" ? Link2 : b.type === "PHONE_NUMBER" ? Phone : MessageSquare;
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1 text-[11px] text-neutral-600">
      <Icon className="h-3 w-3" />
      {b.text || "(sem texto)"}
      {b.url ? <span className="text-neutral-400">· {b.url}</span> : null}
      {b.phone ? <span className="text-neutral-400">· {b.phone}</span> : null}
    </span>
  );
}

export function CampaignCardsEditor({
  cards, onChange, cardBodyText, buttonsPerCard, showLegenda, templateLoaded,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pickTargetIdx, setPickTargetIdx] = useState<number | null>(null);

  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [cropIdx, setCropIdx] = useState<number | null>(null);
  const [cropMeta, setCropMeta] = useState<{ productId?: string | null; variantId?: string | null }>({});
  const [uploading, setUploading] = useState(false);
  const [siteOpen, setSiteOpen] = useState(false);

  const patchCard = (idx: number, patch: Partial<CampaignCard>) =>
    onChange(cards.map((c, i) => (i === idx ? { ...c, ...patch } : c)));

  // ----- Upload do PC -----
  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || pickTargetIdx === null) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Selecione uma imagem");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setCropSrc(String(reader.result));
      setCropIdx(pickTargetIdx);
      setCropMeta({});
      setPickTargetIdx(null);
    };
    reader.readAsDataURL(file);
  };

  const triggerPc = (idx: number) => { setPickTargetIdx(idx); fileRef.current?.click(); };
  const triggerSite = (idx: number) => { setPickTargetIdx(idx); setSiteOpen(true); };

  const onPickProduct = (p: DbOrderProduct) => {
    if (!p.image || pickTargetIdx === null) {
      toast.error("Este produto não tem imagem");
      return;
    }
    setCropSrc(p.image);
    setCropIdx(pickTargetIdx);
    setCropMeta({ productId: p.shopifyId, variantId: p.shopifyId });
    setSiteOpen(false);
    setPickTargetIdx(null);
  };

  const onCropConfirm = async (blob: Blob) => {
    if (cropIdx === null) return;
    setUploading(true);
    try {
      const url = await uploadCardImage(blob);
      patchCard(cropIdx, {
        imagem_url: url,
        shopify_product_id: cropMeta.productId ?? null,
        shopify_variant_id: cropMeta.variantId ?? null,
      });
      toast.success("Imagem do card pronta");
    } catch (err) {
      toast.error("Erro ao subir imagem: " + (err as Error).message);
    } finally {
      setUploading(false);
      setCropSrc(null);
      setCropIdx(null);
      setCropMeta({});
    }
  };

  const countOk = cards.filter((c) => c.imagem_url).length;

  if (!templateLoaded) {
    return (
      <p className="text-xs text-neutral-500">
        Escolha a instância, o modelo e a quantidade de cards para carregar a estrutura do template aprovado.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickFile} />

      <div>
        <h4 className="text-sm font-bold text-neutral-800">Cards do carrossel ({cards.length})</h4>
        <p className="text-xs text-neutral-500">
          {countOk} de {cards.length} card(s) com imagem. A quantidade segue o template aprovado.
        </p>
        {cardBodyText ? (
          <p className="mt-1 rounded-md bg-neutral-50 px-2 py-1 text-[11px] text-neutral-500">
            Texto do card (aprovado na Meta): <span className="text-neutral-700">{cardBodyText}</span>
          </p>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {cards.map((c, idx) => {
          const btns = buttonsPerCard[idx] || buttonsPerCard[0] || [];
          return (
            <Card key={idx} className="p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-neutral-600">Card {idx + 1}</span>
                {c.imagem_url && (
                  <Button
                    type="button" variant="ghost" size="icon"
                    className="h-7 w-7 text-rose-500 hover:bg-rose-50"
                    onClick={() => patchCard(idx, { imagem_url: null, shopify_product_id: null, shopify_variant_id: null })}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>

              <div className="relative aspect-square w-full overflow-hidden rounded-md bg-muted flex items-center justify-center">
                {c.imagem_url ? (
                  <img src={c.imagem_url} alt={`Card ${idx + 1}`} className="h-full w-full object-cover" />
                ) : (
                  <ImageIcon className="h-8 w-8 text-neutral-300" />
                )}
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                <Button type="button" variant="outline" size="sm" className="gap-1 text-xs" onClick={() => triggerPc(idx)}>
                  <Upload className="h-3.5 w-3.5" /> Subir do PC
                </Button>
                <Button type="button" variant="outline" size="sm" className="gap-1 text-xs" onClick={() => triggerSite(idx)}>
                  <Store className="h-3.5 w-3.5" /> Subir do site
                </Button>
              </div>

              {showLegenda && (
                <div className="space-y-1">
                  <Label className="text-[11px] text-neutral-600">Texto próprio deste card</Label>
                  <Textarea
                    value={c.legenda}
                    onChange={(e) => patchCard(idx, { legenda: e.target.value })}
                    placeholder="Ex.: Tênis branco 37 — R$ 199"
                    className="min-h-[56px] bg-white text-sm"
                  />
                </div>
              )}

              {btns.length > 0 && (
                <div className="space-y-1">
                  <Label className="text-[11px] text-neutral-600">Botões (aprovados na Meta)</Label>
                  <div className="flex flex-wrap gap-1">
                    {btns.map((b, i) => <ButtonBadge key={i} b={b} />)}
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {/* Seletor de produto Shopify */}
      <Dialog open={siteOpen} onOpenChange={(o) => { setSiteOpen(o); if (!o) setPickTargetIdx(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Escolher imagem do produto (site)</DialogTitle>
          </DialogHeader>
          <ProductSelector
            selectedProducts={[]}
            onAddProduct={onPickProduct}
            onRemoveProduct={() => {}}
            onUpdateQuantity={() => {}}
          />
        </DialogContent>
      </Dialog>

      {/* Ajuste 1:1 da miniatura */}
      <ImageCropDialog
        open={!!cropSrc}
        imageSrc={cropSrc}
        loading={uploading}
        onCancel={() => {
          if (uploading) return;
          setCropSrc(null);
          setCropIdx(null);
          setCropMeta({});
        }}
        onConfirm={onCropConfirm}
      />

      {uploading && (
        <p className="text-xs text-neutral-500 flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin" /> Enviando imagem...
        </p>
      )}
    </div>
  );
}
