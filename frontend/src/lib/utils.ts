import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getBaseName(path: string): string {
  if (!path) {
    return 'Image';
  }

  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] || 'Image';
}

/**
 * Filters a string to only include numeric characters.
 * @param value The raw input string
 * @param allowFloat Whether to allow a single decimal point
 */
export function filterNumeric(value: string, allowFloat = false): string {
  if (allowFloat) {
    // Keep only numbers and dots, then ensure only one dot remains
    const cleaned = value.replace(/[^0-9.]/g, '');
    const dotIndex = cleaned.indexOf('.');
    if (dotIndex !== -1) {
      return (
        cleaned.slice(0, dotIndex + 1) +
        cleaned.slice(dotIndex + 1).replace(/\./g, '')
      );
    }
    return cleaned;
  }
  return value.replace(/[^0-9]/g, '');
}

/**
 * Parses a string to a number, returning 0 for empty or invalid inputs.
 */
export function parseNumeric(value: string): number {
  if (!value || value === '.') return 0;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatNumber(num: number) {
  if (num >= 1_000_000_000) {
    return (num / 1_000_000_000).toFixed(1).replace(/\.0$/, '') + 'B';
  }
  if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (num >= 1_000) {
    return (num / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  }
  return num.toString();
}
