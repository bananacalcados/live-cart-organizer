import { useState } from "react";
import { ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface LiveLeadGateProps {
  onSubmit: (name: string, phone: string) => void;
  sessionTitle: string;
}

export function LiveLeadGate({ onSubmit, sessionTitle }: LiveLeadGateProps) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  const formatPhone = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 11);
    if (digits.length <= 2) return digits;
    if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  };

  const rawPhone = phone.replace(/\D/g, "");
  const isValid = name.trim().length >= 2 && rawPhone.length >= 10;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;
    onSubmit(name.trim(), `55${rawPhone}`);
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-3">
          <img src="/images/banana-logo.png" alt="Banana Calçados" className="w-16 h-16 rounded-full mx-auto object-cover" />
          <div className="inline-flex items-center gap-1.5 bg-red-600/20 text-red-400 text-xs font-bold px-3 py-1 rounded-full">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            AO VIVO
          </div>
          <h1 className="text-xl font-bold">{sessionTitle}</h1>
          <p className="text-zinc-400 text-sm">
            Cadastre-se para assistir, interagir no chat e aproveitar ofertas exclusivas! 🔥
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label className="text-zinc-300 text-sm">Seu nome</Label>
            <Input
              placeholder="Maria Silva"
              value={name}
              onChange={e => setName(e.target.value)}
              className="bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500 h-12 text-[16px]"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label className="text-zinc-300 text-sm">WhatsApp</Label>
            <Input
              placeholder="(11) 99999-9999"
              value={phone}
              onChange={e => setPhone(formatPhone(e.target.value))}
              className="bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500 h-12 text-[16px]"
              inputMode="tel"
            />
          </div>
          <Button
            type="submit"
            disabled={!isValid}
            className="w-full h-12 bg-amber-500 hover:bg-amber-600 text-black font-bold text-base gap-2"
          >
            <ShoppingBag className="w-5 h-5" />
            Entrar na Live
          </Button>
          <p className="text-zinc-600 text-[10px] text-center">
            Seus dados são protegidos e usados apenas para contato comercial.
          </p>
        </form>
      </div>
    </div>
  );
}
