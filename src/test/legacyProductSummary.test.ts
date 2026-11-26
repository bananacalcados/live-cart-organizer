import { describe, expect, it } from 'vitest';
import { firstLegacyThumbnails, legacySummaryMap } from '@/components/inventory/legacyProductSummary';

describe('Legacy summary and thumbnails', () => {
  it('selects the lowest position across colors', () => {
    expect(firstLegacyThumbnails([
      { master_id: 'a', color_key: 'geral', url_thumb: 'later', position: 2, created_at: '2026-01-01' },
      { master_id: 'a', color_key: 'geral', url_thumb: 'first', position: 0, created_at: '2026-02-01' },
    ])).toEqual({ a: 'first' });
  });
  it('breaks equal positions by oldest creation date', () => {
    expect(firstLegacyThumbnails([
      { master_id: 'a', color_key: 'preto', url_thumb: 'new', position: 0, created_at: '2026-02-01' },
      { master_id: 'b', color_key: 'geral', url_thumb: 'other', position: 0, created_at: '2026-03-01' },
      { master_id: 'a', color_key: 'preto', url_thumb: 'old', position: 0, created_at: '2026-01-01' },
    ])).toEqual({ a: 'old', b: 'other' });
  });
  it('prefers a real color photo over a better positioned general photo', () => {
    expect(firstLegacyThumbnails([
      { master_id: 'a', color_key: 'geral', url_thumb: 'general', position: 0, created_at: '2026-01-01' },
      { master_id: 'a', color_key: 'preto', url_thumb: 'color', position: 8, created_at: '2026-03-01' },
      { master_id: 'a', color_key: 'azul', url_thumb: 'other-color', position: 9, created_at: '2026-02-01' },
    ])).toEqual({ a: 'color' });
  });
  it('uses the general photo when the product has no real color photo', () => {
    expect(firstLegacyThumbnails([
      { master_id: 'a', color_key: 'geral', url_thumb: 'general-later', position: 3, created_at: '2026-01-01' },
      { master_id: 'a', color_key: 'geral', url_thumb: 'general-first', position: 1, created_at: '2026-02-01' },
    ])).toEqual({ a: 'general-first' });
  });
  it('preserves negative stock and gives zero to masters without variants on successful reads', () => {
    expect(legacySummaryMap(['a', 'b'], [{ master_id: 'a', variant_count: 5, total_stock: -19 }]))
      .toEqual({ a: { variant_count: 5, total_stock: -19 }, b: { variant_count: 0, total_stock: 0 } });
  });
});