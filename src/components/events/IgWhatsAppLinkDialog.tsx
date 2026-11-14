import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

interface Props {
  handle: string | null;
  onClose: () => void;
  onLinked: (handle: string) => void;
}

/** Vincula um @ do Instagram a um WhatsApp sem criar pedido (fica salvo no @). */
export function IgWhatsAppLinkDialog({ handle, onClose, onLinked }: Props) {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [info, setInfo] = useState<any>(null);
  const [conflict, setConflict] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPhone(""); setName(""); setInfo(null); setConflict(null);
    if (!handle) return;
    supabase.rpc("ig_handle_link_lookup" as any, { _handle: handle, _phone: "" }).then(({ data }) => {
      const d = data as any;
      setInfo(d);
      if (d?.current_whatsapp) setPhone(d.current_whatsapp);
      if (d?.current_name) setName(d.current_name);
    });
  }, [handle]);

  const digits = phone.replace(/\D/g, "");
  useEffect(() => {
    if (!handle || digits.length < 10) return;
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc("ig_handle_link_lookup" as any, { _handle: handle, _phone: digits });
      const d = data as any;
      setInfo(d);
      setConflict(null);
      if (d?.suggested_name) setName((n) => n || d.suggested_name);
    }, 400);
    return () => clearTimeout(t);
  }, [handle, digits]);

  const save = async (force = false) => {
    if (!handle) return;
    setSaving(true);
    const { data, error } = await supabase.rpc("link_ig_handle_whatsapp" as any, { _handle: handle, _phone: digits, _name: name, _force: force });
    setSaving(false);
    if (error) {
      toast.error(error.message.includes("invalid_phone") ? "Telefone inválido — use DDD + número" : "Não deu pra salvar: " + error.message);
      return;
    }
    const d = data as any;
    if (d?.conflict) { setConflict(d.other_handles || []); return; }
    toast.success(`WhatsApp vinculado ao @${handle}`);
    onLinked(handle);
    onClose();
  };

  const others: string[] = info?.other_handles || [];

  return (
    <Dialog open={!!handle} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Vincular WhatsApp ao @{handle}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {info?.current_whatsapp && (
            <p className="text-sm text-muted-foreground">Hoje está ligado a <b>{info.current_whatsapp}</b>. Se trocar, o número antigo fica no histórico.</p>
          )}
          <div className="space-y-1">
            <Label htmlFor="ig-link-phone">WhatsApp (com DDD)</Label>
            <Input id="ig-link-phone" inputMode="tel" placeholder="98 98161-6655" value={phone} onChange={(e) => setPhone(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ig-link-name">Nome</Label>
            <Input id="ig-link-name" placeholder="Nome da cliente" value={name} onChange={(e) => setName(e.target.value)} />
            {info?.suggested_name && <p className="text-xs text-muted-foreground">Ficha encontrada com esse número: <b>{info.suggested_name}</b></p>}
          </div>
          {(conflict || others.length > 0) && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-sm">
              ⚠️ Esse número já está ligado a: {(conflict || others).map((h) => "@" + h).join(", ")}. Confira se é a mesma pessoa antes de salvar.
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          {conflict ? (
            <Button variant="destructive" disabled={saving} onClick={() => save(true)}>Salvar mesmo assim</Button>
          ) : (
            <Button disabled={saving || digits.length < 10} onClick={() => save(false)}>Salvar vínculo</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
