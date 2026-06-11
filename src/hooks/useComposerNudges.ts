import { useEffect, useMemo, useRef, useState } from "react";
import { useAttendanceRules } from "./useAttendanceRules";
import { evaluateDraft, type AttendanceNudge, type DraftContext } from "@/lib/attendance/rules";

/**
 * Avalia o rascunho atual contra as regras de atendimento (debounce ~400ms) e
 * devolve os avisos a exibir. Não toca no texto nem no envio.
 *
 * `dismissedKey` permite "ignorar" um aviso até o texto mudar de forma relevante.
 */
export function useComposerNudges(text: string, ctx: DraftContext) {
  const rules = useAttendanceRules();
  const [debounced, setDebounced] = useState(text);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const lastTextRef = useRef(text);

  // debounce do rascunho
  useEffect(() => {
    const t = setTimeout(() => setDebounced(text), 400);
    return () => clearTimeout(t);
  }, [text]);

  // reabilita avisos quando a vendedora volta a digitar (texto cresceu)
  useEffect(() => {
    if (text.length < lastTextRef.current.length - 1) {
      // apagou bastante — mantém dismiss
    } else if (text !== lastTextRef.current && dismissed.size > 0) {
      setDismissed(new Set());
    }
    lastTextRef.current = text;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const nudges: AttendanceNudge[] = useMemo(() => {
    if (!debounced.trim()) return [];
    return evaluateDraft(debounced, ctx, rules).filter((n) => !dismissed.has(n.ruleKey));
  }, [debounced, ctx, rules, dismissed]);

  const dismiss = (ruleKey: string) =>
    setDismissed((prev) => new Set([...prev, ruleKey]));

  return { nudges, dismiss };
}
