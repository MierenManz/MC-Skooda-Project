import { readVarInt } from "../util/varint.ts";
import type { Position } from "../types/payloads/position.ts";

const TEXT_DECODER = new TextDecoder();
const POSITION_X_BITSHIFT = 38n;
const POSITION_Y_BITSHIFT = 0xFFFn;
const POSITION_Z_BITSHIFT1 = 12n;
const POSITION_Z_BITSHIFT2 = 0x3FFFFFFn;

export function deserializeString(buffer: Uint8Array): [string, number] {
  const [strLength, bytesRead] = readVarInt(buffer);
  const str = TEXT_DECODER.decode(
    buffer.subarray(bytesRead, bytesRead + strLength),
  );
  return [str, bytesRead + strLength];
}

export function deserializePosition(buffer: Uint8Array): [Position, number] {
  const dt = new DataView(buffer.buffer);
  const bigint = dt.getBigUint64(0);

  let x = Number(bigint >> POSITION_X_BITSHIFT);
  let y = Number(bigint & POSITION_Y_BITSHIFT);
  let z = Number((bigint >> POSITION_Z_BITSHIFT1) & POSITION_Z_BITSHIFT2);

  if (x >= (2 ^ 25)) x -= 2 ^ 26;
  if (y >= (2 ^ 11)) y -= 2 ^ 12;
  if (z >= (2 ^ 25)) z -= 2 ^ 26;

  return [{
    x,
    y,
    z,
  }, 8];
}
