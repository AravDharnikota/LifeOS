export interface Attachment {
  id: string;
  base64: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  dataUrl: string;
}

const MAX_EDGE = 1280;

/** Downscale to 1280px on the long edge and re-encode as JPEG. Returns a base64 payload and a preview URL. */
export async function prepareImage(file: File): Promise<Attachment> {
  const bitmap = await loadImage(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Unable to read the image");
  ctx.drawImage(bitmap, 0, 0, w, h);
  if ("close" in bitmap) bitmap.close();
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return { id: Math.random().toString(36).slice(2, 10), base64: dataUrl.slice(dataUrl.indexOf(",") + 1), mediaType: "image/jpeg", dataUrl };
}

async function loadImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      /* fall through */
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Unable to read the image"));
    };
    img.src = url;
  });
}
