import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Loader2, Images, Store, AlertCircle, Send, Variable } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useConversationInstance } from "@/hooks/useConversationInstance";
import { useWhatsAppNumberStore } from "@/stores/whatsappNumberStore";
import { uploadMediaToStorage } from "@/components/MediaAttachmentPicker";
import { ProductSelector } from "@/components/ProductSelector";
import type { DbOrderProduct } from "@/types/database";
import type { Order } from "@/types/order";
import { toast } from "sonner";

interface EventCrossellDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  phone: string;
  customerName?: string;
  /** Pedido de contexto para variáveis (nome, @, valores, checkout). */
  order?: Order;
}

interface VariableOption {
  key: string;
  label: string;
  value: string;
}

const formatBRL = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

interface DbTemplate {
  id: string;
  nome: string;
  template_id: string;
  template_language: string;
  qtd_cards: number;
  meta_status: string;
  whatsapp_number_id: string | null;
  event_id: string | null;
  scope: string;
}

interface MetaComponent {
  type: string;
  format?: string;
  text?: string;
  cards?: Array<{ components: MetaComponent[] }>;
}
interface MetaTemplate {
  name: string;
  language: string;
  status: string;
  components: MetaComponent[];
}

const countVarSlots = (text?: string) => {
  if (!text) return 0;
  const m = text.match(/\{\{\s*(\d+)\s*\}\}/g);
  if (!m) return 0;
  return Math.max(...m.map((s) => parseInt(s.replace(/\D/g, ""), 10)));
};

const findComp = (comps: MetaComponent[] | undefined, type: string) =>
  (comps || []).find((c) => (c.type || "").toUpperCase() === type.toUpperCase());

interface CardState {
  imageUrl: string;
  bodyVars: string[];
  uploading: boolean;
}

