import { useEffect, useMemo, useState } from "react";
import { DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { posSendMedia, posSendText } from "@/lib/pos/posWhatsappSend";
import { materializePosCustomer } from "@/lib/posCustomerResolve";
import { FileText, Loader2, Send, ExternalLink, RefreshCw, Search, Plus, Minus, X } from "lucide-react";
import { EmbeddedDialog, EmbeddedDialogContent } from "@/components/chat/EmbeddedDialog";
import { isValidCpf } from "@/lib/cpfUtils";
import { digitsOnly, maskCep, maskCpf, maskPhoneBR } from "@/lib/formatMasks";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  phone: string;
  customerName?: string;
  storeId?: string | null;
  sendVia: "meta" | "zapi" | "uazapi" | "wasender";
  selectedNumberId?: string | null;
  embedded?: boolean;
}

interface BoletoResult {
  boletoId: string;
  pdfUrl: string | null;
  publicPdfUrl?: string | null;
  boletoUrl: string | null;
  barcode: string | null;
  digitableLine: string | null;
  digitableLineFormatted: string | null;
  pixQrCode: string | null;
  amount: number;
  dueDate: string;
}

interface BoletoHistoryItem {
  id: string;
  created_at: string;
  amount: number;
  due_date: string;
  status: string;
  description: string | null;
  mp_boleto_url: string | null;
}


interface CartItem {
  id: string;
  title: string;
  variantLabel: string;
  sku: string;
  price: number;
  quantity: number;
  stock?: number;
}

function tomorrowIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 3);
  return d.toISOString().slice(0, 10);
}

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const parseNum = (v: string) => parseFloat(String(v || "").replace(",", ".")) || 0;

