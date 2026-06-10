import { Dialog, DialogContent } from "@/components/ui/dialog";

export interface StatusViewerData {
  type?: string | null;
  mediaUrl?: string | null;
  caption?: string | null;
}

interface Props {
  data: StatusViewerData | null;
  onOpenChange: (open: boolean) => void;
}

/** Modal grande para visualizar um Status/Story respondido (mídia + legenda). */
export function StatusViewerDialog({ data, onOpenChange }: Props) {
  const open = !!data;
  const isVideo = data?.type === "video";
  const caption = data?.caption || null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden bg-black border-0">
        <div className="flex flex-col">
          <div className="flex items-center justify-center bg-black max-h-[80vh]">
            {data?.mediaUrl ? (
              isVideo ? (
                <video
                  src={data.mediaUrl}
                  controls
                  autoPlay
                  className="max-h-[80vh] w-auto max-w-full"
                />
              ) : (
                <img
                  src={data.mediaUrl}
                  alt="status"
                  className="max-h-[80vh] w-auto max-w-full object-contain"
                />
              )
            ) : (
              <p className="text-white/80 py-16 px-6 text-center text-lg">
                {data?.caption || "Status de texto"}
              </p>
            )}
          </div>
          {caption && (
            <div className="bg-black px-4 py-3">
              <p className="text-white text-sm whitespace-pre-wrap">{caption}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
