import fs from "fs";
import path from "path";
import zlib from "zlib";

function makeChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const crcTable: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < body.length; i++) {
    crc = crcTable[(crc ^ body[i]) & 0xff] ^ (crc >>> 8);
  }
  crc = (crc ^ 0xffffffff) >>> 0;
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc, 0);
  return Buffer.concat([len, body, crcBuf]);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilterPng(raw: Buffer, w: number, h: number, bpp: number): Buffer {
  const stride = 1 + w * bpp;
  const out = Buffer.alloc(w * h * bpp);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * stride];
    const prevRow = y > 0 ? (y - 1) * w * bpp : null;
    const currRow = y * w * bpp;
    for (let x = 0; x < w * bpp; x++) {
      const byte = raw[y * stride + 1 + x];
      const left = x >= bpp ? out[currRow + x - bpp] : 0;
      const up = prevRow !== null ? out[prevRow + x] : 0;
      const upLeft = prevRow !== null && x >= bpp ? out[prevRow + x - bpp] : 0;
      let val = 0;
      switch (filter) {
        case 0:
          val = byte;
          break;
        case 1:
          val = (byte + left) & 0xff;
          break;
        case 2:
          val = (byte + up) & 0xff;
          break;
        case 3:
          val = (byte + Math.floor((left + up) / 2)) & 0xff;
          break;
        case 4:
          val = (byte + paeth(left, up, upLeft)) & 0xff;
          break;
        default:
          val = byte;
      }
      out[currRow + x] = val;
    }
  }
  return out;
}

interface DecodedPng {
  w: number;
  h: number;
  pixels: Buffer;
}

function decodePng(buf: Buffer): DecodedPng {
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  const colorType = buf.readUInt8(25);
  let pos = 8;
  const idatList: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.slice(pos + 4, pos + 8).toString("ascii");
    if (type === "IDAT") idatList.push(buf.slice(pos + 8, pos + 8 + len));
    pos += 8 + len + 4;
  }
  const raw = zlib.inflateSync(Buffer.concat(idatList));
  if (colorType === 2) {
    const rgb = unfilterPng(raw, w, h, 3);
    const rgba = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      rgba[i * 4] = rgb[i * 3];
      rgba[i * 4 + 1] = rgb[i * 3 + 1];
      rgba[i * 4 + 2] = rgb[i * 3 + 2];
      rgba[i * 4 + 3] = 255;
    }
    return { w, h, pixels: rgba };
  } else {
    const rgba = unfilterPng(raw, w, h, 4);
    return { w, h, pixels: rgba };
  }
}

