// Interruptor (só admin): exigir que a cliente escolha o produto novo na troca.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { toast } from "sonner";

export function CentralProductChoiceToggle() {
  const { isAdmin } = useIsAdmin();
  const [value, setValue] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!isAdmin) return;
    supabase.from("support_settings").select("central_require_product_choice").eq("id", true).maybeSingle()
      .then(({ data }) => setValue(data ? data.central_require_product_choice !== false : true));
  }, [isAdmin]);
  if (!isAdmin || value === null) return null;
  const change = async (v: boolean) => {
    setBusy(true);
    const { error } = await supabase.from("support_settings").update({ central_require_product_choice: v }).eq("id", true);
    if (error) toast.error("Não foi possível salvar."); else { setValue(v); toast.success(v ? "A cliente escolhe o produto." : "A equipe escolhe o produto."); }
    setBusy(false);
  };
  return (
    <div className="flex items-start gap-3 rounded-md border p-3">
      <Switch id="central-product-choice" checked={value} disabled={busy} onCheckedChange={change} />
      <label htmlFor="central-product-choice" className="text-sm">
        <span className="block font-medium">Exigir que a cliente escolha o produto novo</span>
        <span className="block text-muted-foreground">Ligado: a cliente escolhe na troca e o produto fica reservado. Desligado: ela só conta o tamanho/modelo que procura, e a equipe escolhe e separa depois.</span>
      </label>
    </div>
  );
}
