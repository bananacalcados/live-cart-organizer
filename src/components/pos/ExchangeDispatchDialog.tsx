import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Truck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { WhatsAppNumberSelector } from "@/components/WhatsAppNumberSelector";
import { useWhatsAppNumberStore } from "@/stores/whatsappNumberStore";
import { posSendText } from "@/lib/pos/posWhatsappSend";
import { markExchangesDispatched } from "@/lib/pos/markExchangeDispatched";

interface Props {
  ev: { id: string; codigo_devolucao: string | null; pedido_original_id: string | null; customer_name?: string | null } | null;
  onClose: () => void;
  onDone: () => void;
}

export function ExchangeDispatchDialog({ ev, onClose, onDone }: Props) {
  const [code, setCode] = useState("");
  const [carrier, setCarrier] = useState("");
  const [notify, setNotify] = useState(false);
  const [waNumberId, setWaNumberId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { numbers } = useWhatsAppNumberStore();

  const reset = () => { setCode(""); setCarrier(""); setNotify(false); };

  const submit = async () => {
    if (!ev) return;
    if (notify && !code.trim()) { toast.error("Para avisar a cliente, informe o código de rastreio"); return; }
    setSaving(true);
    try {
      const n = await markExchangesDispatched([ev.id], { trackingCode: code, trackingCarrier: carrier });
      if (n === 0) throw new Error("Essa troca não está mais em 'Aguardando Envio'");
      if (notify) {
        const { data: sale } = ev.pedido_original_id
          ? await supabase.from("pos_sales").select("customer_phone, customer_name").eq("id", ev.pedido_original_id).maybeSingle()
          : { data: null };
        const phone = ((sale as any)?.customer_phone || "").replace(/\D/g, "");
        const nome = ((sale as any)?.customer_name || ev.customer_name || "").split(" ")[0];
        if (!phone) toast.warning("Troca marcada, mas a cliente não tem WhatsApp no pedido.");
        else {
          const msg = `Oi${nome ? `, ${nome}` : ""}! Sua troca ${ev.codigo_devolucao || ""} foi despachada 📦\nRastreio: ${code.trim()}${carrier.trim() ? ` (${carrier.trim()})` : ""}`;
          const provider = numbers.find((x) => x.id === waNumberId)?.provider || null;
          const id = await posSendText({ provider, phone, message: msg, numberId: waNumberId });
          if (id) await supabase.from("trocas_devolucoes").update({ whatsapp_notification_sent_at: new Date().toISOString() } as any).eq("id", ev.id);
          else toast.warning("Troca marcada, mas o WhatsApp não foi enviado.");
        }
      }
      toast.success(`${ev.codigo_devolucao || "Troca"} marcada como despachada.`);
      reset(); onDone();
    } catch (e: any) {
      toast.error(e?.message || "Falha ao marcar como despachada");
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={!!ev} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent className="bg-pos-black border-purple-500/40 max-w-md">
        <DialogHeader>
          <DialogTitle className="text-pos-white flex items-center gap-2">
            <Truck className="h-5 w-5" /> Marcar {ev?.codigo_devolucao} como despachada
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Input placeholder="Código de rastreio (opcional)" value={code} onChange={(e) => setCode(e.target.value)} className="bg-pos-black border-pos-white/20 text-pos-white text-sm" />
          <Input placeholder="Transportadora (opcional)" value={carrier} onChange={(e) => setCarrier(e.target.value)} className="bg-pos-black border-pos-white/20 text-pos-white text-sm" />
          <label className="flex items-center gap-2 cursor-pointer pt-1">
            <Checkbox checked={notify} onCheckedChange={(c) => setNotify(!!c)} />
            <span className="text-xs text-pos-white/70">Enviar aviso ao cliente por WhatsApp</span>
          </label>
          {notify && <WhatsAppNumberSelector value={waNumberId} onValueChange={setWaNumberId} autoSelect />}
          <p className="text-[10px] text-pos-white/40">Não gera nota fiscal nem mexe no estoque.</p>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" className="text-pos-white/70" onClick={() => { reset(); onClose(); }}>Cancelar</Button>
          <Button onClick={submit} disabled={saving} className="bg-emerald-500 text-pos-black hover:bg-emerald-600 font-bold">
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Confirmar despacho
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
