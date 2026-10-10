/** Lossless transport decoding. Every value was captured by the native worker. */
export function expandNativeResponses(members: unknown): void {
  if (!Array.isArray(members)) return;
  for (const member of members) {
    if (!member || member.responseEncoding === undefined) continue;
    if (member.responseEncoding === "tuples-v1") {
      if (!Array.isArray(member.nativeResponses) || member.nativeResponses.length !== 17) throw new Error("原生沿杆编码无效");
      member.nativeResponses = member.nativeResponses.map((sample: unknown) => {
        if (!Array.isArray(sample) || sample.length !== 13 || !sample.every((x) => typeof x === "number" && Number.isFinite(x))) throw new Error("原生沿杆编码分量无效");
        return { position: sample[0], forces: sample.slice(1, 7),
          localDisplacement: { x: sample[7], y: sample[8], z: sample[9] },
          globalDisplacement: { x: sample[10], y: sample[11], z: sample[12] } };
      });
      delete member.responseEncoding;
      return;
    }
    if (member.responseEncoding !== "tuples-f64-v1" || typeof member.nativeResponsesBase64 !== "string") throw new Error("原生沿杆编码无效");
    const encoded = member.nativeResponsesBase64;
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error("原生沿杆 Base64 编码无效");
    const binary = atob(encoded);
    const tupleWidth = 13 * Float64Array.BYTES_PER_ELEMENT;
    if (binary.length !== 17 * tupleWidth) throw new Error("原生沿杆 Base64 长度无效");
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const values = new Float64Array(bytes.buffer);
    const finite = (value: number) => Number.isFinite(value);
    member.nativeResponses = Array.from({ length: 17 }, (_, station) => {
      const offset = station * 13;
      const sample = Array.from(values.slice(offset, offset + 13));
      if (sample.length !== 13 || !sample.every(finite)) throw new Error("原生沿杆 Base64 分量无效");
      return { position: sample[0], forces: sample.slice(1, 7),
        localDisplacement: { x: sample[7], y: sample[8], z: sample[9] },
        globalDisplacement: { x: sample[10], y: sample[11], z: sample[12] } };
    });
    delete member.responseEncoding;
    delete member.nativeResponsesBase64;
  }
}

export function expandNativeVector(value: unknown, expectedLength: number): number[] {
  if (Array.isArray(value)) {
    if (value.length !== expectedLength || !value.every((x) => typeof x === "number" && Number.isFinite(x))) throw new Error("原生向量编码无效");
    return [...value];
  }
  if (!value || typeof value !== "object" || (value as Record<string, unknown>).encoding !== "vector-f64-v1") throw new Error("原生向量编码无效");
  const record = value as Record<string, unknown>, count = record.count;
  if (count !== expectedLength || typeof record.data !== "string" || !Number.isSafeInteger(count)) throw new Error("原生向量编码无效");
  const encoded = record.data;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error("原生向量 Base64 编码无效");
  const binary = atob(encoded), byteLength = expectedLength * Float64Array.BYTES_PER_ELEMENT;
  if (binary.length !== byteLength) throw new Error("原生向量 Base64 长度无效");
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const values = Array.from(new Float64Array(bytes.buffer));
  if (!values.every((x) => Number.isFinite(x))) throw new Error("原生向量 Base64 分量无效");
  return values;
}
