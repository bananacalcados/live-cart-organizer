import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { POSWhatsApp } from "./POSWhatsApp";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeId: string;
  customerPhone?: string;
}

/**
 * A dialog wrapper around POSWhatsApp for use in task cards.
 * Opens the full WhatsApp interface pre-loaded for the given store.
 */
export function POSTaskWhatsAppDialog({ open, onOpenChange, storeId }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[85vh] p-0 overflow-hidden gap-0 border-0 bg-pos-black shadow-2xl">
        <div className="h-full">
          <POSWhatsApp storeId={storeId} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
