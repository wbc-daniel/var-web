import { parseVarJson } from './parser.js';
import type { VectorAnimation } from '../model/types.js';

/** Magic header bytes for binary .var files: ASCII "VAB" + 0x01. */
const VAR_MAGIC = new Uint8Array([0x56, 0x41, 0x42, 0x01]);

/**
 * Loads and parses .var and .var.json animation files.
 *
 * Binary .var files use gzip compression prefixed with a 4-byte magic header
 * (VAB\x01). Decompression requires the native DecompressionStream API
 * (browsers, Node 18+).
 */
export class VarLoader {
  /**
   * Fetches a .var or .var.json file from a URL and parses it.
   * Auto-detects binary vs text format.
   */
  static async fromUrl(url: string): Promise<VectorAnimation> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`VarLoader.fromUrl: ${response.status} ${response.statusText} (${url})`);
    }
    // response.arrayBuffer() guarantees a plain ArrayBuffer (not SharedArrayBuffer).
    const bytes = new Uint8Array(await response.arrayBuffer());
    return VarLoader.fromBytes(bytes);
  }

  /**
   * Parses raw bytes — either a binary .var (gzip + magic header) or a
   * UTF-8 encoded .var.json.
   */
  static async fromBytes(bytes: Uint8Array<ArrayBuffer>): Promise<VectorAnimation> {
    if (isBinaryVar(bytes)) {
      const compressed = bytes.slice(VAR_MAGIC.length);
      const json = await gunzip(compressed);
      return parseVarJson(json);
    }
    return parseVarJson(new TextDecoder().decode(bytes));
  }

  /**
   * Parses a pre-loaded .var.json string.
   * Synchronous — does not handle binary format.
   */
  static fromJsonString(raw: string): VectorAnimation {
    return parseVarJson(raw);
  }

  /**
   * Parses a pre-decoded JSON object.
   * Synchronous — does not handle binary format.
   */
  static fromJson(obj: unknown): VectorAnimation {
    return parseVarJson(obj);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isBinaryVar(bytes: Uint8Array): boolean {
  if (bytes.length < VAR_MAGIC.length) return false;
  for (let i = 0; i < VAR_MAGIC.length; i++) {
    if (bytes[i] !== VAR_MAGIC[i]) return false;
  }
  return true;
}

async function gunzip(compressed: Uint8Array<ArrayBuffer>): Promise<string> {
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  writer.write(compressed);
  writer.close();
  return new Response(ds.readable).text();
}
