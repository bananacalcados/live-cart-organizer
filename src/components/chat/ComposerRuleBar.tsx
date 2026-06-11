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
    <div className="flex flex-col gap-1 px-3 py-1.5 border-t border-border/50 bg-sky-50/70 dark:bg-sky-950/20">
      {nudges.map((n) => (
        <div
          key={n.ruleKey}
          className="flex items-center gap-2 text-xs text-sky-800 dark:text-sky-200"
        >
          <HelpCircle className="h-3.5 w-3.5 shrink-0 text-sky-500" />
          <span className="flex-1">{n.message}</span>
          <button
            type="button"
            onClick={() => onDismiss(n.ruleKey)}
            className="flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
            title="Ignorar"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
