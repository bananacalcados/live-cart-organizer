import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ChatSidePanelProps {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}

export function ChatSidePanel({
  title,
  subtitle,
  icon,
  onClose,
  children,
  className,
  contentClassName,
}: ChatSidePanelProps) {
  return (
    <section className={cn("flex h-full min-h-0 flex-col bg-card", className)}>
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          {icon}
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">{title}</h2>
            {subtitle ? <p className="truncate text-xs text-muted-foreground">{subtitle}</p> : null}
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label={`Fechar ${title}`}>
          <X className="h-4 w-4" />
        </Button>
      </header>
      <div className={cn("min-h-0 flex-1 overflow-y-auto p-4", contentClassName)}>{children}</div>
    </section>
  );
}