function encodePng(w: number, h: number, pixels: Buffer): Buffer {
  const stride = 1 + w * 4;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const rowOffset = y * stride;
    raw[rowOffset] = 0;
    for (let x = 0; x < w; x++) {
      const srcIdx = (y * w + x) * 4;
      const dstIdx = rowOffset + 1 + x * 4;
      raw[dstIdx] = pixels[srcIdx];
      raw[dstIdx + 1] = pixels[srcIdx + 1];
      raw[dstIdx + 2] = pixels[srcIdx + 2];
      raw[dstIdx + 3] = pixels[srcIdx + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = zlib.deflateSync(raw);
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([header, makeChunk("IHDR", ihdr), makeChunk("IDAT", idat), makeChunk("IEND", Buffer.alloc(0))]);
}

function resizeRgba(src: Buffer, sw: number, sh: number, dw: number, dh: number): Buffer {
  const dst = Buffer.alloc(dw * dh * 4);
  for (let dy = 0; dy < dh; dy++) {
    const sy = (dy * sh) / dh;
    const y0 = Math.floor(sy);
    const y1 = Math.min(y0 + 1, sh - 1);
    const yf = sy - y0;
    for (let dx = 0; dx < dw; dx++) {
      const sx = (dx * sw) / dw;
      const x0 = Math.floor(sx);
      const x1 = Math.min(x0 + 1, sw - 1);
      const xf = sx - x0;
      const idx00 = (y0 * sw + x0) * 4;
      const idx10 = (y0 * sw + x1) * 4;
      const idx01 = (y1 * sw + x0) * 4;
      const idx11 = (y1 * sw + x1) * 4;
      const dIdx = (dy * dw + dx) * 4;
      for (let c = 0; c < 4; c++) {
        const top = src[idx00 + c] * (1 - xf) + src[idx10 + c] * xf;
        const bot = src[idx01 + c] * (1 - xf) + src[idx11 + c] * xf;
        dst[dIdx + c] = Math.round(top * (1 - yf) + bot * yf);
      }
    }
  }
  return dst;
}

function blendPixel(dst: Buffer, dIdx: number, r: number, g: number, b: number, a: number): void {
  if (a <= 0) return;
  const srcA = a / 255;
  const dstA = dst[dIdx + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA <= 0) return;
  dst[dIdx] = Math.round((r * srcA + dst[dIdx] * dstA * (1 - srcA)) / outA);
  dst[dIdx + 1] = Math.round((g * srcA + dst[dIdx + 1] * dstA * (1 - srcA)) / outA);
  dst[dIdx + 2] = Math.round((b * srcA + dst[dIdx + 2] * dstA * (1 - srcA)) / outA);
  dst[dIdx + 3] = Math.round(outA * 255);
}

function compositeBrowserWithAvatarBadge(browserPngBuf: Buffer, avatarPngBuf: Buffer): Buffer {
  const canvas = Buffer.alloc(256 * 256 * 4);

  // 1. Draw Main Browser Logo (Hero, increased size: 232x232 placed at x:8, y:16)
  const browserLogo = decodePng(browserPngBuf);
  const mainSize = 232;
  const mainX = 8;
  const mainY = 16;
  const scaledBrowser = resizeRgba(browserLogo.pixels, browserLogo.w, browserLogo.h, mainSize, mainSize);

  for (let by = 0; by < mainSize; by++) {
    const targetY = mainY + by;
    if (targetY < 0 || targetY >= 256) continue;
    for (let bx = 0; bx < mainSize; bx++) {
      const targetX = mainX + bx;
      if (targetX < 0 || targetX >= 256) continue;
      const sIdx = (by * mainSize + bx) * 4;
      const dIdx = (targetY * 256 + targetX) * 4;
      const a = scaledBrowser[sIdx + 3];
      if (a > 0) {
        blendPixel(canvas, dIdx, scaledBrowser[sIdx], scaledBrowser[sIdx + 1], scaledBrowser[sIdx + 2], a);
      }
    }
  }

  // 2. Draw Avatar as Notification Badge at TOP-RIGHT (Center at 196, 58; Outer radius 58px; Inner avatar radius 52px)
  const badgeCx = 196;
  const badgeCy = 58;
  const badgeRadius = 58;
  const avatarRadius = 52;

  // Elevation drop shadow under the badge
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const distShadow = Math.hypot(x - badgeCx, y - 4 - badgeCy);
      if (distShadow <= badgeRadius + 8) {
        const dIdx = (y * 256 + x) * 4;
        const shadowAlpha = Math.max(0, 1 - distShadow / (badgeRadius + 8)) * 0.45;
        blendPixel(canvas, dIdx, 0, 0, 0, Math.round(shadowAlpha * 255));
      }
    }
  }

  // Crisp white outer border ring (6px ring)
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const dist = Math.hypot(x - badgeCx, y - badgeCy);
      if (dist <= badgeRadius + 1) {
        const dIdx = (y * 256 + x) * 4;
        const aa = Math.min(1, Math.max(0, badgeRadius + 1 - dist));
        if (dist > badgeRadius - 2) {
          blendPixel(canvas, dIdx, 220, 220, 225, Math.round(aa * 255));
        } else {
          blendPixel(canvas, dIdx, 255, 255, 255, Math.round(aa * 255));
        }
      }
    }
  }

  // Draw circular cropped avatar inside the badge
  const av = decodePng(avatarPngBuf);
  const avDrawSize = avatarRadius * 2;
  const scaledAv = resizeRgba(av.pixels, av.w, av.h, avDrawSize, avDrawSize);
  const avStartX = badgeCx - avatarRadius;
  const avStartY = badgeCy - avatarRadius;

  for (let ay = 0; ay < avDrawSize; ay++) {
    const targetY = avStartY + ay;
    if (targetY < 0 || targetY >= 256) continue;
    for (let ax = 0; ax < avDrawSize; ax++) {
      const targetX = avStartX + ax;
      if (targetX < 0 || targetX >= 256) continue;
      const distCenter = Math.hypot(ax - avatarRadius, ay - avatarRadius);
      if (distCenter > avatarRadius) continue;
      const aa = Math.min(1, Math.max(0, avatarRadius - distCenter + 0.5));

      const sIdx = (ay * avDrawSize + ax) * 4;
      const dIdx = (targetY * 256 + targetX) * 4;
      const a = Math.round(scaledAv[sIdx + 3] * aa);
      if (a > 0) {
        blendPixel(canvas, dIdx, scaledAv[sIdx], scaledAv[sIdx + 1], scaledAv[sIdx + 2], a);
      }
    }
  }

  return encodePng(256, 256, canvas);
}

