import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Radio, Loader2, RefreshCw, PowerOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ActiveBroadcast {
  id: string;
  name: string;
  instagram_live_url: string | null;
  live_broadcast_started_at: string | null;
  live_url_updated_at: string | null;
}

function formatSince(iso: string | null) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return null;
  }
}

/**
 * LiveBroadcastBanner — banner fixo exibido no módulo Eventos enquanto algum evento
 * estiver marcado como AO VIVO. O link vale enquanto o AO VIVO estiver ligado; a ação
 * "Trocar link" atualiza a URL do Instagram sem sair do módulo.
 */
export function LiveBroadcastBanner() {
  const [active, setActive] = useState<ActiveBroadcast | null>(null);
  const [loading, setLoading] = useState(true);
  
  const [changeOpen, setChangeOpen] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchActive = useCallback(async () => {
    const { data } = await supabase
      .from("events")
      .select("id, name, instagram_live_url, live_broadcast_started_at, live_url_updated_at")
      .eq("is_live_broadcasting", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setActive((data as ActiveBroadcast | null) ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchActive();
    const poll = setInterval(fetchActive, 30_000);
    return () => clearInterval(poll);
  }, [fetchActive]);

  if (loading || !active) return null;

  const sinceLabel = formatSince(
    active.live_url_updated_at || active.live_broadcast_started_at,
  );

  const openChange = () => {
    setNewUrl(active.instagram_live_url ?? "");
    setChangeOpen(true);
  };

  const saveNewUrl = async () => {
    const trimmed = newUrl.trim();
    if (!/^https?:\/\/(www\.)?instagram\.com\//i.test(trimmed)) {
      toast.error("Cole o link completo da live do Instagram.");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("events")
      .update({
        instagram_live_url: trimmed,
        live_url_updated_at: new Date().toISOString(),
      })
      .eq("id", active.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Link trocado. O novo link já está valendo.");
    setChangeOpen(false);
    fetchActive();
  };

  const endBroadcast = async () => {
    if (!window.confirm("Encerrar transmissão? Os redirecionadores param de apontar.")) return;
    const { error } = await supabase
      .from("events")
      .update({ is_live_broadcasting: false })
      .eq("id", active.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Broadcasting encerrado.");
    fetchActive();
  };

  return (
    <>
      <div
        className="bg-red-600 text-white rounded-lg px-4 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3 shadow-md"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="relative flex h-3 w-3 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-60" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-white" />
          </span>
          <Radio className="h-5 w-5 shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">
              AO VIVO — {active.name}
            </div>
            <div className="text-xs opacity-90 truncate">
              {sinceLabel ? `No ar desde ${sinceLabel}` : "No ar"}
              {active.instagram_live_url ? ` · ${active.instagram_live_url}` : ""}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant="secondary"
            onClick={openChange}
            className="gap-1"
          >
            <RefreshCw className="h-4 w-4" /> Trocar link
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={endBroadcast}
            className="gap-1 bg-white/10 border-white/40 text-white hover:bg-white/20"
          >
            <PowerOff className="h-4 w-4" /> Encerrar
          </Button>
        </div>
      </div>

      <Dialog open={changeOpen} onOpenChange={setChangeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Trocar link da live</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Cole o novo link do Instagram. Ele passa a valer imediatamente.
            </p>
            <Input
              placeholder="https://www.instagram.com/usuario/live/..."
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChangeOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={saveNewUrl} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
