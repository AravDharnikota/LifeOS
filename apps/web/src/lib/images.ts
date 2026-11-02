import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { isNative } from "./platform";

export interface PickedImage {
  base64: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  dataUrl: string;
  width: number;
  height: number;
}

/** Downscale any image source to at most `max` px on the long edge and re-encode as JPEG. */
export async function downscale(src: Blob | string, max = 1280, quality = 0.86): Promise<PickedImage> {
  const url = typeof src === "string" ? src : URL.createObjectURL(src);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.drawImage(img, 0, 0, w, h);
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    return { base64: dataUrl.split(",")[1] ?? "", mediaType: "image/jpeg", dataUrl, width: w, height: h };
  } finally {
    if (typeof src !== "string") URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Unable to read the image"));
    img.src = url;
  });
}

/**
 * Take or choose a photo. Native: Capacitor Camera (camera or photo library). Web: file input
 * (`capture` hint for the camera on mobile browsers). Resolves null when the user cancels.
 */
export async function pickImage(source: "camera" | "library" | "prompt" = "prompt", max = 1280): Promise<PickedImage | null> {
  if (isNative) {
    try {
      const photo = await Camera.getPhoto({
        resultType: CameraResultType.DataUrl,
        source: source === "camera" ? CameraSource.Camera : source === "library" ? CameraSource.Photos : CameraSource.Prompt,
        quality: 90,
        width: max,
        height: max,
        correctOrientation: true,
      });
      if (!photo.dataUrl) return null;
      return downscale(photo.dataUrl, max);
    } catch (e) {
      if (e instanceof Error && /cancel/i.test(e.message)) return null;
      throw e;
    }
  }
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    if (source === "camera") input.capture = "environment";
    input.style.display = "none";
    document.body.appendChild(input);
    const cleanup = () => input.remove();
    input.onchange = async () => {
      const file = input.files?.[0];
      cleanup();
      if (!file) return resolve(null);
      try {
        resolve(await downscale(file, max));
      } catch (e) {
        reject(e);
      }
    };
    input.oncancel = () => {
      cleanup();
      resolve(null);
    };
    input.click();
  });
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, data] = dataUrl.split(",");
  const mime = /data:(.*?);/.exec(head ?? "")?.[1] ?? "image/jpeg";
  const bin = atob(data ?? "");
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
