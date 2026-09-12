import type { ComponentProps, ReactNode } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export function EmbeddedDialog({ embedded, open, onOpenChange, children }: {
  embedded?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return embedded ? <>{open ? children : null}</> : <Dialog open={open} onOpenChange={onOpenChange}>{children}</Dialog>;
}

export function EmbeddedDialogContent({ embedded, className, children, ...props }: ComponentProps<typeof DialogContent> & { embedded?: boolean }) {
  if (embedded) return <div className={cn("flex h-full min-h-0 flex-col overflow-hidden bg-card", className)}>{children}</div>;
  return <DialogContent className={className} {...props}>{children}</DialogContent>;
}