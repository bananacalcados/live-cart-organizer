import { Check, CheckCheck, Clock, X } from "lucide-react";

interface MessageStatusIconProps {
  status: string | null | undefined;
  className?: string;
}

export function MessageStatusIcon({ status, className = "h-3 w-3" }: MessageStatusIconProps) {
  switch (status) {
    case 'sending':
    case 'pending':
      return <Clock className={`${className} text-[#667781]`} />;
    case 'sent':
      return <Check className={`${className} text-[#667781]`} />;
    case 'delivered':
      return <CheckCheck className={`${className} text-[#667781]`} />;
    case 'read':
      return <CheckCheck className={`${className} text-[#53bdeb]`} />;
    case 'failed':
      return <X className={`${className} text-red-500`} />;
    default:
      return <Check className={`${className} text-[#667781]`} />;
  }
}
