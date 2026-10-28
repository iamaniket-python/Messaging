const MAX_DEPTH = 20;

// Postgres text columns mein NUL (\u0000) store nahi ho sakta (error 22021 => 500). Pehle hi reject karo.
export function containsNullByte(value, depth = 0) {
  if (depth > MAX_DEPTH) return false;
  if (typeof value === 'string') return value.includes('\u0000');
  if (Array.isArray(value)) return value.some((item) => containsNullByte(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.entries(value).some(
      ([key, item]) => containsNullByte(key, depth + 1) || containsNullByte(item, depth + 1)
    );
  }
  return false;
}