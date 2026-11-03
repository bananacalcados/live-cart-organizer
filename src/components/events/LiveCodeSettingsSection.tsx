import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const db = supabase as any;

export function LiveCodeSettingsSection({ eventId }: { eventId: string }) {
  const [active, setActive] = useState(false);
  const [minutes, setMinutes] = useState(10);
  const [showCodes, setShowCodes] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    db.from("live_code_settings").select("mode, overlay_previous_minutes, overlay_show_codes")
      .eq("event_id", eventId).maybeSingle().then(({ data }: any) => {
        if (!alive) return;
        setActive(data?.mode === "active");
        setMinutes(data?.overlay_previous_minutes ?? 10);
        setShowCodes(Boolean(data?.overlay_show_codes));
        setLoading(false);
      });
    return () => { alive = false; };
  }, [eventId]);

  const save = async () => {
    setSaving(true);
    const { error } = await db.from("live_code_settings").upsert({
      event_id: eventId, mode: active ? "active" : "off",
      overlay_previous_minutes: Math.max(0, Math.round(minutes || 0)),
      overlay_show_codes: showCodes, updated_at: new Date().toISOString(),
    }, { onConflict: "event_id" });
    setSaving(false);
    if (error) toast.error("Erro ao salvar: " + error.message);
    else toast.success("Códigos na live salvos");
  };

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div>
        <h3 className="font-semibold">Códigos na live</h3>
        <p className="text-xs text-muted-foreground">
          Por enquanto, "Ativo" só guarda a configuração. A anotação automática pelos comentários vem numa etapa futura.
        </p>
      </div>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : (
        <>
          <div className="flex items-center justify-between">
            <Label>{active ? "Ativo" : "Desligado"}</Label>
            <Switch checked={active} onCheckedChange={setActive} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label>Manter anteriores no overlay por (minutos)</Label>
            <Input type="number" min={0} className="w-24" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
          </div>
          <div className="flex items-center justify-between">
            <Label>Mostrar códigos no overlay</Label>
            <Switch checked={showCodes} onCheckedChange={setShowCodes} />
          </div>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />} Salvar códigos na live
          </Button>
        </>
      )}
    </div>
  );
}
