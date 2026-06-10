interface Props {
  originalMessage?: string | null;
  originalDirection?: string;
  originalSenderName?: string | null;
  originalMediaType?: string | null;
  contactName?: string;
  onClick?: () => void;
  /** Miniatura (status com mídia). */
  thumbnailUrl?: string | null;
  /** Marca como resposta a um Status/Story. */
  isStatus?: boolean;
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
  thumbnailUrl,
  isStatus,
}: Props) {
  const senderLabel = isStatus
    ? 'Status'
    : originalDirection === 'incoming'
      ? (originalSenderName || contactName || 'Contato')
      : 'Você';

  const borderColor = isStatus
    ? 'border-[#00a884]'
    : originalDirection === 'outgoing' ? 'border-[#7c57d1]' : 'border-[#00a884]';
  const nameColor = isStatus
    ? 'text-[#00a884]'
    : originalDirection === 'outgoing' ? 'text-[#7c57d1]' : 'text-[#00a884]';

  const mediaLabel = getMediaLabel(originalMediaType);
  const isVideoThumb = originalMediaType === 'video';
  const displayText =
    originalMessage?.replace(/^\[AUTO\] /, '') ||
    mediaLabel ||
    (isStatus ? (isVideoThumb ? '🎥 Vídeo' : '📷 Status') : '...');

  return (
    <div
      className={`bg-black/10 rounded-lg p-2 mb-1 border-l-4 ${borderColor} cursor-pointer hover:bg-black/20 transition-colors flex gap-2 items-center`}
      onClick={onClick}
    >
      <div className="min-w-0 flex-1">
        <p className={`text-[11px] font-medium ${nameColor}`}>
          {isStatus ? '↩️ Resposta ao seu Status' : senderLabel}
        </p>
        <p className="text-[12px] text-[#8696a0] line-clamp-2">{displayText}</p>
      </div>
      {thumbnailUrl && (
        <div className="relative shrink-0">
          <img
            src={thumbnailUrl}
            alt="status"
            className="h-20 w-20 rounded-md object-cover"
          />
          {isVideoThumb && (
            <span className="absolute inset-0 flex items-center justify-center text-white text-base drop-shadow">▶</span>
          )}
        </div>
      )}
    </div>
  );
}
