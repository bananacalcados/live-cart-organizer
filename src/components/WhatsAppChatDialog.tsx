import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { WhatsAppChat } from "./WhatsAppChat";

interface WhatsAppChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  phone: string;
  contactName?: string;
}

export function WhatsAppChatDialog({
  open,
  onOpenChange,
  phone,
  contactName,
}: WhatsAppChatDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md h-[600px] p-0 overflow-hidden">
        <WhatsAppChat
          phone={phone}
          contactName={contactName}
          onBack={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
