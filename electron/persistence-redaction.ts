/** Credentials are never part of engineering or conversation persistence. */
export function redactPersistence<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (key, item: unknown) => {
    if (/^(api[-_]?key|authorization|credential|password|access[-_]?token|secret)$/i.test(key)) return undefined;
    if (typeof item === "string") return item
      .replace(/\bsk-[A-Za-z0-9_-]+/g, "[REDACTED]")
      .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
      .replace(/(api[-_ ]?key\s*[:=]\s*)[^\s,;"}]+/gi, "$1[REDACTED]");
    return item;
  })) as T;
}