export function getAssetsDir(): string {
  const candidates = [
    path.join(__dirname, "assets"),
    path.join(__dirname, "..", "assets"),
    path.join(__dirname, "..", "..", "assets"),
    "C:\\Users\\ragha\\.config\\raycast\\extensions\\search-router\\assets",
    "C:\\Users\\ragha\\.config\\raycast-x\\extensions\\search-router\\assets",
    "C:\\Users\\ragha\\AppData\\Local\\Raycast\\extensions\\search-router\\assets",
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return "C:\\Users\\ragha\\.config\\raycast\\extensions\\search-router\\assets";
}

export function ensureAvatarBadgedIcon(
  browserId: string,
  safeProfileId: string,
  diskAvatarPath?: string,
): string | undefined {
  if (!diskAvatarPath || !fs.existsSync(diskAvatarPath)) {
    return undefined;
  }

  try {
    const assetsDir = getAssetsDir();
    const profilesDir = path.join(assetsDir, "profiles");
    if (!fs.existsSync(profilesDir)) {
      fs.mkdirSync(profilesDir, { recursive: true });
    }

    const badgedFile = path.join(profilesDir, `v3_badge_${safeProfileId}.png`);
    const avatarStat = fs.statSync(diskAvatarPath);

    if (fs.existsSync(badgedFile)) {
      const badgedStat = fs.statSync(badgedFile);
      if (badgedStat.mtimeMs >= avatarStat.mtimeMs) {
        return `profiles/v3_badge_${safeProfileId}.png`;
      }
    }

    // Find browser logo to composite with
    const browserLogoPath = path.join(assetsDir, "extracted", `${browserId}.png`);
    if (!fs.existsSync(browserLogoPath)) {
      return undefined;
    }

    const browserLogoBuf = fs.readFileSync(browserLogoPath);
    const avatarBuf = fs.readFileSync(diskAvatarPath);
    const composited = compositeBrowserWithAvatarBadge(browserLogoBuf, avatarBuf);

    fs.writeFileSync(badgedFile, composited);
    // Also update v2 and legacy for backward compatibility
    fs.writeFileSync(path.join(profilesDir, `v2_badge_${safeProfileId}.png`), composited);
    fs.writeFileSync(path.join(profilesDir, `${safeProfileId}.png`), composited);

    return `profiles/v3_badge_${safeProfileId}.png`;
  } catch (err) {
    console.error(`Failed to generate badged icon for ${safeProfileId}:`, err);
    return undefined;
  }
}
