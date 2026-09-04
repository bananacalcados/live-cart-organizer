import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWhatsAppNumberStore } from "@/stores/whatsappNumberStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Check, Copy, Link2, Loader2, MousePointerClick } from "lucide-react";

const PUBLIC_HOST = "https://checkout.bananacalcados.com.br";

interface LinkRow {
  id: string;
  slug: string;
  name: string;
  whatsapp_number_id: string | null;
  target_phone: string;
  message_text: string;
  is_active: boolean;
  click_count: number;
}

interface Props {
  eventId: string;
  eventName: string;
  /** Instância padrão da live (pré-seleciona o destino). */
  defaultWhatsappNumberId?: string | null;
}

const slugify = (v: string) =>
  v
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

/**
 * Link redirecionador da Live → WhatsApp (modo WhatsApp).
 * /zap/:slug captura fbc/fbp/UTMs e abre o WhatsApp com a frase + código curto.
 */
export function LiveWhatsAppLinkConfig({ eventId, eventName, defaultWhatsappNumberId }: Props) {
  const { numbers, fetchNumbers } = useWhatsAppNumberStore();
  const [row, setRow] = useState<LinkRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [stats, setStats] = useState<{
    confirmed: number; matched: number; withFb: number;
    byPhone: number; byCode: number; byTime: number; divergent: number;
  } | null>(null);

  const [slug, setSlug] = useState("");
  const [waId, setWaId] = useState<string>("none");
  const [phone, setPhone] = useState("");
  const [text, setText] = useState("Oii, vim da Live, pode me ajudar?");

  useEffect(() => {
    fetchNumbers();
  }, [fetchNumbers]);

  const waNumbers = useMemo(
    () => numbers.filter((n) => !["instagram", "messenger"].includes(n.provider || "")),
    [numbers]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await (supabase as any)
        .from("live_whatsapp_links")
        .select("id, slug, name, whatsapp_number_id, target_phone, message_text, is_active, click_count")
        .eq("event_id", eventId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        setRow(data as LinkRow);
        setSlug(data.slug);
        setWaId(data.whatsapp_number_id || "none");
        setPhone(data.target_phone || "");
        setText(data.message_text || "");
        const { data: clicks } = await (supabase as any)
          .from("live_whatsapp_clicks")
          .select("phone, fbc, fbp, entered_phone, match_method, divergent, superseded")
          .eq("link_id", data.id)
          .or("phone.not.is.null,entered_phone.not.is.null");
        if (!cancelled) {
          const arr = ((clicks || []) as any[]).filter((c) => !c.superseded);
          const by = (m: string) => arr.filter((c) => c.phone && c.match_method === m).length;
          setStats({
            confirmed: arr.filter((c) => c.entered_phone).length,
            matched: arr.filter((c) => c.phone).length,
            withFb: arr.filter((c) => c.phone && (c.fbc || c.fbp)).length,
            byPhone: by("phone"),
            byCode: by("code"),
            byTime: by("time") + by("context"),
            divergent: arr.filter((c) => c.divergent).length,
          });
        }
      } else {
        setSlug(slugify(eventName) || `live-${eventId.slice(0, 6)}`);
        setWaId(defaultWhatsappNumberId || "none");
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, eventName, defaultWhatsappNumberId]);

  // Pré-preenche o telefone a partir da instância escolhida
  useEffect(() => {
    if (waId === "none") return;
    const n = numbers.find((x) => x.id === waId);
    const digits = (n?.phone_display || "").replace(/\D/g, "");
    if (digits && !phone) setPhone(digits.startsWith("55") ? digits : `55${digits}`);
  }, [waId, numbers, phone]);

  const publicUrl = slug ? `${PUBLIC_HOST}/zap/${slug}` : "";

  const save = async () => {
    const cleanSlug = slugify(slug);
    const digits = phone.replace(/\D/g, "");
    if (!cleanSlug) return toast.error("Informe um slug para o link");
    if (digits.length < 12) return toast.error("Telefone de destino inválido (use DDI+DDD+número)");
    if (!text.trim()) return toast.error("Informe a frase pré-preenchida");
    setSaving(true);
    const payload = {
      event_id: eventId,
      name: eventName || cleanSlug,
      slug: cleanSlug,
      whatsapp_number_id: waId === "none" ? null : waId,
      target_phone: digits,
      message_text: text.trim(),
    };
    const q = row
      ? (supabase as any).from("live_whatsapp_links").update(payload).eq("id", row.id)
      : (supabase as any).from("live_whatsapp_links").insert(payload);
    const { data, error } = await q.select("id, slug, name, whatsapp_number_id, target_phone, message_text, is_active, click_count").single();
    setSaving(false);
    if (error) {
      toast.error(error.code === "23505" ? "Este slug já está em uso" : "Erro ao salvar link");
      return;
    }
    setRow(data as LinkRow);
    setSlug(data.slug);
    toast.success("Link da live salvo");
  };

  const toggleActive = async (v: boolean) => {
    if (!row) return;
    await (supabase as any).from("live_whatsapp_links").update({ is_active: v }).eq("id", row.id);
    setRow({ ...row, is_active: v });
  };

  const copy = async () => {
    if (!publicUrl) return;
    await navigator.clipboard.writeText(publicUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Carregando link da live...
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border-2 border-emerald-500/40 bg-emerald-500/5 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <Label className="flex items-center gap-2 text-sm font-semibold">
            <Link2 className="h-4 w-4 text-emerald-600" /> Link da Live → WhatsApp
          </Label>
          <p className="mt-1 text-xs text-muted-foreground">
            Coloque este link no botão da live. Ele captura fbc/fbp da cliente, abre o WhatsApp com a
            frase pronta + um código curto e marca a conversa como "veio da Live".
          </p>
        </div>
        {row && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">{row.is_active ? "Ativo" : "Pausado"}</span>
            <Switch checked={row.is_active} onCheckedChange={toggleActive} />
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Slug do link</Label>
          <Input value={slug} onChange={(e) => setSlug(slugify(e.target.value))} placeholder="live-setembro" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Instância que vai receber</Label>
          <Select value={waId} onValueChange={setWaId}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Qualquer instância</SelectItem>
              {waNumbers.map((n) => (
                <SelectItem key={n.id} value={n.id}>
                  {n.label} <span className="ml-1 text-muted-foreground">({n.phone_display})</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Telefone de destino (wa.me)</Label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))} placeholder="5533999999999" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Frase pré-preenchida</Label>
          <Input value={text} onChange={(e) => setText(e.target.value)} />
          <p className="text-[10px] text-muted-foreground">O código (ex.: #K7M2X) é adicionado automaticamente no fim.</p>
        </div>
      </div>

      {publicUrl && (
        <div className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5">
          <span className="min-w-0 flex-1 truncate font-mono text-xs">{publicUrl}</span>
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={copy}>
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        {row ? (
          <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <MousePointerClick className="h-3 w-3" /> {row.click_count} cliques
            {stats && (
              <>
                {" · "}{stats.confirmed} digitaram o telefone{" · "}{stats.matched} chegaram no WhatsApp{" · "}{stats.withFb} com fbc/fbp
                {stats.matched > 0 && (
                  <span className="ml-1" title="Como o clique foi casado com a conversa">
                    (por telefone {stats.byPhone} · por código {stats.byCode} · por tempo/contexto {stats.byTime}
                    {stats.divergent > 0 && <> · <span className="text-amber-600">{stats.divergent} divergente(s)</span></>})
                  </span>
                )}
              </>
            )}
          </p>
        ) : (
          <span />
        )}
        <Button type="button" size="sm" onClick={save} disabled={saving}>
          {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
          {row ? "Salvar link" : "Criar link"}
        </Button>
      </div>
    </div>
  );
}
