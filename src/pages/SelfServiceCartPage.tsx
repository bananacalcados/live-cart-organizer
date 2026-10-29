import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldCheck, Clock, Copy, CheckCircle2, CreditCard, QrCode } from "lucide-react";
import { toast } from "sonner";
import { StepPayment, type CustomerFormData } from "@/components/checkout/PaymentSection";
import { SplitPaymentPanel } from "@/components/checkout/SplitPaymentPanel";
import { buildInstallmentOptions, parseInstallmentRule, resolveSelfServiceInstallments, type InstallmentConfig } from "@/lib/installmentRules";
import { SelfServicePrivacy } from "@/components/live/SelfServicePrivacy";
import { advertisingAllowed, advertisingRefused, advertisingSignals, ensureAdvertisingRegion, trackSelfservice } from "@/lib/selfServiceAdvertising";
import { SelfServiceCashbackBanner } from "@/components/live/SelfServiceCashbackBanner";
import { formatMmSs } from "@/lib/liveModes";
import { initialCartMode, selfServiceShipping } from "@/lib/selfServiceCheckout";

/** Link do carrinho do modo "WhatsApp + Cadastro online" (/pedido/:slug/carrinho/:orderId). */
type Ev = { name: string; product_notice: string | null; official_last4: string | null; installment_max: number | null; installment_min_value: number | null; google_rating?: string | null; google_url?: string | null };

