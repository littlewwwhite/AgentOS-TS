// input: Class name arguments (strings, conditionals, arrays)
// output: Merged, deduplicated Tailwind class string
// pos: Core utility — used by all UI components for className composition

import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
