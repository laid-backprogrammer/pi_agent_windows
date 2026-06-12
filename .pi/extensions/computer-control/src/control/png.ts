import { inflateSync } from "node:zlib";

export type DecodedPng = {
  width: number;
  height: number;
  channels: 3 | 4;
  data: Uint8Array;
};

export function decodePng(bytes: Buffer): DecodedPng {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature)) {
    throw new Error("Scroll calibration frames must be PNG files.");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks: Buffer[] = [];

  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) {
      throw new Error("Invalid PNG chunk length.");
    }
    const chunk = bytes.subarray(dataStart, dataEnd);

    if (type === "IHDR") {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      bitDepth = chunk[8];
      colorType = chunk[9];
      const interlace = chunk[12];
      if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
        throw new Error("Only non-interlaced 8-bit RGB/RGBA PNG screenshots are supported.");
      }
    } else if (type === "IDAT") {
      idatChunks.push(chunk);
    } else if (type === "IEND") {
      break;
    }

    offset = dataEnd + 4;
  }

  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const inflated = inflateSync(Buffer.concat(idatChunks));
  const output = new Uint8Array(height * stride);
  let inputOffset = 0;

  for (let y = 0; y < height; y++) {
    const filter = inflated[inputOffset++];
    const rowStart = y * stride;
    const previousRowStart = rowStart - stride;
    for (let x = 0; x < stride; x++) {
      const raw = inflated[inputOffset++];
      const left = x >= channels ? output[rowStart + x - channels] : 0;
      const up = y > 0 ? output[previousRowStart + x] : 0;
      const upLeft = y > 0 && x >= channels ? output[previousRowStart + x - channels] : 0;
      output[rowStart + x] = unfilterPngByte(filter, raw, left, up, upLeft);
    }
  }

  return { width, height, channels, data: output };
}

function unfilterPngByte(filter: number, raw: number, left: number, up: number, upLeft: number): number {
  switch (filter) {
    case 0:
      return raw;
    case 1:
      return (raw + left) & 0xff;
    case 2:
      return (raw + up) & 0xff;
    case 3:
      return (raw + Math.floor((left + up) / 2)) & 0xff;
    case 4:
      return (raw + paethPredictor(left, up, upLeft)) & 0xff;
    default:
      throw new Error(`Unsupported PNG filter: ${filter}`);
  }
}

function paethPredictor(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  if (upDistance <= upLeftDistance) return up;
  return upLeft;
}

export function pixelOffset(image: DecodedPng, x: number, y: number): number {
  return (y * image.width + x) * image.channels;
}
