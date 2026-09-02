import { useRef } from "react";
import { Plus, Trash2, MessagesSquare, Shuffle, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWhatsAppNumberStore } from "@/stores/whatsappNumberStore";
import { MessagePresetControls } from "./MessagePresetControls";

export interface WaInitialVariant {
  text: string;
  media_url?: string | null;
  media_type?: string | null;
}

export interface WaInitialConfig {
  enabled: boolean;
  auto: boolean;
  numberId: string | null;
  variants: WaInitialVariant[];
}

export interface WaInitialPresetPayload extends Record<string, unknown> {
  number_id: string | null;
  variants: WaInitialVariant[];
  auto: boolean;
}

interface Props {
  value: WaInitialConfig;
  onChange: (next: WaInitialConfig) => void;
}

// Mantém em sync com event-order-wa-initial-send
const VARIABLES: { token: string; label: string; sample: string }[] = [
  { token: "{customer_first_name}", label: "Primeiro nome", sample: "Juliana" },
  { token: "{customer_name}", label: "Nome / @ completo", sample: "@juliana_soares_292" },
  { token: "{instagram}", label: "@ do Instagram", sample: "@juliana_soares_292" },
  { token: "{checkout_link}", label: "Link de pagamento", sample: "https://checkout.bananacalcados.com.br/checkout/order/abc12345" },
  { token: "{member_area_link}", label: "Área de Membros (autenticada)", sample: "https://checkout.bananacalcados.com.br/minha-area?ml=xxxx" },
  { token: "{member_area_public}", label: "Área de Membros (pública)", sample: "https://checkout.bananacalcados.com.br/minha-area" },
  { token: "{products}", label: "Produtos (longa)", sample: "1x Tênis Jess Ortopédico (37 Preto) — R$199.90" },
  { token: "{products_short}", label: "Produtos (curta)", sample: "1x Tênis Jess Ortopédico" },
  { token: "{subtotal}", label: "Subtotal", sample: "R$199.90" },
  { token: "{discount}", label: "Desconto", sample: "R$10.00" },
  { token: "{total}", label: "Total", sample: "R$189.90" },
  { token: "{order_id}", label: "ID do pedido", sample: "abc12345" },
];

const DEFAULT_VARIANT: WaInitialVariant = {
  text: "Oii {customer_first_name}, vi seu pedido da live! 😊\n\n{products_short}\nTotal: {total}\n\nPaga por aqui: {checkout_link}",
};

const NON_API = ["uazapi", "wasender", "zapi"];

/**
 * Mensagem inicial via instância NÃO-API (uazapi) para lives no modo WhatsApp.
 * Permite N variações que são enviadas em rodízio (1ª, 2ª, 3ª, 1ª, ...).
 */
export function WaInitialMessageEditor({ value, onChange }: Props) {
  const { numbers } = useWhatsAppNumberStore();
  const nonApi = numbers.filter((n) => NON_API.includes(String(n.provider || "")));
  const textareas = useRef<Record<number, HTMLTextAreaElement | null>>({});
  const focused = useRef(0);

  const variants = value.variants?.length ? value.variants : [];
  const set = (patch: Partial<WaInitialConfig>) => onChange({ ...value, ...patch });
  const setVariant = (i: number, patch: Partial<WaInitialVariant>) =>
    set({ variants: variants.map((v, idx) => (idx === i ? { ...v, ...patch } : v)) });

  const insertToken = (token: string) => {
    const i = focused.current;
    const el = textareas.current[i];
    const cur = variants[i]?.text ?? "";
    if (!el) return setVariant(i, { text: cur + token });
    const start = el.selectionStart ?? cur.length;
    const end = el.selectionEnd ?? cur.length;
    setVariant(i, { text: cur.slice(0, start) + token + cur.slice(end) });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const preview = (text: string) =>
    VARIABLES.reduce((acc, v) => acc.split(v.token).join(v.sample), text || "");

  return (
    <div className="space-y-3 rounded-lg border-2 border-sky-500/40 p-3 bg-sky-500/5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Label className="flex items-center gap-2 text-sm font-semibold">
            <MessagesSquare className="h-4 w-4 text-sky-600" /> Mensagem inicial via instância não-API (uazapi)
          </Label>
          <p className="text-xs text-muted-foreground mt-1">
            Alternativa ao template Meta no modo WhatsApp. Monte variações e o sistema
            reveza entre elas a cada envio (3 variações → cada uma sai 1 vez a cada 3).
          </p>
        </div>
        <Switch checked={value.enabled} onCheckedChange={(enabled) => set({ enabled })} />
      </div>

      {value.enabled && (
        <>
          <MessagePresetControls<WaInitialPresetPayload>
            kind="wa_initial"
            canSave={variants.some((v) => v.text.trim())}
            getPayload={() => ({ number_id: value.numberId, variants, auto: value.auto })}
            onApply={(p) =>
              onChange({
                enabled: true,
                auto: Boolean(p.auto),
                numberId: p.number_id ?? value.numberId,
                variants: Array.isArray(p.variants) && p.variants.length ? p.variants : variants,
              })
            }
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Instância (uazapi / wasender / zapi)</Label>
              <Select value={value.numberId ?? "none"} onValueChange={(v) => set({ numberId: v === "none" ? null : v })}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Selecione a instância..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Selecione...</SelectItem>
                  {nonApi.map((n) => (
                    <SelectItem key={n.id} value={n.id}>
                      {n.label} <span className="text-muted-foreground ml-1">({n.phone_display} · {n.provider})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-md border p-2">
              <div>
                <Label className="text-xs font-semibold">Enviar automaticamente</Label>
                <p className="text-[11px] text-muted-foreground">
                  Ao confirmar o pedido na live. Desligado = só pelo botão no Kanban.
                </p>
              </div>
              <Switch checked={value.auto} onCheckedChange={(auto) => set({ auto })} />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs font-semibold">Variáveis (clique para inserir na variação em foco)</Label>
            <div className="flex flex-wrap gap-1">
              {VARIABLES.map((v) => (
                <Badge
                  key={v.token}
                  variant="secondary"
                  className="cursor-pointer text-[10px] hover:bg-accent/30"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insertToken(v.token)}
                >
                  {v.label}
                </Badge>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            {variants.length === 0 && (
              <p className="text-xs text-muted-foreground">Nenhuma variação. Adicione ao menos uma.</p>
            )}
            {variants.map((v, i) => (
              <div key={i} className="space-y-2 rounded-md border bg-background p-2">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-semibold">
                    <Shuffle className="h-3 w-3" /> Variação {i + 1}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => set({ variants: variants.filter((_, idx) => idx !== i) })}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
                <Textarea
                  ref={(el) => (textareas.current[i] = el)}
                  rows={4}
                  value={v.text}
                  onFocus={() => (focused.current = i)}
                  onChange={(e) => setVariant(i, { text: e.target.value })}
                  placeholder="Texto da mensagem..."
                  className="text-sm"
                />
                <div className="flex items-center gap-2">
                  <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={v.media_url ?? ""}
                    onChange={(e) => setVariant(i, { media_url: e.target.value || null, media_type: "image" })}
                    placeholder="URL de imagem (opcional — vai como legenda)"
                    className="h-8 text-xs"
                  />
                </div>
                {v.text.includes("{") && (
                  <p className="whitespace-pre-wrap rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                    {preview(v.text)}
                  </p>
                )}
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => set({ variants: [...variants, variants.length ? { text: "" } : DEFAULT_VARIANT] })}
            >
              <Plus className="h-3.5 w-3.5" /> Adicionar variação
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
