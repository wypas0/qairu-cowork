/** Две первые буквы имени: «Асель» → «Ас», «@asel_n» → «As» — как кружки людей на доске. */
export function initials(name: string): string {
  const word = name.replace(/^@/, "").trim().split(/\s+/)[0] ?? "";
  const letters = [...word];
  return letters.length === 0 ? "?" : letters[0]!.toUpperCase() + (letters[1] ?? "").toLowerCase();
}
