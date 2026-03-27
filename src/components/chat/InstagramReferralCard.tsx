import { cn } from "@/lib/utils";

interface Props {
  referral: any;
}

const STYLE_MAP: Record<string, { icon: string; label: string; color: string; border: string; bg: string }> = {
  ad: { icon: '📣', label: 'Via Anúncio', color: 'text-blue-600 dark:text-blue-400', border: 'border-blue-200 dark:border-blue-800', bg: 'bg-blue-50 dark:bg-blue-950/40' },
  story_reply: { icon: '📷', label: 'Resposta ao Story', color: 'text-pink-600 dark:text-pink-400', border: 'border-pink-200 dark:border-pink-800', bg: 'bg-pink-50 dark:bg-pink-950/40' },
  story_mention: { icon: '📷', label: 'Menção no Story', color: 'text-pink-600 dark:text-pink-400', border: 'border-pink-200 dark:border-pink-800', bg: 'bg-pink-50 dark:bg-pink-950/40' },
  reel: { icon: '🎬', label: 'Reel', color: 'text-purple-600 dark:text-purple-400', border: 'border-purple-200 dark:border-purple-800', bg: 'bg-purple-50 dark:bg-purple-950/40' },
  shared_post: { icon: '📮', label: 'Post Compartilhado', color: 'text-orange-600 dark:text-orange-400', border: 'border-orange-200 dark:border-orange-800', bg: 'bg-orange-50 dark:bg-orange-950/40' },
};

export function InstagramReferralCard({ referral }: Props) {
  if (!referral || typeof referral !== 'object') return null;

  const sourceType = referral.source_type || '';
  const style = STYLE_MAP[sourceType];
  if (!style) return null;

  return (
    <div className={cn("mb-2 rounded-md border overflow-hidden", style.border, style.bg)}>
      {referral.media_url && (
        <img
          src={referral.media_url}
          alt={style.label}
          className="w-full max-h-[150px] object-cover"
          loading="lazy"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      )}
      {referral.video_url && !referral.media_url && (
        <video src={referral.video_url} className="w-full max-h-[150px] object-cover" muted />
      )}
      <div className="px-2.5 py-1.5">
        <span className={cn("text-[10px] font-semibold uppercase tracking-wide", style.color)}>
          {style.icon} {style.label}
        </span>
        {referral.headline && (
          <p className="text-xs font-medium text-foreground leading-tight mt-0.5">{referral.headline}</p>
        )}
        {referral.body && (
          <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{referral.body}</p>
        )}
        {referral.source_url && (
          <a href={referral.source_url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-500 hover:underline mt-1 block truncate">
            Ver original ↗
          </a>
        )}
      </div>
    </div>
  );
}