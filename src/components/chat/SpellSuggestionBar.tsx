import { Check, X, BookPlus } from "lucide-react";
import type { Misspelling } from "@/lib/spellAssist/dictionary";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface SpellSuggestionBarProps {
  suggestions: Misspelling[];
  /** Aplica a substituição da palavra pela sugestão escolhida. */
  onApply: (m: Misspelling, replacement: string) => void;
  /** Ignora a sugestão apenas nesta conversa/sessão. */
  onDismiss: (word: string) => void;
  /** Adiciona a palavra ao vocabulário pessoal (não sugere mais). */
  onAddToDictionary: (word: string) => void;
}

/**
 * Barra discreta de sugestões ortográficas, exibida ACIMA do input.
 * Não bloqueia a digitação nem o envio — é puramente opcional.
 */
export function SpellSuggestionBar({
  suggestions,
  onApply,
  onDismiss,
  onAddToDictionary,
}: SpellSuggestionBarProps) {
  if (suggestions.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3 py-1.5 border-t border-border/50 bg-muted/40">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mr-1">
        Ortografia
      </span>
      {suggestions.map((m) => {
        const primary = m.suggestions[0];
        const alternates = m.suggestions.slice(1);
        return (
          <div
            key={m.word + m.start}
            className="flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-50 dark:bg-amber-950/30 pl-2 pr-0.5 py-0.5 text-xs"
          >
            <span className="text-amber-700 dark:text-amber-300 line-through decoration-amber-500/70">
              {m.word}
            </span>
            <span className="text-muted-foreground">→</span>
            <button
              type="button"
              onClick={() => onApply(m, primary)}
              className="font-medium text-foreground hover:underline"
              title={`Corrigir para "${primary}"`}
            >
              {primary}
            </button>
            <button
              type="button"
              onClick={() => onApply(m, primary)}
              className="flex h-5 w-5 items-center justify-center rounded-full text-emerald-600 hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
              title="Aplicar correção"
            >
              <Check className="h-3 w-3" />
            </button>

            {alternates.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex h-5 items-center rounded-full px-1 text-[10px] text-muted-foreground hover:bg-muted"
                    title="Outras sugestões"
                  >
                    +{alternates.length}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" side="top" className="w-auto p-1">
                  <div className="flex flex-col">
                    {alternates.map((alt) => (
                      <button
                        key={alt}
                        type="button"
                        onClick={() => onApply(m, alt)}
                        className="rounded px-2 py-1 text-left text-sm hover:bg-muted"
                      >
                        {alt}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => onAddToDictionary(m.word)}
                      className="mt-1 flex items-center gap-1 rounded border-t px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted"
                    >
                      <BookPlus className="h-3 w-3" /> Adicionar ao vocabulário
                    </button>
                  </div>
                </PopoverContent>
              </Popover>
            )}

            <button
              type="button"
              onClick={() => onDismiss(m.word)}
              className="flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
              title="Ignorar"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
