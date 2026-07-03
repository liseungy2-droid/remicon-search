import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import sharp from 'sharp';
import type { SearchResult } from '@/types';

const NAVER_TILE_BASE = 'http://nrbe.map.naver.net/styles/basic';
const TILE_VERSION_FALLBACK = '1782439410';

let cachedTileVersion = TILE_VERSION_FALLBACK;

const HIGHLIGHT_NAMES = ['유진기업', '이순산업', '현대개발 본사', '현대개발 김해', '당진기업'];
function isHighlight(name: string): boolean {
  return HIGHLIGHT_NAMES.some(k => k.split(' ').every(word => name.includes(word)));
}

function abbrevName(name: string): string {
  const n = name
    .replace(/^\(주\)\s*/, '')
    .replace(/\s*\(주\)$/, '')
    .replace(/^주식회사\s*/, '')
    .trim();
  return n.slice(0, 2);
}

// opentype.js: 텍스트 → SVG 패스 (한글 폰트를 렌더러에 의존하지 않음)
let _fontPromise: Promise<any> | null = null;

async function loadFont(): Promise<any> {
  if (_fontPromise) return _fontPromise;
  _fontPromise = (async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const opentype = require('opentype.js');
      let ab: ArrayBuffer | null = null;

      // 시도 1: 로컬 파일시스템 (개발 환경 / Vercel 번들)
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { readFileSync } = require('fs');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { join } = require('path');
        const raw: Buffer = readFileSync(join(process.cwd(), 'public', 'fonts', 'NanumGothic.ttf'));
        ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
        console.log('[export] 폰트 fs 로드 완료');
      } catch {
        // 시도 2: CDN URL fetch (Vercel cold Lambda에서 fs 실패 시)
        const base = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'http://localhost:3001';
        const res = await fetch(`${base}/fonts/NanumGothic.ttf`, {
          signal: AbortSignal.timeout(6000),
        });
        if (res.ok) {
          ab = await res.arrayBuffer();
          console.log('[export] 폰트 HTTP 로드 완료');
        }
      }

      if (ab) return opentype.parse(ab);
    } catch (e) {
      console.error('[export] 한글 폰트 로드 실패:', e);
    }
    return null;
  })();
  return _fontPromise;
}

function textW(font: any, text: string, size: number): number {
  if (!font) return text.length * size * 0.65;
  return (
    font.stringToGlyphs(text).reduce((s: number, g: any) => s + (g.advanceWidth ?? 0), 0) *
    size / font.unitsPerEm
  );
}

// 수평 중앙 정렬 텍스트 → <path> (폰트 없으면 빈 문자열)
function rText(font: any, text: string, cx: number, baselineY: number, size: number, fill: string): string {
  if (!font) return '';
  try {
    const w = textW(font, text, size);
    const path = font.getPath(text, cx - w / 2, baselineY, size);
    return `<path d="${path.toPathData(1)}" fill="${fill}"/>`;
  } catch {
    return '';
  }
}

// 왼쪽 정렬 텍스트 → <path>
function rTextLeft(font: any, text: string, x: number, baselineY: number, size: number, fill: string): string {
  if (!font) return '';
  try {
    const path = font.getPath(text, x, baselineY, size);
    return `<path d="${path.toPathData(1)}" fill="${fill}"/>`;
  } catch {
    return '';
  }
}

async function refreshNaverTileVersion() {
  try {
    const res = await fetch(`${NAVER_TILE_BASE}.json?fmt=png`, {
      signal: AbortSignal.timeout(4000),
    });
    const text = await res.text();
    const m = text.match(/\/styles\/basic\/(\d+)\//);
    if (m) cachedTileVersion = m[1];
  } catch {
    // keep cached fallback
  }
}

function lngToTileX(lng: number, zoom: number): number {
  return (lng + 180) / 360 * Math.pow(2, zoom);
}

function latToTileY(lat: number, zoom: number): number {
  const r = lat * Math.PI / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, zoom);
}