/** "G" do Google em SVG inline (selo de avaliação clicável). */
const GoogleG = () => (
  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden>
    <path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.5-.3-2.2H12v4.1h6.5c-.1 1.1-.8 2.7-2.4 3.8l-.02.15 3.5 2.7.24.03c2.2-2 3.5-5 3.5-8.6z" />
    <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.8-2.9c-1 .7-2.4 1.2-4.1 1.2-3.1 0-5.8-2.1-6.8-5l-.14.01-3.1 2.4-.04.13C3.9 21.3 7.7 24 12 24z" />
    <path fill="#FBBC05" d="M5.2 14.4c-.2-.7-.4-1.5-.4-2.4s.2-1.7.4-2.4l-.01-.16-3.1-2.4-.1.05C1.4 8.7 1 10.3 1 12s.4 3.3 1.1 4.9l3.1-2.5z" />
    <path fill="#EA4335" d="M12 4.6c2.2 0 3.7 1 4.6 1.8l3.3-3.2C17.9 1.2 15.2 0 12 0 7.7 0 3.9 2.7 2.1 6.6l3.1 2.5c1-2.9 3.7-4.5 6.8-4.5z" />
  </svg>
);
type Ord = {
  id: string; products: { title: string; variant?: string; price: number; quantity: number; image?: string | null }[];
  total: number; pix_total: number; payment_window_expires_at: string | null; cashback_deadline: string | null;
  shipping_cost: number; free_shipping: boolean;
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
  const { eventSlug = "", orderId: rawOrderId = "" } = useParams();
  // Links sem hífens: o WhatsApp confundia o UUID com "chave Pix aleatória" e copiava em vez de abrir.
  const orderId = /^[0-9a-f]{32}$/i.test(rawOrderId) ? rawOrderId.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5") : rawOrderId;
  const [searchParams] = useSearchParams();
  const slug = eventSlug.toLowerCase();
  const [ev, setEv] = useState<Ev | null>(null);
  const [order, setOrder] = useState<Ord | null>(null);
  const [form, setForm] = useState<CustomerFormData | null>(null);
  const [paid, setPaid] = useState(false);
  const [notFound, setNotFound] = useState(false);
  // Link da equipe (?pgto=cartao) já abre na tela do cartão, sem passar pela escolha Pix/Cartão.
  const [directCard] = useState(() => initialCartMode(`?${searchParams.toString()}`) === "card");
  const [mode, setMode] = useState<"choose" | "pix" | "card">(directCard ? "card" : "choose");
  const [pix, setPix] = useState<{ code: string; base64: string | null; amount: number; sent: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [installmentConfig, setInstallmentConfig] = useState<InstallmentConfig | null>(null);
  const purchaseSeen = useRef(false);
  const paidValue = useRef<number | null>(null);

  useEffect(() => {
    call({ action: "cart", slug, order_id: orderId }).then((r) => {
      if (!r?.ok) { setNotFound(true); return; }
      paidValue.current = r.amount_paid ?? null;
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
      if (r?.paid) { paidValue.current = r.amount_paid ?? null; setPaid(true); }
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

  useEffect(() => {
    const sync = () => {
      if (advertisingRefused()) { if (order) call({ action: "meta_signals", slug, order_id: orderId, signals: advertisingSignals() }); }
      if (!advertisingAllowed()) { if (paid) purchaseSeen.current = true; return; }
      if (!paid) call({ action: "meta_signals", slug, order_id: orderId, signals: advertisingSignals() });
      if (!paid) trackSelfservice("InitiateCheckout", { value: order?.total, currency: "BRL" });
      // No replay after a later consent change; Purchase needs the server-confirmed paid amount.
      if (paid && !purchaseSeen.current) {
        purchaseSeen.current = true;
        if (paidValue.current) trackSelfservice("Purchase", { value: paidValue.current, currency: "BRL" }, `purchase_order_${orderId}`);
      }
    };
    if (order) ensureAdvertisingRegion().then(sync);
    window.addEventListener("selfservice-advertising-change", sync);
    return () => window.removeEventListener("selfservice-advertising-change", sync);
  }, [slug, orderId, order?.id, paid]);

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
    if (r?.paid) { paidValue.current = r.amount_paid ?? null; setPaid(true); } else toast.info("Ainda não recebemos — pode levar alguns segundos.");
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
              <p className="mb-2 flex justify-between"><span>Frete</span><strong>{order.free_shipping ? "Grátis" : brl(selfServiceShipping(order))}</strong></p>
              <p className="text-lg font-bold">{brl(order.pix_total)} no Pix</p>
              <p className="text-muted-foreground">ou {brl(order.total)} no cartão</p>
              {freeOption && <p className="font-semibold">Até {freeOption.installments}x de {brl(freeOption.installmentAmount)} sem juros</p>}
              {interestOption && <p className="text-muted-foreground">Ou até {interestOption.installments}x com juros — parcelas e total apresentados antes de pagar.</p>}
              {ev.product_notice && <p className="mt-2 text-xs text-muted-foreground">{ev.product_notice}</p>}
            </div>
            {/* Faixa de confiança: compacta, uma linha no celular, sem empurrar os botões. */}
            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-full border bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
              <span className="font-semibold text-foreground">Banana Calçados · 10 anos · 2 lojas físicas em Gov. Valadares-MG</span>
              {ev.google_rating && ev.google_url && (
                <a href={ev.google_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 font-semibold text-foreground underline-offset-2 hover:underline">
                  <GoogleG /> {ev.google_rating} ★ no Google
                </a>
              )}
              <span className="flex items-center gap-1">
                <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                Pagamento processado pelo <strong className="text-foreground">Mercado Pago</strong>
                <span className="ml-1 flex gap-0.5">
                  {["Visa", "Master", "Elo", "Hiper"].map((b) => (
                    <span key={b} className="rounded border bg-background px-1 py-px text-[9px] font-bold text-foreground">{b}</span>
                  ))}
                </span>
              </span>
            </div>
            {/* Botões de pagamento ANTES do cronômetro de cashback: a cliente escolhe como pagar sem rolar. */}
            {form && mode === "choose" && (
              <div className="grid gap-2">
                <p className="text-center text-2xl font-extrabold uppercase leading-tight tracking-tight text-foreground">Escolha a forma de pagamento abaixo</p>
                <Button className="h-14 text-base font-bold" onClick={payPix} disabled={busy}>
                  {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <><QrCode className="mr-2 h-5 w-5" />PAGAR NO PIX</>}
                </Button>
                <Button className="h-14 text-base font-bold" onClick={() => setMode("card")} disabled={!installmentConfig}>
                  <CreditCard className="mr-2 h-5 w-5" />PAGAR NO CARTÃO
                </Button>
              </div>
            )}
            <SelfServiceCashbackBanner deadline={order.cashback_deadline} now={now} amount={Math.round((mode === "pix" && pix ? pix.amount : mode === "card" ? order.total : order.pix_total) * 10) / 100} />
            {reserveLeft !== null && (
              <div className="flex items-center gap-2 rounded-2xl bg-muted p-3 text-sm">
                <Clock className="h-4 w-4" />
                {reserveLeft > 0 ? <>Reservado pra você por <strong>{formatMmSs(reserveLeft)}</strong></> : <>Reserva expirada — fale com a gente no WhatsApp</>}
              </div>
            )}

            {!form ? (
              <p className="rounded-2xl border p-3 text-center text-sm text-muted-foreground">Seu cadastro ainda não chegou. Fale com a gente no WhatsApp.</p>
            ) : mode === "choose" ? null : mode === "pix" && pix ? (
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
                    initialMethod={directCard ? "card" : null}
                    products={order.products.map((p) => ({ ...p, image: p.image || undefined })) as any}
                    form={form}
                    installmentConfig={installmentConfig}
                    stepBadge={null}
                    onPaymentConfirmed={() => setPaid(true)}
                  />
                </SplitPaymentPanel>
              </div>
            ) : <div className="flex justify-center p-4"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}
          </>
        )}

        <SelfServicePrivacy slug={slug} />
        <p className="text-center text-xs text-muted-foreground">
          <ShieldCheck className="mr-1 inline h-3.5 w-3.5" />
          Único WhatsApp oficial da Banana: final <strong>{ev.official_last4 || "----"}</strong>. Qualquer outro número é golpe.
        </p>
      </div>
    </div>
  );
}
