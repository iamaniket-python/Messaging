export function createTokenBucket({ capacity, refillPerSecond }) {
  let tokens = capacity;
  let last = Date.now();

  return {
    consume() {
      const now = Date.now();
      tokens = Math.min(capacity, tokens + ((now - last) / 1000) * refillPerSecond);
      last = now;

      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    },
  };
}