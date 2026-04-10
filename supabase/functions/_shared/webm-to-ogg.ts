/**
 * Minimal WebM (Matroska + Opus) → OGG/Opus remuxer.
 *
 * Meta WhatsApp Cloud API only accepts audio/ogg with Opus codec.
 * Browsers (especially Safari) record audio/webm;codecs=opus.
 * This module extracts Opus packets from a WebM container and
 * re-wraps them in a valid OGG bitstream so Meta accepts the upload.
 *
 * Limitations:
 *  - Only handles files with a single Opus audio track.
 *  - Does not handle lacing (multiple frames per Block) beyond simple schemes.
 */

// ─── EBML / WebM Parser ──────────────────────────────────────────────

function readVint(buf: Uint8Array, offset: number): { value: number; length: number } {
  if (offset >= buf.length) throw new Error("Unexpected end of EBML data");
  const first = buf[offset];
  let len = 1;
  let mask = 0x80;
  while (len <= 8 && (first & mask) === 0) {
    len++;
    mask >>= 1;
  }
  if (len > 8) throw new Error("Invalid VINT at offset " + offset);
  let value = first & (mask - 1);
  for (let i = 1; i < len; i++) {
    value = value * 256 + buf[offset + i];
  }
  return { value, length: len };
}

function readEbmlId(buf: Uint8Array, offset: number): { id: number; length: number } {
  if (offset >= buf.length) throw new Error("Unexpected end of EBML ID");
  const first = buf[offset];
  let len = 1;
  if (first & 0x80) len = 1;
  else if (first & 0x40) len = 2;
  else if (first & 0x20) len = 3;
  else if (first & 0x10) len = 4;
  else throw new Error("Invalid EBML ID at offset " + offset);
  let id = first;
  for (let i = 1; i < len; i++) {
    id = id * 256 + buf[offset + i];
  }
  return { id, length: len };
}

// Known EBML element IDs we care about
const EBML_ID = 0x1A45DFA3;
const SEGMENT_ID = 0x18538067;
const TRACKS_ID = 0x1654AE6B;
const TRACK_ENTRY_ID = 0xAE;
const CODEC_PRIVATE_ID = 0x63A2;
const CLUSTER_ID = 0x1F43B675;
const SIMPLE_BLOCK_ID = 0xA3;
const BLOCK_GROUP_ID = 0xA0;
const BLOCK_ID = 0xA1;
const TIMECODE_ID = 0xE7;
const TRACK_NUMBER_ID = 0xD7;

// Master elements whose children we need to recurse into
const MASTER_IDS = new Set([EBML_ID, SEGMENT_ID, TRACKS_ID, TRACK_ENTRY_ID, CLUSTER_ID, BLOCK_GROUP_ID]);

interface OpusPacket {
  data: Uint8Array;
  /** Granule position contribution of this packet (48kHz samples). */
  samples: number;
}

/**
 * Parse a WebM file and extract Opus packets in order,
 * along with the OpusHead (CodecPrivate).
 */
