import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldCheck, Clock, Copy, CheckCircle2, CreditCard, QrCode } from "lucide-react";
import { toast } from "sonner";
import { StepPayment, type CustomerFormData } from "@/components/checkout/PaymentSection";
import { SplitPaymentPanel } from "@/components/checkout/SplitPaymentPanel";
import { buildInstallmentOptions, parseInstallmentRule, resolveSelfServiceInstallments, type InstallmentConfig } from "@/lib/installmentRules";
import { formatMmSs } from "@/lib/liveModes";

/** Link do carrinho do modo "WhatsApp + Cadastro online" (/pedido/:slug/carrinho/:orderId). */
type Ev = { name: string; product_notice: string | null; official_last4: string | null; installment_max: number | null; installment_min_value: number | null };
type Ord = {
  id: string; products: { title: string; variant?: string; price: number; quantity: number; image?: string | null }[];
  total: number; pix_total: number; payment_window_expires_at: string | null;
};
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

async function call(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("live-selfservice", { body });
  if (error) {
    try { const j = await (error as any).context?.json?.(); if (j) return j; } catch { /* ignore */ }
    return { ok: false, error: "Falha de conexão. Tente de novo." };
  }
  return data;
}

export default function SelfServiceCartPage() {
  const { eventSlug = "", orderId = "" } = useParams();
  const slug = eventSlug.toLowerCase();
  const [ev, setEv] = useState<Ev | null>(null);
  const [order, setOrder] = useState<Ord | null>(null);
  const [form, setForm] = useState<CustomerFormData | null>(null);
  const [paid, setPaid] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [mode, setMode] = useState<"choose" | "pix" | "card">("choose");
  const [pix, setPix] = useState<{ code: string; base64: string | null; amount: number; sent: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [installmentConfig, setInstallmentConfig] = useState<InstallmentConfig | null>(null);

  useEffect(() => {
    call({ action: "cart", slug, order_id: orderId }).then((r) => {
      if (!r?.ok) { setNotFound(true); return; }
      setEv(r.event); setOrder(r.order); setForm(r.form); setPaid(!!r.paid);
    });
  }, [slug, orderId]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Pix na página: confere o pagamento a cada 30 s com a aba visível.
  useEffect(() => {
    if (mode !== "pix" || paid) return;
    const t = setInterval(async () => {
      if (document.hidden) return;
      const r = await call({ action: "status", slug, order_id: orderId });
      if (r?.paid) setPaid(true);
    }, 30_000);
    return () => clearInterval(t);
  }, [mode, paid, slug, orderId]);

  useEffect(() => {
    if (!ev || !order) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from("app_settings").select("value").eq("key", "installment_config").maybeSingle();
      const base = !error ? parseInstallmentRule(data?.value) : null;
      if (!cancelled) setInstallmentConfig(base ? resolveSelfServiceInstallments(base, order.total, ev.installment_max, ev.installment_min_value) : null);
    })();
    return () => { cancelled = true; };
  }, [ev, order?.id, order?.total]);

  const payPix = async () => {
    setBusy(true);
    const r = await call({ action: "pix", slug, order_id: orderId });
    setBusy(false);
    if (r?.paid) { setPaid(true); return; }
    if (r?.split) { toast.info(r.error); setMode("card"); return; }
    if (!r?.ok) { toast.error(r?.error || "Não foi possível gerar o Pix."); return; }
    setPix({ code: String(r.qr_code).trim(), base64: r.qr_base64, amount: Number(r.amount), sent: !!r.sent_whatsapp });
    setMode("pix");
  };

  const copy = () => {
    if (!pix) return;
    navigator.clipboard.writeText(pix.code).then(() => toast.success("Código PIX copiado!"))
      .catch(() => window.prompt("Copie o código PIX:", pix.code));
  };

  const checkPaid = async () => {
    const r = await call({ action: "status", slug, order_id: orderId });
    if (r?.paid) setPaid(true); else toast.info("Ainda não recebemos — pode levar alguns segundos.");
  };

  if (notFound) return <div className="flex min-h-screen items-center justify-center p-6 text-center text-muted-foreground">Link não encontrado.</div>;
  if (!ev || !order) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  const reserveLeft = order.payment_window_expires_at ? new Date(order.payment_window_expires_at).getTime() - now : null;
  const options = installmentConfig ? buildInstallmentOptions(order.total, installmentConfig) : [];
  const freeOption = options.filter((o) => !o.hasInterest).at(-1);
  const interestOption = options.filter((o) => o.hasInterest).at(-1);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-md space-y-4 p-4">
        <h1 className="text-center text-xl font-bold">{ev.name}</h1>

        {paid ? (
          <div className="space-y-3 rounded-2xl border p-4 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-primary" />
            <p className="text-lg font-bold">Pagamento confirmado! 🎉</p>
            <p className="text-sm text-muted-foreground">Você vai receber a confirmação no WhatsApp.</p>
          </div>
        ) : (
          <>
            {order.products.map((p, i) => (
              <div key={i} className="flex gap-3 rounded-2xl border p-3">
                {p.image && <img src={p.image} alt={p.title} className="h-24 w-24 rounded-lg object-cover" />}
                <div className="flex-1">
                  <p className="font-semibold leading-tight">{p.title}</p>
                  {p.variant && <p className="text-sm text-muted-foreground">{p.variant}</p>}
                  <p className="mt-1 text-sm">{p.quantity}x {brl(p.price)}</p>
                </div>
              </div>
            ))}
            <div className="rounded-2xl border p-3 text-sm">
              <p className="text-lg font-bold">{brl(order.pix_total)} no Pix</p>
              <p className="text-muted-foreground">ou {brl(order.total)} no cartão</p>
              {freeOption && <p className="font-semibold">Até {freeOption.installments}x de {brl(freeOption.installmentAmount)} sem juros</p>}
              {interestOption && <p className="text-muted-foreground">Ou até {interestOption.installments}x com juros — parcelas e total apresentados antes de pagar.</p>}
              {ev.product_notice && <p className="mt-2 text-xs text-muted-foreground">{ev.product_notice}</p>}
            </div>
            {reserveLeft !== null && (
              <div className="flex items-center gap-2 rounded-2xl bg-muted p-3 text-sm">
                <Clock className="h-4 w-4" />
                {reserveLeft > 0 ? <>Reservado pra você por <strong>{formatMmSs(reserveLeft)}</strong></> : <>Reserva expirada — fale com a gente no WhatsApp</>}
              </div>
            )}

            {!form ? (
              <p className="rounded-2xl border p-3 text-center text-sm text-muted-foreground">Seu cadastro ainda não chegou. Fale com a gente no WhatsApp.</p>
            ) : mode === "choose" ? (
              <div className="grid gap-2">
                <Button className="h-14 text-base font-bold" onClick={payPix} disabled={busy}>
                  {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <><QrCode className="mr-2 h-5 w-5" />PAGAR NO PIX</>}
                </Button>
                <Button variant="outline" className="h-14 text-base font-bold" onClick={() => setMode("card")} disabled={!installmentConfig}>
                  <CreditCard className="mr-2 h-5 w-5" />PAGAR NO CARTÃO
                </Button>
              </div>
            ) : mode === "pix" && pix ? (
              <div className="space-y-3 rounded-2xl border p-4 text-center">
                <p className="text-lg font-bold">Pix de {brl(pix.amount)}</p>
                {pix.base64 && <img src={`data:image/png;base64,${pix.base64.replace(/^data:image\/\w+;base64,/, "")}`} alt="QR code Pix" className="mx-auto h-56 w-56" />}
                <p className="break-all rounded-lg bg-muted p-2 text-xs">{pix.code}</p>
                <Button className="h-12 w-full font-bold" onClick={copy}><Copy className="mr-2 h-4 w-4" />Copiar código PIX</Button>
                {pix.sent && <p className="text-xs text-muted-foreground">Também mandamos esse Pix no seu WhatsApp.</p>}
                <Button variant="ghost" className="w-full" onClick={checkPaid}>Já paguei</Button>
                <button type="button" className="w-full text-xs text-muted-foreground underline" onClick={() => setMode("card")}>Prefiro pagar no cartão</button>
              </div>
            ) : installmentConfig ? (
              <div className="rounded-2xl border-2 p-3">
                <SplitPaymentPanel orderId={order.id} total={order.total} form={form} maxInstallments={Math.min(installmentConfig.max_installments || 6, 12)} onPaid={() => setPaid(true)}>
                  <StepPayment
                    orderId={order.id}
                    amount={order.total}
                    products={order.products.map((p) => ({ ...p, image: p.image || undefined })) as any}
                    form={form}
                    installmentConfig={installmentConfig}
                    stepBadge={null}
                    onPaymentConfirmed={() => setPaid(true)}
                  />
                </SplitPaymentPanel>
              </div>
            ) : <p className="text-sm text-muted-foreground">Não foi possível carregar as condições do cartão. Recarregue a página para tentar novamente.</p>}
          </>
        )}

        <p className="text-center text-xs text-muted-foreground">
          <ShieldCheck className="mr-1 inline h-3.5 w-3.5" />
          Único WhatsApp oficial da Banana: final <strong>{ev.official_last4 || "----"}</strong>. Qualquer outro número é golpe.
        </p>
      </div>
    </div>
  );
}
