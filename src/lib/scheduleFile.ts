/**
 * Файлы с расписанием: что принимаем, как проверяем и что отправляем нейросети.
 *
 * Принимается только белый список форматов. Картинки, PDF и zip-документы
 * опознаются по содержимому, а не по расширению: программа, переименованная в
 * .png или .txt, не пройдёт (двоичные данные отклоняются). Текстовые файлы
 * принимаются только с расширениями из списка (.js, .sh, .py и т. п. — нет).
 * Ничего из загруженного не выполняется и не показывается на сайте: из HTML,
 * Word и Excel на сервере достаётся только текст, скрипты и стили вырезаются,
 * а нейросеть получает всё как данные.
 */

import "server-only";

import { inflateRawSync } from "node:zlib";

import { sniffImage } from "@/core/avatar";

/** Каждый файл — до 1 МБ, как и скриншот после сжатия. */
export const FILE_MAX_BYTES = 1024 * 1024;
/** Сколько текста из одного файла отдаём модели. Расписание заметно меньше. */
const TEXT_MAX_CHARS = 60_000;
/** Защита от zip-бомб: сколько байт можно распаковать из одного docx/xlsx. */
const UNZIP_MAX_BYTES = 8 * 1024 * 1024;

export type ScheduleFileKind = "image" | "pdf" | "text";

export type PreparedFile =
  | { kind: "image"; name: string; dataUrl: string }
  | { kind: "pdf"; name: string; dataUrl: string }
  | { kind: "text"; name: string; format: string; text: string };

export type FileProblem = "format" | "too_large" | "empty";

const TEXT_EXTENSIONS = new Set(["txt", "csv", "tsv", "ics", "md", "json", "html", "htm", "xml"]);

function extensionOf(name: string): string {
  const match = /\.([a-z0-9]{1,8})$/i.exec(name.trim());
  return match ? match[1].toLowerCase() : "";
}

function cleanName(name: string): string {
  return (
    name
      .replace(/[^\p{L}\p{N} ._()-]/gu, "_")
      .trim()
      .slice(0, 80) || "file"
  );
}

// ---------------------------------------------------------------------------
// Текст
// ---------------------------------------------------------------------------

/** Декодировать как UTF-8; нулевые байты означают двоичный файл, а не текст. */
function decodeText(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // Не UTF-8 — чаще всего Windows-1251 у старых выгрузок.
    try {
      text = new TextDecoder("windows-1251").decode(bytes);
    } catch {
      return null;
    }
  }
  return text.replace(new RegExp("^" + String.fromCharCode(0xfeff)), "");
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const value = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(value) && value > 31 && value < 0x110000 ? String.fromCodePoint(value) : " ";
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

