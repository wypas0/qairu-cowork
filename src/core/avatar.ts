/**
 * Проверка загружаемого фото профиля. Чистая функция — одинаково работает в
 * обработчике и в тестах.
 *
 * Тип определяется по первым байтам файла, а не по тому, что прислал браузер:
 * подписать HTML или SVG как image/png ничего не стоит, а отдать такое со
 * своего домена — значит выполнить чужой скрипт.
 */

/** Потолок после сжатия в браузере (256×256). С большим запасом, но не мегабайты. */
export const AVATAR_MAX_BYTES = 200 * 1024;

export type AvatarMime = "image/jpeg" | "image/png" | "image/webp";

export type AvatarUpload = { mime: AvatarMime; base64: string; bytes: number };

export type AvatarProblem = "format" | "too_large" | "empty";

/** Тип картинки по сигнатуре или null, если это не JPEG, PNG или WebP. */
export function sniffImage(bytes: Uint8Array): AvatarMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/** Разобрать `data:image/...;base64,...` из браузера. */
export function parseAvatarDataUrl(
  dataUrl: unknown,
): { ok: true; value: AvatarUpload } | { ok: false; error: AvatarProblem } {
  if (typeof dataUrl !== "string" || !dataUrl) return { ok: false, error: "empty" };
  const match = /^data:[\w/+.-]*;base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) return { ok: false, error: "format" };

  // Проверяем длину до декодирования: не распаковываем мегабайты впустую.
  if ((match[1].length * 3) / 4 > AVATAR_MAX_BYTES + 3) return { ok: false, error: "too_large" };
  const bytes = Uint8Array.from(Buffer.from(match[1], "base64"));
  if (bytes.length === 0) return { ok: false, error: "empty" };
  if (bytes.length > AVATAR_MAX_BYTES) return { ok: false, error: "too_large" };

  const mime = sniffImage(bytes);
  if (!mime) return { ok: false, error: "format" };
  return { ok: true, value: { mime, base64: Buffer.from(bytes).toString("base64"), bytes: bytes.length } };
}
