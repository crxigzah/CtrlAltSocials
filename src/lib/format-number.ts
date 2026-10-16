/** 1,284 / 12.9K / 4.2M: compact for headline numbers. */
export function compact(n: number) {
  return new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function full(n: number) {
  return new Intl.NumberFormat("en-GB").format(n);
}
