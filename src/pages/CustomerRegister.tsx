import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, CheckCircle2, Package, MapPin, User } from "lucide-react";

interface OrderInfo {
  id: string;
  products: Array<{ title: string; variant: string; quantity: number; price: number; image?: string }>;
  customer?: { id: string; instagram_handle: string };
}

export default function CustomerRegister() {
  const { orderId } = useParams<{ orderId: string }>();
  const [order, setOrder] = useState<OrderInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [draftOrderName, setDraftOrderName] = useState("");

  // Form fields
  const [fullName, setFullName] = useState("");
  const [cpf, setCpf] = useState("");
  const [email, setEmail] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [cep, setCep] = useState("");
  const [address, setAddress] = useState("");
  const [addressNumber, setAddressNumber] = useState("");
  const [complement, setComplement] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [fetchingCep, setFetchingCep] = useState(false);

  useEffect(() => {
    if (!orderId) return;
    loadOrder();
  }, [orderId]);

  const loadOrder = async () => {
    const { data, error } = await supabase
      .from("orders")
      .select("id, products, customer_id, customer:customers(id, instagram_handle)")
      .eq("id", orderId)
      .single();

    if (error || !data) {
      setLoading(false);
      return;
    }

    // Check if already registered for THIS order
    const { data: existing } = await supabase
      .from("customer_registrations")
      .select("id, status, shopify_draft_order_name")
      .eq("order_id", orderId)
      .maybeSingle();

    if (existing?.status === "completed") {
      setDraftOrderName(existing.shopify_draft_order_name || "");
      setSubmitted(true);
    }

    // Pre-fill from previous registration if customer has one
    const customerId = (data as any).customer_id;
    if (customerId && !existing) {
      const { data: prevReg } = await supabase
        .rpc('get_latest_registration_by_customer', { p_customer_id: customerId })
        .maybeSingle();
      if (prevReg) {
        setFullName(prevReg.full_name || "");
        setCpf(formatCpf(prevReg.cpf || ""));
        setEmail(prevReg.email || "");
        setWhatsapp(formatPhone(prevReg.whatsapp || ""));
        setCep(formatCep(prevReg.cep || ""));
        setAddress(prevReg.address || "");
        setAddressNumber(prevReg.address_number || "");
        setComplement(prevReg.complement || "");
        setNeighborhood(prevReg.neighborhood || "");
        setCity(prevReg.city || "");
        setState(prevReg.state || "");
      }
    }

    setOrder({
      id: data.id,
      products: data.products as OrderInfo["products"],
      customer: data.customer as OrderInfo["customer"],
    });
    setLoading(false);
  };

  const formatCpf = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 11);
    return digits
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  };

  const formatCep = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 8);
    return digits.replace(/(\d{5})(\d)/, "$1-$2");
  };

  const formatPhone = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 11);
    if (digits.length <= 10) {
      return digits.replace(/(\d{2})(\d{4})(\d)/, "($1) $2-$3");
    }
    return digits.replace(/(\d{2})(\d{5})(\d)/, "($1) $2-$3");
  };

  const handleCepChange = async (value: string) => {
    const formatted = formatCep(value);
    setCep(formatted);
    const digits = formatted.replace(/\D/g, "");
    if (digits.length === 8) {
      setFetchingCep(true);
      try {
        const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
        const data = await res.json();
        if (!data.erro) {
          setAddress(data.logradouro || "");
          setNeighborhood(data.bairro || "");
          setCity(data.localidade || "");
          setState(data.uf || "");
        }
      } catch {}
      setFetchingCep(false);
    }
  };

  const handleSubmit = async () => {
    if (!fullName || !cpf || !email || !whatsapp || !cep || !address || !addressNumber || !neighborhood || !city || !state) {
      toast.error("Preencha todos os campos obrigatórios");
      return;
    }

    setSubmitting(true);
    try {
      // Check if already registered (prevent duplicate submissions)
      const { data: existingReg } = await supabase
        .from("customer_registrations")
        .select("id, status, shopify_draft_order_name")
        .eq("order_id", orderId!)
        .maybeSingle();

      if (existingReg) {
        setDraftOrderName(existingReg.shopify_draft_order_name || "");
        setSubmitted(true);
        toast.success("Cadastro já realizado anteriormente!");
        return;
      }

      // Save registration with customer_id linkage
      const customerIdToLink = order.customer?.id || null;
      
      const { data: reg, error: regError } = await supabase
        .from("customer_registrations")
        .insert({
          order_id: orderId!,
          full_name: fullName,
          cpf: cpf.replace(/\D/g, ""),
          email,
          whatsapp: whatsapp.replace(/\D/g, ""),
          cep: cep.replace(/\D/g, ""),
          address,
          address_number: addressNumber,
          complement,
          neighborhood,
          city,
          state,
          ...(customerIdToLink ? { customer_id: customerIdToLink } : {}),
        })
        .select()
        .single();

      if (regError) throw regError;

      // Create Shopify draft order
      const { data: draftData, error: draftError } = await supabase.functions.invoke(
        "shopify-create-draft-order",
        { body: { registrationId: reg.id } }
      );

      if (draftError) {
        console.error("Draft order error:", draftError);
        toast.error("Cadastro salvo, mas houve um erro ao criar o pedido na Shopify");
      } else if (draftData?.draftOrderName) {
        setDraftOrderName(draftData.draftOrderName);
      }

      setSubmitted(true);
      toast.success("Cadastro realizado com sucesso!");
    } catch (error) {
      console.error("Error submitting:", error);
      toast.error("Erro ao enviar cadastro. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center">
          <h1 className="text-xl font-bold">Pedido não encontrado</h1>
          <p className="text-muted-foreground mt-2">Este link é inválido ou o pedido não existe.</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center space-y-4 max-w-sm">
          <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto" />
          <h1 className="text-2xl font-bold">Cadastro realizado!</h1>
          <p className="text-muted-foreground">
            Seus dados foram recebidos e seu pedido está sendo preparado.
          </p>
          {draftOrderName && (
            <p className="text-sm font-medium text-primary">
              Pedido: {draftOrderName}
            </p>
          )}
        </div>
      </div>
    );
  }

  const totalValue = order.products.reduce((sum, p) => sum + p.price * p.quantity, 0);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-lg mx-auto p-4 space-y-6">
        {/* Header */}
        <div className="text-center py-4">
          <h1 className="text-2xl font-bold">Cadastro para Envio</h1>
          <p className="text-muted-foreground mt-1">Preencha seus dados para que possamos enviar seu pedido</p>
        </div>

        {/* Order summary */}
        <div className="bg-secondary/50 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2 font-medium">
            <Package className="h-4 w-4" />
            Resumo do Pedido
          </div>
          {order.products.map((p, i) => (
            <div key={i} className="flex items-center gap-3 text-sm">
              {p.image && (
                <img src={p.image} alt={p.title} className="w-10 h-10 rounded object-cover" />
              )}
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{p.title}</p>
                {p.variant && <p className="text-xs text-muted-foreground">{p.variant}</p>}
              </div>
              <span>{p.quantity}x R$ {p.price.toFixed(2)}</span>
            </div>
          ))}
          <div className="border-t pt-2 flex justify-between font-bold">
            <span>Total</span>
            <span>R$ {totalValue.toFixed(2)}</span>
          </div>
        </div>

        {/* Personal info */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 font-medium">
            <User className="h-4 w-4" />
            Dados Pessoais
          </div>
          <div className="space-y-3">
            <div>
              <Label htmlFor="fullName">Nome Completo *</Label>
              <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="João da Silva" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="cpf">CPF *</Label>
                <Input id="cpf" value={cpf} onChange={(e) => setCpf(formatCpf(e.target.value))} placeholder="000.000.000-00" />
              </div>
              <div>
                <Label htmlFor="whatsapp">WhatsApp *</Label>
                <Input id="whatsapp" value={whatsapp} onChange={(e) => setWhatsapp(formatPhone(e.target.value))} placeholder="(11) 99999-9999" />
              </div>
            </div>
            <div>
              <Label htmlFor="email">E-mail *</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="seu@email.com" />
            </div>
          </div>
        </div>

        {/* Address */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 font-medium">
            <MapPin className="h-4 w-4" />
            Endereço de Entrega
          </div>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="cep">CEP *</Label>
                <div className="relative">
                  <Input id="cep" value={cep} onChange={(e) => handleCepChange(e.target.value)} placeholder="00000-000" />
                  {fetchingCep && <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin" />}
                </div>
              </div>
              <div>
                <Label htmlFor="state">Estado *</Label>
                <Input id="state" value={state} onChange={(e) => setState(e.target.value)} placeholder="SP" maxLength={2} />
              </div>
            </div>
            <div>
              <Label htmlFor="city">Cidade *</Label>
              <Input id="city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="São Paulo" />
            </div>
            <div>
              <Label htmlFor="neighborhood">Bairro *</Label>
              <Input id="neighborhood" value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} placeholder="Centro" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Label htmlFor="address">Endereço *</Label>
                <Input id="address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Rua das Flores" />
              </div>
              <div>
                <Label htmlFor="addressNumber">Número *</Label>
                <Input id="addressNumber" value={addressNumber} onChange={(e) => setAddressNumber(e.target.value)} placeholder="123" />
              </div>
            </div>
            <div>
              <Label htmlFor="complement">Complemento</Label>
              <Input id="complement" value={complement} onChange={(e) => setComplement(e.target.value)} placeholder="Apto 101, Bloco A" />
            </div>
          </div>
        </div>

        <Button onClick={handleSubmit} disabled={submitting} className="w-full" size="lg">
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Enviando...
            </>
          ) : (
            "Confirmar Cadastro"
          )}
        </Button>
      </div>
    </div>
  );
}