// 모든 결과가 뷰포트 안에 들어오는 최대 줌 레벨 계산
function fitZoom(
  siteLat: number, siteLng: number,
  results: SearchResult[], W: number, H: number, TS: number,
): number {
  const margin = 40; // px 여백
  for (let z = 14; z >= 8; z--) {
    const cx = lngToTileX(siteLng, z);
    const cy = latToTileY(siteLat, z);
    let ok = true;
    for (const r of results) {
      const x = (lngToTileX(r.lng, z) - cx) * TS + W / 2;
      const y = (latToTileY(r.lat, z) - cy) * TS + H / 2;
      if (x < margin || x > W - margin || y < margin || y > H - margin) {
        ok = false;
        break;
      }
    }
    if (ok) return z;
  }
  return 8;
}

async function fetchNaverTileMap(
  siteLat: number, siteLng: number,
  results: SearchResult[], radius: number,
): Promise<Buffer | null> {
  await refreshNaverTileVersion();

  const W = 800, H = 780, TS = 256;
  const zoom = results.length > 0
    ? fitZoom(siteLat, siteLng, results, W, H, TS)
    : (radius <= 5 ? 14 : radius <= 10 ? 13 : radius <= 20 ? 12 : radius <= 30 ? 11 : 10);

  const cx = lngToTileX(siteLng, zoom);
  const cy = latToTileY(siteLat, zoom);

  const halfX = Math.ceil(W / (2 * TS)) + 1;
  const halfY = Math.ceil(H / (2 * TS)) + 1;
  const txMin = Math.floor(cx) - halfX;
  const txMax = Math.floor(cx) + halfX;
  const tyMin = Math.floor(cy) - halfY;
  const tyMax = Math.floor(cy) + halfY;

  type TileItem = { input: Buffer; left: number; top: number };
  const fetchQueue: { url: string; left: number; top: number }[] = [];

  for (let ty = tyMin; ty <= tyMax; ty++) {
    for (let tx = txMin; tx <= txMax; tx++) {
      const left = Math.round((tx - cx) * TS + W / 2);
      const top = Math.round((ty - cy) * TS + H / 2);
      if (left + TS <= 0 || left >= W || top + TS <= 0 || top >= H) continue;
      fetchQueue.push({
        url: `${NAVER_TILE_BASE}/${cachedTileVersion}/${zoom}/${tx}/${ty}.png?mt=bg.ol.sw.ar.lko`,
        left, top,
      });
    }
  }

  const tileResults = await Promise.all(
    fetchQueue.map(async ({ url, left, top }): Promise<TileItem | null> => {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!res.ok || !res.headers.get('content-type')?.startsWith('image/')) return null;
        const buf = Buffer.from(await res.arrayBuffer());
        const eLeft = Math.max(0, left);
        const eTop = Math.max(0, top);
        const clipL = eLeft - left;
        const clipT = eTop - top;
        const clipR = Math.max(0, left + TS - W);
        const clipB = Math.max(0, top + TS - H);
        const clipW = TS - clipL - clipR;
        const clipH = TS - clipT - clipB;
        if (clipW <= 0 || clipH <= 0) return null;
        if (clipL > 0 || clipT > 0 || clipR > 0 || clipB > 0) {
          const cropped = await sharp(buf)
            .extract({ left: clipL, top: clipT, width: clipW, height: clipH })
            .toBuffer();
          return { input: cropped, left: eLeft, top: eTop };
        }
        return { input: buf, left, top };
      } catch {
        return null;
      }
    })
  );

  const tiles = tileResults.filter((t): t is TileItem => t !== null);
  if (tiles.length === 0) {
    console.log('[naver tiles] 0개 로드됨 — 폴백으로 이동');
    return null;
  }
  console.log(`[naver tiles] ${tiles.length}/${fetchQueue.length}개 로드 완료 (zoom ${zoom})`);

  const font = await loadFont();

  const px = (lat: number, lng: number) => ({
    x: Math.round((lngToTileX(lng, zoom) - cx) * TS + W / 2),
    y: Math.round((latToTileY(lat, zoom) - cy) * TS + H / 2),
  });

  type LabelItem = { cx: number; cy: number; lx: number; ly: number; ox: number; oy: number; w: number; h: number; label: string; rank: number; highlight: boolean };
  const labelItems: LabelItem[] = [];
  for (const r of results) {
    const { x, y } = px(r.lat, r.lng);
    const label = abbrevName(r.name);
    const w = font ? Math.ceil(textW(font, label, 11)) + 16 : String(r.rank).length * 9 + 14;
    const h = 20;
    labelItems.push({ cx: x, cy: y, lx: x, ly: y - 22, ox: x, oy: y - 22, w, h, label, rank: r.rank, highlight: isHighlight(r.name) });
  }

  // 라벨 충돌 해소: 최대 이동 거리(MAX_DISP)를 제한해 밀집 지역에서 마커 근처 유지
  const MAX_DISP = 28;
  const clamp = (val: number, origin: number) =>
    origin + Math.max(-MAX_DISP, Math.min(MAX_DISP, val - origin));

  for (let iter = 0; iter < 30; iter++) {
    let moved = false;
    for (let i = 0; i < labelItems.length; i++) {
      for (let j = i + 1; j < labelItems.length; j++) {
        const a = labelItems[i], b = labelItems[j];
        const overlapX = (a.w + b.w) / 2 + 1 - Math.abs(a.lx - b.lx);
        const overlapY = (a.h + b.h) / 2 + 1 - Math.abs(a.ly - b.ly);
        if (overlapX > 0 && overlapY > 0) {
          const sx2 = a.lx <= b.lx ? -1 : 1;
          const sy2 = a.ly <= b.ly ? -1 : 1;
          if (overlapX < overlapY) {
            a.lx = clamp(a.lx + sx2 * overlapX / 2, a.ox);
            b.lx = clamp(b.lx - sx2 * overlapX / 2, b.ox);
          } else {
            a.ly = clamp(a.ly + sy2 * overlapY / 2, a.oy);
            b.ly = clamp(b.ly - sy2 * overlapY / 2, b.oy);
          }
          moved = true;
        }
      }
    }
    if (!moved) break;
  }

  const { x: sx, y: sy } = px(siteLat, siteLng);
  const els: string[] = [];

  // 반경 원 (10 / 20 / 30 km) — 마커보다 먼저 그려서 뒤에 위치
  const RING_COLORS: { [k: number]: string } = { 10: '#3b82f6', 20: '#f59e0b', 30: '#ef4444' };
  [10, 20, 30].forEach(km => {
    const rPx = Math.abs(sy - px(siteLat + (km * 1000) / 111320, siteLng).y);
    if (rPx < 5) return;
    const color = RING_COLORS[km];
    els.push(`<circle cx="${sx}" cy="${sy}" r="${rPx.toFixed(1)}" fill="none" stroke="${color}" stroke-width="1.5" stroke-dasharray="8,5" stroke-opacity="0.65"/>`);
    // 라벨: 원의 오른쪽 끝 (동쪽 지점)
    const eastX = Math.round((lngToTileX(siteLng + (km * 1000) / (111320 * Math.cos(siteLat * Math.PI / 180)), zoom) - cx) * TS + W / 2);
    if (eastX > 4 && eastX < W - 4) {
      const lbl = `${km}km`;
      const lw = font ? Math.ceil(textW(font, lbl, 11)) + 12 : 38;
      els.push(`<rect x="${eastX.toFixed(1)}" y="${(sy - 11).toFixed(1)}" width="${lw}" height="16" rx="3" fill="white" fill-opacity="0.9" stroke="${color}" stroke-width="1.2"/>`);
      if (font) {
        els.push(rTextLeft(font, lbl, eastX + 4, sy + 3, 11, color));
      }
    }
  });

  for (const d of labelItems) {
    const mc = d.highlight ? '#d97706' : '#1d4ed8';
    const dist = Math.sqrt((d.lx - d.cx) ** 2 + (d.ly - d.cy) ** 2);
    if (dist > 18) {
      els.push(`<line x1="${d.cx.toFixed(1)}" y1="${d.cy.toFixed(1)}" x2="${d.lx.toFixed(1)}" y2="${d.ly.toFixed(1)}" stroke="${mc}" stroke-width="1" stroke-dasharray="2,2" opacity="0.6"/>`);
    }
    els.push(`<rect x="${(d.lx - d.w / 2).toFixed(1)}" y="${(d.ly - d.h / 2).toFixed(1)}" width="${d.w}" height="${d.h}" rx="${d.h / 2}" fill="${mc}" stroke="white" stroke-width="2"/>`);
    if (font) {
      els.push(rText(font, d.label, d.lx, d.ly + 4, 11, 'white'));
    } else {
      els.push(`<text x="${d.lx.toFixed(1)}" y="${(d.ly + 4).toFixed(1)}" text-anchor="middle" fill="white" font-size="11" font-family="Arial,sans-serif" font-weight="bold">${d.rank}</text>`);
    }
  }
  els.push(`<circle cx="${sx}" cy="${sy}" r="16" fill="#dc2626" stroke="white" stroke-width="3"/>`);
  if (font) {
    els.push(rText(font, '현장', sx, sy + 5, 10, 'white'));
  } else {
    els.push(`<text x="${sx}" y="${sy + 5}" text-anchor="middle" fill="white" font-size="10" font-family="Arial,sans-serif" font-weight="bold">*</text>`);
  }

  const markerSvg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${els.join('')}</svg>`
  );

  return sharp({
    create: { width: W, height: H, channels: 4, background: { r: 236, g: 234, b: 219, alpha: 1 } },
  })
    .composite([
      ...tiles.map(t => ({ input: t.input, left: t.left, top: t.top })),
      { input: markerSvg, left: 0, top: 0 },
    ])
    .png()
    .toBuffer();
}

async function generateSvgMap(
  siteLat: number, siteLng: number,
  results: SearchResult[],
): Promise<Buffer | null> {
  try {
    const W = 900, H = 780, PAD = 70;
    const font = await loadFont();

    const allPts = [{ lat: siteLat, lng: siteLng }, ...results.map(r => ({ lat: r.lat, lng: r.lng }))];
    let minLat = Math.min(...allPts.map(p => p.lat));
    let maxLat = Math.max(...allPts.map(p => p.lat));
    let minLng = Math.min(...allPts.map(p => p.lng));
    let maxLng = Math.max(...allPts.map(p => p.lng));

    const latPad = Math.max((maxLat - minLat) * 0.20, 0.025);
    const lngPad = Math.max((maxLng - minLng) * 0.20, 0.04);
    minLat -= latPad; maxLat += latPad;
    minLng -= lngPad; maxLng += lngPad;

    const toX = (lng: number) => PAD + (lng - minLng) / (maxLng - minLng) * (W - 2 * PAD);
    const toY = (lat: number) => H - PAD - (lat - minLat) / (maxLat - minLat) * (H - 2 * PAD);
    const sx = toX(siteLng), sy = toY(siteLat);

    const pxPerKm = (W - 2 * PAD) / ((maxLng - minLng) * 111.32 * Math.cos((siteLat * Math.PI) / 180));
    const SVG_RING: { [k: number]: string } = { 10: '#3b82f6', 20: '#f59e0b', 30: '#ef4444' };
    let distCircles = '';
    [10, 20, 30].forEach(km => {
      const r = Math.round(km * pxPerKm);
      if (r < 5) return;
      const color = SVG_RING[km];
      distCircles += `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${r}" fill="none" stroke="${color}" stroke-width="1.5" stroke-dasharray="6,4" stroke-opacity="0.65"/>`;
      distCircles += `<rect x="${(sx + r - 16).toFixed(1)}" y="${(sy - 10).toFixed(1)}" width="32" height="14" rx="3" fill="white" fill-opacity="0.85" stroke="${color}" stroke-width="1"/>`;
      distCircles += `<text x="${(sx + r).toFixed(1)}" y="${(sy + 1).toFixed(1)}" text-anchor="middle" fill="${color}" font-size="9" font-family="Arial,sans-serif" font-weight="bold">${km}km</text>`;
    });

    let grid = '';
    for (let i = 1; i < 5; i++) {
      const gy = (PAD + (H - 2 * PAD) * i / 5).toFixed(1);
      const gx = (PAD + (W - 2 * PAD) * i / 5).toFixed(1);
      grid += `<line x1="${PAD}" y1="${gy}" x2="${W - PAD}" y2="${gy}" stroke="#cbd5c0" stroke-width="0.8"/>`;
      grid += `<line x1="${gx}" y1="${PAD}" x2="${gx}" y2="${H - PAD}" stroke="#cbd5c0" stroke-width="0.8"/>`;
    }

    let lines = '';
    results.forEach(r => {
      const cx2 = toX(r.lng).toFixed(1), cy2 = toY(r.lat).toFixed(1);
      lines += `<line x1="${sx.toFixed(1)}" y1="${sy.toFixed(1)}" x2="${cx2}" y2="${cy2}" stroke="#94a3b8" stroke-width="1" stroke-dasharray="3,3" opacity="0.5"/>`;
    });

    let markers = '';
    results.forEach(r => {
      const cx2 = toX(r.lng), cy2 = toY(r.lat);
      const name = r.name.length > 8 ? r.name.slice(0, 8) + '..' : r.name;
      const mc = isHighlight(r.name) ? '#d97706' : '#1d4ed8';
      markers += `<circle cx="${cx2.toFixed(1)}" cy="${cy2.toFixed(1)}" r="15" fill="${mc}" stroke="white" stroke-width="2.5"/>`;
      markers += `<text x="${cx2.toFixed(1)}" y="${(cy2 + 5).toFixed(1)}" text-anchor="middle" fill="white" font-size="13" font-family="Arial,sans-serif" font-weight="bold">${r.rank}</text>`;
      markers += `<rect x="${(cx2 - 32).toFixed(1)}" y="${(cy2 - 34).toFixed(1)}" width="64" height="16" rx="3" fill="white" fill-opacity="0.85" stroke="${mc}" stroke-width="0.8"/>`;
      markers += rText(font, name, cx2, cy2 - 20, 9.5, mc);
    });
    markers += `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="19" fill="#dc2626" stroke="white" stroke-width="3"/>`;
    markers += rText(font, '현장', sx, sy + 5, 10, 'white');

    const lx = W - PAD - 5, ly = PAD + 5;
    const legend = `
      <rect x="${lx - 110}" y="${ly}" width="110" height="90" rx="4" fill="white" fill-opacity="0.9" stroke="#aaa" stroke-width="1"/>
      <circle cx="${lx - 92}" cy="${ly + 18}" r="8" fill="#dc2626" stroke="white" stroke-width="1.5"/>
      ${rTextLeft(font, '현장', lx - 80, ly + 23, 10, '#333')}
      <circle cx="${lx - 92}" cy="${ly + 38}" r="8" fill="#1d4ed8" stroke="white" stroke-width="1.5"/>
      ${rTextLeft(font, '레미콘사', lx - 80, ly + 43, 10, '#333')}
      <circle cx="${lx - 92}" cy="${ly + 58}" r="8" fill="#d97706" stroke="white" stroke-width="1.5"/>
      ${rTextLeft(font, '관련업체', lx - 80, ly + 63, 10, '#333')}
      <line x1="${lx - 98}" y1="${ly + 77}" x2="${lx - 86}" y2="${ly + 77}" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="4,3"/>
      ${rTextLeft(font, '연결선', lx - 80, ly + 82, 10, '#333')}`;

    const compass = `
      <text x="${PAD + 10}" y="${PAD + 22}" font-size="14" font-family="Arial,sans-serif" font-weight="bold" fill="#374151">N</text>
      <line x1="${PAD + 16}" y1="${PAD + 25}" x2="${PAD + 16}" y2="${PAD + 38}" stroke="#374151" stroke-width="2"/>
      <polygon points="${PAD + 16},${PAD + 24} ${PAD + 12},${PAD + 34} ${PAD + 20},${PAD + 34}" fill="#374151"/>`;

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <defs>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="1" stdDeviation="2" flood-color="#00000030"/>
        </filter>
      </defs>
      <rect width="${W}" height="${H}" fill="#f0f4e8"/>
      <rect x="${PAD}" y="${PAD}" width="${W - 2*PAD}" height="${H - 2*PAD}" fill="#e4edd8" rx="3" stroke="#b8c8a0" stroke-width="1"/>
      ${grid}${distCircles}${lines}${markers}${legend}${compass}
    </svg>`;

    return await sharp(Buffer.from(svg)).png().toBuffer();
  } catch (e) {
    console.error('[export] SVG map error:', e);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { results, siteAddress, siteLat, siteLng, radius } = body as {
      results: SearchResult[];
      siteAddress: string;
      siteLat?: number;
      siteLng?: number;
      radius?: number;
    };

    console.log(`[export] 지도 생성 시작: lat=${siteLat} lng=${siteLng} radius=${radius}`);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('레미콘사 검색결과');

    ws.columns = [
      { width: 6 }, { width: 22 }, { width: 10 }, { width: 10 },
      { width: 42 }, { width: 16 }, { width: 16 }, { width: 12 },
    ];

    let dataStartRow = 1;
    let mapImg: Buffer | null = null;

    if (siteLat != null && siteLng != null) {
      try {
        mapImg = await fetchNaverTileMap(siteLat, siteLng, results, radius ?? 30);
        if (mapImg) console.log('[export] Naver 타일 지도 성공');
      } catch (e) {
        console.error('[export] Naver 타일 오류:', e);
      }

      if (!mapImg) {
        try {
          console.log('[export] SVG 폴백 시도');
          mapImg = await generateSvgMap(siteLat, siteLng, results);
        } catch (e) {
          console.error('[export] SVG 폴백 오류:', e);
        }
      }
    }

    if (mapImg) {
      const imgId = wb.addImage({ buffer: mapImg, extension: 'png' });
      ws.addImage(imgId, { tl: { col: 0, row: 0 }, br: { col: 8, row: 28 } });
      for (let r = 1; r <= 28; r++) ws.getRow(r).height = 16;
      dataStartRow = 29;
    }

    const titleRow = ws.getRow(dataStartRow);
    titleRow.getCell(1).value = `현장: ${siteAddress || ''}`;
    titleRow.getCell(1).font = { bold: true, size: 11 };
    ws.mergeCells(dataStartRow, 1, dataStartRow, 8);
    dataStartRow += 1;

    const headers = ['순위', '업체명', '거리(km)', '소요시간', '소재지', '전화', '생산능력', '믹서트럭(대)'];
    const headerRow = ws.getRow(dataStartRow);
    headers.forEach((h, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = h;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });
    headerRow.height = 18;
    dataStartRow += 1;

    results.forEach((r, i) => {
      const row = ws.getRow(dataStartRow + i);
      const vals = [
        r.rank, r.name, parseFloat(r.distance.toFixed(1)),
        r.duration > 0 ? `${Math.round(r.duration / 60000)}분` : '-',
        r.address, r.phone, r.capacity, r.trucks,
      ];
      const hl = isHighlight(r.name);
      vals.forEach((v, j) => {
        const cell = row.getCell(j + 1);
        cell.value = v;
        cell.alignment = { vertical: 'middle' };
        if (hl) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } };
          cell.font = { bold: true };
        } else if (i % 2 === 1) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F4FF' } };
        }
      });
      row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      row.height = 16;
    });

    const arrayBuf = await wb.xlsx.writeBuffer();
    const buf = Buffer.from(arrayBuf);
    const filename = encodeURIComponent(`레미콘사_${siteAddress || '검색결과'}.xlsx`);

    return new NextResponse(buf, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
      },
    });
  } catch (e) {
    console.error('[export] 치명적 오류:', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
