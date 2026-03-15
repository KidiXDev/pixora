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
