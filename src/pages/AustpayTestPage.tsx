import { useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

export default function AustpayTestPage() {
  const { token } = useParams();
  const [f, setF] = useState({ name: "", cpf: "", number: "", exp: "", cvv: "", installments: "1" });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  const pay = async () => {
    if (busy) return;
    setBusy(true); setResult(null);
    const [m, y] = f.exp.split("/").map((s) => s.trim());
    const { data, error } = await supabase.functions.invoke("austpay-test-charge", {
      body: { token, name: f.name, cpf: f.cpf, installments: Number(f.installments), card: { number: f.number, expMonth: m, expYear: y, cvv: f.cvv } },
    });
    setResult(error ? { error: error.message } : data);
    setBusy(false);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md p-6 space-y-3">
        <h1 className="text-xl font-bold">Teste de pagamento AustPay</h1>
        <p className="text-sm text-muted-foreground">Cobrança real de R$ 50,00 no cartão de crédito. Não gera pedido.</p>
        <Input placeholder="Nome como no cartão" value={f.name} onChange={set("name")} />
        <Input placeholder="CPF" inputMode="numeric" value={f.cpf} onChange={set("cpf")} />
        <Input placeholder="Número do cartão" inputMode="numeric" autoComplete="cc-number" value={f.number} onChange={set("number")} />
        <div className="flex gap-2">
          <Input placeholder="MM/AA" autoComplete="cc-exp" value={f.exp} onChange={set("exp")} />
          <Input placeholder="CVV" inputMode="numeric" autoComplete="cc-csc" value={f.cvv} onChange={set("cvv")} />
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
