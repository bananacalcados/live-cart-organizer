import { Camera, Video, Mic, FileText } from "lucide-react";

interface Props {
  originalMessage?: string | null;
  originalDirection?: string;
  originalSenderName?: string | null;
  originalMediaType?: string | null;
  contactName?: string;
  onClick?: () => void;
}

function getMediaLabel(mediaType?: string | null) {
  switch (mediaType) {
    case 'image': return '📷 Foto';
    case 'video': return '🎥 Vídeo';
    case 'audio': return '🎵 Áudio';
    case 'document': return '📄 Documento';
    default: return null;
  }
}

export function QuotedMessageBubble({
  originalMessage,
  originalDirection,
  originalSenderName,
  originalMediaType,
  contactName,
  onClick,
}: Props) {
  const senderLabel = originalDirection === 'incoming'
    ? (originalSenderName || contactName || 'Contato')
    : 'Você';

  const borderColor = originalDirection === 'outgoing' ? 'border-[#7c57d1]' : 'border-[#00a884]';
  const nameColor = originalDirection === 'outgoing' ? 'text-[#7c57d1]' : 'text-[#00a884]';

  const mediaLabel = getMediaLabel(originalMediaType);
  const displayText = originalMessage?.replace(/^\[AUTO\] /, '') || mediaLabel || '...';

  return (
    <div
      className={`bg-black/10 rounded-lg p-2 mb-1 border-l-4 ${borderColor} cursor-pointer hover:bg-black/20 transition-colors`}
      onClick={onClick}
    >
      <p className={`text-[11px] font-medium ${nameColor}`}>{senderLabel}</p>
      <p className="text-[12px] text-[#8696a0] line-clamp-2">{displayText}</p>
    </div>
  );
}
