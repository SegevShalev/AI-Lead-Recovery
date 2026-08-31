export function formatMoney(amount: number): string {
  return "$" + amount.toLocaleString("en-US");
}

export function formatElapsed(days: number): string {
  if (days < 30) {
    return `${days} ${days === 1 ? "day" : "days"}`;
  }
  const months = Math.round(days / 30.4);
  return `${months} ${months === 1 ? "month" : "months"}`;
}

export function initialsOf(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((word) => word[0])
    .join("");
}
