import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Loader2, Save, MessageSquareWarning, ListChecks } from "lucide-react";
import { DEFAULT_CLOSING_PHRASES } from "@/lib/attendance/closingPhrases";
import { invalidateAttendanceRules } from "@/hooks/useAttendanceRules";

interface RuleRow {
  rule_key: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

export function AttendanceRulesSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // end_with_question
  const [eqEnabled, setEqEnabled] = useState(true);
  const [eqMessage, setEqMessage] = useState(
    "Sua mensagem não termina com pergunta. Que tal puxar uma resposta da cliente?",
  );
  const [eqMinLength, setEqMinLength] = useState(12);
  const [eqPhrases, setEqPhrases] = useState(DEFAULT_CLOSING_PHRASES.join("\n"));

  // workload_counters
  const [wlEnabled, setWlEnabled] = useState(true);
  const [wlAwaiting, setWlAwaiting] = useState(true);
  const [wlFollowups, setWlFollowups] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any)
        .from("chat_attendance_rules")
        .select("rule_key, enabled, config");
      for (const row of (data || []) as RuleRow[]) {
        if (row.rule_key === "end_with_question") {
          setEqEnabled(!!row.enabled);
          const c = row.config || {};
          if (typeof c.message === "string") setEqMessage(c.message);
          if (typeof c.min_length === "number") setEqMinLength(c.min_length);
          if (Array.isArray(c.closing_phrases))
            setEqPhrases((c.closing_phrases as string[]).join("\n"));
        }
        if (row.rule_key === "workload_counters") {
          setWlEnabled(!!row.enabled);
          const c = row.config || {};
          setWlAwaiting(c.show_awaiting !== false);
          setWlFollowups(c.show_followups !== false);
        }
      }
      setLoading(false);
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    const phrases = eqPhrases
      .split("\n")
      .map((p) => p.trim())
      .filter(Boolean);

    const rows = [
      {
        rule_key: "end_with_question",
        enabled: eqEnabled,
        config: { message: eqMessage, min_length: eqMinLength, closing_phrases: phrases },
      },
      {
        rule_key: "workload_counters",
        enabled: wlEnabled,
        config: { show_awaiting: wlAwaiting, show_followups: wlFollowups },
      },
    ];

    const { error } = await (supabase as any)
      .from("chat_attendance_rules")
      .upsert(rows, { onConflict: "rule_key" });

    setSaving(false);
    if (error) {
      toast.error("Erro ao salvar: " + error.message);
      return;
    }
    invalidateAttendanceRules();
    toast.success("Regras de atendimento salvas!");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando regras...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquareWarning className="h-4 w-4 text-sky-500" />
            Lembrete: terminar com pergunta
          </CardTitle>
          <CardDescription>
            Avisa a vendedora (enquanto digita) quando a mensagem não termina com "?".
            Nunca bloqueia o envio.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="eq-enabled">Regra ativa</Label>
            <Switch id="eq-enabled" checked={eqEnabled} onCheckedChange={setEqEnabled} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="eq-message">Mensagem do aviso</Label>
            <Input id="eq-message" value={eqMessage} onChange={(e) => setEqMessage(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="eq-min">Tamanho mínimo da mensagem (caracteres)</Label>
            <Input
              id="eq-min"
              type="number"
              min={1}
              value={eqMinLength}
              onChange={(e) => setEqMinLength(Number(e.target.value) || 0)}
              className="w-28"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="eq-phrases">
              Frases de fechamento (exceções) — uma por linha
            </Label>
            <Textarea
              id="eq-phrases"
              value={eqPhrases}
              onChange={(e) => setEqPhrases(e.target.value)}
              rows={8}
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              Se a mensagem contém qualquer uma dessas frases, o aviso não aparece.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ListChecks className="h-4 w-4 text-primary" />
            Contadores da fila (card flutuante)
          </CardTitle>
          <CardDescription>
            Mostra à vendedora quantos clientes aguardam resposta e quantos follow-ups
            ela tem pra fazer.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="wl-enabled">Card ativo</Label>
            <Switch id="wl-enabled" checked={wlEnabled} onCheckedChange={setWlEnabled} />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="wl-awaiting">Mostrar "clientes aguardando"</Label>
            <Switch id="wl-awaiting" checked={wlAwaiting} onCheckedChange={setWlAwaiting} />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="wl-followups">Mostrar "follow-ups pra fazer"</Label>
            <Switch id="wl-followups" checked={wlFollowups} onCheckedChange={setWlFollowups} />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar regras
        </Button>
      </div>
    </div>
  );
}