function tidy(text: string): string {
  const controls = new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(8)}${String.fromCharCode(11)}${String.fromCharCode(12)}${String.fromCharCode(14)}-${String.fromCharCode(31)}]`, "g");
  return text
    .replace(controls, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, TEXT_MAX_CHARS);
}

/**
 * Текст из HTML: скрипты, стили и комментарии выбрасываются целиком, ячейки
 * таблицы разделяются « | », строки таблицы и блоки — переводами строк.
 */
export function htmlToText(html: string): string {
  const withoutCode = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg|iframe|object|embed)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(script|style|noscript|template|svg|iframe|object|embed)\b[^>]*\/?>/gi, " ");
  const structured = withoutCode
    .replace(/<\/(td|th)\s*>/gi, " | ")
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/(tr|p|div|li|h[1-6]|section|article|header|footer|table|thead|tbody|ul|ol)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return tidy(decodeEntities(structured));
}

// ---------------------------------------------------------------------------
// ZIP (docx, xlsx)
// ---------------------------------------------------------------------------

/** Прочитать нужные записи zip-архива. Только stored и deflate, с лимитом на распаковку. */
export function readZipEntries(buffer: Buffer, wanted: (name: string) => boolean): Map<string, Buffer> {
  const result = new Map<string, Buffer>();
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0 || eocd + 22 > buffer.length) return result;

  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  let unpacked = 0;

  for (let index = 0; index < count && offset + 46 <= buffer.length; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    offset += 46 + nameLength + extraLength + commentLength;

    if (!wanted(name)) continue;
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) continue;
    const dataStart =
      localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const data = buffer.subarray(dataStart, dataStart + compressedSize);

    unpacked += size;
    if (size > UNZIP_MAX_BYTES || unpacked > UNZIP_MAX_BYTES) break;
    try {
      if (method === 0) result.set(name, Buffer.from(data));
      else if (method === 8) result.set(name, inflateRawSync(data, { maxOutputLength: UNZIP_MAX_BYTES }));
    } catch {
      // Битая запись — просто пропускаем.
    }
  }
  return result;
}

/** Текст документа Word: абзацы — строки, табуляции и ячейки таблиц — разделители. */
export function docxToText(buffer: Buffer): string | null {
  const entries = readZipEntries(buffer, (name) => name === "word/document.xml");
  const xml = entries.get("word/document.xml")?.toString("utf8");
  if (!xml) return null;
  const text = xml
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<\/w:tc>/g, " | ")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<\/w:tr>/g, "\n")
    .replace(/<[^>]+>/g, "");
  return tidy(decodeEntities(text));
}

/**
 * Ячейки листов Excel построчно через « | ». Числа оставляются как есть:
 * время в Excel — доля суток (0.375 = 09:00), модель об этом предупреждена.
 */
export function xlsxToText(buffer: Buffer): string | null {
  const entries = readZipEntries(
    buffer,
    (name) => name === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(name),
  );
  const sheets = [...entries.keys()].filter((name) => name.startsWith("xl/worksheets/")).sort();
  if (sheets.length === 0) return null;

  const shared: string[] = [];
  const sharedXml = entries.get("xl/sharedStrings.xml")?.toString("utf8") ?? "";
  for (const match of sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    const parts = [...match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((part) => part[1]);
    shared.push(decodeEntities(parts.join("")));
  }

  const lines: string[] = [];
  for (const sheet of sheets.slice(0, 5)) {
    const xml = entries.get(sheet)!.toString("utf8");
    for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const cell of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cell[1];
        const body = cell[2] ?? "";
        const value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        const inline = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((part) => part[1]).join("");
        let text = "";
        if (/\bt="s"/.test(attrs) && value !== undefined) text = shared[Number(value)] ?? "";
        else if (/\bt="inlineStr"/.test(attrs)) text = decodeEntities(inline);
        else if (value !== undefined) text = decodeEntities(value);
        cells.push(text.trim());
      }
      if (cells.some(Boolean)) lines.push(cells.join(" | "));
    }
    lines.push("");
  }
  return tidy(lines.join("\n"));
}

// ---------------------------------------------------------------------------
// Классификация
// ---------------------------------------------------------------------------

function isPdf(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-";
}

function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/**
 * Проверить файл и подготовить его к отправке модели.
 *
 * Картинки уже сжаты браузером; документы идут как есть, до 1 МБ.
 */
export function prepareScheduleFile(
  name: string,
  bytes: Uint8Array,
): { ok: true; file: PreparedFile } | { ok: false; error: FileProblem } {
  if (bytes.length === 0) return { ok: false, error: "empty" };
  if (bytes.length > FILE_MAX_BYTES) return { ok: false, error: "too_large" };

  const safeName = cleanName(name);
  const extension = extensionOf(name);
  const buffer = Buffer.from(bytes);

  const image = sniffImage(bytes);
  if (image) {
    return { ok: true, file: { kind: "image", name: safeName, dataUrl: `data:${image};base64,${buffer.toString("base64")}` } };
  }
  if (isPdf(bytes)) {
    return { ok: true, file: { kind: "pdf", name: safeName, dataUrl: `data:application/pdf;base64,${buffer.toString("base64")}` } };
  }
  if (isZip(bytes)) {
    const text = extension === "xlsx" ? xlsxToText(buffer) : extension === "docx" ? docxToText(buffer) : null;
    if (!text) return { ok: false, error: extension === "xlsx" || extension === "docx" ? "empty" : "format" };
    return { ok: true, file: { kind: "text", name: safeName, format: extension, text } };
  }

  // Текстовые форматы — только по белому списку расширений: .js, .sh, .py и т. п.
  // тоже текст, но это код, а не расписание.
  if (!TEXT_EXTENSIONS.has(extension)) return { ok: false, error: "format" };
  const decoded = decodeText(bytes);
  if (decoded === null) return { ok: false, error: "format" };
  const text = extension === "html" || extension === "htm" || /^\s*<(!doctype html|html)\b/i.test(decoded)
    ? htmlToText(decoded)
    : tidy(decoded);
  if (!text) return { ok: false, error: "empty" };
  return { ok: true, file: { kind: "text", name: safeName, format: extension, text } };
}

/** Что показать в поле выбора файла. Проверка всё равно на сервере. */
export const ACCEPT_ATTRIBUTE =
  "image/png,image/jpeg,image/webp,application/pdf,.pdf,.html,.htm,.txt,.csv,.tsv,.ics,.md,.json,.xml,.docx,.xlsx";
