import { X, HelpCircle } from "lucide-react";
import type { AttendanceNudge } from "@/lib/attendance/rules";

interface ComposerRuleBarProps {
  nudges: AttendanceNudge[];
  onDismiss: (ruleKey: string) => void;
}

/**
 * Barra discreta de lembretes de atendimento, exibida ACIMA do input.
 * Apenas avisa — nunca bloqueia o envio nem altera o texto.
 */
export function ComposerRuleBar({ nudges, onDismiss }: ComposerRuleBarProps) {
  if (nudges.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5 px-3 py-2.5 border-t-2 border-amber-300/70 bg-amber-50 dark:bg-amber-950/40">
      {nudges.map((n) => (
        <div
          key={n.ruleKey}
          className="flex items-center gap-2.5 text-sm font-semibold text-amber-900 dark:text-amber-100"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-400/30 text-amber-600 dark:text-amber-400">
            <HelpCircle className="h-4 w-4" />
          </span>
          <span className="flex-1 leading-snug">{n.message}</span>
          <button
            type="button"
            onClick={() => onDismiss(n.ruleKey)}
            className="flex h-7 w-7 items-center justify-center rounded-full text-amber-700/70 hover:bg-amber-200/60 dark:text-amber-300/70 dark:hover:bg-amber-800/40"
            title="Ignorar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
