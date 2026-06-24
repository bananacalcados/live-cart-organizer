import { ExternalLink, CornerUpLeft, Phone } from "lucide-react";

export interface CarouselCardButton {
  type?: string; // URL | QUICK_REPLY | PHONE_NUMBER
  text?: string;
  url?: string;
  phone_number?: string;
}

export interface CarouselCard {
  image_url?: string | null;
  video_url?: string | null;
  body?: string | null;
  buttons?: CarouselCardButton[];
}

export interface CarouselTemplatePayload {
  type: "carousel";
  body?: string | null;
  cards?: CarouselCard[];
}

interface Props {
  payload: CarouselTemplatePayload;
}

function ButtonChip({ btn }: { btn: CarouselCardButton }) {
  const type = (btn.type || "").toUpperCase();
  const Icon = type === "URL" ? ExternalLink : type === "PHONE_NUMBER" ? Phone : CornerUpLeft;
  return (
    <div className="flex items-center justify-center gap-1.5 w-full text-center text-[13px] font-medium text-[#00a884] border-t border-black/5 dark:border-white/10 py-1.5">
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{btn.text || "Botão"}</span>
    </div>
  );
}

/**
 * Renderiza um template de carrossel da Meta exatamente como o cliente recebe:
 * balão de texto + cards horizontais (foto quadrada 1:1, texto e botões).
 */
export function CarouselMessageBubble({ payload }: Props) {
  const cards = payload.cards || [];
  return (
    <div className="space-y-2">
      {payload.body && (
        <p
          className="whitespace-pre-wrap break-words overflow-wrap-anywhere"
          style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
        >
          {payload.body}
        </p>
      )}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 snap-x">
        {cards.map((card, i) => (
          <div
            key={i}
            className="snap-start shrink-0 w-[180px] rounded-lg overflow-hidden bg-white dark:bg-[#1f2c33] border border-black/10 dark:border-white/10"
          >
            {card.image_url ? (
              <img
                src={card.image_url}
                alt={`Card ${i + 1}`}
                className="w-full aspect-square object-cover"
                loading="lazy"
              />
            ) : card.video_url ? (
              <video src={card.video_url} className="w-full aspect-square object-cover" controls />
            ) : (
              <div className="w-full aspect-square bg-muted flex items-center justify-center text-xs text-muted-foreground">
                sem mídia
              </div>
            )}
            {card.body && (
              <p className="px-2 py-1.5 text-[12px] leading-snug whitespace-pre-wrap break-words">
                {card.body}
              </p>
            )}
            {(card.buttons || []).map((btn, bi) => (
              <ButtonChip key={bi} btn={btn} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
