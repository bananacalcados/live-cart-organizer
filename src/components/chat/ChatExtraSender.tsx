import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { User, MapPin, BarChart3, Plus, X, MoreHorizontal, Crosshair } from "lucide-react";

interface ChatExtraSenderProps {
  phone: string;
  whatsappNumberId?: string | null;
  senderUserId?: string | null;
  senderName?: string | null;
  /** Recarrega o histórico após envio bem-sucedido. */
  onSent?: () => void;
}

type ExtraKind = "contact" | "location" | "poll" | null;

/**
 * ChatExtraSender — botões de Contato, Localização e Enquete no chat.
 *
 * Funciona apenas com instâncias WaSender (único provider com `wasender-send-extra`).
 * Para Z-API/Meta o componente não renderiza nada.
 */
export function ChatExtraSender({
  phone,
  whatsappNumberId,
  senderUserId,
  senderName,
  onSent,
}: ChatExtraSenderProps) {
  const [provider, setProvider] = useState<string | null>(null);
  const [open, setOpen] = useState<ExtraKind>(null);
  const [sending, setSending] = useState(false);

  // Contato
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");

  // Localização
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [locName, setLocName] = useState("");
  const [locAddress, setLocAddress] = useState("");

  // Enquete
  const [pollName, setPollName] = useState("");
  const [pollOptions, setPollOptions] = useState<string[]>(["", ""]);
  const [pollMulti, setPollMulti] = useState(false);

  useEffect(() => {
    let active = true;
    if (!whatsappNumberId) {
      setProvider(null);
      return;
    }
    supabase
      .from("whatsapp_numbers_safe")
      .select("provider")
      .eq("id", whatsappNumberId)
      .maybeSingle()
      .then(({ data }) => {
        if (active) setProvider((data as { provider?: string } | null)?.provider ?? null);
      });
    return () => {
      active = false;
    };
  }, [whatsappNumberId]);

  if (provider !== "wasender" && provider !== "uazapi") return null;

  const resetAll = () => {
    setContactName("");
    setContactPhone("");
    setLat("");
    setLng("");
    setLocName("");
    setLocAddress("");
    setPollName("");
    setPollOptions(["", ""]);
    setPollMulti(false);
  };

  const close = () => {
    if (sending) return;
    setOpen(null);
    resetAll();
  };

  /** Persiste a mensagem outgoing e pausa a IA (regras do projeto). */
  const persistOutgoing = async (text: string, messageId: string | null) => {
    await supabase.from("whatsapp_messages").insert({
      phone,
      message: text,
      direction: "outgoing",
      status: "sent",
      message_id: messageId,
      whatsapp_number_id: whatsappNumberId,
      channel: "whatsapp",
      sender_user_id: senderUserId || null,
      sender_name: senderName || null,
    } as never);

    await supabase
      .from("automation_ai_sessions")
      .update({ is_active: false })
      .eq("phone", phone)
      .eq("is_active", true);
  };

  const send = async (kind: Exclude<ExtraKind, null>, body: Record<string, unknown>, summary: string) => {
    setSending(true);
    try {
      const fn = provider === "uazapi" ? "uazapi-send-extra" : "wasender-send-extra";
      const { data, error } = await supabase.functions.invoke(fn, {
        body: { kind, phone, whatsapp_number_id: whatsappNumberId, ...body },
      });
      if (error) throw error;
      if (data?.error) throw new Error(typeof data.error === "string" ? data.error : "Falha no envio");
      await persistOutgoing(summary, data?.messageId ?? null);
      toast.success("Enviado!");
      onSent?.();
      close();
    } catch (e) {
      console.error("[ChatExtraSender] erro:", e);
      toast.error(`Erro ao enviar: ${e instanceof Error ? e.message : "tente novamente"}`);
    } finally {
      setSending(false);
    }
  };

  const handleSendContact = () => {
    if (!contactName.trim() || !contactPhone.trim()) {
      toast.error("Preencha nome e telefone do contato");
      return;
    }
    send(
      "contact",
      { contact: { name: contactName.trim(), phone: contactPhone.trim() } },
      `👤 ${contactName.trim()} — ${contactPhone.trim()}`,
    );
  };

  const handleSendLocation = () => {
    const la = Number(lat);
    const lo = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(lo)) {
      toast.error("Latitude e longitude inválidas");
      return;
    }
    send(
      "location",
      {
        location: {
          latitude: la,
          longitude: lo,
          ...(locName.trim() ? { name: locName.trim() } : {}),
          ...(locAddress.trim() ? { address: locAddress.trim() } : {}),
        },
      },
      `📍 ${locName.trim() ? locName.trim() + "\n" : ""}https://maps.google.com/?q=${la},${lo}`,
    );
  };

  const handleSendPoll = () => {
    const opts = pollOptions.map((o) => o.trim()).filter(Boolean);
    if (!pollName.trim() || opts.length < 2) {
      toast.error("Informe a pergunta e ao menos 2 opções");
      return;
    }
    send(
      "poll",
      { poll: { name: pollName.trim(), options: opts, selectableCount: pollMulti ? opts.length : 1 } },
      `📊 ${pollName.trim()}\n${opts.map((o) => `• ${o}`).join("\n")}`,
    );
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      toast.error("Geolocalização não disponível neste dispositivo");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(String(pos.coords.latitude));
        setLng(String(pos.coords.longitude));
        toast.success("Localização capturada");
      },
      () => toast.error("Não foi possível obter a localização"),
    );
  };

  const updateOption = (i: number, value: string) =>
    setPollOptions((prev) => prev.map((o, idx) => (idx === i ? value : o)));
  const addOption = () => setPollOptions((prev) => (prev.length >= 12 ? prev : [...prev, ""]));
  const removeOption = (i: number) =>
    setPollOptions((prev) => (prev.length <= 2 ? prev : prev.filter((_, idx) => idx !== i)));

  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="h-10 w-10" title="Enviar contato, localização ou enquete">
            <MoreHorizontal className="h-5 w-5 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-2" align="start" side="top">
          <div className="flex flex-col gap-1">
            <Button variant="ghost" size="sm" className="justify-start gap-2 text-xs" onClick={() => setOpen("contact")}>
              <User className="h-4 w-4" /> Contato
            </Button>
            <Button variant="ghost" size="sm" className="justify-start gap-2 text-xs" onClick={() => setOpen("location")}>
              <MapPin className="h-4 w-4" /> Localização
            </Button>
            <Button variant="ghost" size="sm" className="justify-start gap-2 text-xs" onClick={() => setOpen("poll")}>
              <BarChart3 className="h-4 w-4" /> Enquete
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      {/* Contato */}
      <Dialog open={open === "contact"} onOpenChange={(o) => !o && close()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Enviar contato</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="cs-cname">Nome</Label>
              <Input id="cs-cname" value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Nome do contato" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cs-cphone">Telefone</Label>
              <Input id="cs-cphone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="Ex: 5533999998888" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={sending}>Cancelar</Button>
            <Button onClick={handleSendContact} disabled={sending} className="bg-stage-paid hover:bg-stage-paid/90">
              {sending ? "Enviando..." : "Enviar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Localização */}
      <Dialog open={open === "location"} onOpenChange={(o) => !o && close()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Enviar localização</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Button variant="outline" size="sm" className="w-full gap-2" onClick={useMyLocation} disabled={sending}>
              <Crosshair className="h-4 w-4" /> Usar minha localização
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="cs-lat">Latitude</Label>
                <Input id="cs-lat" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="-18.85" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cs-lng">Longitude</Label>
                <Input id="cs-lng" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="-41.94" />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="cs-locname">Nome (opcional)</Label>
              <Input id="cs-locname" value={locName} onChange={(e) => setLocName(e.target.value)} placeholder="Banana Calçados" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cs-locaddr">Endereço (opcional)</Label>
              <Input id="cs-locaddr" value={locAddress} onChange={(e) => setLocAddress(e.target.value)} placeholder="Rua, número, cidade" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={sending}>Cancelar</Button>
            <Button onClick={handleSendLocation} disabled={sending} className="bg-stage-paid hover:bg-stage-paid/90">
              {sending ? "Enviando..." : "Enviar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Enquete */}
      <Dialog open={open === "poll"} onOpenChange={(o) => !o && close()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Criar enquete</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="cs-pname">Pergunta</Label>
              <Input id="cs-pname" value={pollName} onChange={(e) => setPollName(e.target.value)} placeholder="Qual sua cor favorita?" />
            </div>
            <div className="space-y-2">
              <Label>Opções</Label>
              {pollOptions.map((opt, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input value={opt} onChange={(e) => updateOption(i, e.target.value)} placeholder={`Opção ${i + 1}`} />
                  {pollOptions.length > 2 && (
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => removeOption(i)}>
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
              {pollOptions.length < 12 && (
                <Button variant="ghost" size="sm" className="gap-1" onClick={addOption}>
                  <Plus className="h-4 w-4" /> Adicionar opção
                </Button>
              )}
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="cs-multi" className="text-sm">Permitir múltiplas respostas</Label>
              <Switch id="cs-multi" checked={pollMulti} onCheckedChange={setPollMulti} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={sending}>Cancelar</Button>
            <Button onClick={handleSendPoll} disabled={sending} className="bg-stage-paid hover:bg-stage-paid/90">
              {sending ? "Enviando..." : "Enviar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
