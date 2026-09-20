const WEBM_HEADER = [0x1a, 0x45, 0xdf, 0xa3];
const WEBM_CLUSTER = [0x1f, 0x43, 0xb6, 0x75];

function matches(data: Uint8Array, offset: number, pattern: number[]) {
  return pattern.every((byte, index) => data[offset + index] === byte);
}

function vintLength(first: number) {
  for (let length = 1; length <= 8; length++) {
    if (first & (1 << (8 - length))) return length;
  }
  return 0;
}

function readVint(data: Uint8Array, offset: number, keepMarker = false) {
  if (offset >= data.length) return null;
  const length = vintLength(data[offset]);
  if (!length || offset + length > data.length) return null;
  const marker = 1 << (8 - length);
  let value = keepMarker ? data[offset] : data[offset] & (marker - 1);
  for (let index = 1; index < length; index++) {
    value = value * 256 + data[offset + index];
  }
  const unknown = !keepMarker && value === 2 ** (7 * length) - 1;
  return { value: unknown ? Number.POSITIVE_INFINITY : value, length };
}

function readUnsigned(data: Uint8Array, offset: number, length: number) {
  if (length < 1 || length > 8 || offset + length > data.length) return null;
  let value = 0;
  for (let index = 0; index < length; index++) {
    value = value * 256 + data[offset + index];
  }
  return Number.isSafeInteger(value) ? value : null;
}

function webmDuration(data: Uint8Array) {
  if (!matches(data, 0, WEBM_HEADER))
    throw new Error("Cabeçalho WebM inválido");
  let timecodeScale = 1_000_000;

  for (let offset = 0; offset + 4 < data.length; offset++) {
    if (!matches(data, offset, [0x2a, 0xd7, 0xb1])) continue;
    const size = readVint(data, offset + 3);
    if (!size || !Number.isFinite(size.value)) continue;
    const value = readUnsigned(data, offset + 3 + size.length, size.value);
    if (value && value <= 1_000_000_000) {
      timecodeScale = value;
      break;
    }
  }

  let maximumTimecode = -1;
  for (let offset = 0; offset + 5 < data.length; offset++) {
    if (!matches(data, offset, WEBM_CLUSTER)) continue;
    const size = readVint(data, offset + 4);
    if (!size) continue;
    const bodyStart = offset + 4 + size.length;
    const bodyEnd = Number.isFinite(size.value)
      ? Math.min(data.length, bodyStart + size.value)
      : data.length;
    let cursor = bodyStart;
    let clusterTimecode = 0;

    while (cursor < bodyEnd) {
      const id = readVint(data, cursor, true);
      if (!id) break;
      const elementSize = readVint(data, cursor + id.length);
      if (!elementSize || !Number.isFinite(elementSize.value)) break;
      const payload = cursor + id.length + elementSize.length;
      const next = payload + elementSize.value;
      if (next > bodyEnd || next <= cursor) break;

      if (id.value === 0xe7) {
        clusterTimecode = readUnsigned(data, payload, elementSize.value) || 0;
      } else if (id.value === 0xa3 && elementSize.value >= 4) {
        const track = readVint(data, payload);
        if (track && payload + track.length + 2 <= next) {
          const timeOffset = payload + track.length;
          let relative = (data[timeOffset] << 8) | data[timeOffset + 1];
          if (relative & 0x8000) relative -= 0x10000;
          maximumTimecode = Math.max(
            maximumTimecode,
            clusterTimecode + relative,
          );
        }
      }
      cursor = next;
    }
    offset = Math.max(offset, bodyEnd - 1);
  }

  if (maximumTimecode < 0) throw new Error("Duração WebM ausente");
  return Math.round((maximumTimecode * timecodeScale) / 1_000_000 + 20);
}

function readUint32(data: Uint8Array, offset: number) {
  if (offset + 4 > data.length) return 0;
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(
    offset,
  );
}

function readUint64(data: Uint8Array, offset: number) {
  if (offset + 8 > data.length) return 0;
  const high = readUint32(data, offset);
  const low = readUint32(data, offset + 4);
  const value = high * 2 ** 32 + low;
  return Number.isSafeInteger(value) ? value : 0;
}

function boxName(data: Uint8Array, offset: number) {
  return String.fromCharCode(...data.slice(offset, offset + 4));
}

function mp4Duration(data: Uint8Array) {
  if (data.length < 12 || boxName(data, 4) !== "ftyp") {
    throw new Error("Cabeçalho MP4 inválido");
  }
  let durationMs = 0;
  const containers = new Set(["moov", "trak", "mdia"]);

  const scan = (start: number, end: number) => {
    for (let offset = start; offset + 8 <= end;) {
      let size = readUint32(data, offset);
      const type = boxName(data, offset + 4);
      let header = 8;
      if (size === 1) {
        size = readUint64(data, offset + 8);
        header = 16;
      } else if (size === 0) {
        size = end - offset;
      }
      if (size < header || offset + size > end) {
        offset++;
        continue;
      }
      if (containers.has(type)) {
        scan(offset + header, offset + size);
      }
      if (type === "mvhd" || type === "mdhd") {
        const version = data[offset + header];
        const timescaleOffset = offset + header + (version === 1 ? 20 : 12);
        const durationOffset = timescaleOffset + 4;
        const timescale = readUint32(data, timescaleOffset);
        const duration =
          version === 1
            ? readUint64(data, durationOffset)
            : readUint32(data, durationOffset);
        if (timescale > 0 && duration > 0) {
          durationMs = Math.max(
            durationMs,
            Math.round((duration / timescale) * 1000),
          );
        }
      }
      offset += size;
    }
  };

  scan(0, data.length);
  if (!durationMs) throw new Error("Duração MP4 ausente");
  return durationMs;
}

function oggDuration(data: Uint8Array) {
  let maximumGranule = 0n;
  let found = false;
  for (let offset = 0; offset + 27 <= data.length;) {
    if (boxName(data, offset) !== "OggS") {
      offset++;
      continue;
    }
    found = true;
    let granule = 0n;
    for (let index = 7; index >= 0; index--) {
      granule = granule * 256n + BigInt(data[offset + 6 + index]);
    }
    if (granule > maximumGranule) maximumGranule = granule;
    const segments = data[offset + 26];
    if (offset + 27 + segments > data.length) break;
    let payload = 0;
    for (let index = 0; index < segments; index++) {
      payload += data[offset + 27 + index];
    }
    offset += 27 + segments + payload;
  }
  if (!found || maximumGranule <= 0n) throw new Error("Duração OGG ausente");
  return Math.round((Number(maximumGranule) / 48_000) * 1000);
}

export function inspectAudioDuration(
  data: Uint8Array,
  mimeType: "audio/webm" | "audio/ogg" | "audio/mp4",
) {
  if (mimeType === "audio/webm") return webmDuration(data);
  if (mimeType === "audio/ogg") return oggDuration(data);
  return mp4Duration(data);
}
