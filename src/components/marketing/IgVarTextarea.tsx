import { useRef } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

const VARS = [
  { token: "{@username}", label: "@ da pessoa" },
  { token: "{username}", label: "Usuário (sem @)" },
  { token: "{comment}", label: "Comentário" },
  { token: "{saudacao}", label: "Bom dia/tarde/noite" },
];

interface Props extends Omit<React.ComponentProps<typeof Textarea>, "onChange" | "value"> {
  value: string;
  onValueChange: (v: string) => void;
}

/** Textarea com botões que inserem variáveis na posição do cursor. */
export function IgVarTextarea({ value, onValueChange, ...rest }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const insert = (token: string) => {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + token + value.slice(end);
    onValueChange(next);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = start + token.length;
      el?.setSelectionRange(pos, pos);
    });
  };
  return (
    <div className="space-y-1">
      <Textarea ref={ref} value={value} onChange={(e) => onValueChange(e.target.value)} {...rest} />
      <div className="flex flex-wrap gap-1">
        {VARS.map((v) => (
          <Button
            key={v.token}
            type="button"
            size="sm"
            variant="outline"
            className="h-6 px-2 text-[11px]"
            onClick={() => insert(v.token)}
          >
            + {v.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