function parseWebmOpus(buf: Uint8Array): { opusHead: Uint8Array; packets: OpusPacket[] } {
  let opusHead: Uint8Array | null = null;
  const packets: OpusPacket[] = [];
  let audioTrackNumber = 1; // default

  function walk(start: number, end: number, parentId?: number) {
    let pos = start;
    while (pos < end) {
      const idResult = readEbmlId(buf, pos);
      pos += idResult.length;

      const sizeResult = readVint(buf, pos);
      pos += sizeResult.length;

      const elementEnd = pos + sizeResult.value;

      if (MASTER_IDS.has(idResult.id)) {
        walk(pos, Math.min(elementEnd, end), idResult.id);
      } else if (idResult.id === CODEC_PRIVATE_ID && parentId === TRACK_ENTRY_ID) {
        opusHead = buf.slice(pos, elementEnd);
      } else if (idResult.id === TRACK_NUMBER_ID && parentId === TRACK_ENTRY_ID) {
        audioTrackNumber = 0;
        for (let i = pos; i < elementEnd; i++) {
          audioTrackNumber = audioTrackNumber * 256 + buf[i];
        }
      } else if (idResult.id === SIMPLE_BLOCK_ID || idResult.id === BLOCK_ID) {
        // Parse block header: track number (VINT) + int16 timecode + flags
        const trackVint = readVint(buf, pos);
        const trackNum = trackVint.value;
        if (trackNum === audioTrackNumber) {
          const headerLen = trackVint.length + 2 + 1; // vint + timecode(2) + flags(1)
          const frameData = buf.slice(pos + headerLen, elementEnd);
          if (frameData.length > 0) {
            const samples = getOpusPacketSamples(frameData);
            packets.push({ data: frameData, samples });
          }
        }
      }

      pos = elementEnd;
      // Handle unknown-size elements (live streams etc.) — bail out
      if (sizeResult.value >= 0x00FFFFFFFFFFFFFF) break;
    }
  }

  walk(0, buf.length);

  if (!opusHead) {
    // Build a default OpusHead if CodecPrivate is missing
    opusHead = new Uint8Array([
      0x4F, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, // "OpusHead"
      1,    // version
      1,    // channel count (mono)
      0x38, 0x01, // pre-skip = 312
      0x80, 0xBB, 0x00, 0x00, // sample rate = 48000
      0x00, 0x00, // output gain
      0,    // mapping family
    ]);
  }

  return { opusHead, packets };
}

/**
 * Determine how many 48kHz samples an Opus packet represents.
 * Opus packets are 2.5ms – 120ms; TOC byte encodes frame size.
 */
function getOpusPacketSamples(data: Uint8Array): number {
  if (data.length === 0) return 960; // fallback 20ms

  const toc = data[0];
  const config = (toc >> 3) & 0x1F;
  const code = toc & 0x03;

  let frameSizeSamples: number;
  if (config <= 11) {
    // SILK-only
    const sizes = [480, 960, 1920, 2880]; // 10, 20, 40, 60 ms at 48kHz
    frameSizeSamples = sizes[config % 4];
  } else if (config <= 15) {
    // Hybrid
    const sizes = [480, 960]; // 10, 20 ms
    frameSizeSamples = sizes[config % 2];
  } else {
    // CELT-only
    const sizes = [120, 240, 480, 960]; // 2.5, 5, 10, 20 ms
    frameSizeSamples = sizes[config % 4];
  }

  let numFrames = 1;
  if (code === 1 || code === 2) {
    numFrames = 2;
  } else if (code === 3 && data.length >= 2) {
    numFrames = data[1] & 0x3F;
  }

  return frameSizeSamples * numFrames;
}

// ─── OGG Writer ──────────────────────────────────────────────────────

function crc32Ogg(data: Uint8Array): number {
  let crc = 0;
  for (let i = 0; i < data.length; i++) {
    crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) & 0xFF) ^ data[i]]) >>> 0;
  }
  return crc;
}

const CRC_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) {
      r = (r & 0x80000000) ? ((r << 1) ^ 0x04C11DB7) : (r << 1);
      r = r >>> 0;
    }
    table.push(r);
  }
  return table;
})();

