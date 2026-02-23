function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

interface VisualTheme {
  tileClassName: string;
  swatchClassName: string;
}

function solidTheme(
  tileClassName: string,
  swatchClassName: string,
): VisualTheme {
  return {
    tileClassName,
    swatchClassName,
  };
}

function patternedTheme(): VisualTheme {
  return {
    tileClassName:
      "bg-[#f7efe7] border-[#c7a27d] border-dashed bg-[repeating-linear-gradient(45deg,rgba(122,75,42,0.08)_0_6px,rgba(255,255,255,0.15)_6px_12px)]",
    swatchClassName:
      "bg-[#7a4b2a] bg-[repeating-linear-gradient(45deg,rgba(255,255,255,0.35)_0_2px,rgba(122,75,42,0.12)_2px_4px)]",
  };
}

export function getProductVisualTheme(
  _category: string | null | undefined,
  color: string | null | undefined,
): VisualTheme {
  const normalized = normalizeText(color);

  if (!normalized) {
    return solidTheme("bg-[#f3ead7] border-[#e1c89e]", "bg-[#cba678]");
  }

  if (
    normalized.includes("animal") ||
    normalized.includes("estamp") ||
    normalized.includes("raya")
  ) {
    return patternedTheme();
  }

  if (
    normalized.includes("dorado") ||
    normalized.includes("plata") ||
    normalized.includes("plateado")
  ) {
    return solidTheme("bg-[#f0f2f6] border-[#bcc1cb]", "bg-[#8e95a5]");
  }

  if (
    normalized.includes("negro") ||
    normalized.includes("negra") ||
    normalized.includes("antracita")
  ) {
    return solidTheme("bg-[#e6e8ee] border-[#778091]", "bg-[#222831]");
  }

  if (
    normalized.includes("blue jean") ||
    normalized.includes("jean") ||
    normalized.includes("azul") ||
    normalized.includes("marino")
  ) {
    return solidTheme("bg-[#e0eeff] border-[#80acef]", "bg-[#2d63c8]");
  }

  if (
    normalized.includes("rosado") ||
    normalized.includes("rosada") ||
    normalized.includes("rosa") ||
    normalized.includes("lila")
  ) {
    return solidTheme("bg-[#ffe3ef] border-[#efa4c7]", "bg-[#db5e98]");
  }

  if (normalized.includes("rojo")) {
    return solidTheme("bg-[#ffe2de] border-[#ed9288]", "bg-[#d64339]");
  }

  if (normalized.includes("verde") || normalized.includes("oliva")) {
    return solidTheme("bg-[#e5f4e4] border-[#8dc18f]", "bg-[#2f8a45]");
  }

  if (
    normalized.includes("marron") ||
    normalized.includes("brown") ||
    normalized.includes("mostaza") ||
    normalized.includes("naranja") ||
    normalized.includes("amarillo") ||
    normalized.includes("khaki") ||
    normalized.includes("caqui")
  ) {
    return solidTheme("bg-[#fff0da] border-[#e6b36f]", "bg-[#c87a21]");
  }

  if (
    normalized.includes("blanco") ||
    normalized.includes("blanca") ||
    normalized.includes("hueso") ||
    normalized.includes("crema") ||
    normalized.includes("beige") ||
    normalized.includes("arena")
  ) {
    return solidTheme("bg-[#fff8ea] border-[#e4cfaa]", "bg-[#dcc39a]");
  }

  if (normalized.includes("gris")) {
    return solidTheme("bg-[#eceef3] border-[#b4bcc9]", "bg-[#7f8aa0]");
  }

  return solidTheme("bg-[#f3ead7] border-[#e1c89e]", "bg-[#cba678]");
}
