export interface OverlayRect { x: number; y: number; width: number; height: number }

/** 1 = maior prioridade. Blocos sem entrada ficam por último. */
export const OVERLAY_PRIORITY: Record<string, number> = {
  timers: 1,
  alert: 2,
  shown_product: 3,
  wheel: 4,
  raffle_bar: 4,
  ticker: 5,
  cta: 6,
};

/** Cruzam quando a interseção passa de `tolerance` px nos dois eixos. */
export function rectsOverlap(a: OverlayRect, b: OverlayRect, tolerance = 4): boolean {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > tolerance && h > tolerance;
}

/** Devolve as chaves que devem ficar escondidas: só o de maior prioridade aparece em cada cruzamento. */
export function hiddenByConflict(blocks: { key: string; rect: OverlayRect }[]): Set<string> {
  const sorted = [...blocks].sort((a, b) => (OVERLAY_PRIORITY[a.key] ?? 99) - (OVERLAY_PRIORITY[b.key] ?? 99));
  const accepted: OverlayRect[] = [];
  const hidden = new Set<string>();
  for (const b of sorted) {
    if (b.rect.width <= 0 || b.rect.height <= 0) { accepted.push(b.rect); continue; }
    if (accepted.some((r) => rectsOverlap(r, b.rect))) hidden.add(b.key);
    else accepted.push(b.rect);
  }
  return hidden;
}

/** Pares que se cruzam (para o editor de posições). */
export function overlappingPairs(blocks: { key: string; rect: OverlayRect }[]): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < blocks.length; i++)
    for (let j = i + 1; j < blocks.length; j++)
      if (rectsOverlap(blocks[i].rect, blocks[j].rect)) out.push([blocks[i].key, blocks[j].key]);
  return out;
}

export function measureBlocks(root: HTMLElement | null): { key: string; el: HTMLElement; rect: OverlayRect }[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(":scope > [data-overlay-block]")).map((el) => ({
    key: el.dataset.overlayBlock || "",
    el,
    rect: { x: el.offsetLeft, y: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight },
  }));
}
