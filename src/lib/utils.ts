import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** One number the way the page's language writes it: 118.8 / 118.8 (figures stay Latin, like the carton). */
export function formatNumber(value: number, digits = 1) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(value);
}