export function EventCrossellDialog({ open, onOpenChange, phone, customerName, order }: EventCrossellDialogProps) {
  const { boundNumberId, boundNumber, effectiveNumberId, effectiveNumber } = useConversationInstance(phone);
  const { numbers } = useWhatsAppNumberStore();

  const numberId = boundNumberId || effectiveNumberId;
  const numberLabel =
    boundNumber?.label || effectiveNumber?.label || numbers.find((n) => n.id === numberId)?.label || "instância";

  const [templates, setTemplates] = useState<DbTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [metaTemplate, setMetaTemplate] = useState<MetaTemplate | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(false);

  const [topVars, setTopVars] = useState<string[]>([]);
  const [cards, setCards] = useState<CardState[]>([]);
  const [sending, setSending] = useState(false);

  // Shopify product picker (per card)
  const [shopifyPickerIdx, setShopifyPickerIdx] = useState<number | null>(null);

  // Variáveis disponíveis do cadastro/pedido
  const variableOptions = useMemo<VariableOption[]>(() => {
    const opts: VariableOption[] = [];
    const name = order?.instagramHandle || customerName || "";
    if (name) {
      opts.push({ key: "nome", label: "Nome do cliente", value: name.replace(/^@/, "") });
      opts.push({ key: "instagram", label: "@ Instagram", value: name.startsWith("@") ? name : `@${name}` });
    }
    if (phone) opts.push({ key: "telefone", label: "Telefone", value: phone });
    const products = order?.products || [];
    if (products.length > 0) {
      const subtotal = products.reduce((s, p) => s + (p.price || 0) * (p.quantity || 1), 0);
      const compareTotal = products.reduce((s, p) => s + (p.price || 0) * (p.quantity || 1), 0);
      opts.push({ key: "valor_produtos", label: "Valor dos produtos", value: formatBRL(subtotal) });
      opts.push({ key: "valor_compra", label: "Valor da compra", value: formatBRL(subtotal) });
      opts.push({ key: "desconto", label: "Desconto", value: formatBRL(Math.max(compareTotal - subtotal, 0)) });
      opts.push({ key: "qtd_itens", label: "Qtd. de itens", value: String(products.reduce((s, p) => s + (p.quantity || 1), 0)) });
      opts.push({ key: "primeiro_produto", label: "1º produto", value: products[0].title || "" });
    }
    if (order?.cartLink) opts.push({ key: "link_checkout", label: "Link do checkout", value: order.cartLink });
    return opts;
  }, [order, customerName, phone]);


  // Load approved event templates for the bound instance
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoadingTemplates(true);
      let q = supabase
        .from("templates_carrossel")
        .select("id,nome,template_id,template_language,qtd_cards,meta_status,whatsapp_number_id,event_id,scope")
        .in("scope", ["event", "pos"])
        .eq("meta_status", "APPROVED")
        .order("scope", { ascending: true })
        .order("qtd_cards", { ascending: true });
      if (numberId) q = q.eq("whatsapp_number_id", numberId);
      const { data, error } = await q;
      if (cancelled) return;
      if (error) {
        toast.error("Erro ao carregar templates", { description: error.message });
        setTemplates([]);
      } else {
        setTemplates((data || []) as DbTemplate[]);
      }
      setLoadingTemplates(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, numberId]);

  // Reset when dialog closes
  useEffect(() => {
    if (!open) {
      setSelectedId(null);
      setMetaTemplate(null);
      setTopVars([]);
      setCards([]);
    }
  }, [open]);

  // Load Meta template structure when template selected
  useEffect(() => {
    if (!selectedId) {
      setMetaTemplate(null);
      return;
    }
    const t = templates.find((x) => x.id === selectedId);
    if (!t) return;
    let cancelled = false;
    (async () => {
      setLoadingMeta(true);
      const { data, error } = await supabase.functions.invoke("meta-whatsapp-get-templates", {
        body: { whatsappNumberId: t.whatsapp_number_id },
      });
      if (cancelled) return;
      setLoadingMeta(false);
      if (error) {
        toast.error("Erro ao buscar template na Meta", { description: error.message });
        return;
      }
      const list: MetaTemplate[] = (data as { templates?: MetaTemplate[] })?.templates || [];
      const found = list.find((m) => m.name === t.template_id && m.language === t.template_language);
      if (!found) {
        toast.error("Template não encontrado na Meta");
        return;
      }
      setMetaTemplate(found);

      // Initialize inputs
      const topBody = findComp(found.components, "BODY");
      const topCount = countVarSlots(topBody?.text);
      setTopVars(Array.from({ length: topCount }, () => ""));

      const carousel = findComp(found.components, "CAROUSEL");
      const metaCards = carousel?.cards || [];
      setCards(
        metaCards.map((c) => {
          const cardBody = findComp(c.components, "BODY");
          const n = countVarSlots(cardBody?.text);
          return { imageUrl: "", bodyVars: Array.from({ length: n }, () => ""), uploading: false };
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, templates]);

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === selectedId) || null,
    [selectedId, templates],
  );

  const carouselComp = useMemo(
    () => findComp(metaTemplate?.components, "CAROUSEL"),
    [metaTemplate],
  );
  const topBodyText = useMemo(
    () => findComp(metaTemplate?.components, "BODY")?.text || "",
    [metaTemplate],
  );

  const handleImageUpload = async (idx: number, file: File) => {
    setCards((prev) => prev.map((c, i) => (i === idx ? { ...c, uploading: true } : c)));
    const url = await uploadMediaToStorage(file);
    setCards((prev) =>
      prev.map((c, i) => (i === idx ? { ...c, uploading: false, imageUrl: url || c.imageUrl } : c)),
    );
    if (!url) toast.error(`Falha no upload do card ${idx + 1}`);
  };

  const handleShopifyImagePick = (imageUrl: string) => {
    if (shopifyPickerIdx === null) return;
    const idx = shopifyPickerIdx;
    setCards((prev) => prev.map((c, i) => (i === idx ? { ...c, imageUrl } : c)));
    setShopifyPickerIdx(null);
    toast.success(`Imagem aplicada no card ${idx + 1}`);
  };



  const canSend =
    !!metaTemplate &&
    !!numberId &&
    cards.length > 0 &&
    cards.every((c) => !!c.imageUrl) &&
    topVars.every((v) => v.trim().length > 0) &&
    cards.every((c) => c.bodyVars.every((v) => v.trim().length > 0));

  const handleSend = async () => {
    if (!selectedTemplate || !metaTemplate) return;
    setSending(true);
    try {
      const components: unknown[] = [];
      if (topVars.length > 0) {
        components.push({
          type: "body",
          parameters: topVars.map((t) => ({ type: "text", text: t })),
        });
      }
      const carouselCards = cards.map((c, i) => {
        const comps: unknown[] = [
          { type: "header", parameters: [{ type: "image", image: { link: c.imageUrl } }] },
        ];
        if (c.bodyVars.length > 0) {
          comps.push({
            type: "body",
            parameters: c.bodyVars.map((t) => ({ type: "text", text: t })),
          });
        }
        return { card_index: i, components: comps };
      });
      components.push({ type: "carousel", cards: carouselCards });

      const { data, error } = await supabase.functions.invoke("meta-whatsapp-send-template", {
        body: {
          phone,
          templateName: selectedTemplate.template_id,
          language: selectedTemplate.template_language,
          whatsappNumberId: selectedTemplate.whatsapp_number_id || numberId,
          components,
        },
      });
      if (error) throw new Error(error.message);
      if (!(data as { success?: boolean })?.success) {
        throw new Error((data as { error?: string })?.error || "Falha ao enviar");
      }
      toast.success("Cross-sell enviado!", {
        description: `Carrossel entregue para ${customerName || phone}`,
      });
      onOpenChange(false);
    } catch (e) {
      const err = e as Error;
      toast.error("Erro ao enviar", { description: err.message });
    } finally {
      setSending(false);
    }
  };

  const VarPicker = ({ onPick, disabled }: { onPick: (v: string) => void; disabled?: boolean }) => {
    if (variableOptions.length === 0) return null;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            className="h-8 gap-1 text-xs shrink-0"
          >
            <Variable className="h-3.5 w-3.5" />
            Variável
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>Inserir do cadastro</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {variableOptions.map((opt) => (
            <DropdownMenuItem
              key={opt.key}
              onSelect={(e) => {
                e.preventDefault();
                onPick(opt.value);
              }}
              className="flex flex-col items-start gap-0.5"
            >
              <span className="text-xs font-medium">{opt.label}</span>
              <span className="text-[10px] text-muted-foreground truncate max-w-full">{opt.value}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  return (

    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl sm:max-w-3xl w-[95vw] h-[85vh] p-0 gap-0 flex flex-col overflow-hidden">
        <DialogHeader className="p-4 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Images className="h-5 w-5 text-primary" />
            Enviar Cross-sell (Carrossel)
          </DialogTitle>
          <DialogDescription>
            Para {customerName || phone} · instância <strong>{numberLabel}</strong>
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1">
          <div className="p-4 space-y-4">
            {!numberId && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Nenhuma instância vinculada a esta conversa. Envie uma mensagem primeiro para travar a instância.
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label>Template aprovado</Label>
              {loadingTemplates ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Carregando templates…
                </div>
              ) : templates.length === 0 ? (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Nenhum template <strong>APROVADO</strong> disponível para esta instância. Crie um em
                    <em> Eventos → Templates API</em> e aguarde a aprovação da Meta.
                  </AlertDescription>
                </Alert>
              ) : (
                <Select value={selectedId ?? ""} onValueChange={setSelectedId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Escolha um template" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        [{t.scope === "event" ? "Evento" : "PDV"}] {t.nome || t.template_id} · {t.qtd_cards} cards
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {loadingMeta && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Buscando estrutura do template…
              </div>
            )}

            {metaTemplate && (
              <>
                {topBodyText && (
                  <div className="space-y-2 rounded-md border p-3 bg-muted/30">
                    <div className="text-xs font-semibold text-muted-foreground uppercase">
                      Corpo do topo
                    </div>
                    <div className="text-sm whitespace-pre-wrap text-muted-foreground">{topBodyText}</div>
                    {topVars.map((v, i) => (
                      <div key={i} className="space-y-1">
                        <Label className="text-xs">Variável {`{{${i + 1}}}`}</Label>
                        <div className="flex gap-2">
                          <Input
                            value={v}
                            onChange={(e) =>
                              setTopVars((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))
                            }
                            placeholder={`Valor para {{${i + 1}}}`}
                          />
                          <VarPicker
                            onPick={(val) =>
                              setTopVars((prev) => prev.map((x, j) => (j === i ? (x ? `${x} ${val}` : val) : x)))
                            }
                          />
                        </div>
                      </div>
                    ))}

                  </div>
                )}

                <div className="space-y-3">
                  <div className="text-xs font-semibold text-muted-foreground uppercase">
                    Cards ({cards.length})
                  </div>
                  {cards.map((card, idx) => {
                    const metaCard = carouselComp?.cards?.[idx];
                    const cardBodyText = findComp(metaCard?.components, "BODY")?.text || "";
                    return (
                      <div key={idx} className="rounded-md border p-3 space-y-3">
                        <div className="flex items-center justify-between">
                          <Badge variant="outline">Card {idx + 1}</Badge>
                          {card.imageUrl && (
                            <img
                              src={card.imageUrl}
                              alt=""
                              className="h-12 w-12 rounded object-cover border"
                            />
                          )}
                        </div>

                        <div className="space-y-1">
                          <Label className="text-xs">Imagem do produto</Label>
                          <div className="flex gap-2 items-center">
                            <Input
                              type="file"
                              accept="image/*"
                              disabled={card.uploading}
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) handleImageUpload(idx, f);
                              }}
                            />
                            {card.uploading && <Loader2 className="h-4 w-4 animate-spin" />}
                          </div>
                          <div className="flex gap-2 mt-1">
                            <Input
                              placeholder="…ou cole uma URL de imagem"
                              value={card.imageUrl}
                              onChange={(e) =>
                                setCards((prev) =>
                                  prev.map((c, i) => (i === idx ? { ...c, imageUrl: e.target.value } : c)),
                                )
                              }
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="gap-1 text-xs shrink-0"
                              onClick={() => setShopifyPickerIdx(idx)}
                            >
                              <Store className="h-3.5 w-3.5" />
                              Shopify
                            </Button>
                          </div>
                        </div>

                        {cardBodyText && (
                          <div className="space-y-2">
                            <div className="text-xs text-muted-foreground whitespace-pre-wrap bg-muted/30 rounded p-2">
                              {cardBodyText}
                            </div>
                            {card.bodyVars.map((v, i) => (
                              <div key={i} className="space-y-1">
                                <Label className="text-xs">Variável {`{{${i + 1}}}`}</Label>
                                <div className="flex gap-2 items-start">
                                  <Textarea
                                    rows={2}
                                    value={v}
                                    onChange={(e) =>
                                      setCards((prev) =>
                                        prev.map((c, j) =>
                                          j === idx
                                            ? {
                                                ...c,
                                                bodyVars: c.bodyVars.map((x, k) =>
                                                  k === i ? e.target.value : x,
                                                ),
                                              }
                                            : c,
                                        ),
                                      )
                                    }
                                    placeholder={`Valor para {{${i + 1}}}`}
                                  />
                                  <VarPicker
                                    onPick={(val) =>
                                      setCards((prev) =>
                                        prev.map((c, j) =>
                                          j === idx
                                            ? {
                                                ...c,
                                                bodyVars: c.bodyVars.map((x, k) =>
                                                  k === i ? (x ? `${x} ${val}` : val) : x,
                                                ),
                                              }
                                            : c,
                                        ),
                                      )
                                    }
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="p-4 border-t shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancelar
          </Button>
          <Button onClick={handleSend} disabled={!canSend || sending}>
            {sending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Enviando…
              </>
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" /> Enviar cross-sell
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Seletor de imagem via Shopify */}
      <Dialog
        open={shopifyPickerIdx !== null}
        onOpenChange={(o) => { if (!o) setShopifyPickerIdx(null); }}
      >
        <DialogContent className="max-w-2xl sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Escolher imagem de produto Shopify</DialogTitle>
            <DialogDescription>
              A imagem selecionada será aplicada no card {shopifyPickerIdx !== null ? shopifyPickerIdx + 1 : ""}.
            </DialogDescription>
          </DialogHeader>
          <ProductSelector
            selectedProducts={[]}
            onAddProduct={handleShopifyPick}
            onRemoveProduct={() => {}}
            onUpdateQuantity={() => {}}
          />
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}

