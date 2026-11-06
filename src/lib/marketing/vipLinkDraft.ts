export interface VipLinkDraftBlock {
  message_content: string | null;
  vip_link_mode?: string | null;
}

/** Cada bloco que usa o placeholder precisa ter seu próprio link configurado. */
export function hasVipLinkWithoutMode(blocks: VipLinkDraftBlock[]): boolean {
  return blocks.some((block) =>
    (block.message_content || '').includes('{{link_atendimento}}')
    && !['product', 'general'].includes(block.vip_link_mode || 'none')
  );
}
