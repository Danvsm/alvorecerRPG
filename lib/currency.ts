const BR_VALUE = /^[+-]?(?:\d{1,3}(?:\.\d{3})*|\d+)(?:,\d{1,2})?$/;

export function parseDracmas(value: string, allowNegative = false) {
  const normalized = value.trim().replace(/\s+/g, "");
  if (!BR_VALUE.test(normalized))
    throw new Error("Informe o valor no formato brasileiro, por exemplo 25,50");
  const negative = normalized.startsWith("-");
  if (negative && !allowNegative)
    throw new Error("Informe um valor maior que zero");
  const unsigned = normalized.replace(/^[+-]/, "").replace(/\./g, "");
  const [whole, fraction = ""] = unsigned.split(",");
  const cents = BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
  const signed = negative ? -cents : cents;
  if (
    signed > BigInt(Number.MAX_SAFE_INTEGER) ||
    signed < BigInt(Number.MIN_SAFE_INTEGER)
  )
    throw new Error("Valor muito alto");
  return Number(signed);
}

export function formatDracmas(
  value: number | string | bigint | null | undefined,
) {
  let cents = BigInt(value || 0);
  const negative = cents < 0;
  if (negative) cents = -cents;
  const whole = cents / 100n;
  const fraction = String(cents % 100n).padStart(2, "0");
  return `${negative ? "-" : ""}${whole.toLocaleString("pt-BR")},${fraction} Dracmas`;
}
