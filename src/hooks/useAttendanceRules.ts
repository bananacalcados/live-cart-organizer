import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_CLOSING_PHRASES } from "@/lib/attendance/closingPhrases";
import type { RulesMap } from "@/lib/attendance/rules";

/** Defaults usados enquanto a config não carrega (ou se a tabela estiver vazia). */
const DEFAULT_RULES: RulesMap = {
  end_with_question: {
    enabled: true,
    config: {
      message:
        "Sua mensagem não termina com pergunta. Que tal puxar uma resposta da cliente?",
      min_length: 12,
      closing_phrases: DEFAULT_CLOSING_PHRASES,
    },
  },
  workload_counters: {
    enabled: true,
    config: { show_awaiting: true, show_followups: true },
  },
};

// Cache simples por sessão pra não refazer a query em cada chat.
let cache: RulesMap | null = null;
let inflight: Promise<RulesMap> | null = null;

async function loadRules(): Promise<RulesMap> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data, error } = await (supabase as any)
        .from("chat_attendance_rules")
        .select("rule_key, enabled, config");
      if (error || !data) return DEFAULT_RULES;
      const map: RulesMap = { ...DEFAULT_RULES };
      for (const row of data as Array<{ rule_key: string; enabled: boolean; config: Record<string, unknown> }>) {
        map[row.rule_key] = {
          enabled: !!row.enabled,
          config: row.config || {},
        };
      }
      cache = map;
      return map;
    } catch {
      return DEFAULT_RULES;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Limpa o cache (chamado após salvar na tela de configuração). */
export function invalidateAttendanceRules() {
  cache = null;
}

export function useAttendanceRules(): RulesMap {
  const [rules, setRules] = useState<RulesMap>(cache || DEFAULT_RULES);

  useEffect(() => {
    let alive = true;
    loadRules().then((r) => {
      if (alive) setRules(r);
    });
    return () => {
      alive = false;
    };
  }, []);

  return rules;
}
