// Configuração das respostas automáticas (só admin altera). Modo 'auto' fica sem efeito enquanto as Centrais estiverem fechadas.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { deskCall } from "./api";
import { waMeLink } from "@/lib/supportAuto/intent";

interface Cfg { mode: string; instance_ids: string[]; support_whatsapp_phone: string | null; central_public_enabled: boolean; is_admin: boolean }

export function AutoReplySettings() {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<{ id: string; label: string; provider: string; phone_display: string | null }[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    deskCall<Cfg>("support_auto_reply_settings_get").then(setCfg).catch(() => setCfg(null));
    (supabase as any).from("whatsapp_numbers_safe").select("id,label,provider,phone_display").eq("is_active", true).limit(100)
      .then(({ data }: any) => setList(data || []));
  }, []);
  if (!cfg) return null;

  const save = async () => {
    setSaving(true);
    try {
      await deskCall("support_auto_reply_settings_update", { p_mode: cfg.mode, p_instance_ids: cfg.instance_ids, p_support_phone: cfg.support_whatsapp_phone || "" });
      toast.success("Configuração salva");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
    finally { setSaving(false); }
  };
  const toggle = (id: string, on: boolean) => setCfg({ ...cfg, instance_ids: on ? [...cfg.instance_ids, id] : cfg.instance_ids.filter((x) => x !== id) });
  const phone = (cfg.support_whatsapp_phone || "").replace(/\D/g, "");

  return (
    <div className="rounded-lg border bg-card p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium flex-1">
          Respostas automáticas: {cfg.mode === "off" ? "desligadas" : cfg.mode === "shadow" ? "modo sombra (só sugere, nada é enviado)" : "automático"}
          {cfg.instance_ids.length === 0 && " · nenhum número escolhido"}
        </span>
        <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>{open ? "Fechar" : "Configurar"}</Button>
      </div>
      {open && (
        <div className="space-y-3 text-sm">
          <div className="flex items-center gap-2">
            <span>Modo</span>
            <Select value={cfg.mode} onValueChange={(v) => setCfg({ ...cfg, mode: v })} disabled={!cfg.is_admin}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="off">Desligado</SelectItem>
                <SelectItem value="shadow">Modo sombra (só sugere)</SelectItem>
                <SelectItem value="auto">Automático</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {cfg.mode === "auto" && !cfg.central_public_enabled && <p className="text-destructive">As Centrais estão fechadas: nada é enviado sozinho.</p>}
          {cfg.mode === "auto" && <p className="text-muted-foreground">O envio sozinho ainda não está ligado nesta fase.</p>}
          <div>
            <p className="mb-1">Números que participam</p>
            {list.map((n) => (
              <label key={n.id} className="flex items-center gap-2 py-0.5">
                <Checkbox checked={cfg.instance_ids.includes(n.id)} disabled={!cfg.is_admin} onCheckedChange={(v) => toggle(n.id, !!v)} />
                {n.label} <span className="text-muted-foreground">({n.provider}{n.phone_display ? ` · ${n.phone_display}` : ""})</span>
              </label>
            ))}
          </div>
          <div className="space-y-1">
            <p>WhatsApp de atendimento (para levar a cliente do Instagram)</p>
            <Input value={cfg.support_whatsapp_phone || ""} disabled={!cfg.is_admin} onChange={(e) => setCfg({ ...cfg, support_whatsapp_phone: e.target.value })} placeholder="5533999999999" autoComplete="off" />
            {phone.length >= 12 && (
              <p className="text-muted-foreground break-all">Troca: {waMeLink(phone, "troca")}<br />Devolução: {waMeLink(phone, "devolucao")}</p>
            )}
          </div>
          {cfg.is_admin ? <Button size="sm" disabled={saving} onClick={save}>Salvar</Button> : <p className="text-muted-foreground">Só admin altera.</p>}
        </div>
      )}
    </div>
  );
}