function writeOggPage(
  serialNo: number,
  pageSeqNo: number,
  granulePos: bigint,
  headerType: number,
  segments: Uint8Array[],
): Uint8Array {
  // Build segment table
  const segmentSizes: number[] = [];
  for (const seg of segments) {
    let remaining = seg.length;
    while (remaining >= 255) {
      segmentSizes.push(255);
      remaining -= 255;
    }
    segmentSizes.push(remaining);
  }

  const headerSize = 27 + segmentSizes.length;
  const bodySize = segments.reduce((s, seg) => s + seg.length, 0);
  const page = new Uint8Array(headerSize + bodySize);
  const view = new DataView(page.buffer);

  // Capture pattern "OggS"
  page[0] = 0x4F; page[1] = 0x67; page[2] = 0x67; page[3] = 0x53;
  // Version
  page[4] = 0;
  // Header type
  page[5] = headerType;
  // Granule position (64-bit LE)
  view.setBigInt64(6, granulePos, true);
  // Serial number
  view.setUint32(14, serialNo, true);
  // Page sequence number
  view.setUint32(18, pageSeqNo, true);
  // CRC (filled later)
  view.setUint32(22, 0, true);
  // Number of segments
  page[26] = segmentSizes.length;
  // Segment table
  for (let i = 0; i < segmentSizes.length; i++) {
    page[27 + i] = segmentSizes[i];
  }
  // Body
  let offset = headerSize;
  for (const seg of segments) {
    page.set(seg, offset);
    offset += seg.length;
  }

  // Compute CRC
  const crc = crc32Ogg(page);
  view.setUint32(22, crc, true);

  return page;
}

/**
 * Convert WebM/Opus bytes to OGG/Opus bytes.
 */
export function webmToOgg(webmBytes: Uint8Array): Uint8Array {
  const { opusHead, packets } = parseWebmOpus(webmBytes);
  const serialNo = (Math.random() * 0x7FFFFFFF) | 0;
  let pageSeqNo = 0;

  const pages: Uint8Array[] = [];

  // Page 0: OpusHead (BOS)
  pages.push(writeOggPage(serialNo, pageSeqNo++, 0n, 0x02, [opusHead]));

  // Page 1: OpusTags
  const vendor = new TextEncoder().encode("lovable");
  const opusTags = new Uint8Array(8 + 4 + vendor.length + 4);
  const te = new TextEncoder();
  opusTags.set(te.encode("OpusTags"), 0);
  new DataView(opusTags.buffer).setUint32(8, vendor.length, true);
  opusTags.set(vendor, 12);
  new DataView(opusTags.buffer).setUint32(12 + vendor.length, 0, true); // 0 comments
  pages.push(writeOggPage(serialNo, pageSeqNo++, 0n, 0x00, [opusTags]));

  // Audio data pages — group packets into pages of ~64KB max
  let granulePos = 0n;
  const MAX_PAGE_BODY = 60000;
  let currentSegments: Uint8Array[] = [];
  let currentBodySize = 0;

  for (const pkt of packets) {
    granulePos += BigInt(pkt.samples);

    if (currentBodySize + pkt.data.length > MAX_PAGE_BODY && currentSegments.length > 0) {
      pages.push(writeOggPage(serialNo, pageSeqNo++, granulePos, 0x00, currentSegments));
      currentSegments = [];
      currentBodySize = 0;
    }

    currentSegments.push(pkt.data);
    currentBodySize += pkt.data.length;
  }

  // Last page (EOS)
  if (currentSegments.length > 0) {
    pages.push(writeOggPage(serialNo, pageSeqNo++, granulePos, 0x04, currentSegments));
  }

  // Concatenate all pages
  const totalSize = pages.reduce((s, p) => s + p.length, 0);
  const result = new Uint8Array(totalSize);
  let offset = 0;
  for (const p of pages) {
    result.set(p, offset);
    offset += p.length;
  }

  return result;
}

/**
 * Check if bytes start with WebM/EBML magic bytes.
 */
export function isWebmContainer(bytes: Uint8Array): boolean {
  return bytes.length >= 4 &&
    bytes[0] === 0x1A && bytes[1] === 0x45 &&
    bytes[2] === 0xDF && bytes[3] === 0xA3;
}

/**
 * Check if bytes start with OGG magic "OggS".
 */
export function isOggContainer(bytes: Uint8Array): boolean {
  return bytes.length >= 4 &&
    bytes[0] === 0x4F && bytes[1] === 0x67 &&
    bytes[2] === 0x67 && bytes[3] === 0x53;
}
