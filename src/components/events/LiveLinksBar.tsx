import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Copy, Check, ExternalLink, Link2, Instagram, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const PUBLIC_HOST = "https://checkout.bananacalcados.com.br";

interface Props {
  eventId: string;
}

/**
 * Barra de links da Live — mostra o link certo para colar no Instagram
 * (conforme o modo da live) e o campo para colar o link da live do Instagram,
 * que alimenta os redirecionadores fixos.
 */
export function LiveLinksBar({ eventId }: Props) {
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<string | null>(null);
  const [igUrl, setIgUrl] = useState("");
  const [savedIgUrl, setSavedIgUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [zapSlug, setZapSlug] = useState<string | null>(null);
  const [redirectSlug, setRedirectSlug] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: ev }, { data: zap }, { data: red }] = await Promise.all([
      supabase
        .from("events")
        .select("operation_mode, instagram_live_url")
        .eq("id", eventId)
        .maybeSingle() as any,
      (supabase as any)
        .from("live_whatsapp_links")
        .select("slug, is_active")
        .eq("event_id", eventId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
      (supabase as any)
        .from("live_redirect_links")
        .select("slug, is_active")
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    setMode((ev as any)?.operation_mode ?? null);
    setIgUrl((ev as any)?.instagram_live_url ?? "");
    setSavedIgUrl((ev as any)?.instagram_live_url ?? "");
    setZapSlug(zap?.slug ?? null);
    setRedirectSlug(red?.slug ?? null);
    setLoading(false);
  }, [eventId]);

  useEffect(() => {
    load();
  }, [load]);

  const copy = async (url: string, key: string) => {
    await navigator.clipboard.writeText(url);
    setCopied(key);
    toast.success("Link copiado!");
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 2000);
  };

  const saveIgUrl = async () => {
    const trimmed = igUrl.trim();
    if (trimmed && !/^https?:\/\/(www\.)?instagram\.com\//i.test(trimmed)) {
      toast.error("Cole o link completo da live do Instagram (https://www.instagram.com/...).");
      return;
    }
    setSaving(true);
    const nowIso = new Date().toISOString();
    const patch: Record<string, unknown> = {
      instagram_live_url: trimmed || null,
      live_url_updated_at: trimmed ? nowIso : null,
    };
    if (trimmed) {
      patch.is_live_broadcasting = true;
      patch.live_broadcast_started_at = nowIso;
    }
    const { error } = await supabase.from("events").update(patch).eq("id", eventId);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setSavedIgUrl(trimmed);
    toast.success(
      trimmed
        ? "Link salvo — os redirecionadores já estão apontando pra essa live."
        : "Link da live removido.",
    );
  };

  if (loading) return null;

  const isWhatsApp = mode === "whatsapp";
  const primaryUrl = isWhatsApp
    ? zapSlug
      ? `${PUBLIC_HOST}/zap/${zapSlug}`
      : null
    : `${PUBLIC_HOST}/minha-area`;
  const primaryLabel = isWhatsApp
    ? "Link da Live → WhatsApp"
    : "Link da Área de Membros";

  return (
    <div className="container py-2">
      <div className="rounded-lg border border-white/20 bg-black p-5 space-y-5 text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.8)]">
        {/* Link para o Instagram */}
        <div>
          <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-white/90 drop-shadow-sm">
            <Link2 className="h-5 w-5" /> Link para colocar no Instagram
          </p>
          {primaryUrl ? (
            <>
              <p className="mt-2 break-all text-2xl font-black text-yellow-400 drop-shadow-md">{primaryUrl}</p>
              <p className="text-sm font-medium text-white/80">{primaryLabel}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" className="gap-2 font-bold bg-yellow-400 text-black hover:bg-yellow-300" onClick={() => copy(primaryUrl, "primary")}>
                  {copied === "primary" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied === "primary" ? "COPIADO!" : "COPIAR LINK"}
                </Button>
                <Button asChild size="sm" variant="outline" className="gap-2 border-white/30 text-white hover:bg-white/10 hover:text-white">
                  <a href={primaryUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="h-4 w-4" /> Abrir
                  </a>
                </Button>
              </div>
            </>
          ) : (
            <p className="mt-2 text-base text-white/70">
              Configure o link da Live → WhatsApp nas configurações da Live para ele aparecer aqui.
            </p>
          )}

          {redirectSlug && (
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/20 pt-3">
              <span className="text-sm text-white/80">Redirecionador direto pra live:</span>
              <span className="text-sm font-bold break-all text-yellow-400">{`${PUBLIC_HOST}/ao-vivo/${redirectSlug}`}</span>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 gap-1 text-sm text-white hover:bg-white/10 hover:text-white"
                onClick={() => copy(`${PUBLIC_HOST}/ao-vivo/${redirectSlug}`, "redirect")}
              >
                {copied === "redirect" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                Copiar
              </Button>
            </div>
          )}
        </div>

        {/* Colar link da live do Instagram */}
        <div className="border-t border-white/20 pt-4">
          <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-white/90 drop-shadow-sm">
            <Instagram className="h-5 w-5" /> Cole aqui o link da live do Instagram
          </p>
          <p className="mt-2 text-base text-white/80">
            É o link que o Instagram fornece na transmissão. Ao salvar, os redirecionadores
            passam a levar direto pra essa live.
          </p>
          <div className="mt-3 flex gap-2">
            <Input
              placeholder="https://www.instagram.com/usuario/live/..."
              value={igUrl}
              onChange={(e) => setIgUrl(e.target.value)}
              className="bg-white/10 border-white/20 text-white placeholder:text-white/50 focus-visible:ring-yellow-400"
            />
            <Button onClick={saveIgUrl} disabled={saving || igUrl.trim() === savedIgUrl.trim()} className="bg-yellow-400 text-black hover:bg-yellow-300 font-bold">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
            </Button>
          </div>
          {savedIgUrl && (
            <p className="mt-2 break-all text-sm font-semibold text-yellow-300">
              Link ativo: {savedIgUrl}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
