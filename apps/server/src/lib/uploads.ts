import fs from "node:fs";
import path from "node:path";
import type { Env } from "./env.ts";
import { HttpError, badRequest } from "./errors.ts";
import { newId } from "./ids.ts";

export type UploadMediaType = "image/jpeg" | "image/png" | "image/webp";
export const IMAGE_MEDIA_TYPES: readonly UploadMediaType[] = ["image/jpeg", "image/png", "image/webp"];
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

const EXTENSIONS: Record<UploadMediaType, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MEDIA_BY_EXTENSION: Record<string, UploadMediaType> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

export interface SavedUpload {
  /** Served path, e.g. /uploads/meals/<id>.jpg */
  path: string;
  /** Absolute path on disk */
  abs: string;
  id: string;
  mediaType: UploadMediaType;
  bytes: number;
}

/** Detect the image type from its leading bytes rather than trusting the client's content type. */
export function sniffMediaType(buf: Uint8Array): UploadMediaType | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return "image/png";
  if (buf.length >= 12 && ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 12) === "WEBP") return "image/webp";
  return null;
}

function ascii(buf: Uint8Array, from: number, to: number): string {
  return String.fromCharCode(...buf.subarray(from, to));
}

/** Validate and store an uploaded image as-is under uploads/<subdir>/<id>.<ext>. */
export async function saveUpload(env: Env, subdir: string, file: Blob, allowed: readonly UploadMediaType[] = IMAGE_MEDIA_TYPES, id = newId()): Promise<SavedUpload> {
  if (!/^[a-z0-9-]+$/.test(subdir)) throw new Error(`Invalid upload subdir: ${subdir}`);
  if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, `Image is too large. The limit is ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`);
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length === 0) throw badRequest("The uploaded file is empty.");
  const mediaType = sniffMediaType(buf);
  if (!mediaType || !allowed.includes(mediaType)) throw new HttpError(415, "Unsupported image type. Upload a JPEG, PNG or WebP file.");
  const dir = path.join(env.uploadsDir, subdir);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${id}.${EXTENSIONS[mediaType]}`;
  const abs = path.join(dir, name);
  fs.writeFileSync(abs, buf);
  return { path: `/uploads/${subdir}/${name}`, abs, id, mediaType, bytes: buf.length };
}

/** Map a served /uploads/... path back to a file inside uploadsDir. Rejects anything that escapes it. */
export function resolveUploadPath(env: Env, servedPath: string): string {
  if (!servedPath.startsWith("/uploads/")) throw badRequest("Expected a path under /uploads/.");
  const rel = servedPath.slice("/uploads/".length);
  const abs = path.resolve(env.uploadsDir, rel);
  const root = path.resolve(env.uploadsDir) + path.sep;
  if (!abs.startsWith(root)) throw badRequest("Invalid upload path.");
  return abs;
}

export function readUploadBase64(env: Env, servedPath: string): { base64: string; mediaType: UploadMediaType } {
  const abs = resolveUploadPath(env, servedPath);
  if (!fs.existsSync(abs)) throw new HttpError(404, "Image not found.");
  const buf = fs.readFileSync(abs);
  const ext = path.extname(abs).slice(1).toLowerCase();
  const mediaType = sniffMediaType(buf) ?? MEDIA_BY_EXTENSION[ext];
  if (!mediaType) throw new HttpError(415, "Stored file is not a supported image.");
  return { base64: buf.toString("base64"), mediaType };
}

export function deleteUpload(env: Env, servedPath: string): void {
  let abs: string;
  try {
    abs = resolveUploadPath(env, servedPath);
  } catch {
    return;
  }
  fs.rmSync(abs, { force: true });
}
