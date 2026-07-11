import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, MessagesSquare } from "lucide-react";
import { MetaTemplateConfigurator } from "./MetaTemplateConfigurator";

/**
 * Um template de acompanhamento (2ª/3ª mensagem) do evento.
 * É disparado MANUALMENTE pela vendedora dentro do chat — nunca automaticamente
 * junto com a primeira mensagem.
 */
export interface FollowupTemplate {
  id: string;
  label: string;
  templateName: string | null;
  language: string;
  bodyVariables: string[];
  headerVariable: string | null;
}

interface Props {
  whatsappNumberId: string | null;
  templates: FollowupTemplate[];
  onChange: (next: FollowupTemplate[]) => void;
}

function newTemplate(index: number): FollowupTemplate {
  return {
    id: (globalThis.crypto?.randomUUID?.() ?? `tpl_${Date.now()}_${Math.random().toString(36).slice(2)}`),
    label: `Acompanhamento ${index}`,
    templateName: null,
    language: "pt_BR",
    bodyVariables: [],
    headerVariable: null,
  };
}

/**
 * Configurador dos templates de acompanhamento do evento (opcional).
 * Reaproveita o mesmo seletor de templates aprovados + variáveis usado na 1ª mensagem.
 */
export function EventFollowupTemplates({ whatsappNumberId, templates, onChange }: Props) {
  const update = (id: string, patch: Partial<FollowupTemplate>) => {
    onChange(templates.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  };
  const remove = (id: string) => onChange(templates.filter((t) => t.id !== id));
  const add = () => onChange([...templates, newTemplate(templates.length + 1)]);

  return (
    <div className="space-y-3 rounded-md border border-dashed p-3">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-2 font-semibold">
          <MessagesSquare className="h-4 w-4 text-accent" />
          Templates de acompanhamento (2ª / 3ª mensagem)
        </Label>
        <Button type="button" variant="outline" size="sm" onClick={add} className="gap-1">
          <Plus className="h-3.5 w-3.5" /> Adicionar
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Opcional. Estes templates <strong>não são disparados automaticamente</strong> — as vendedoras os enviam
        manualmente pelo chat do cliente que não respondeu a primeira mensagem.
      </p>

      {templates.length === 0 && (
        <div className="text-xs text-muted-foreground py-1">
          Nenhum template de acompanhamento configurado.
        </div>
      )}

      {templates.map((t, i) => (
        <div key={t.id} className="space-y-2 rounded-md border p-3 bg-background">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground shrink-0">#{i + 1}</span>
            <Input
              value={t.label}
              onChange={(e) => update(t.id, { label: e.target.value })}
              placeholder="Nome interno (ex.: Lembrete 24h)"
              className="h-8 text-sm"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive shrink-0"
              onClick={() => remove(t.id)}
              title="Remover"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <MetaTemplateConfigurator
            whatsappNumberId={whatsappNumberId}
            templateName={t.templateName}
            language={t.language}
            bodyVariables={t.bodyVariables}
            headerVariable={t.headerVariable}
            onChange={(next) =>
              update(t.id, {
                templateName: next.templateName,
                language: next.language,
                bodyVariables: next.bodyVariables,
                headerVariable: next.headerVariable,
              })
            }
          />
        </div>
      ))}
    </div>
  );
}
