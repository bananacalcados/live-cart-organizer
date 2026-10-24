import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { PlayCircle } from "lucide-react";

/** Botão discreto que abre o vídeo tutorial (vertical, com som) numa janela. */
export function TutorialVideoButton({ label, src }: { label: string; src: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="gap-1 text-xs text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <PlayCircle className="h-4 w-4" /> {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xs p-2">
          <DialogTitle className="sr-only">{label}</DialogTitle>
          {open && (
            <video src={src} controls autoPlay playsInline className="w-full rounded-lg" />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
