import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Send, Save, Copy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { DbOrder } from "@/types/database";
import { normalizeBRPhone } from "@/lib/phoneUtils";

interface CustomerFichaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: DbOrder;
}

type Form = {
  full_name: string;
  cpf: string;
  email: string;
  whatsapp: string;
  cep: string;
  address: string;
  address_number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
};

const EMPTY: Form = {
  full_name: "",
  cpf: "",
  email: "",
  whatsapp: "",
  cep: "",
  address: "",
  address_number: "",
  complement: "",
  neighborhood: "",
  city: "",
  state: "",
};

export function CustomerFichaDialog({ open, onOpenChange, order }: CustomerFichaDialogProps) {
  const [form, setForm] = useState<Form>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  const paymentLink = `https://checkout.bananacalcados.com.br/checkout/order/${order.id}?step=3`;

  useEffect(() => {
    if (!open) return;
    (async () => {
      setLoading(true);
      try {
        // 1. Try the registration of THIS order
        const { data: reg } = await supabase
          .from("customer_registrations")
          .select("full_name,cpf,email,whatsapp,cep,address,address_number,complement,neighborhood,city,state")
          .eq("order_id", order.id)
          .maybeSingle();

        if (reg) {
          setForm({
            full_name: reg.full_name || "",
            cpf: reg.cpf || "",
            email: reg.email || "",
            whatsapp: reg.whatsapp || order.customer?.whatsapp || "",
            cep: reg.cep || "",
            address: reg.address || "",
            address_number: reg.address_number || "",
            complement: reg.complement || "",
            neighborhood: reg.neighborhood || "",
            city: reg.city || "",
            state: reg.state || "",
          });
        } else if (order.customer_id) {
          // 2. Fallback to last registration of customer
          const { data: prev } = await supabase
            .rpc("get_latest_registration_by_customer", { p_customer_id: order.customer_id })
            .maybeSingle();
          if (prev) {
            setForm({
              full_name: (prev as any).full_name || "",
              cpf: (prev as any).cpf || "",
              email: (prev as any).email || "",
              whatsapp: (prev as any).whatsapp || order.customer?.whatsapp || "",
              cep: (prev as any).cep || "",
              address: (prev as any).address || "",
              address_number: (prev as any).address_number || "",
              complement: (prev as any).complement || "",
              neighborhood: (prev as any).neighborhood || "",
              city: (prev as any).city || "",
              state: (prev as any).state || "",
            });
          } else {
            setForm({ ...EMPTY, whatsapp: order.customer?.whatsapp || "" });
          }
        } else {
          setForm({ ...EMPTY, whatsapp: order.customer?.whatsapp || "" });
        }
      } catch (e) {
        console.error("[CustomerFicha] load error:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, [open, order.id, order.customer_id, order.customer?.whatsapp]);

  const handleChange = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        order_id: order.id,
        full_name: form.full_name.trim(),
        cpf: form.cpf.replace(/\D/g, ""),
        email: form.email.trim(),
        whatsapp: form.whatsapp.replace(/\D/g, ""),
        cep: form.cep.replace(/\D/g, "") || "00000000",
        address: form.address.trim() || "Pendente",
        address_number: form.address_number.trim() || "0",
        complement: form.complement.trim(),
        neighborhood: form.neighborhood.trim() || "Pendente",
        city: form.city.trim() || "Pendente",
        state: (form.state.trim().toUpperCase() || "MG"),
        ...(order.customer_id ? { customer_id: order.customer_id } : {}),
      };

      const { error } = await supabase
        .from("customer_registrations")
        .upsert(payload, { onConflict: "order_id" });
      if (error) throw error;

      toast.success("Ficha do cliente salva com sucesso");
    } catch (e: any) {
      console.error(e);
      toast.error(`Erro ao salvar ficha: ${e?.message || e}`);
    } finally {
      setSaving(false);
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(paymentLink);
      toast.success("Link de pagamento copiado!");
    } catch {
      window.prompt("Copie o link de pagamento:", paymentLink);
    }
  };

  const handleSendPaymentLink = async () => {
    const phone = normalizeBRPhone(form.whatsapp || order.customer?.whatsapp || "");
    if (!phone) {
      toast.error("WhatsApp do cliente não informado");
      return;
    }
    setSending(true);
    try {
      // Save first to ensure pre-fill works
      await handleSave();

      const greet = form.full_name?.split(" ")[0] || (order.customer?.instagram_handle || "");
      const message =
        `Olá ${greet}! 🍌\n\n` +
        `Sua ficha está pré-preenchida. Para concluir, é só revisar e finalizar o pagamento aqui:\n\n` +
        `${paymentLink}`;

      const { error } = await supabase.functions.invoke("zapi-send-message", {
        body: { phone, message },
      });
      if (error) throw error;

      toast.success("Link de pagamento enviado no WhatsApp!");
    } catch (e: any) {
      console.error(e);
      toast.error(`Erro ao enviar link: ${e?.message || e}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Ficha do Cliente — {order.customer?.instagram_handle || "Sem @"}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 py-2">
            <div className="md:col-span-2">
              <Label>Nome completo</Label>
              <Input value={form.full_name} onChange={handleChange("full_name")} />
            </div>
            <div>
              <Label>CPF</Label>
              <Input value={form.cpf} onChange={handleChange("cpf")} />
            </div>
            <div>
              <Label>WhatsApp</Label>
              <Input value={form.whatsapp} onChange={handleChange("whatsapp")} />
            </div>
            <div className="md:col-span-2">
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={handleChange("email")} />
            </div>
            <div>
              <Label>CEP</Label>
              <Input value={form.cep} onChange={handleChange("cep")} />
            </div>
            <div>
              <Label>Cidade</Label>
              <Input value={form.city} onChange={handleChange("city")} />
            </div>
            <div className="md:col-span-2">
              <Label>Endereço</Label>
              <Input value={form.address} onChange={handleChange("address")} />
            </div>
            <div>
              <Label>Número</Label>
              <Input value={form.address_number} onChange={handleChange("address_number")} />
            </div>
            <div>
              <Label>Complemento</Label>
              <Input value={form.complement} onChange={handleChange("complement")} />
            </div>
            <div>
              <Label>Bairro</Label>
              <Input value={form.neighborhood} onChange={handleChange("neighborhood")} />
            </div>
            <div>
              <Label>Estado (UF)</Label>
              <Input
                value={form.state}
                maxLength={2}
                onChange={(e) => setForm((p) => ({ ...p, state: e.target.value.toUpperCase() }))}
              />
            </div>
          </div>
        )}

        <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-between gap-2">
          <Button variant="outline" onClick={handleCopyLink}>
            <Copy className="h-4 w-4 mr-2" /> Copiar link
          </Button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={handleSave} disabled={saving || loading}>
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Salvar
            </Button>
            <Button onClick={handleSendPaymentLink} disabled={sending || loading}>
              {sending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
              Enviar link Pagamento
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
