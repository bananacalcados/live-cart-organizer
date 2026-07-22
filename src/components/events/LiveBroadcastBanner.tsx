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

const TTL_MS = 3 * 60 * 60 * 1000;

interface ActiveBroadcast {
  id: string;
  name: string;
  instagram_live_url: string | null;
  live_broadcast_started_at: string | null;
  live_url_updated_at: string | null;
}

function formatCountdown(ms: number) {
  if (ms <= 0) return "expirado";
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h > 0) return `${h}h ${rem}m`;
  return `${m}m`;
}

/**
 * LiveBroadcastBanner — fixed banner shown in the Events module while any event is
 * marked as AO VIVO. Shows TTL countdown and a "Trocar link" quick-action to keep the
 * Instagram live URL fresh without opening the wizard. Also lets the operator encerrar.
 */
export function LiveBroadcastBanner() {
  const [active, setActive] = useState<ActiveBroadcast | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
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
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [fetchActive]);

  if (loading || !active) return null;

  const startedAt = active.live_broadcast_started_at
    ? new Date(active.live_broadcast_started_at).getTime()
    : 0;
  const urlAt = active.live_url_updated_at
    ? new Date(active.live_url_updated_at).getTime()
    : startedAt;
  const freshestAt = Math.max(startedAt, urlAt);
  const remainingMs = freshestAt > 0 ? TTL_MS - (now - freshestAt) : TTL_MS;
  const expiringSoon = remainingMs > 0 && remainingMs < 30 * 60 * 1000;
  const expired = remainingMs <= 0;

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
    toast.success("Link trocado. TTL reiniciado (3h).");
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

  const bg = expired
    ? "bg-orange-600"
    : expiringSoon
    ? "bg-amber-500"
    : "bg-red-600";

  return (
    <>
      <div
        className={`${bg} text-white rounded-lg px-4 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3 shadow-md`}
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
              {expired
                ? "TTL expirado — troque o link ou encerre."
                : `Expira em ${formatCountdown(remainingMs)}${
                    expiringSoon ? " — troque logo!" : ""
                  }`}
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
              Cole o novo link do Instagram. Isso reinicia o TTL de 3h.
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
