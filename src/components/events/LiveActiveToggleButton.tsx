import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Radio } from "lucide-react";
import { toast } from "sonner";

interface Props {
  eventId: string;
  size?: "sm" | "default";
}

export const LiveActiveToggleButton = ({ eventId, size = "sm" }: Props) => {
  const [liveActiveUntil, setLiveActiveUntil] = useState<Date | null>(null);
  const [toggling, setToggling] = useState(false);

  const isActive = !!liveActiveUntil && liveActiveUntil.getTime() > Date.now();

  const refresh = useCallback(async () => {
    if (!eventId) return;
    const { data } = await supabase
      .from("events")
      .select("live_active_until")
      .eq("id", eventId)
      .maybeSingle();
    setLiveActiveUntil(data?.live_active_until ? new Date(data.live_active_until) : null);
  }, [eventId]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 60000);
    return () => clearInterval(t);
  }, [refresh]);

  const toggle = useCallback(async () => {
    if (!eventId || toggling) return;
    setToggling(true);
    try {
      if (isActive) {
        const { error } = await supabase.rpc("clear_event_live_active", { p_event_id: eventId });
        if (error) throw error;
        toast.success("Live desativada para este evento");
        setLiveActiveUntil(null);
      } else {
        const { data, error } = await supabase.rpc("set_event_live_active", { p_event_id: eventId });
        if (error) throw error;
        toast.success("Live ativada — expira em 12h");
        if (data) setLiveActiveUntil(new Date(data as string));
      }
      await refresh();
    } catch (e: any) {
      toast.error("Erro ao alternar Live: " + (e?.message || "desconhecido"));
    } finally {
      setToggling(false);
    }
  }, [eventId, isActive, toggling, refresh]);

  const hoursLeft = liveActiveUntil
    ? Math.max(0, Math.round((liveActiveUntil.getTime() - Date.now()) / 3600000))
    : 0;

  return (
    <Button
      variant={isActive ? "default" : "outline"}
      size={size}
      onClick={toggle}
      disabled={toggling}
      className={
        isActive
          ? "gap-1.5 bg-red-600 hover:bg-red-700 text-white border-red-600 animate-pulse"
          : "gap-1.5"
      }
      title={isActive ? `Comentários da Live vão para este evento. Expira em ~${hoursLeft}h` : "Marcar este evento como a Live ativa agora"}
    >
      <Radio className="h-4 w-4" />
      {isActive ? "AO VIVO" : "Ativar Live"}
    </Button>
  );
};
