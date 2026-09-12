import { useState, useEffect } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Send, Save, Copy, Search, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { DbOrder } from "@/types/database";
import { normalizeBRPhone } from "@/lib/phoneUtils";
import { ensureEventShippingOnOrder } from "@/lib/eventShipping";
import { cn } from "@/lib/utils";
import { formatCpf, isValidCpf, onlyDigitsCpf } from "@/lib/cpfUtils";

/** CEP visual: 00000-000. */
function formatCep(value?: string | null): string {
  const d = String(value ?? "").replace(/\D/g, "").slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

/** Telefone BR visual: (11) 96913-0022 (ou (11) 3691-0022 com 10 dígitos). */
function formatBRPhone(value?: string | null): string {
  let d = String(value ?? "").replace(/\D/g, "");
  if (d.startsWith("55") && d.length > 11) d = d.slice(2); // DDI colado no cadastro
  d = d.slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  const ddd = d.slice(0, 2);
  const rest = d.slice(2);
  if (rest.length <= 4) return `(${ddd}) ${rest}`;
  const split = rest.length > 8 ? 5 : 4;
  return `(${ddd}) ${rest.slice(0, split)}-${rest.slice(split)}`;
}

/** Cadastro considerado "aproveitável": tem nome, CPF e endereço real (sem placeholders). */
function isRegUsable(r: any): boolean {
  const txt = (v: any) => String(v || "").trim();
  const cep = txt(r?.cep).replace(/\D/g, "");
  return Boolean(
    txt(r?.full_name) &&
      txt(r?.cpf).replace(/\D/g, "").length === 11 &&
      cep && cep !== "00000000" &&
      txt(r?.address) && txt(r?.address) !== "Pendente" &&
      txt(r?.city) && txt(r?.city) !== "Pendente",
  );
}

interface CustomerFichaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: DbOrder;
}

export interface CustomerFichaPanelProps {
  order: DbOrder;
  /** Chamado ao clicar no X (modo painel lateral). */
  onClose?: () => void;
  className?: string;
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

/**
 * Conteúdo da ficha do cliente SEM o Dialog — usado tanto no modal clássico
 * quanto no painel lateral lado a lado com o chat (WhatsAppChatDialog).
 */
export function CustomerFichaPanel({ order, onClose, className }: CustomerFichaPanelProps) {
  const [form, setForm] = useState<Form>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [copying, setCopying] = useState(false);
  const [fetchingCep, setFetchingCep] = useState(false);
  /** Qual link os botões usam: checkout do pedido ou área de membros autenticada. */
  const [linkMode, setLinkMode] = useState<"checkout" | "member">("member");

  // Conversas da Central da Live sem pedido usam um id virtual ("live-conv-<fone>"),
  // que não é UUID — nesse caso a ficha só pode ser preenchida após criar o pedido.
  const isRealOrder = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(order.id),
  );

  const paymentLink = `https://checkout.bananacalcados.com.br/checkout/order/${order.id}?step=3`;

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        // 1. Cadastro DESTE pedido (mesmo parcial) — nunca é descartado.
        const { data: reg } = isRealOrder
          ? await supabase
              .from("customer_registrations")
              .select("full_name,cpf,email,whatsapp,cep,address,address_number,complement,neighborhood,city,state")
              .eq("order_id", order.id)
              .maybeSingle()
          : { data: null as any };

        const clean = (v: any) => {
          const s = String(v ?? "").trim();
          if (!s || s === "Pendente" || s === "0" || s === "00000000") return "";
          return s;
        };
        const fromRow = (r: any): Form => ({
          full_name: clean(r?.full_name),
          cpf: formatCpf(clean(r?.cpf)),
          email: clean(r?.email),
          whatsapp: formatBRPhone(clean(r?.whatsapp)),
          cep: formatCep(clean(r?.cep)),
          address: clean(r?.address),
          address_number: clean(r?.address_number),
          complement: clean(r?.complement),
          neighborhood: clean(r?.neighborhood),
          city: clean(r?.city),
          state: clean(r?.state),
        });

        const base = reg ? fromRow(reg) : { ...EMPTY };

        // 2. Cliente recorrente: só preenche os campos que ficaram vazios.
        const needsFill = !isRegUsable(reg);
        if (needsFill && (order.customer_id || order.customer?.whatsapp)) {
          let prev: any = null;
          if (order.customer_id) {
            const { data } = await supabase
              .rpc("get_customer_checkout_prefill" as any, { p_customer_id: order.customer_id });
            prev = data || null;
          }
          if (!prev && order.customer?.whatsapp) {
            const { data } = await supabase
              .rpc("find_customer_prefill_by_phone" as any, { p_phone: order.customer.whatsapp });
            prev = data || null;
          }
          if (prev) {
            const p = fromRow(prev);
            (Object.keys(base) as (keyof Form)[]).forEach((k) => {
              if (!base[k] && p[k]) base[k] = p[k];
            });
          }
        }

