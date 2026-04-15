import { X, Camera, Video, Mic, FileText } from "lucide-react";

export interface QuotedMessageData {
  message_id: string;
  message: string;
  sender_name?: string;
  direction: string;
  media_type?: string;
}

interface Props {
  quoted: QuotedMessageData;
  contactName?: string;
  onCancel: () => void;
}

function getMediaLabel(mediaType?: string) {
  switch (mediaType) {
    case 'image': return <><Camera className="h-3 w-3 inline" /> Foto</>;
    case 'video': return <><Video className="h-3 w-3 inline" /> Vídeo</>;
    case 'audio': return <><Mic className="h-3 w-3 inline" /> Áudio</>;
    case 'document': return <><FileText className="h-3 w-3 inline" /> Documento</>;
    default: return null;
  }
}

export function QuotedMessagePreview({ quoted, contactName, onCancel }: Props) {
  const senderLabel = quoted.direction === 'incoming'
    ? (quoted.sender_name || contactName || 'Contato')
    : 'Você';

  const mediaLabel = getMediaLabel(quoted.media_type);
  const displayText = quoted.message?.replace(/^\[AUTO\] /, '') || '';

  return (
    <div className="px-3 py-2 bg-[#1a2228] border-t border-[#2a3942] flex items-center gap-2">
      <div className="flex-1 min-w-0 border-l-4 border-[#00a884] pl-2 py-0.5">
        <p className="text-[12px] font-bold text-[#00a884] truncate">{senderLabel}</p>
        <p className="text-[12px] text-[#8696a0] truncate">
          {mediaLabel && !displayText ? mediaLabel : displayText || mediaLabel || '...'}
        </p>
      </div>
      <button onClick={onCancel} className="shrink-0 p-1 hover:bg-[#2a3942] rounded text-[#8696a0]">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