export function POSGenerateBoletoDialog({
  open, onOpenChange, phone, customerName, storeId, sendVia, selectedNumberId, embedded = false,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<BoletoResult | null>(null);
  const [status, setStatus] = useState<string>("pending");
  const [checking, setChecking] = useState(false);

  // ── Boletos já gerados para este cliente ──────────────────────────────
  const [history, setHistory] = useState<BoletoHistoryItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [openingPdf, setOpeningPdf] = useState<string | null>(null);


  // ── Produtos do pedido ────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [products, setProducts] = useState<CartItem[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [shippingValue, setShippingValue] = useState("");
  const [discountValue, setDiscountValue] = useState("");

  const [form, setForm] = useState({
    customer_name: customerName || "",
    customer_cpf: "",
    customer_email: "",
    customer_phone: phone || "",
    address_zip: "",
    address_street: "",
    address_number: "",
    address_complement: "",
    address_neighborhood: "",
    address_city: "",
    address_state: "",
    amount: "",
    description: "",
    due_date: tomorrowIso(),
    include_pix: true,
  });

  useEffect(() => {
    if (!open) {
      setResult(null);
      setStatus("pending");
    } else {
      setForm((f) => ({
        ...f,
        customer_name: customerName || f.customer_name,
        customer_phone: phone || f.customer_phone,
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /** Boletos já gerados para este telefone (ver / baixar / reenviar). */
  const loadHistory = async () => {
    if (!phone) return;
    setLoadingHistory(true);
    try {
      const { data, error } = await supabase.functions.invoke("pos-boleto-pdf", {
        body: { action: "list", phone },
      });
      if (error) throw error;
      setHistory((data?.boletos || []) as BoletoHistoryItem[]);
    } catch {
      setHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    if (open) loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, phone]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 400);
    return () => clearTimeout(t);
  }, [searchQuery]);

  useEffect(() => {
    if (!open) return;
    const term = debouncedSearch.trim();
    if (!term) { setProducts([]); return; }
    let cancelled = false;
    (async () => {
      setLoadingProducts(true);
      try {
        let q = supabase
          .from("pos_products")
          .select("name, variant, size, color, sku, barcode, price, stock")
          .gt("stock", 0)
          .order("name", { ascending: true })
          .limit(400);
        if (/^\d{6,14}$/.test(term)) q = q.or(`barcode.eq.${term},sku.eq.${term}`);
        else for (const w of term.split(/\s+/).filter(Boolean).slice(0, 4)) q = q.ilike("name", `%${w}%`);
        const { data } = await q;
        if (cancelled) return;
        const map = new Map<string, CartItem>();
        for (const r of (data || []) as any[]) {
          const key = String(r.barcode || r.sku || `${r.name}|${r.variant}`);
          const variantLabel = [r.color, r.variant].filter(Boolean)
            .filter((v, i, arr) => arr.indexOf(v) === i).join(" · ");
          const existing = map.get(key);
          if (existing) { existing.stock = (existing.stock || 0) + Number(r.stock || 0); continue; }
          map.set(key, {
            id: key,
            title: r.name || "Produto sem nome",
            variantLabel,
            sku: r.barcode || r.sku || "",
            price: parseFloat(r.price || "0"),
            quantity: 1,
            stock: Number(r.stock || 0),
          });
        }
        setProducts(Array.from(map.values()));
      } finally {
        if (!cancelled) setLoadingProducts(false);
      }
    })();
    return () => { cancelled = true; };
  }, [debouncedSearch, open]);

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const subtotal = useMemo(() => cart.reduce((s, c) => s + c.price * c.quantity, 0), [cart]);
  const shippingAmount = parseNum(shippingValue);
  const discountAmount = Math.min(subtotal, parseNum(discountValue));
  const cartTotal = Math.max(0, subtotal - discountAmount) + shippingAmount;
  const hasCart = cart.length > 0;
  const finalAmount = hasCart ? cartTotal : parseNum(form.amount);

  const cpfDigits = digitsOnly(form.customer_cpf);
  const cpfValid = cpfDigits.length === 11 && isValidCpf(cpfDigits);

  const addToCart = (item: CartItem) => {
    setCart((prev) => {
      const found = prev.find((c) => c.id === item.id);
      if (found) return prev.map((c) => (c.id === item.id ? { ...c, quantity: c.quantity + 1 } : c));
      return [...prev, { ...item, quantity: 1 }];
    });
    setSearchQuery("");
    setDebouncedSearch("");
    setProducts([]);
  };
  const updateQty = (id: string, delta: number) =>
    setCart((prev) => prev.map((c) => (c.id === id ? { ...c, quantity: Math.max(1, c.quantity + delta) } : c)));
  const updatePrice = (id: string, price: number) =>
    setCart((prev) => prev.map((c) => (c.id === id ? { ...c, price } : c)));

  // Busca endereço por CEP (automático ao completar 8 dígitos)
  const lookupCep = async (raw?: string) => {
    const cep = digitsOnly(raw ?? form.address_zip);
    if (cep.length !== 8) return;
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const j = await r.json();
      if (j && !j.erro) {
        setForm((f) => ({
          ...f,
          address_street: j.logradouro || f.address_street,
          address_neighborhood: j.bairro || f.address_neighborhood,
          address_city: j.localidade || f.address_city,
          address_state: j.uf || f.address_state,
        }));
      } else {
        toast.error("CEP não encontrado");
      }
    } catch { /* ignore */ }
  };

  const onCepChange = (value: string) => {
    const masked = maskCep(value);
    set("address_zip", masked);
    if (digitsOnly(masked).length === 8) lookupCep(masked);
  };

  /** Cria o pedido no PDV (não pago) para aparecer na barrinha e na Expedição depois. */
  const createPendingSale = async (boletoId: string, mpPaymentId: string | null) => {
    if (!storeId || !hasCart) return;
    const cleanPhone = digitsOnly(form.customer_phone || phone);
    const posCustomer = cleanPhone
      ? await materializePosCustomer({ name: form.customer_name || customerName || "Cliente", whatsapp: cleanPhone })
      : null;
    const { data: sale, error } = await supabase
      .from("pos_sales")
      .insert({
        store_id: storeId,
        subtotal,
        discount: discountAmount > 0 ? discountAmount : 0,
        total: cartTotal,
        status: "online_pending",
        sale_type: "online",
        payment_method: "Boleto",
        payment_gateway: "mercadopago",
        mercadopago_payment_id: mpPaymentId,
        customer_id: posCustomer?.id || null,
        customer_name: form.customer_name || customerName || null,
        customer_phone: cleanPhone || null,
        payment_details: {
          link_origin: "whatsapp_chat",
          payment_kind: "boleto",
          boleto_id: boletoId,
          mp_payment_id: mpPaymentId,
          customer_name: form.customer_name || customerName || null,
          customer_phone: form.customer_phone || phone,
          customer_cpf: cpfDigits || null,
          shipping_amount: shippingAmount,
          discount_amount: discountAmount,
          address: {
            zip: digitsOnly(form.address_zip),
            street: form.address_street,
            number: form.address_number,
            complement: form.address_complement,
            neighborhood: form.address_neighborhood,
            city: form.address_city,
            state: form.address_state,
          },
          items_detail: cart.map((c) => ({
            title: c.title, variant: c.variantLabel, unit_price: c.price, quantity: c.quantity,
          })),
        },
      } as any)
      .select("id")
      .single();
    if (error || !sale) return;

    await supabase.from("pos_sale_items").insert(
      cart.map((c) => ({
        sale_id: sale.id,
        sku: c.sku || null,
        product_name: c.title,
        variant_name: c.variantLabel || null,
        unit_price: c.price,
        quantity: c.quantity,
        total_price: c.price * c.quantity,
      })) as any,
    );
  };

  const generate = async () => {
    setLoading(true);
    try {
      const amountNum = Number(finalAmount.toFixed(2));
      if (!Number.isFinite(amountNum) || amountNum <= 0) throw new Error("Informe um valor válido ou adicione produtos");
      if (!cpfValid) throw new Error("CPF inválido — confira os números");

      const description = form.description
        || (hasCart ? cart.map((c) => `${c.quantity}x ${c.title}${c.variantLabel ? ` (${c.variantLabel})` : ""}`).join(", ").slice(0, 200) : "");

      const { data, error } = await supabase.functions.invoke("mercadopago-create-boleto", {
        body: {
          ...form,
          customer_cpf: cpfDigits,
          customer_phone: digitsOnly(form.customer_phone),
          address_zip: digitsOnly(form.address_zip),
          description,
          amount: amountNum,
          storeId: storeId || null,
        },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Falha ao gerar boleto");

      await createPendingSale(data.boletoId, data.mpPaymentId ?? null).catch(() => {});

      setResult({
        boletoId: data.boletoId,
        pdfUrl: data.pdfPublicUrl || data.pdfUrl,
        publicPdfUrl: data.pdfPublicUrl ?? null,
        boletoUrl: data.boletoUrl,
        barcode: data.barcode,
        digitableLine: data.digitableLine ?? null,
        digitableLineFormatted: data.digitableLineFormatted ?? null,
        pixQrCode: data.pixQrCode,
        amount: data.amount,
        dueDate: data.dueDate,
      });
      loadHistory();

      toast.success("Boleto gerado com sucesso");
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Erro ao gerar boleto");
    } finally {
      setLoading(false);
    }
  };

  /** Garante um link público e estável do PDF (usado para enviar e para baixar de novo). */
  const ensurePublicPdf = async (boletoId: string): Promise<string> => {
    const { data, error } = await supabase.functions.invoke("pos-boleto-pdf", {
      body: { action: "url", boletoId },
    });
    if (error) throw new Error(error.message || "Não foi possível preparar o PDF do boleto");
    if (!data?.ok || !data?.publicUrl) throw new Error(data?.error || "PDF do boleto indisponível");
    return data.publicUrl as string;
  };

  const persistMessage = async (message: string, mediaUrl?: string | null, messageId?: string | null) => {
    try {
      await supabase.from("whatsapp_messages").insert({
        phone,
        message,
        direction: "outgoing",
        status: "sent",
        media_type: mediaUrl ? "document" : null,
        media_url: mediaUrl || null,
        message_id: messageId || null,
        whatsapp_number_id: selectedNumberId || null,
      } as any);
    } catch { /* histórico não deve quebrar o envio */ }
  };

  const sendBoleto = async (b: {
    boletoId: string;
    amount: number;
    dueDate: string;
    digitableLine?: string | null;
    digitableLineFormatted?: string | null;
    barcode?: string | null;
    boletoUrl?: string | null;
    pixQrCode?: string | null;
  }) => {
    setSending(true);
    try {
      const pdfUrl = await ensurePublicPdf(b.boletoId);

      const captionLines = [
        `📄 *Boleto Banana Calçados*`,
        `Valor: R$ ${Number(b.amount).toFixed(2).replace(".", ",")}`,
        `Vencimento: ${new Date(String(b.dueDate) + "T00:00:00").toLocaleDateString("pt-BR")}`,
      ];
      const line = b.digitableLineFormatted || b.digitableLine || b.barcode;
      if (line) captionLines.push(`\n*Linha digitável (digite no app do banco):*\n${line}`);
      if (b.boletoUrl) captionLines.push(`\n2ª via / imprimir:\n${b.boletoUrl}`);
      const caption = captionLines.join("\n");

      const mid = await posSendMedia({
        provider: sendVia,
        phone,
        mediaUrl: pdfUrl,
        mediaType: "document",
        fileName: "boleto.pdf",
        caption,
        numberId: selectedNumberId ?? null,
      });
      await persistMessage(caption, pdfUrl, mid);

      if (b.digitableLine) {
        const tid = await posSendText({
          provider: sendVia,
          phone,
          message: b.digitableLine,
          numberId: selectedNumberId ?? null,
        });
        await persistMessage(b.digitableLine, null, tid);
      }

      if (b.pixQrCode) {
        const msg = `⚡ *Se preferir, pague via PIX (mesmo valor, confirmação na hora):*\n\n${b.pixQrCode}`;
        const pid = await posSendText({
          provider: sendVia,
          phone,
          message: msg,
          numberId: selectedNumberId ?? null,
        });
        await persistMessage(msg, null, pid);
      }

      toast.success("Boleto enviado no WhatsApp");
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Erro ao enviar o boleto");
    } finally {
      setSending(false);
    }
  };

  const sendToClient = async () => {
    if (!result) return;
    await sendBoleto(result);
  };

  /** Abre o PDF de um boleto já gerado (link público estável). */
  const openBoletoPdf = async (boletoId: string) => {
    setOpeningPdf(boletoId);
    try {
      const url = await ensurePublicPdf(boletoId);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      toast.error(e?.message || "Não foi possível abrir o PDF");
    } finally {
      setOpeningPdf(null);
    }
  };


  const checkStatus = async () => {
    if (!result?.boletoId) return;
    setChecking(true);
    try {
      const { data } = await supabase
        .from("pos_boletos")
        .select("status, paid_at")
        .eq("id", result.boletoId)
        .maybeSingle();
      if (data?.status) setStatus(data.status);
      if (data?.status === "paid") toast.success("✅ Boleto pago!");
      else toast.info(`Status: ${data?.status || "desconhecido"}`);
    } finally {
      setChecking(false);
    }
  };

  return (
    <EmbeddedDialog embedded={embedded} open={open} onOpenChange={onOpenChange}>
      <EmbeddedDialogContent embedded={embedded} className={embedded ? "h-full w-full max-w-full min-w-0 overflow-y-auto overflow-x-hidden p-3 [&_*]:min-w-0" : "max-w-2xl max-h-[92vh] overflow-y-auto"}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-orange-500" />
            Gerar Boleto (Mercado Pago)
          </DialogTitle>
        </DialogHeader>

        {/* ── Boletos já gerados para este cliente ─────────────────────── */}
        {(history.length > 0 || loadingHistory) && (
          <div className="rounded-lg border">
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-semibold"
            >
              <span className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-orange-500" />
                Boletos já gerados{history.length ? ` (${history.length})` : ""}
              </span>
              <span className="text-xs text-muted-foreground">{showHistory ? "ocultar" : "ver"}</span>
            </button>
            {showHistory && (
              <div className="max-h-[220px] space-y-1 overflow-y-auto border-t p-2">
                {loadingHistory && <div className="p-2 text-xs text-muted-foreground">Carregando...</div>}
                {history.map((b) => (
                  <div key={b.id} className="rounded border p-2 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold">{fmt(Number(b.amount))}</span>
                      <span className="text-muted-foreground">
                        Venc. {new Date(b.due_date + "T00:00:00").toLocaleDateString("pt-BR")} ·{" "}
                        {b.status === "paid" ? "pago" : b.status === "cancelled" ? "cancelado" : "aguardando"}
                      </span>
                    </div>
                    {b.description && <div className="mt-0.5 truncate text-muted-foreground">{b.description}</div>}
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        disabled={openingPdf === b.id}
                        onClick={() => openBoletoPdf(b.id)}
                      >
                        {openingPdf === b.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <ExternalLink className="mr-1 h-3 w-3" />}
                        Ver / baixar PDF
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        disabled={sending}
                        onClick={() =>
                          sendBoleto({
                            boletoId: b.id,
                            amount: Number(b.amount),
                            dueDate: b.due_date,
                            boletoUrl: b.mp_boleto_url,
                          })
                        }
                      >
                        <Send className="mr-1 h-3 w-3" /> Enviar no WhatsApp
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}



        {!result ? (
          <div className="grid gap-3 min-w-0">
            {/* ── Produtos do pedido ─────────────────────────────── */}
            <div className="w-full min-w-0 max-w-full overflow-hidden rounded-lg border p-3 space-y-2">
              <div className="text-sm font-semibold">Produtos do pedido</div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9 h-9"
                  placeholder="Buscar produto por nome ou código..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              {(loadingProducts || products.length > 0) && (
                <ScrollArea className="h-[170px] rounded-md border">
                  <div className="p-1 space-y-1">
                    {loadingProducts && <div className="p-3 text-xs text-muted-foreground">Buscando...</div>}
                    {products.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => addToCart(p)}
                        className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{p.title}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {p.variantLabel} {p.sku ? `· ${p.sku}` : ""} · {p.stock} un.
                          </span>
                        </span>
                        <span className="shrink-0 text-xs font-semibold">{fmt(p.price)}</span>
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              )}

              {hasCart && (
                <div className="space-y-1">
                  {cart.map((c) => (
                    <div key={c.id} className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2 rounded border p-2">
                      <div className="min-w-0 self-center">
                        <div className="truncate text-sm font-medium">{c.title}</div>
                        <div className="truncate text-xs text-muted-foreground">{c.variantLabel}</div>
                      </div>
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setCart((p) => p.filter((x) => x.id !== c.id))}>
                        <X className="h-3 w-3" />
                      </Button>
                      <div className="col-span-2 grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-2">
                       <div className="flex shrink-0 items-center gap-1">
                        <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => updateQty(c.id, -1)}>
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="w-6 text-center text-sm">{c.quantity}</span>
                        <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => updateQty(c.id, 1)}>
                          <Plus className="h-3 w-3" />
                        </Button>
                       </div>
                       <div className="min-w-0">
                         <Label className="sr-only">Preço do produto</Label>
                         <Input
                           className="h-8 w-full min-w-0"
                           value={String(c.price).replace(".", ",")}
                           onChange={(e) => updatePrice(c.id, parseNum(e.target.value))}
                         />
                       </div>
                      </div>
                    </div>
                  ))}
                  <div className={embedded ? "grid grid-cols-1 gap-2 pt-1" : "grid grid-cols-2 gap-2 pt-1"}>
                    <div>
                      <Label className="text-xs">Frete (R$)</Label>
                      <Input value={shippingValue} onChange={(e) => setShippingValue(e.target.value)} placeholder="0,00" />
                    </div>
                    <div>
                      <Label className="text-xs">Desconto (R$)</Label>
                      <Input value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} placeholder="0,00" />
                    </div>
                  </div>
                  <div className="flex justify-between border-t pt-2 text-sm font-semibold">
                    <span>Total do boleto</span>
                    <span>{fmt(cartTotal)}</span>
                  </div>
                </div>
              )}
            </div>

            <div className={embedded ? "grid w-full min-w-0 grid-cols-1 gap-3 [&>*]:col-span-1 [&>*]:w-full [&>*]:max-w-full" : "grid grid-cols-2 gap-3"}>
              <div className={embedded ? "col-span-1" : "col-span-2"}>
                <Label>Nome completo *</Label>
                <Input value={form.customer_name} onChange={(e) => set("customer_name", e.target.value)} />
              </div>
              <div>
                <Label>CPF *</Label>
                <Input
                  value={form.customer_cpf}
                  onChange={(e) => set("customer_cpf", maskCpf(e.target.value))}
                  placeholder="000.000.000-00"
                  className={cpfDigits.length === 11 && !cpfValid ? "border-destructive" : ""}
                />
                {cpfDigits.length === 11 && !cpfValid && (
                  <p className="mt-1 text-xs text-destructive">CPF inválido</p>
                )}
              </div>
              <div>
                <Label>E-mail *</Label>
                <Input type="email" value={form.customer_email} onChange={(e) => set("customer_email", e.target.value)} />
              </div>
              <div className={embedded ? "col-span-1" : "col-span-2"}>
                <Label>WhatsApp</Label>
                <Input value={maskPhoneBR(form.customer_phone)} onChange={(e) => set("customer_phone", digitsOnly(e.target.value))} />
              </div>

              <div>
                <Label>CEP *</Label>
                <Input value={form.address_zip} onChange={(e) => onCepChange(e.target.value)} onBlur={() => lookupCep()} placeholder="00.000-000" />
              </div>
              <div className="col-span-1">
                <Label>Estado *</Label>
                <Input maxLength={2} value={form.address_state} onChange={(e) => set("address_state", e.target.value.toUpperCase())} />
              </div>
              <div className={embedded ? "col-span-1" : "col-span-2"}>
                <Label>Rua *</Label>
                <Input value={form.address_street} onChange={(e) => set("address_street", e.target.value)} />
              </div>
              <div>
                <Label>Número *</Label>
                <Input value={form.address_number} onChange={(e) => set("address_number", e.target.value)} />
              </div>
              <div>
                <Label>Complemento</Label>
                <Input value={form.address_complement} onChange={(e) => set("address_complement", e.target.value)} />
              </div>
              <div>
                <Label>Bairro *</Label>
                <Input value={form.address_neighborhood} onChange={(e) => set("address_neighborhood", e.target.value)} />
              </div>
              <div>
                <Label>Cidade *</Label>
                <Input value={form.address_city} onChange={(e) => set("address_city", e.target.value)} />
              </div>

              <div>
                <Label>Valor (R$) *</Label>
                <Input
                  value={hasCart ? cartTotal.toFixed(2).replace(".", ",") : form.amount}
                  onChange={(e) => set("amount", e.target.value)}
                  disabled={hasCart}
                  placeholder="199,90"
                />
                {hasCart && <p className="mt-1 text-xs text-muted-foreground">Calculado pelos produtos + frete</p>}
              </div>
              <div>
                <Label>Vencimento *</Label>
                <Input type="date" value={form.due_date} onChange={(e) => set("due_date", e.target.value)} />
              </div>

              <div className={embedded ? "col-span-1" : "col-span-2"}>
                <Label>Descrição</Label>
                <Textarea rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Ex: Pedido #1234 - Tênis" />
              </div>

              <div className={`${embedded ? "col-span-1" : "col-span-2"} flex min-w-0 items-center justify-between gap-3 rounded-lg border p-3`}>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">Incluir QR Code PIX no boleto</div>
                  <div className="text-xs text-muted-foreground">Cliente escolhe pagar por boleto ou PIX (mesmo valor)</div>
                </div>
                <Switch className="shrink-0" checked={form.include_pix} onCheckedChange={(v) => set("include_pix", v)} />
              </div>
            </div>

            <DialogFooter className={embedded ? "flex w-full flex-col gap-2 sm:flex-col" : undefined}>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button className={embedded ? "w-full" : undefined} onClick={generate} disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileText className="h-4 w-4 mr-2" />}
                Gerar boleto
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="rounded-lg border p-4 bg-muted/40">
              <div className="text-sm text-muted-foreground">Boleto gerado</div>
              <div className="text-2xl font-bold mt-1">R$ {result.amount.toFixed(2).replace(".", ",")}</div>
              <div className="text-sm mt-1">Vencimento: {new Date(result.dueDate + "T00:00:00").toLocaleDateString("pt-BR")}</div>
              <div className="mt-2 text-xs">Status atual: <span className="font-semibold">{status}</span></div>
              {(result.digitableLine || result.barcode) && (
                <div className="mt-3">
                  <div className="text-xs text-muted-foreground mb-1">
                    {result.digitableLine ? "Linha digitável (47 dígitos)" : "Código de barras"}
                  </div>
                  <div className="font-mono text-xs break-all bg-background p-2 rounded border">
                    {result.digitableLineFormatted || result.digitableLine || result.barcode}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-1 h-7 px-2 text-xs"
                    onClick={() => {
                      navigator.clipboard.writeText(result.digitableLine || result.barcode || "");
                      toast.success("Linha digitável copiada");
                    }}
                  >
                    Copiar
                  </Button>

                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              {result.pdfUrl && (
                <Button variant="outline" asChild>
                  <a href={result.pdfUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4 mr-2" /> Abrir PDF
                  </a>
                </Button>
              )}
              {result.boletoUrl && (
                <Button variant="outline" asChild>
                  <a href={result.boletoUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4 mr-2" /> Boleto MP
                  </a>
                </Button>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={sendToClient} disabled={sending || !result.pdfUrl} className="flex-1">
                {sending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                Enviar por WhatsApp
              </Button>
              <Button variant="outline" onClick={checkStatus} disabled={checking}>
                {checking ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                Verificar pagamento
              </Button>
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Fechar</Button>
              <Button variant="secondary" onClick={() => { setResult(null); setCart([]); }}>Gerar outro</Button>
            </DialogFooter>
          </div>
        )}
      </EmbeddedDialogContent>
    </EmbeddedDialog>
  );
}
