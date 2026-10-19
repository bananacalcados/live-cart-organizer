interface CaptionItem { url: string; caption: string }
interface CaptionBlock { content: string; mediaItems: CaptionItem[] }

/** A pending draft caption belongs to the first successfully added file only. */
export function appendDraftMedia<T extends CaptionBlock>(block: T, items: CaptionItem[]): T {
  if (items.length === 0) return block;
  const transfer = block.mediaItems.length === 0 && block.content.length > 0;
  return {
    ...block,
    content: transfer ? '' : block.content,
    mediaItems: [...block.mediaItems, ...items.map((item, i) =>
      transfer && i === 0 ? { ...item, caption: block.content } : item)],
  };
}

export function removeDraftMedia<T extends CaptionBlock>(block: T, index: number): T {
  const removed = block.mediaItems[index];
  if (!removed) return block;
  const mediaItems = block.mediaItems.filter((_, i) => i !== index);
  return {
    ...block,
    mediaItems,
    content: mediaItems.length === 0 ? removed.caption || block.content : block.content,
  };
}