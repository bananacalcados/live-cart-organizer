import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Star, Send, Gift, CheckCircle2, Sparkles } from "lucide-react";

interface ReviewToken {
  id: string;
  customer_phone: string;
  customer_name: string | null;
  store_phone: string | null;
  cashback_value: number;
  cashback_doubled: boolean;
  review_submitted_at: string | null;
}

interface Referral {
  id: string;
  friend_name: string;
  friend_phone: string;
  coupon_code: string;
  coupon_value: number;
  message_sent_at: string | null;
}

const STORE_FALLBACK_PHONE = "5533991955003";

export default function ReviewReferralPage() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [tok, setTok] = useState<ReviewToken | null>(null);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [step, setStep] = useState<"review" | "referral" | "done">("review");

  // review form
  const [nps, setNps] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [improve, setImprove] = useState("");

  // referral form
  const [fName, setFName] = useState("");
  const [fPhone, setFPhone] = useState("");
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) return;
    (async () => {
      const { data } = await supabase.functions.invoke("review-load", { body: { token } });
      const t = (data as any)?.token as ReviewToken | null;
      if (!t) {
        setLoading(false);
        return;
      }
      setTok(t);
      setReferrals(((data as any)?.referrals as Referral[]) || []);
      if (t.review_submitted_at) setStep("referral");
      setLoading(false);
    })();
  }, [token]);

  async function submitReview() {
    if (nps === null) { toast.error("Escolha uma nota de 0 a 10"); return; }
    setSubmitting(true);
    const { error } = await supabase.functions.invoke("review-submit", {
      body: { token, nps_score: nps, review_comment: comment, improvement_suggestion: improve },
    });
    setSubmitting(false);
    if (error) { toast.error("Erro ao enviar avaliação"); return; }
    toast.success("Obrigado pela avaliação! 💛");
    setStep("referral");
  }

  async function createReferral() {
    if (!fName.trim() || !fPhone.trim()) {
      toast.error("Preencha nome e WhatsApp do amigo");
      return;
    }
    if (referrals.length >= 3) {
      toast.error("Limite de 3 amigos atingido");
      return;
    }
    setCreating(true);
    const { data, error } = await supabase.functions.invoke("referral-create", {
      body: { token, friend_name: fName, friend_phone: fPhone },
    });
    setCreating(false);
    if (error || (data as any)?.error) {
      toast.error((data as any)?.error || "Erro ao criar indicação");
      return;
    }
    setReferrals([...referrals, (data as any).referral]);
    setFName("");
    setFPhone("");
    toast.success("Indicação criada! Clique em Enviar mensagem 👇");
  }

  function buildWhatsappLink(r: Referral): string {
    const storePhone = (tok?.store_phone || STORE_FALLBACK_PHONE).replace(/\D/g, "");
    const value = Number(r.coupon_value).toFixed(2).replace(".", ",");
    const text =
      `Oii ${r.friend_name}! Acabei de sair do Banana Calçados e me pediram pra indicar amigos pra ganharem um *CUPOM DE COMPRA* no valor de *R$ ${value}*. ` +
      `Você pode usar no WhatsApp ou na loja física. ` +
      `O cupom é: *${r.coupon_code}* (válido por 30 dias). ` +
      `O contato da loja é: https://wa.me/${storePhone}`;
    return `https://wa.me/${r.friend_phone}?text=${encodeURIComponent(text)}`;
  }

  async function markSent(r: Referral) {
    // open immediately
    window.open(buildWhatsappLink(r), "_blank");
    // record click
    const { data } = await supabase.functions.invoke("referral-mark-sent", {
      body: { referral_id: r.id },
    });
    setReferrals((prev) =>
      prev.map((x) => (x.id === r.id ? { ...x, message_sent_at: new Date().toISOString() } : x))
    );
    if ((data as any)?.doubled) {
      toast.success("🎉 Cashback DOBRADO! Você indicou 3 amigos.", { duration: 6000 });
      // refresh token
      const { data: nt } = await supabase
        .from("review_tokens")
        .select("id, customer_phone, customer_name, store_phone, cashback_value, cashback_doubled, review_submitted_at")
        .eq("token", token)
        .maybeSingle();
      if (nt) setTok(nt as ReviewToken);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-yellow-50 to-yellow-100">
        <p className="text-muted-foreground">Carregando...</p>
      </div>
    );
  }

  if (!tok) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-yellow-50 to-yellow-100 p-4">
        <Card className="p-8 max-w-md text-center">
          <h1 className="text-2xl font-bold mb-2">Link inválido</h1>
          <p className="text-muted-foreground">Este link de avaliação não foi encontrado ou expirou.</p>
        </Card>
      </div>
    );
  }

  const sentCount = referrals.filter((r) => r.message_sent_at).length;
  const doubled = tok.cashback_doubled;
  const cashbackText = `R$ ${Number(tok.cashback_value).toFixed(2).replace(".", ",")}`;

  return (
    <div className="min-h-screen bg-gradient-to-b from-yellow-50 via-yellow-100 to-amber-100 py-6 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-6">
          <h1 className="text-3xl font-extrabold tracking-tight">
            🍌 Banana Calçados
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Olá{tok.customer_name ? `, ${tok.customer_name}` : ""}! Sua opinião vale ouro 💛
          </p>
        </div>

        {step === "review" && (
          <Card className="p-6 space-y-5">
            <div>
              <h2 className="text-xl font-bold">Como foi sua experiência?</h2>
              <p className="text-sm text-muted-foreground">De 0 a 10, quanto você nos recomendaria a um amigo?</p>
            </div>
            <div className="grid grid-cols-11 gap-1">
              {Array.from({ length: 11 }).map((_, i) => (
                <button
                  key={i}
                  onClick={() => setNps(i)}
                  className={`h-10 rounded-md font-bold text-sm transition ${
                    nps === i
                      ? "bg-amber-500 text-white scale-110"
                      : "bg-white hover:bg-amber-100 border"
                  }`}
                >
                  {i}
                </button>
              ))}
            </div>
            <div>
              <label className="text-sm font-medium">O que você mais gostou? (opcional)</label>
              <Textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} rows={3} />
            </div>
            <div>
              <label className="text-sm font-medium">O que podemos melhorar? (opcional)</label>
              <Textarea value={improve} onChange={(e) => setImprove(e.target.value)} maxLength={500} rows={3} />
            </div>
            <Button onClick={submitReview} disabled={submitting} className="w-full bg-amber-500 hover:bg-amber-600">
              {submitting ? "Enviando..." : "Enviar avaliação"}
            </Button>
          </Card>
        )}

        {step === "referral" && (
          <div className="space-y-4">
            <Card className="p-5 bg-gradient-to-br from-amber-100 to-yellow-200 border-amber-300">
              <div className="flex items-center gap-3">
                <Gift className="h-10 w-10 text-amber-700 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-amber-900">Seu cashback atual</p>
                  <p className="text-3xl font-extrabold text-amber-900">
                    {cashbackText}
                    {doubled && <Sparkles className="inline h-6 w-6 ml-2 text-amber-600" />}
                  </p>
                  {doubled && (
                    <p className="text-xs font-bold text-emerald-700 mt-1">✨ DOBRADO! Obrigado pelas indicações.</p>
                  )}
                </div>
              </div>
            </Card>

            {!doubled && (
              <Card className="p-5 bg-amber-50 border-amber-200">
                <p className="text-sm font-medium text-amber-900">
                  💡 <b>Indique 3 amigos</b> e seu cashback será <b>DOBRADO</b> automaticamente!
                </p>
                <div className="flex gap-2 mt-3">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className={`flex-1 h-2 rounded-full ${
                        i < sentCount ? "bg-emerald-500" : "bg-amber-200"
                      }`}
                    />
                  ))}
                </div>
                <p className="text-xs text-amber-800 mt-2">{sentCount}/3 amigos com mensagem enviada</p>
              </Card>
            )}

            <Card className="p-5 space-y-4">
              <h2 className="text-lg font-bold">Indicar amigos</h2>

              {referrals.map((r) => (
                <div key={r.id} className="border rounded-lg p-3 bg-card">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{r.friend_name}</p>
                      <p className="text-xs text-muted-foreground">
                        Cupom: <b>{r.coupon_code}</b>
                      </p>
                    </div>
                    {r.message_sent_at ? (
                      <span className="flex items-center gap-1 text-emerald-600 text-xs font-medium">
                        <CheckCircle2 className="h-4 w-4" /> Enviado
                      </span>
                    ) : (
                      <Button size="sm" onClick={() => markSent(r)} className="bg-emerald-600 hover:bg-emerald-700">
                        <Send className="h-3 w-3 mr-1" /> Enviar
                      </Button>
                    )}
                  </div>
                </div>
              ))}

              {referrals.length < 3 && (
                <div className="space-y-2 pt-2 border-t">
                  <Input
                    placeholder="Nome do amigo"
                    value={fName}
                    onChange={(e) => setFName(e.target.value)}
                    maxLength={100}
                  />
                  <Input
                    placeholder="WhatsApp com DDD (ex: 33991955003)"
                    value={fPhone}
                    onChange={(e) => setFPhone(e.target.value.replace(/[^\d]/g, ""))}
                    maxLength={13}
                    inputMode="numeric"
                  />
                  <Button onClick={createReferral} disabled={creating} className="w-full">
                    {creating ? "Adicionando..." : `Adicionar amigo (${referrals.length}/3)`}
                  </Button>
                </div>
              )}

              {referrals.length >= 3 && sentCount < 3 && (
                <p className="text-xs text-center text-muted-foreground">
                  Clique em <b>Enviar</b> em todos para dobrar seu cashback!
                </p>
              )}
            </Card>
          </div>
        )}

        <p className="text-center text-xs text-muted-foreground mt-6">
          Banana Calçados · Programa de Indicação
        </p>
      </div>
    </div>
  );
}
