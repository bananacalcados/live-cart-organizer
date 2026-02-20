import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pencil, Check } from "lucide-react";

export interface MasterDirective {
  campaign_name: string;
  concept: string;
  tone_of_voice: string;
  key_messages: string[];
  target_audience: string;
  goals: string[];
  start_date_suggestion?: string;
  end_date_suggestion?: string;
  estimated_budget?: number;
  summary: string;
  recommended_channels: Array<{
    channel_type: string;
    priority: string;
    rationale: string;
  }>;
}

interface Props {
  directive: MasterDirective;
  onUpdate: (d: MasterDirective) => void;
}

const CHANNEL_LABELS: Record<string, string> = {
  grupo_vip: "Grupo VIP",
  whatsapp_marketing: "WhatsApp Marketing",
  instagram: "Instagram",
  loja_fisica: "Loja Física",
  email: "Email Marketing",
  site: "Site",
};

const PRIORITY_COLORS: Record<string, string> = {
  alta: "bg-red-500/10 text-red-700 border-red-500/30",
  media: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  baixa: "bg-blue-500/10 text-blue-700 border-blue-500/30",
};

export function MasterDirectiveCard({ directive, onUpdate }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const startEdit = (field: string, value: string) => {
    setEditing(field);
    setEditValue(value);
  };

  const saveEdit = (field: string) => {
    onUpdate({ ...directive, [field]: editValue });
    setEditing(null);
  };

  const EditableField = ({ field, label, value, multiline = false }: { field: string; label: string; value: string; multiline?: boolean }) => (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        {editing !== field && (
          <button onClick={() => startEdit(field, value)} className="text-muted-foreground hover:text-primary">
            <Pencil className="h-3 w-3" />
          </button>
        )}
      </div>
      {editing === field ? (
        <div className="flex gap-2">
          {multiline ? (
            <Textarea value={editValue} onChange={e => setEditValue(e.target.value)} rows={3} className="text-sm" />
          ) : (
            <Input value={editValue} onChange={e => setEditValue(e.target.value)} className="text-sm" />
          )}
          <Button size="sm" variant="ghost" onClick={() => saveEdit(field)}><Check className="h-4 w-4" /></Button>
        </div>
      ) : (
        <p className="text-sm leading-relaxed whitespace-pre-line">{value}</p>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="pt-5 pb-4 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">🎯</span>
            <h3 className="font-bold text-lg">Diretriz Matriz</h3>
          </div>

          <EditableField field="campaign_name" label="Nome da Campanha" value={directive.campaign_name} />
          <EditableField field="concept" label="Conceito Central / Big Idea" value={directive.concept} multiline />
          <EditableField field="tone_of_voice" label="Tom de Voz" value={directive.tone_of_voice} multiline />
          <EditableField field="summary" label="Resumo Executivo" value={directive.summary} multiline />
          <EditableField field="target_audience" label="Público-Alvo" value={directive.target_audience} multiline />

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Mensagens-Chave</Label>
            <div className="space-y-1.5">
              {directive.key_messages.map((msg, i) => (
                <div key={i} className="text-sm bg-muted/50 rounded-md p-2 italic">"{msg}"</div>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Metas Gerais</Label>
            <ul className="space-y-1">
              {directive.goals.map((g, i) => (
                <li key={i} className="text-sm flex gap-2"><span className="text-primary">✓</span>{g}</li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4 pb-4 space-y-3">
          <h4 className="text-sm font-semibold">📡 Canais Recomendados</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {directive.recommended_channels.map(ch => (
              <div key={ch.channel_type} className="border rounded-lg p-3 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{CHANNEL_LABELS[ch.channel_type] || ch.channel_type}</span>
                  <Badge variant="outline" className={PRIORITY_COLORS[ch.priority] || ""}>{ch.priority}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{ch.rationale}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
