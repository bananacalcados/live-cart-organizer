import { useState } from "react";
import {
  Loader2, Copy, Check, Link2, MessageSquareText, ArrowLeft,
  Banknote, CreditCard, QrCode, User, MapPin,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Seller {
  id: string;
  name: string;
  tiny_seller_id?: string;
}

interface Props {
  storeId: string;
  sellers: Seller[];
}

type Step = "amount" | "choice" | "form" | "result";
type PayMethod = "pix" | "card";

interface CustomerForm {
  fullName: string;
  email: string;
  cpf: string;
  whatsapp: string;
  cep: string;
  address: string;
  addressNumber: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
}

const EMPTY_FORM: CustomerForm = {
  fullName: "", email: "", cpf: "", whatsapp: "",
  cep: "", address: "", addressNumber: "", complement: "",
  neighborhood: "", city: "", state: "",
};

// ── Formatters & validators (mesmos do checkout) ──
function formatCPF(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}
function isValidCPF(cpf: string) {
  const digits = cpf.replace(/\D/g, "");
  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;
  for (let t = 9; t <= 10; t++) {
    let sum = 0;
    for (let i = 0; i < t; i++) sum += parseInt(digits[i]) * (t + 1 - i);
    const r = (sum * 10) % 11;
    if ((r === 10 ? 0 : r) !== parseInt(digits[t])) return false;
  }
  return true;
}
function formatCEP(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}
function formatPhone(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}
function isValidEmail(e: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

export function POSCustomLinkDialog({ storeId, sellers }: Props) {
  const [step, setStep] = useState<Step>("amount");
  const [amountInput, setAmountInput] = useState("");
  const [selectedSeller, setSelectedSeller] = useState("");
  const [withData, setWithData] = useState(false);
  const [form, setForm] = useState<CustomerForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [payMethod, setPayMethod] = useState<PayMethod>("pix");
  const [fetchingCep, setFetchingCep] = useState(false);

  const [generating, setGenerating] = useState(false);
  const [generatedLink, setGeneratedLink] = useState("");
  const [copied, setCopied] = useState(false);

  const amount = (() => {
    const n = parseFloat(amountInput.replace(/\./g, "").replace(",", "."));
    return isNaN(n) ? 0 : n;
  })();

  const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  const lookupCep = async (cepValue: string) => {
    const digits = cepValue.replace(/\D/g, "");
    if (digits.length !== 8) return;
    setFetchingCep(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const data = await res.json();
      if (!data.erro) {
        setForm(prev => ({
          ...prev,
          address: data.logradouro || prev.address,
          neighborhood: data.bairro || prev.neighborhood,
          city: data.localidade || prev.city,
          state: data.uf || prev.state,
        }));
      }
    } catch { /* ignore */ }
    setFetchingCep(false);
  };

  const goToChoice = () => {
    if (!selectedSeller) { toast.error("Selecione a vendedora"); return; }
    if (amount <= 0) { toast.error("Digite um valor válido"); return; }
    setStep("choice");
  };

  const validateForm = () => {
    const e: Record<string, string> = {};
    if (!form.fullName.trim()) e.fullName = "Nome é obrigatório";
    else if (form.fullName.trim().split(/\s+/).length < 2) e.fullName = "Informe nome e sobrenome";
    if (!form.email.trim()) e.email = "E-mail é obrigatório";
    else if (!isValidEmail(form.email.trim())) e.email = "E-mail inválido";
    if (!form.cpf.trim()) e.cpf = "CPF é obrigatório";
    else if (!isValidCPF(form.cpf)) e.cpf = "CPF inválido";
    const w = form.whatsapp.replace(/\D/g, "");
    if (!form.whatsapp.trim()) e.whatsapp = "Telefone é obrigatório";
    else if (w.length < 10 || w.length > 11) e.whatsapp = "Telefone inválido";
    if (form.cep.replace(/\D/g, "").length !== 8) e.cep = "CEP inválido";
    if (!form.address.trim()) e.address = "Endereço é obrigatório";
    if (!form.addressNumber.trim()) e.addressNumber = "Número é obrigatório";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const createSale = async (collectData: boolean) => {
    setGenerating(true);
    setGeneratedLink("");
    try {
      const sellerObj = sellers.find(s => s.id === selectedSeller);
      const payment_details: Record<string, unknown> = {
        link_origin: "custom_link",
        is_custom_amount: true,
        is_avulso: true,
        free_shipping: true,
        shipping_amount: 0,
        seller_name: sellerObj?.name || "",
        description: "Pagamento avulso",
      };

      if (collectData) {
        payment_details.customer_name = form.fullName;
        payment_details.customer_phone = form.whatsapp.replace(/\D/g, "");
        payment_details.customer_email = form.email;
        payment_details.customer_cpf = form.cpf.replace(/\D/g, "");
        payment_details.customer_cep = form.cep.replace(/\D/g, "");
        payment_details.customer_address = form.address;
        payment_details.customer_address_number = form.addressNumber;
        payment_details.customer_complement = form.complement;
        payment_details.customer_neighborhood = form.neighborhood;
        payment_details.customer_city = form.city;
        payment_details.customer_state = form.state;
        payment_details.suggested_payment_method = payMethod;
      }

      const salePayload = {
        store_id: storeId,
        seller_id: selectedSeller,
        customer_id: null,
        subtotal: amount,
        discount: 0,
        total: amount,
        status: "online_pending",
        sale_type: "online",
        payment_gateway: "store-checkout",
        payment_link: null,
        stock_source_store_id: storeId,
        payment_method_detail: null,
        payment_details,
        notes: "Link avulso (sem produto)",
      };

      const { data: sale, error: saleErr } = await supabase
        .from("pos_sales")
        .insert(salePayload as any)
        .select("id")
        .single();
      if (saleErr || !sale) throw new Error(saleErr?.message || "Não foi possível criar a venda");

      // Item sintético para manter a matemática de totais do checkout
      const { error: itemErr } = await supabase.from("pos_sale_items").insert({
        sale_id: sale.id,
        sku: null,
        barcode: null,
        product_name: "Pagamento avulso",
        variant_name: null,
        unit_price: amount,
        quantity: 1,
        total_price: amount,
      } as any);
      if (itemErr) throw new Error(itemErr.message || "Não foi possível salvar o item");

      // Persistir dados do cliente nos campos diretos quando preenchidos
      if (collectData) {
        await supabase.from("pos_sales").update({
          customer_name: form.fullName,
          customer_phone: form.whatsapp.replace(/\D/g, ""),
        } as any).eq("id", sale.id);
      }

      const link = `https://checkout.bananacalcados.com.br/checkout-loja/${storeId}/${sale.id}`;
      setGeneratedLink(link);
      setStep("result");
      toast.success("Link gerado com sucesso!");
    } catch (e: any) {
      console.error("Custom link error:", e);
      toast.error(e.message || "Erro ao gerar link");
    } finally {
      setGenerating(false);
    }
  };

  const handleFillData = () => { setWithData(true); setStep("form"); };
  const handleNoData = () => { setWithData(false); createSale(false); };
  const handleSubmitForm = () => { if (validateForm()) createSale(true); };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(generatedLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success("Link copiado!");
    } catch {
      window.prompt("Copie o link abaixo (Ctrl+C):", generatedLink);
    }
  };

  const sendWhatsApp = () => {
    const phone = withData ? form.whatsapp.replace(/\D/g, "") : "";
    const text = `Olá! Aqui está o link para pagamento de ${fmt(amount)}: ${generatedLink}`;
    const url = phone
      ? `https://wa.me/55${phone}?text=${encodeURIComponent(text)}`
      : `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank");
  };

  const reset = () => {
    setStep("amount");
    setAmountInput("");
    setForm(EMPTY_FORM);
    setErrors({});
    setPayMethod("pix");
    setGeneratedLink("");
    setWithData(false);
  };

  return (
    <div className="max-w-xl mx-auto p-4 md:p-6">
      {/* ── Step: Amount ── */}
      {step === "amount" && (
        <div className="bg-white border border-orange-200/60 rounded-2xl p-6 shadow-[var(--shadow-pos-card,0_4px_12px_rgba(0,0,0,0.06))] space-y-5">
          <div>
            <h3 className="text-lg font-bold text-neutral-800">Link Avulso</h3>
            <p className="text-sm text-neutral-500 mt-1">
              Cobre um valor sem produto vinculado — sem escolha de frete/entrega.
            </p>
          </div>

          <div>
            <Label className="text-sm">Vendedora *</Label>
            <Select value={selectedSeller} onValueChange={setSelectedSeller}>
              <SelectTrigger><SelectValue placeholder="Selecione a vendedora" /></SelectTrigger>
              <SelectContent>
                {sellers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-sm">Valor a cobrar (R$) *</Label>
            <Input
              inputMode="decimal"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value.replace(/[^0-9.,]/g, ""))}
              placeholder="Ex: 50,00"
              className="text-lg font-semibold"
            />
            {amount > 0 && <p className="text-xs text-neutral-500 mt-1">Cobrança: {fmt(amount)}</p>}
          </div>

          <Button onClick={goToChoice} className="w-full h-12 text-base font-semibold bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700">
            Continuar
          </Button>
        </div>
      )}

      {/* ── Step: Choice ── */}
      {step === "choice" && (
        <div className="bg-white border border-orange-200/60 rounded-2xl p-6 shadow-[var(--shadow-pos-card,0_4px_12px_rgba(0,0,0,0.06))] space-y-4">
          <button onClick={() => setStep("amount")} className="flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-700">
            <ArrowLeft className="h-4 w-4" /> Voltar
          </button>
          <div>
            <h3 className="text-lg font-bold text-neutral-800">Como deseja gerar o link?</h3>
            <p className="text-sm text-neutral-500 mt-1">Valor: <span className="font-semibold">{fmt(amount)}</span></p>
          </div>

          <button
            onClick={handleFillData}
            className="w-full text-left bg-white border border-orange-200/60 rounded-xl p-4 hover:shadow-md hover:-translate-y-0.5 transition-all flex items-start gap-3"
          >
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 text-white"><User className="h-5 w-5" /></div>
            <div>
              <p className="font-bold text-neutral-800">Preencher dados</p>
              <p className="text-xs text-neutral-500 mt-0.5">Você informa os dados do cliente e a forma de pagamento agora.</p>
            </div>
          </button>

          <button
            onClick={handleNoData}
            disabled={generating}
            className="w-full text-left bg-white border border-neutral-200 rounded-xl p-4 hover:shadow-md hover:-translate-y-0.5 transition-all flex items-start gap-3 disabled:opacity-60"
          >
            <div className="p-2.5 rounded-xl bg-neutral-700 text-white"><Link2 className="h-5 w-5" /></div>
            <div>
              <p className="font-bold text-neutral-800">Não preencher dados</p>
              <p className="text-xs text-neutral-500 mt-0.5">Gera só o link; o próprio cliente preenche os dados no checkout.</p>
            </div>
            {generating && <Loader2 className="h-4 w-4 animate-spin ml-auto text-neutral-500" />}
          </button>
        </div>
      )}

      {/* ── Step: Form (preencher dados) ── */}
      {step === "form" && (
        <div className="bg-white border border-orange-200/60 rounded-2xl p-6 shadow-[var(--shadow-pos-card,0_4px_12px_rgba(0,0,0,0.06))] space-y-4">
          <button onClick={() => setStep("choice")} className="flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-700">
            <ArrowLeft className="h-4 w-4" /> Voltar
          </button>
          <div className="flex items-center gap-2">
            <User className="h-5 w-5 text-orange-500" />
            <h3 className="text-lg font-bold text-neutral-800">Dados do cliente</h3>
          </div>

          <div className="space-y-3">
            <div>
              <Label className="text-sm">Nome completo *</Label>
              <Input value={form.fullName} onChange={(e) => { setForm({ ...form, fullName: e.target.value }); setErrors(p => ({ ...p, fullName: "" })); }} placeholder="João da Silva" className={errors.fullName ? "border-destructive" : ""} />
              {errors.fullName && <p className="text-destructive text-xs mt-1">{errors.fullName}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-sm">CPF *</Label>
                <Input value={form.cpf} onChange={(e) => { setForm({ ...form, cpf: formatCPF(e.target.value) }); setErrors(p => ({ ...p, cpf: "" })); }} placeholder="000.000.000-00" maxLength={14} className={errors.cpf ? "border-destructive" : ""} />
                {errors.cpf && <p className="text-destructive text-xs mt-1">{errors.cpf}</p>}
              </div>
              <div>
                <Label className="text-sm">Telefone *</Label>
                <Input value={form.whatsapp} onChange={(e) => { setForm({ ...form, whatsapp: formatPhone(e.target.value) }); setErrors(p => ({ ...p, whatsapp: "" })); }} placeholder="(11) 99999-9999" maxLength={15} className={errors.whatsapp ? "border-destructive" : ""} />
                {errors.whatsapp && <p className="text-destructive text-xs mt-1">{errors.whatsapp}</p>}
              </div>
            </div>
            <div>
              <Label className="text-sm">E-mail *</Label>
              <Input type="email" value={form.email} onChange={(e) => { setForm({ ...form, email: e.target.value }); setErrors(p => ({ ...p, email: "" })); }} placeholder="seu@email.com" className={errors.email ? "border-destructive" : ""} />
              {errors.email && <p className="text-destructive text-xs mt-1">{errors.email}</p>}
            </div>

            <div className="flex items-center gap-2 pt-2">
              <MapPin className="h-4 w-4 text-orange-500" />
              <span className="text-sm font-semibold text-neutral-700">Endereço</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-sm">CEP *</Label>
                <div className="relative">
                  <Input value={form.cep} onChange={(e) => { const v = formatCEP(e.target.value); setForm({ ...form, cep: v }); setErrors(p => ({ ...p, cep: "" })); if (v.replace(/\D/g, "").length === 8) lookupCep(v); }} placeholder="00000-000" maxLength={9} className={errors.cep ? "border-destructive" : ""} />
                  {fetchingCep && <Loader2 className="h-4 w-4 animate-spin absolute right-2 top-2.5 text-neutral-400" />}
                </div>
                {errors.cep && <p className="text-destructive text-xs mt-1">{errors.cep}</p>}
              </div>
              <div>
                <Label className="text-sm">Número *</Label>
                <Input value={form.addressNumber} onChange={(e) => { setForm({ ...form, addressNumber: e.target.value }); setErrors(p => ({ ...p, addressNumber: "" })); }} placeholder="123" className={errors.addressNumber ? "border-destructive" : ""} />
                {errors.addressNumber && <p className="text-destructive text-xs mt-1">{errors.addressNumber}</p>}
              </div>
            </div>
            <div>
              <Label className="text-sm">Endereço *</Label>
              <Input value={form.address} onChange={(e) => { setForm({ ...form, address: e.target.value }); setErrors(p => ({ ...p, address: "" })); }} placeholder="Rua, Avenida..." className={errors.address ? "border-destructive" : ""} />
              {errors.address && <p className="text-destructive text-xs mt-1">{errors.address}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-sm">Complemento</Label>
                <Input value={form.complement} onChange={(e) => setForm({ ...form, complement: e.target.value })} placeholder="Apto, bloco..." />
              </div>
              <div>
                <Label className="text-sm">Bairro</Label>
                <Input value={form.neighborhood} onChange={(e) => setForm({ ...form, neighborhood: e.target.value })} placeholder="Bairro" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Label className="text-sm">Cidade</Label>
                <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="Cidade" />
              </div>
              <div>
                <Label className="text-sm">UF</Label>
                <Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value.toUpperCase().slice(0, 2) })} placeholder="UF" maxLength={2} />
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <CreditCard className="h-4 w-4 text-orange-500" />
              <span className="text-sm font-semibold text-neutral-700">Forma de pagamento sugerida</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setPayMethod("pix")}
                className={`flex items-center justify-center gap-2 p-3 rounded-xl border transition-all text-sm font-semibold ${payMethod === "pix" ? "border-green-600 bg-green-50 text-green-700" : "border-neutral-200 text-neutral-600"}`}
              >
                <QrCode className="h-4 w-4" /> Pix
              </button>
              <button
                type="button"
                onClick={() => setPayMethod("card")}
                className={`flex items-center justify-center gap-2 p-3 rounded-xl border transition-all text-sm font-semibold ${payMethod === "card" ? "border-blue-600 bg-blue-50 text-blue-700" : "border-neutral-200 text-neutral-600"}`}
              >
                <CreditCard className="h-4 w-4" /> Cartão
              </button>
            </div>
            <p className="text-[11px] text-neutral-400">O cliente ainda poderá escolher Pix ou Cartão na tela final de pagamento.</p>
          </div>

          <Button onClick={handleSubmitForm} disabled={generating} className="w-full h-12 text-base font-semibold bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700">
            {generating ? <><Loader2 className="h-5 w-5 animate-spin mr-2" />Gerando...</> : `Gerar link — ${fmt(amount)}`}
          </Button>
        </div>
      )}

      {/* ── Step: Result ── */}
      {step === "result" && (
        <div className="bg-white border border-orange-200/60 rounded-2xl p-6 shadow-[var(--shadow-pos-card,0_4px_12px_rgba(0,0,0,0.06))] space-y-4 text-center">
          <div className="mx-auto w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
            <Check className="h-7 w-7 text-green-600" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-neutral-800">Link de pagamento gerado!</h3>
            <p className="text-sm text-neutral-500 mt-1">Valor: <span className="font-semibold">{fmt(amount)}</span></p>
          </div>

          <div className="p-3 bg-secondary/40 rounded-lg text-xs font-mono break-all text-left">{generatedLink}</div>

          <div className="grid grid-cols-2 gap-3">
            <Button onClick={copyLink} variant="outline" className="gap-2">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copiado!" : "Copiar link"}
            </Button>
            <Button onClick={sendWhatsApp} className="gap-2 bg-green-600 hover:bg-green-700">
              <MessageSquareText className="h-4 w-4" /> WhatsApp
            </Button>
          </div>

          <Button onClick={reset} variant="ghost" className="w-full text-sm text-neutral-500">
            Criar outro link avulso
          </Button>
        </div>
      )}
    </div>
  );
}
