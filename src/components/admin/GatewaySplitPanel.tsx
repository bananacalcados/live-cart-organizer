import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

const GATEWAYS = [
  { key: "mercadopago", label: "Mercado Pago", disabled: false },
  { key: "pagarme", label: "Pagar.me", disabled: false },
  { key: "appmax", label: "AppMax", disabled: false },
  { key: "austpay", label: "AustPay", disabled: true, note: "Desativada até ter credenciais de produção" },
] as const;

type Pct = Record<string, number>;

export function GatewaySplitPanel() {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(false);
  const [pct, setPct] = useState<Pct>({ mercadopago: 100, pagarme: 0, appmax: 0, austpay: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("gateway_split_config")
        .select("enabled, percentages")
        .eq("id", true)
        .maybeSingle();
      if (error) toast({ title: "Erro ao carregar", description: error.message, variant: "destructive" });
      if (data) {
        setEnabled(!!data.enabled);
        setPct({ mercadopago: 0, pagarme: 0, appmax: 0, austpay: 0, ...((data.percentages as Pct) || {}) });
      }
      setLoading(false);
    })();
  }, [toast]);

  const total = GATEWAYS.reduce((s, g) => s + (Number(pct[g.key]) || 0), 0);
  const valid = total === 100;

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    const { error } = await supabase
      .from("gateway_split_config")
      .update({ enabled, percentages: pct })
      .eq("id", true);
    setSaving(false);
    if (error) toast({ title: "Não salvou", description: error.message, variant: "destructive" });
    else toast({ title: "Divisão salva" });
  };

  if (loading) return <p className="text-sm text-muted-foreground">Carregando…</p>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          Divisão entre gateways (cartão de crédito)
          <div className="flex items-center gap-2 text-sm font-normal">
            <Label htmlFor="split-enabled">{enabled ? "Ligada" : "Desligada"}</Label>
            <Switch id="split-enabled" checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Define em qual gateway cada venda no cartão começa. Pix e débito continuam sempre no Mercado Pago.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {GATEWAYS.map((g) => (
            <div key={g.key} className={`space-y-1 ${g.disabled ? "opacity-50" : ""}`}>
              <Label>{g.label}</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  disabled={g.disabled}
                  value={pct[g.key] ?? 0}
                  onChange={(e) => {
                    const v = Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0)));
                    setPct((p) => ({ ...p, [g.key]: v }));
                  }}
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
              {"note" in g && g.note && <p className="text-xs text-muted-foreground">{g.note}</p>}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm">Soma:</span>
          <Badge variant={valid ? "secondary" : "destructive"}>{total}%</Badge>
          {!valid && <span className="text-sm text-destructive">A soma precisa dar 100%</span>}
        </div>

        <div className="rounded-md border p-3 text-sm text-muted-foreground">
          <strong className="text-foreground">Plano B (cascata):</strong> se o gateway sorteado recusar, a venda tenta os
          outros nesta ordem, pulando o que já recusou: Mercado Pago → Pagar.me → AppMax.
        </div>

        <Button onClick={save} disabled={!valid || saving}>
          {saving ? "Salvando…" : "Salvar divisão"}
        </Button>
      </CardContent>
    </Card>
  );
}
