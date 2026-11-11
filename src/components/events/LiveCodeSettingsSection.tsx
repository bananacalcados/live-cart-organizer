import { useEffect, useState } from "react";
import { Loader2, Settings2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const db = supabase as any;

/** Configuração compacta de "Códigos na live", no topo da aba Produtos em exibição. */
export function LiveCodeSettingsSection({ eventId }: { eventId: string }) {
  const [active, setActive] = useState(false);
  const [minutes, setMinutes] = useState(10);
  const [showCodes, setShowCodes] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    db.from("live_code_settings").select("mode, overlay_previous_minutes, overlay_show_codes")
      .eq("event_id", eventId).maybeSingle().then(({ data }: any) => {
        if (!alive) return;
        setActive(data?.mode === "active");
        setMinutes(data?.overlay_previous_minutes ?? 10);
        setShowCodes(data?.overlay_show_codes ?? true);
        setLoading(false);
      });
    return () => { alive = false; };
  }, [eventId]);

  const persist = async (next: { active: boolean; minutes: number; showCodes: boolean }, msg: string) => {
    setSaving(true);
    const { error } = await db.from("live_code_settings").upsert({
      event_id: eventId, mode: next.active ? "active" : "off",
      overlay_previous_minutes: Math.max(0, Math.round(next.minutes || 0)),
      overlay_show_codes: next.showCodes, updated_at: new Date().toISOString(),
    }, { onConflict: "event_id" });
    setSaving(false);
    if (error) { toast.error("Erro ao salvar: " + error.message); return false; }
    toast.success(msg);
    return true;
  };

  const toggleActive = async (v: boolean) => {
    const prev = active;
    setActive(v);
    setSaving(true);
    const { error } = await db.from("live_code_settings").upsert({
      event_id: eventId, mode: v ? "active" : "off", updated_at: new Date().toISOString(),
    }, { onConflict: "event_id" });
    setSaving(false);
    if (error) { toast.error("Erro ao salvar: " + error.message); setActive(prev); return; }
    toast.success(v ? "Anotação automática ativada" : "Anotação automática desligada");
  };

  if (loading) return <div className="rounded-lg border p-3"><Loader2 className="h-4 w-4 animate-spin" /></div>;

  return (
    <div className="rounded-lg border p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <Switch checked={active} onCheckedChange={toggleActive} disabled={saving} />
        <span className="font-semibold text-sm">
          Anotação automática por código: <span className={active ? "text-primary" : "text-muted-foreground"}>{active ? "Ativo" : "Desligado"}</span>
        </span>
        <Button size="sm" variant="ghost" className="ml-auto h-7 gap-1" onClick={() => setOpen((o) => !o)}>
          <Settings2 className="h-3.5 w-3.5" /> Configurar
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Quando Ativo, comentários com código (ex.: T101 37 final 8531) viram cards 'Por código' na linha PEDIDOS.
      </p>
      {open && (
        <div className="space-y-2 border-t pt-2">
          <div className="flex items-center justify-between gap-3">
            <Label>Manter anteriores no overlay por (minutos)</Label>
            <Input type="number" min={0} className="w-24" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
          </div>
          <div className="flex items-center justify-between">
            <Label>Mostrar códigos no overlay</Label>
            <Switch checked={showCodes} onCheckedChange={setShowCodes} />
          </div>
          <Button size="sm" onClick={() => persist({ active, minutes, showCodes }, "Configuração salva")} disabled={saving}>
            {saving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />} Salvar
          </Button>
        </div>
      )}
    </div>
  );
}
