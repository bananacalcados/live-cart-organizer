import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Local object URLs only; playing a draft never uploads or dispatches it. */
export function MobileMediaPreview({ file, discard }: { file: File; discard: () => void }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return <div className="m-wa-draft flex min-w-0 items-center gap-2">
    <div className="min-w-0 flex-1">
      {file.type.startsWith('audio/') ? <audio aria-label="Prévia do áudio" controls preload="metadata" src={url} className="h-12 w-full" /> : file.type.startsWith('video/') ? <video aria-label="Prévia do vídeo" controls playsInline preload="metadata" src={url} className="max-h-60 w-full rounded-lg" /> : file.type.startsWith('image/') ? <img src={url} alt="Prévia da imagem" className="max-h-60 w-full rounded-lg object-contain" /> : <p className="truncate text-sm">{file.name}</p>}
    </div>
    <Button type="button" variant="ghost" size="icon" className="m-wa-icon" aria-label="Descartar gravação ou arquivo" onClick={discard}><Trash2 className="h-6 w-6" /></Button>
  </div>;
}