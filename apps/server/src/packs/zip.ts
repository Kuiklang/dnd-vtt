import { inflateRawSync } from "node:zlib";

/**
 * A small, strict ZIP reader for campaign packs: reads the central directory and
 * returns every file's bytes. Supports the two methods every zip tool writes by
 * default (0 = stored, 8 = deflate). No zip64, no encryption, no multi-disk.
 *
 * Limits guard against zip bombs: total uncompressed size and entry count are capped,
 * and each entry's inflated size must match what the directory promised.
 */
export interface ZipLimits {
  maxEntries: number;
  maxTotalBytes: number;
  maxEntryBytes: number;
}

export class ZipError extends Error {}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

export function readZip(buf: Buffer, limits: ZipLimits): Map<string, Buffer> {
  // The end-of-central-directory record sits in the last 22 + up to 65535 (comment) bytes.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError("This file isn't a .zip archive");
  const count = buf.readUInt16LE(eocd + 10);
  const cenSize = buf.readUInt32LE(eocd + 12);
  const cenOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cenOffset === 0xffffffff) throw new ZipError("Zip64 archives aren't supported");
  if (count > limits.maxEntries) throw new ZipError(`Too many files in the archive (max ${limits.maxEntries})`);
  if (cenOffset + cenSize > buf.length) throw new ZipError("The archive is damaged");

  const files = new Map<string, Buffer>();
  let total = 0;
  let p = cenOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CEN_SIG) throw new ZipError("The archive is damaged");
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    // Bit 11 = UTF-8 names; older tools write CP437, which is ASCII for our purposes.
    const name = buf.toString(flags & 0x800 ? "utf8" : "latin1", p + 46, p + 46 + nameLen).replace(/\\/g, "/");
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue; // directory entry
    if (flags & 0x1) throw new ZipError("Encrypted archives aren't supported");
    if (size > limits.maxEntryBytes) throw new ZipError(`"${name}" is too large`);
    total += size;
    if (total > limits.maxTotalBytes) throw new ZipError("The archive is too large once unpacked");

    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== LOC_SIG) throw new ZipError("The archive is damaged");
    const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const raw = buf.subarray(dataStart, dataStart + compSize);
    if (raw.length !== compSize) throw new ZipError("The archive is damaged");
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) {
      try {
        data = inflateRawSync(raw, { maxOutputLength: Math.max(1, size) });
      } catch {
        throw new ZipError(`Couldn't unpack "${name}"`);
      }
    } else throw new ZipError(`"${name}" uses an unsupported compression method`);
    if (data.length !== size) throw new ZipError(`"${name}" is damaged`);
    files.set(normalizePath(name), data);
  }
  return files;
}

/** Pack-relative path: forward slashes, no leading "./" or "/", no "..". */
export function normalizePath(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/").filter((s) => s && s !== ".");
  if (parts.some((s) => s === "..")) throw new ZipError(`Bad path in archive: ${p}`);
  return parts.join("/");
}
