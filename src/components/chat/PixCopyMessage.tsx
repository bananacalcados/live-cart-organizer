import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

const BUTTON_MARKER = "[Botão: Copiar código PIX]";
const CODE_PATTERN = /\n?\[PIX_CODE:([^\]]+)\]/;

interface PixCopyMessageProps {
  message: string;
}

export function PixCopyMessage({ message }: PixCopyMessageProps) {
  if (!message.includes(BUTTON_MARKER)) {
    return <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{message}</p>;
  }

  const code = message.match(CODE_PATTERN)?.[1]?.trim() || "";
  const text = message.replace(BUTTON_MARKER, "").replace(CODE_PATTERN, "").trimEnd();

  const copyCode = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      toast.success("Código PIX copiado!");
    } catch {
      toast.error("Não foi possível copiar o código PIX");
    }
  };

  return (
    <div className="-mx-3 -mb-1.5">
      {text && <p className="whitespace-pre-wrap break-words px-3 pb-2 [overflow-wrap:anywhere]">{text}</p>}
      <div className="border-t border-border/50 px-1 py-0.5">
        <Button
          type="button"
          variant="ghost"
          className="h-9 w-full justify-center gap-2 text-primary hover:bg-background/30 hover:text-primary"
          onClick={copyCode}
          disabled={!code}
          title={code ? "Copiar código PIX" : "Botão enviado ao cliente"}
        >
          <Copy className="h-4 w-4" />
          Copiar código PIX
        </Button>
      </div>
    </div>
  );
}