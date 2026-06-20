export const FNV_OFFSET_BASIS = 2166136261;
export const HASH_SEPARATOR_CHAR_CODE = 0x3a; // ':'

const FNV_PRIME = 16777619;

export function mixStringIntoHash(hash: number, segment: string): number {
  for (let index = 0; index < segment.length; index += 1) {
    hash = mixByteIntoHash(hash, segment.charCodeAt(index));
  }
  return hash;
}

export function mixByteIntoHash(hash: number, byte: number): number {
  hash ^= byte;
  return Math.imul(hash, FNV_PRIME);
}

export function finishHash(hash: number): number {
  return hash >>> 0;
}
