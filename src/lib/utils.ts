import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDuration(hours: number) {
  const absHours = Math.abs(hours);
  if (absHours >= 1) {
    return `${absHours.toFixed(1)} hrs`;
  }
  const mins = Math.round(absHours * 60);
  return `${mins} mins`;
}
export function formatNum(num: number | string | null | undefined): string {
  if (num === null || num === undefined) return "0";
  const parsed = typeof num === 'string' ? parseFloat(num) : num;
  if (isNaN(parsed)) return "0";
  return new Intl.NumberFormat("en-US").format(parsed);
}
