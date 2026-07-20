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

export interface PhoneListEntry {
  phone: string;
  name: string;
}

interface Props {
  /** Chamado com o Set de sufixos de 8 dígitos permitidos, ou null quando limpo.
   *  Para públicos em modo phone_list (lista fixa criada pelo Estrategista), também
   *  passa a lista de destinatários enriquecida com nome — o Dispatcher usa como fonte
   *  direta, sem filtrar por CRM/leads. */
  onApply: (
    allowedPhoneSuffix8: Set<string> | null,
    meta: { id: string; nome: string } | null,
    phoneEntries?: PhoneListEntry[] | null,
  ) => void;
  activeId: string | null;
}

function digits(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "");
}

async function enrichPhonesWithNames(rawPhones: string[]): Promise<PhoneListEntry[]> {
  const seenSuffix = new Set<string>();
  const list: { phone: string; suffix: string }[] = [];
  for (const raw of rawPhones) {
    const d = digits(raw);
    if (d.length < 8) continue;
    const suf = d.slice(-8);
    if (seenSuffix.has(suf)) continue;
    seenSuffix.add(suf);
    list.push({ phone: String(raw), suffix: suf });
  }

  // Look up names from customers_unified by phone_suffix8 (in chunks of 500)
  const nameBySuffix = new Map<string, string>();
  const suffixes = list.map((x) => x.suffix);
  for (let i = 0; i < suffixes.length; i += 500) {
    const chunk = suffixes.slice(i, i + 500);
    const { data } = await supabase
      .from("customers_unified")
      .select("phone_suffix8, name")
      .in("phone_suffix8", chunk);
    for (const r of (data as any[]) || []) {
      const nm = String(r?.name ?? "").trim();
      if (r?.phone_suffix8 && nm && !nameBySuffix.has(r.phone_suffix8)) {
        nameBySuffix.set(r.phone_suffix8, nm);
      }
    }
  }

  // Fallback: leads tables (ad_leads/event_leads/lp_leads/link_page_leads use `name`)
  const missing = list.filter((x) => !nameBySuffix.has(x.suffix)).map((x) => x.suffix);
  if (missing.length > 0) {
    const leadTables = ["ad_leads", "event_leads", "lp_leads", "link_page_leads"] as const;
    // Build a temp map suffix->list; then scan tables and match by suffix client-side
    // (leads don't have phone_suffix8). Fetch by phone LIKE is not feasible; instead
    // fetch a reasonable window (last 200 by created_at per table filtered by phone endings).
    // Simpler: query each table where phone ~ any(missing) — Postgres LIKE with % is slow;
    // do a targeted scan via .in() on last-8 computed suffix using RPC would be ideal, but
    // to keep it dependency-free we just skip fallback when there are too many missing.
    if (missing.length <= 1500) {
      for (const table of leadTables) {
        const { data } = await supabase.from(table as any).select("name, phone").limit(20000);
        for (const r of (data as any[]) || []) {
          const suf = digits(r?.phone).slice(-8);
          if (!suf || nameBySuffix.has(suf)) continue;
          const nm = String(r?.name ?? "").trim();
          if (nm && missing.includes(suf)) nameBySuffix.set(suf, nm);
        }
      }
    }
  }

  return list.map((x) => ({ phone: x.phone, name: nameBySuffix.get(x.suffix) || "" }));
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
    if (filtro && filtro.mode === "phone_list") {
      // Prefer persisted entries (name+phone) if present; fallback to phones[] and enrich.
      let entries: PhoneListEntry[] = [];
      if (Array.isArray(filtro.entries) && filtro.entries.length) {
        const seen = new Set<string>();
        for (const e of filtro.entries) {
          const d = digits(e?.phone);
          if (d.length < 8) continue;
          const suf = d.slice(-8);
          if (seen.has(suf)) continue;
          seen.add(suf);
          entries.push({ phone: String(e.phone), name: String(e?.name ?? "").trim() });
        }
        // Fill blanks via CRM lookup
        const blanks = entries.filter((e) => !e.name).map((e) => e.phone);
        if (blanks.length) {
          const enriched = await enrichPhonesWithNames(blanks);
          const nameBySuffix = new Map(enriched.map((x) => [digits(x.phone).slice(-8), x.name]));
          entries = entries.map((e) => e.name ? e : { ...e, name: nameBySuffix.get(digits(e.phone).slice(-8)) || "" });
        }
      } else if (Array.isArray(filtro.phones)) {
        entries = await enrichPhonesWithNames(filtro.phones);
      }

      const suffixes = new Set<string>();
      for (const e of entries) {
        const d = digits(e.phone);
        if (d.length >= 8) suffixes.add(d.slice(-8));
      }
      setApplying(false);
      onApply(suffixes, { id: row.id, nome: row.nome }, entries);
      const withName = entries.filter((e) => e.name).length;
      toast.success(`Público "${row.nome}" aplicado (${suffixes.size} contatos — ${withName} com nome)`);
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
      const digitsPhone = String(r.phone || "").replace(/\D/g, "");
      if (digitsPhone.length >= 8) suffixes.add(digitsPhone.slice(-8));
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
        <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => onApply(null, null, null)}>
          <X className="h-3 w-3" />
        </Button>
      )}
      {applying && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
    </div>
  );
}
