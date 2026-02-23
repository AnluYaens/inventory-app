function normalizeCategory(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function getCategoryIcon(category: string | null | undefined): string {
  const normalized = normalizeCategory(category);

  if (!normalized) return "📦";
  if (normalized === "faldas") return "👗";
  if (normalized === "vestidos") return "👗";
  if (normalized === "camisas") return "👚";
  if (normalized === "pantalones") return "👖";
  if (normalized === "bermudas shorts") return "🩳";
  if (normalized === "zapatos") return "👠";
  if (normalized === "accesorios") return "👜";
  if (normalized === "monederos") return "👛";
  if (normalized === "perfumes") return "🧴";
  if (normalized === "maquillaje") return "💄";
  if (normalized === "lenceria") return "🩱";
  if (normalized === "chaquetas") return "🧥";

  return "📦";
}

