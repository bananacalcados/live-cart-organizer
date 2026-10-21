import { useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { digitsOnly, maskCpf, maskCardNumber, maskCardExpiry } from "@/lib/formatMasks";
import { z } from "zod";

const paymentSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome como no cartão.").max(100),
  cpf: z.string().regex(/^\d{11}$/, "Preencha os 11 números do CPF."),
  number: z.string().regex(/^\d{13,19}$/, "Confira o número do cartão."),
  exp: z.string().regex(/^(0[1-9]|1[0-2])\/\d{2}$/, "Informe a validade no formato MM/AA."),
  cvv: z.string().regex(/^\d{3,4}$/, "Informe os 3 ou 4 números do CVV."),
  installments: z.coerce.number().int().min(1).max(6),
});

export default function AustpayTestPage() {
  const { token } = useParams();
  const [f, setF] = useState({ name: "", cpf: "", number: "", exp: "", cvv: "", installments: "1" });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const value = e.target.value;
    const formatted = k === "cpf" ? maskCpf(value) : k === "number" ? maskCardNumber(value)
      : k === "exp" ? maskCardExpiry(value) : k === "cvv" ? digitsOnly(value).slice(0, 4) : value;
    setF((current) => ({ ...current, [k]: formatted }));
  };

  const pay = async () => {
    if (busy) return;
    const parsed = paymentSchema.safeParse({ ...f, cpf: digitsOnly(f.cpf), number: digitsOnly(f.number) });
    if (!parsed.success) {
      setResult({ error: parsed.error.issues[0]?.message || "Confira os campos do pagamento." });
      return;
    }
    setBusy(true); setResult(null);
    const values = parsed.data;
    const [m, y] = values.exp.split("/");
    try {
      const { data, error } = await supabase.functions.invoke("austpay-test-charge", {
        body: { token, name: values.name, cpf: values.cpf, installments: values.installments, card: { number: values.number, expMonth: m, expYear: y, cvv: values.cvv } },
      });
      setResult(error ? { error: error.message } : data);
    } catch {
      setResult({ error: "Não foi possível confirmar a resposta do pagamento. Confira antes de tentar novamente." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md p-6 space-y-3">
        <h1 className="text-xl font-bold">Teste de pagamento AustPay</h1>
        <p className="text-sm text-muted-foreground">Cobrança real de R$ 50,00 no cartão de crédito. Não gera pedido.</p>
        <Label htmlFor="austpay-name">Nome como no cartão</Label>
        <Input id="austpay-name" placeholder="Nome como no cartão" autoComplete="cc-name" maxLength={100} value={f.name} onChange={set("name")} />
        <Label htmlFor="austpay-cpf">CPF</Label>
        <Input id="austpay-cpf" placeholder="000.000.000-00" inputMode="numeric" maxLength={14} value={f.cpf} onChange={set("cpf")} />
        <Label htmlFor="austpay-number">Número do cartão</Label>
        <Input id="austpay-number" placeholder="0000 0000 0000 0000" inputMode="numeric" autoComplete="cc-number" maxLength={23} value={f.number} onChange={set("number")} />
        <div className="flex gap-2">
          <div className="min-w-0 flex-1 space-y-2">
            <Label htmlFor="austpay-exp">Validade (mês/ano)</Label>
            <Input id="austpay-exp" placeholder="MM/AA" inputMode="numeric" autoComplete="cc-exp" maxLength={5} value={f.exp} onChange={set("exp")} />
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <Label htmlFor="austpay-cvv">CVV</Label>
            <Input id="austpay-cvv" placeholder="CVV" type="password" inputMode="numeric" autoComplete="cc-csc" maxLength={4} value={f.cvv} onChange={set("cvv")} />
          </div>
        </div>
        <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={f.installments} onChange={set("installments")}>
          {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}x de R$ {(50 / n).toFixed(2).replace(".", ",")}</option>)}
        </select>
        <Button className="w-full" onClick={pay} disabled={busy}>{busy ? "Processando..." : "Pagar R$ 50,00"}</Button>
        {result && (
          <div className={`text-sm rounded-md p-3 ${result.approved ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"}`}>
            {result.approved ? "✅ Aprovado na AustPay" : `❌ ${result.error || "Recusado"}`}
            {result.status && <div>Status: {result.status}{result.reason ? ` — ${result.reason}` : ""}{result.acquirerCode ? ` (código ${result.acquirerCode})` : ""}</div>}
            {result.transactionId && <div>Transação: {result.transactionId}</div>}
          </div>
        )}
      </Card>
    </div>
  );
}