        if (!base.whatsapp) base.whatsapp = formatBRPhone(order.customer?.whatsapp || "");
        setForm(base);
      } catch (e) {
        console.error("[CustomerFicha] load error:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, [order.id, order.customer_id, order.customer?.whatsapp]);


  const handleChange = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  // CPF: máscara automática (000.000.000-00) + aviso quando o número é inválido.
  // CPF errado é a causa nº 1 de recusa do gateway ("validation_error | customer | Invalid CPF").
  const handleCpfChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((p) => ({ ...p, cpf: formatCpf(e.target.value) }));

  const cpfDigits = onlyDigitsCpf(form.cpf);
  const cpfInvalid = cpfDigits.length > 0 && !isValidCpf(cpfDigits);

  const lookupCep = async (rawCep: string) => {
    const digits = rawCep.replace(/\D/g, "");
    if (digits.length !== 8) return;
    setFetchingCep(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const data = await res.json();
      if (!data.erro) {
        setForm((p) => ({
          ...p,
          address: data.logradouro || p.address,
          neighborhood: data.bairro || p.neighborhood,
          city: data.localidade || p.city,
          state: data.uf || p.state,
        }));
      } else {
        toast.error("CEP não encontrado");
      }
    } catch {
      toast.error("Erro ao buscar CEP");
    } finally {
      setFetchingCep(false);
    }
  };

  const handleCepChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = formatCep(e.target.value);
    setForm((p) => ({ ...p, cep: value }));
    if (value.replace(/\D/g, "").length === 8) lookupCep(value);
  };

  // WhatsApp: máscara automática (11) 96913-0022, aceitando 10 ou 11 dígitos.
  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((p) => ({ ...p, whatsapp: formatBRPhone(e.target.value) }));

  const phoneDigits = form.whatsapp.replace(/\D/g, "");
  const phoneInvalid = phoneDigits.length > 0 && phoneDigits.length < 10;
  const cepDigits = form.cep.replace(/\D/g, "");
  const cepInvalid = cepDigits.length > 0 && cepDigits.length < 8;


  const handleSave = async () => {
    if (!isRealOrder) {
      toast.error("Crie o pedido desta conversa antes de salvar a ficha");
      return;
    }
    if (cpfInvalid) {
      toast.error("CPF inválido — corrija antes de salvar (o cartão é recusado com CPF errado).");
      return;
    }
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

      // Frete: garante a regra do evento (valor fixo / grátis acima de X) no pedido,
      // já que ao ir direto para o pagamento a etapa de frete é pulada.
      const subtotal = (order.products || []).reduce(
        (acc: number, p: any) => acc + Number(p.price || 0) * Number(p.quantity || 1),
        0,
      );
      // A regra de frete grátis do evento considera o valor COM desconto.
      const discountAmount = order.discount_type && order.discount_value
        ? order.discount_type === "percentage"
          ? subtotal * (Number(order.discount_value) / 100)
          : Number(order.discount_value)
        : 0;
      const applied = await ensureEventShippingOnOrder({
        orderId: order.id,
        eventId: order.event_id,
        subtotal: Math.max(0, subtotal - discountAmount),
        currentShippingCost: order.shipping_cost,
        currentFreeShipping: order.free_shipping,
      });

      toast.success(
        applied
          ? applied.freeShipping
            ? "Ficha salva — frete grátis aplicado (regra do evento)"
            : `Ficha salva — frete de R$ ${applied.shippingCost.toFixed(2)} aplicado ao pedido`
          : "Ficha do cliente salva com sucesso",
      );
    } catch (e: any) {
      console.error(e);
      toast.error(`Erro ao salvar ficha: ${e?.message || e}`);
    } finally {
      setSaving(false);
    }
  };

  /** Link autenticado da Área de Membros para o telefone da cliente. */
  const buildMemberAreaLink = async (): Promise<string> => {
    const phone = normalizeBRPhone(form.whatsapp || order.customer?.whatsapp || "");
    if (!phone) throw new Error("WhatsApp do cliente não informado");
    const { data, error } = await supabase.functions.invoke("issue-member-magic-link", {
      body: { phone },
    });
    if (error) throw error;
    const url = (data as { url?: string } | null)?.url;
    if (!url) throw new Error("Não foi possível gerar o link da área de membros");
    return url;
  };

  const handleCopyLink = async () => {
    setCopying(true);
    try {
      const link = linkMode === "member" ? await buildMemberAreaLink() : paymentLink;
      try {
        await navigator.clipboard.writeText(link);
        toast.success(
          linkMode === "member"
            ? "Link da área de membros (já autenticado) copiado!"
            : "Link de pagamento copiado!",
        );
      } catch {
        window.prompt("Copie o link:", link);
      }
    } catch (e: any) {
      toast.error(`Erro ao gerar link: ${e?.message || e}`);
    } finally {
      setCopying(false);
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

      // 1) Mensagem inicial configurada na Live (instância não-API / uazapi),
      //    com rodízio de variações e tokens {checkout_link} / {member_area_link}.
      const { data: waData, error: waError } = await supabase.functions.invoke(
        "event-order-wa-initial-send",
        { body: { orderId: order.id } },
      );
      const waErrMsg =
        (waError as any)?.message || (waData as { error?: string } | null)?.error || null;
      if (!waErrMsg) {
        toast.success("Mensagem da Live enviada no WhatsApp!");
        return;
      }

      // 2) Fallback: envia o link escolhido em mensagem simples.
      console.warn("[CustomerFicha] mensagem inicial indisponível:", waErrMsg);
      const link = linkMode === "member" ? await buildMemberAreaLink() : paymentLink;
      const greet = form.full_name?.split(" ")[0] || (order.customer?.instagram_handle || "");
      const message =
        `Olá ${greet}! 🍌\n\n` +
        (linkMode === "member"
          ? `Seus pedidos estão aqui, é só abrir e pagar:\n\n`
          : `Sua ficha está pré-preenchida. Para concluir, é só revisar e finalizar o pagamento aqui:\n\n`) +
        `${link}`;

      const { error } = await supabase.functions.invoke("zapi-send-message", {
        body: { phone, message, linkPreview: false },
      });
      if (error) throw error;

      toast.success("Link enviado no WhatsApp (mensagem padrão)");
    } catch (e: any) {
      console.error(e);
      toast.error(`Erro ao enviar link: ${e?.message || e}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3 shrink-0">
        <h2 className="text-sm font-semibold truncate">
          Ficha do Cliente — {order.customer?.instagram_handle || "Sem @"}
        </h2>
        {onClose && (
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onClose} title="Fechar ficha">
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
        {!isRealOrder && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 mb-3">
            Esta conversa ainda não tem pedido. Crie o pedido para salvar a ficha e gerar o link de
            pagamento.
          </p>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="md:col-span-2">
              <Label>Nome completo</Label>
              <Input value={form.full_name} onChange={handleChange("full_name")} />
            </div>
            <div>
              <Label>CPF</Label>
              <Input
                value={form.cpf}
                onChange={handleCpfChange}
                inputMode="numeric"
                maxLength={14}
                placeholder="000.000.000-00"
                className={cn(cpfInvalid && "border-destructive focus-visible:ring-destructive")}
                aria-invalid={cpfInvalid}
              />
              {cpfInvalid && (
                <p className="mt-1 text-xs text-destructive">
                  CPF inválido — confira os números (o pagamento no cartão é recusado com CPF errado).
                </p>
              )}
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
              <div className="relative">
                <Input
                  value={form.cep}
                  onChange={handleCepChange}
                  onBlur={(e) => lookupCep(e.target.value)}
                  placeholder="00000-000"
                  maxLength={9}
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
                  {fetchingCep ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                </div>
              </div>
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
      </div>

      {/* Footer */}
      <div className="border-t px-3 py-3 shrink-0 space-y-2">
        {/* Tipo de link usado ao copiar/enviar */}
        <div className="flex items-center gap-1 rounded-md bg-muted p-1">
          <button
            type="button"
            onClick={() => setLinkMode("member")}
            className={cn(
              "flex-1 rounded px-2 py-1 text-xs font-medium transition-colors",
              linkMode === "member"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Área de membros
          </button>
          <button
            type="button"
            onClick={() => setLinkMode("checkout")}
            className={cn(
              "flex-1 rounded px-2 py-1 text-xs font-medium transition-colors",
              linkMode === "checkout"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Link do checkout
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 min-w-[110px]"
            onClick={handleCopyLink}
            disabled={!isRealOrder || copying}
          >
            {copying ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Copy className="h-4 w-4 mr-1.5" />}
            Copiar link
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="flex-1 min-w-[100px]"
            onClick={handleSave}
            disabled={saving || loading || !isRealOrder}
          >
            {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
            Salvar
          </Button>
          <Button
            size="sm"
            className="flex-1 basis-full min-w-[160px]"
            onClick={handleSendPaymentLink}
            disabled={sending || loading || !isRealOrder}
          >
            {sending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Send className="h-4 w-4 mr-1.5" />}
            Enviar link Pagamento
          </Button>
        </div>
      </div>
    </div>
  );
}

export function CustomerFichaDialog({ open, onOpenChange, order }: CustomerFichaDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] p-0 gap-0 overflow-hidden">
        {open && <CustomerFichaPanel order={order} className="max-h-[90vh]" />}
      </DialogContent>
    </Dialog>
  );
}
