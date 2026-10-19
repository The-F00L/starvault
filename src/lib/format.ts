const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const full = new Intl.NumberFormat("en");

export const compactNumber = (n: number) => compact.format(n).toLowerCase();
export const fullNumber = (n: number) => full.format(n);

const DAY = 86_400_000;

export function relativeTime(iso: string, now = Date.now()): string {
  const diff = now - new Date(iso).getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(diff / DAY);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30.44);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.round((days / 365.25) * 10) / 10;
  return `${years} yr${years === 1 ? "" : "s"} ago`;
}

export function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en", { month: "short", day: "2-digit", year: "numeric" });
}
