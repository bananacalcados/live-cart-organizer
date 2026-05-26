import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, FileText, AlertCircle, Type, Variable } from "lucide-react";
import { Badge } from "@/components/ui/badge";

// "Token" = value exatamente igual a um dos AVAILABLE_TOKENS (formato {algo}).
// Qualquer outra coisa é tratada como texto livre e enviado literalmente para a Meta.
const isTokenValue = (v: string) => /^\{[a-z_]+\}$/i.test(v || "");

export const AVAILABLE_TOKENS = [
  { value: "{customer_name}", label: "Nome completo do cliente" },
  { value: "{customer_first_name}", label: "Primeiro nome" },
  { value: "{instagram}", label: "@ do Instagram" },
  { value: "{products}", label: "Lista de produtos (1 linha)" },
  { value: "{products_short}", label: "Produtos (vírgula)" },
  { value: "{checkout_link}", label: "Link de pagamento (checkout)" },
  { value: "{subtotal}", label: "Subtotal (R$)" },
  { value: "{discount}", label: "Desconto (R$)" },
  { value: "{total}", label: "Total (R$)" },
  { value: "{order_id}", label: "ID do pedido (curto)" },
] as const;

interface MetaTemplate {
  name: string;
  language: string;
  status: string;
  category: string;
  components: Array<{
    type: "HEADER" | "BODY" | "FOOTER" | "BUTTONS";
    format?: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";
    text?: string;
  }>;
}

interface Props {
  whatsappNumberId: string | null;
  templateName: string | null;
  language: string;
  bodyVariables: string[];
  headerVariable: string | null;
  onChange: (next: {
    templateName: string | null;
    language: string;
    bodyVariables: string[];
    headerVariable: string | null;
  }) => void;
}

const countVarSlots = (text?: string): number => {
  if (!text) return 0;
  const matches = text.match(/\{\{\s*(\d+)\s*\}\}/g);
  if (!matches) return 0;
  const nums = matches.map((m) => parseInt(m.replace(/\D/g, ""), 10));
  return Math.max(...nums);
};

