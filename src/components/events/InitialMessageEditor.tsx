import { useMemo, useRef } from "react";
import { Plus, Trash2, ArrowUp, ArrowDown, MessageSquare, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

interface Props {
  enabled: boolean;
  blocks: string[];
  onChange: (next: { enabled: boolean; blocks: string[] }) => void;
}

// Mantém em sync com livete-start-order/resolveToken
const VARIABLES: { token: string; label: string; sample: string }[] = [
  { token: "{customer_first_name}", label: "Primeiro nome", sample: "Juliana" },
  { token: "{customer_name}", label: "Nome / @ completo", sample: "@juliana_soares_292" },
  { token: "{instagram}", label: "@ do Instagram", sample: "@juliana_soares_292" },
  { token: "{checkout_link}", label: "Link de pagamento", sample: "https://checkout.bananacalcados.com.br/checkout/order/abc12345" },
  { token: "{products}", label: "Lista de produtos (longa)", sample: "1x Tênis Jess Ortopédico (37 Preto) — R$199.90" },
  { token: "{products_short}", label: "Lista de produtos (curta)", sample: "1x Tênis Jess Ortopédico" },
  { token: "{subtotal}", label: "Subtotal", sample: "R$199.90" },
  { token: "{discount}", label: "Desconto", sample: "R$10.00" },
  { token: "{total}", label: "Total", sample: "R$189.90" },
  { token: "{order_id}", label: "ID do pedido (curto)", sample: "abc12345" },
];

const DEFAULT_BLOCKS = [
  "Oii {customer_first_name}, já separamos seu pedido.",
  "{checkout_link}",
  "Só clicar no link acima pra finalizar a compra. Seu produto já foi separado, mas precisa ser pago em 10 minutos, pra continuar reservado, OK?",
];

export function InitialMessageEditor({ enabled, blocks, onChange }: Props) {
  const focusedIndexRef = useRef<number>(0);
  const textareasRef = useRef<Record<number, HTMLTextAreaElement | null>>({});

  const safeBlocks = blocks?.length ? blocks : [];

  const update = (next: { enabled?: boolean; blocks?: string[] }) =>
    onChange({
      enabled: next.enabled ?? enabled,
      blocks: next.blocks ?? safeBlocks,
    });

  const setBlock = (idx: number, value: string) => {
    const copy = [...safeBlocks];
    copy[idx] = value;
    update({ blocks: copy });
  };

  const addBlock = () => update({ blocks: [...safeBlocks, ""] });

  const removeBlock = (idx: number) => {
    const copy = safeBlocks.filter((_, i) => i !== idx);
    update({ blocks: copy });
  };

  const move = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= safeBlocks.length) return;
    const copy = [...safeBlocks];
    [copy[idx], copy[target]] = [copy[target], copy[idx]];
    update({ blocks: copy });
  };

  const loadDefault = () => update({ blocks: DEFAULT_BLOCKS });

  const insertVariable = (token: string) => {
    const idx = focusedIndexRef.current;
    const ta = textareasRef.current[idx];
    const current = safeBlocks[idx] ?? "";
    const start = ta?.selectionStart ?? current.length;
    const end = ta?.selectionEnd ?? current.length;
    const next = current.slice(0, start) + token + current.slice(end);
    setBlock(idx, next);
    requestAnimationFrame(() => {
      const el = textareasRef.current[idx];
      if (el) {
        el.focus();
        const pos = start + token.length;
        el.setSelectionRange(pos, pos);
      }
    });
  };

  const previewBlocks = useMemo(() => {
    return safeBlocks.map((b) => {
      let out = b;
      for (const v of VARIABLES) out = out.split(v.token).join(v.sample);
      return out;
    });
  }, [safeBlocks]);

  return (
    <div className="space-y-3 rounded-lg border border-border p-4 bg-muted/30">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <Label className="flex items-center gap-2 text-base">
            <MessageSquare className="h-4 w-4" />
            Mensagem inicial automática
          </Label>
          <p className="text-xs text-muted-foreground">
            Quando ativada, substitui a saudação do agente de IA. A IA continua atuando apenas no follow-up depois que o cliente responder.
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={(v) => update({ enabled: v })} />
      </div>

      {enabled && (
        <>
          <div className="flex flex-wrap gap-1.5 pt-2 border-t border-border/60">
            <span className="text-xs text-muted-foreground self-center mr-1">Inserir variável:</span>
            {VARIABLES.map((v) => (
              <Badge
                key={v.token}
                variant="secondary"
                className="cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors font-mono text-[10px]"
                onClick={() => insertVariable(v.token)}
                title={v.label}
              >
                {v.token}
              </Badge>
            ))}
          </div>

          <div className="space-y-2">
            {safeBlocks.length === 0 && (
              <div className="text-center py-4 text-sm text-muted-foreground">
                Nenhum bloco configurado.{" "}
                <button
                  type="button"
                  className="text-primary underline"
                  onClick={loadDefault}
                >
                  Carregar template padrão (3 blocos)
                </button>
              </div>
            )}

            {safeBlocks.map((block, idx) => (
              <div key={idx} className="flex gap-2 items-start">
                <div className="flex flex-col gap-1 pt-1">
                  <Badge variant="outline" className="h-6 w-6 p-0 flex items-center justify-center text-xs">
                    {idx + 1}
                  </Badge>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={() => move(idx, -1)}
                    disabled={idx === 0}
                  >
                    <ArrowUp className="h-3 w-3" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={() => move(idx, 1)}
                    disabled={idx === safeBlocks.length - 1}
                  >
                    <ArrowDown className="h-3 w-3" />
                  </Button>
                </div>
                <Textarea
                  ref={(el) => (textareasRef.current[idx] = el)}
                  value={block}
                  onChange={(e) => setBlock(idx, e.target.value)}
                  onFocus={() => (focusedIndexRef.current = idx)}
                  placeholder={`Bloco ${idx + 1} — digite o texto do balão`}
                  className="min-h-[70px] font-mono text-xs"
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-destructive"
                  onClick={() => removeBlock(idx)}
                  title="Remover bloco"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}

            <Button type="button" variant="outline" size="sm" onClick={addBlock} className="w-full">
              <Plus className="h-3 w-3 mr-1" /> Adicionar bloco
            </Button>
          </div>

          {safeBlocks.length > 0 && (
            <Card className="bg-background">
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Eye className="h-3 w-3" /> Pré-visualização (com dados fictícios)
                </div>
                {previewBlocks.map((p, i) => (
                  <div
                    key={i}
                    className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words max-w-[85%]"
                  >
                    {p || <span className="text-muted-foreground italic">(vazio)</span>}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
