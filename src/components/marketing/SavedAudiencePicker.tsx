import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, X } from "lucide-react";

interface PublicoRow {
  id: string;
  nome: string;
  filtro_json: unknown;
}

interface Props {
  /** Chamado com o Set de sufixos de 8 dígitos permitidos, ou null quando limpo.
   *  Para públicos em modo phone_list (lista fixa criada pelo Estrategista), também
   *  passa a lista bruta de telefones — o Dispatcher usa como fonte direta, sem filtrar
   *  por CRM/leads. */
  onApply: (
    allowedPhoneSuffix8: Set<string> | null,
    meta: { id: string; nome: string } | null,
    phoneList?: string[] | null,
  ) => void;
  activeId: string | null;
}


export function SavedAudiencePicker({ onApply, activeId }: Props) {
  const [rows, setRows] = useState<PublicoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("campanha_publicos")
        .select("id, nome, filtro_json")
        .order("updated_at", { ascending: false })
        .limit(200);
      if (error) toast.error("Erro ao listar públicos");
      setRows((data as PublicoRow[]) || []);
      setLoading(false);
    })();
  }, []);

  const applyPublico = async (id: string) => {
    if (!id || id === "__none__") {
      onApply(null, null, null);
      return;
    }

    const row = rows.find((r) => r.id === id);
    if (!row) return;
    setApplying(true);

    // Modo phone_list: público construído a partir de uma lista fixa de telefones
    // (usado pelo Estrategista quando cria públicos a partir de resultado de disparo
    // ou de leads que ainda não estão no CRM unificado). Não passa pela RPC.
    const filtro: any = row.filtro_json;
    if (filtro && filtro.mode === "phone_list" && Array.isArray(filtro.phones)) {
      const suffixes = new Set<string>();
      const normalized: string[] = [];
      for (const raw of filtro.phones) {
        const digits = String(raw || "").replace(/\D/g, "");
        if (digits.length >= 8) {
          suffixes.add(digits.slice(-8));
          normalized.push(String(raw));
        }
      }
      setApplying(false);
      onApply(suffixes, { id: row.id, nome: row.nome }, normalized);
      toast.success(`Público "${row.nome}" aplicado (${suffixes.size} contatos — lista fixa)`);
      return;
    }

    const { data, error } = await supabase.rpc("list_campaign_audience", {
      p_filtro: row.filtro_json as any,
      p_limit: 5000,
      p_offset: 0,
    });
    setApplying(false);
    if (error) {
      toast.error("Erro ao resolver público: " + error.message);
      return;
    }
    const suffixes = new Set<string>();
    for (const r of (data as any[]) || []) {
      const digits = String(r.phone || "").replace(/\D/g, "");
      if (digits.length >= 8) suffixes.add(digits.slice(-8));
    }
    onApply(suffixes, { id: row.id, nome: row.nome }, null);
    toast.success(`Público "${row.nome}" aplicado (${suffixes.size} contatos)`);

  };


  return (
    <div className="flex items-center gap-2">
      <div className="min-w-[240px]">
        <Select
          value={activeId ?? "__none__"}
          onValueChange={applyPublico}
          disabled={loading || applying}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder={loading ? "Carregando..." : "Público salvo (opcional)"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">— sem público —</SelectItem>
            {rows.map((r) => (
              <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {activeId && (
        <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => onApply(null, null)}>
          <X className="h-3 w-3" />
        </Button>
      )}
      {applying && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
    </div>
  );
}
