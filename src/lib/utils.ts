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