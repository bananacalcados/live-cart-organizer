import { describe, expect, it } from 'vitest';
import { buildPhotoBlocks, photosForColorBlock, type PhotoRow } from '@/components/inventory/ProductColorPhotos';

const photo = (id: string, color_key: string, position: number): PhotoRow => ({
  id, color_key, position, photo_id: id, url_thumb: '', url_medium: '', url_full: '',
});

describe('Product color photo blocks', () => {
  it('keeps one general block last even when a real color has the geral slug', () => {
    const blocks = buildPhotoBlocks(['Preto', 'Geral'], [{ color: 'Azul', color_key: 'azul' }]);
    expect(blocks).toEqual([
      { key: 'preto', label: 'Preto' },
      { key: 'azul', label: 'Azul' },
      { key: 'geral', label: 'Geral (sem cor)' },
    ]);
    expect(buildPhotoBlocks([], [])).toEqual([{ key: 'geral', label: 'Geral (sem cor)' }]);
  });

  it('shows general and orphaned color keys together in the general block', () => {
    const blocks = buildPhotoBlocks(['Preto'], []);
    const photos = [
      photo('orphan-later', 'cor-antiga', 4),
      photo('black', 'preto', 0),
      photo('general', 'geral', 2),
      photo('orphan-first', 'cor-removida', 1),
    ];
    expect(photosForColorBlock(photos, 'geral', blocks).map((item) => item.id))
      .toEqual(['orphan-first', 'general', 'orphan-later']);
    expect(photosForColorBlock(photos, 'preto', blocks).map((item) => item.id)).toEqual(['black']);
  });
});