export const MetaTemplateConfigurator = ({
  whatsappNumberId,
  templateName,
  language,
  bodyVariables,
  headerVariable,
  onChange,
}: Props) => {
  const [templates, setTemplates] = useState<MetaTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!whatsappNumberId || whatsappNumberId === "none") {
      setTemplates([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data, error: invokeErr } = await supabase.functions.invoke(
          "meta-whatsapp-get-templates",
          { body: { whatsappNumberId, status: "APPROVED" } },
        );
        if (cancelled) return;
        if (invokeErr) {
          setError(invokeErr.message);
        } else if (data?.error) {
          setError(data.error);
        } else {
          const list: MetaTemplate[] = (data?.data || data?.templates || []) as MetaTemplate[];
          setTemplates(list);
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [whatsappNumberId]);

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.name === templateName) || null,
    [templates, templateName],
  );

  const headerComponent = selectedTemplate?.components.find((c) => c.type === "HEADER");
  const bodyComponent = selectedTemplate?.components.find((c) => c.type === "BODY");
  const bodyText = bodyComponent?.text || "";
  const headerText = headerComponent?.format === "TEXT" ? headerComponent.text || "" : "";

  const bodyVarCount = countVarSlots(bodyText);
  const headerVarCount = countVarSlots(headerText);

  const setBodyVar = (index: number, token: string) => {
    const next = [...bodyVariables];
    while (next.length < bodyVarCount) next.push("");
    next[index] = token;
    onChange({ templateName, language, bodyVariables: next.slice(0, bodyVarCount), headerVariable });
  };

  const renderPreview = (text: string, vars: string[]) =>
    text.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n) => {
      const idx = parseInt(n, 10) - 1;
      const token = vars[idx];
      return token ? `[${token}]` : `{{${n}}}`;
    });

  if (!whatsappNumberId || whatsappNumberId === "none") {
    return (
      <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground flex items-center gap-2">
        <AlertCircle className="h-4 w-4" />
        Selecione um número WhatsApp para carregar os templates aprovados.
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-md border p-3 bg-muted/30">
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 text-accent" />
        <Label className="font-semibold">Template Meta para Automação</Label>
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Template aprovado</Label>
        <Select
          value={templateName || ""}
          onValueChange={(val) => {
            const tpl = templates.find((t) => t.name === val);
            onChange({
              templateName: val,
              language: tpl?.language || language || "pt_BR",
              bodyVariables: [],
              headerVariable: null,
            });
          }}
          disabled={loading || templates.length === 0}
        >
          <SelectTrigger>
            <SelectValue
              placeholder={
                loading
                  ? "Carregando templates..."
                  : templates.length === 0
                  ? "Nenhum template aprovado disponível"
                  : "Selecione um template..."
              }
            />
          </SelectTrigger>
          <SelectContent>
            {templates.map((t) => (
              <SelectItem key={`${t.name}_${t.language}`} value={t.name}>
                {t.name} <span className="text-muted-foreground ml-1">({t.language})</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {loading && (
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" /> Buscando templates aprovados na Meta…
          </div>
        )}
        {error && <div className="text-xs text-destructive">{error}</div>}
      </div>

      {selectedTemplate && (
        <>
          {/* Header text variables */}
          {headerComponent?.format === "TEXT" && headerVarCount > 0 && (
            <div className="space-y-2">
              <Label className="text-xs">Variável do cabeçalho</Label>
              <div className="text-xs bg-background border rounded p-2 font-mono whitespace-pre-wrap">
                {headerText}
              </div>
              {(() => {
                const isToken = !headerVariable || isTokenValue(headerVariable);
                return (
                  <div className="flex items-center gap-2">
                    {isToken ? (
                      <Select
                        value={headerVariable || ""}
                        onValueChange={(val) =>
                          onChange({ templateName, language, bodyVariables, headerVariable: val })
                        }
                      >
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder="Escolha o token..." />
                        </SelectTrigger>
                        <SelectContent>
                          {AVAILABLE_TOKENS.map((t) => (
                            <SelectItem key={t.value} value={t.value}>
                              <code className="text-xs">{t.value}</code> — {t.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        className="flex-1"
                        placeholder="Digite o texto livre..."
                        value={headerVariable || ""}
                        onChange={(e) =>
                          onChange({ templateName, language, bodyVariables, headerVariable: e.target.value })
                        }
                      />
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      title={isToken ? "Mudar para texto livre" : "Mudar para token/variável"}
                      onClick={() =>
                        onChange({
                          templateName,
                          language,
                          bodyVariables,
                          headerVariable: isToken ? " " : "",
                        })
                      }
                    >
                      {isToken ? <Type className="h-3 w-3" /> : <Variable className="h-3 w-3" />}
                    </Button>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Body */}
          <div className="space-y-2">
            <Label className="text-xs">Corpo do template</Label>
            <div className="text-xs bg-background border rounded p-2 font-mono whitespace-pre-wrap">
              {bodyText}
            </div>
          </div>

          {bodyVarCount > 0 && (
            <div className="space-y-2">
              <Label className="text-xs">
                Mapeamento das variáveis ({bodyVarCount} {bodyVarCount === 1 ? "variável" : "variáveis"})
              </Label>
              {Array.from({ length: bodyVarCount }).map((_, i) => {
                const current = bodyVariables[i] || "";
                const isToken = !current || isTokenValue(current);
                return (
                  <div key={i} className="flex items-center gap-2">
                    <Badge variant="outline" className="font-mono">{`{{${i + 1}}}`}</Badge>
                    {isToken ? (
                      <Select
                        value={current}
                        onValueChange={(val) => setBodyVar(i, val)}
                      >
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder="Escolha o token..." />
                        </SelectTrigger>
                        <SelectContent>
                          {AVAILABLE_TOKENS.map((t) => (
                            <SelectItem key={t.value} value={t.value}>
                              <code className="text-xs">{t.value}</code> — {t.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        className="flex-1"
                        placeholder="Digite o texto livre..."
                        value={current}
                        onChange={(e) => setBodyVar(i, e.target.value)}
                      />
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      title={isToken ? "Mudar para texto livre" : "Mudar para token/variável"}
                      onClick={() => setBodyVar(i, isToken ? " " : "")}
                    >
                      {isToken ? <Type className="h-3 w-3" /> : <Variable className="h-3 w-3" />}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Preview */}
          {(bodyVarCount > 0 || headerVarCount > 0) && (
            <div className="space-y-1 border-t pt-2">
              <Label className="text-xs text-muted-foreground">Preview com tokens</Label>
              {headerComponent?.format === "TEXT" && (
                <div className="text-xs bg-background border rounded p-2 font-semibold whitespace-pre-wrap">
                  {renderPreview(headerText, headerVariable ? [headerVariable] : [])}
                </div>
              )}
              <div className="text-xs bg-background border rounded p-2 whitespace-pre-wrap">
                {renderPreview(bodyText, bodyVariables)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
