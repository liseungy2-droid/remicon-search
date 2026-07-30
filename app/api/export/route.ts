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

type LabelItem = { cx: number; cy: number; lx: number; ly: number; ox: number; oy: number; w: number; h: number; tw: number; label: string; rank: number; highlight: boolean };

async function fetchNaverTileMap(
  siteLat: number, siteLng: number,
  results: SearchResult[], radius: number,
): Promise<{ map: Buffer; labels: LabelItem[]; font: any } | null> {
  await refreshNaverTileVersion();

  const W = 800, H = 600, TS = 256;
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

  const labelItems: LabelItem[] = [];
  for (const r of results) {
    const { x, y } = px(r.lat, r.lng);
    const label = abbrevName(r.name);
    const tw = 14;
    const w = 30, h = 18;
    labelItems.push({ cx: x, cy: y, lx: x, ly: y - 16, ox: x, oy: y - 16, w, h, tw, label, rank: r.rank, highlight: isHighlight(r.name) });
  }

  // 라벨 충돌 해소: 이동 거리 제한 없이 자유롭게 밀어내기 (지도 경계만 유지)
  const GAP = 3;
  for (let iter = 0; iter < 300; iter++) {
    let moved = false;
    for (let i = 0; i < labelItems.length; i++) {
      for (let j = i + 1; j < labelItems.length; j++) {
        const a = labelItems[i], b = labelItems[j];
        const overlapX = (a.tw + b.tw) / 2 + GAP - Math.abs(a.lx - b.lx);
        const overlapY = (a.h + b.h) / 2 + GAP - Math.abs(a.ly - b.ly);
        if (overlapX > 0 && overlapY > 0) {
          const dx = a.lx - b.lx;
          const dy = a.ly - b.ly;
          // 완전히 같은 위치면 인덱스 기준으로 대각선 방향 배정
          const sx2 = Math.abs(dx) < 0.5 ? (i % 2 === 0 ? 1 : -1) : Math.sign(dx);
          const sy2 = Math.abs(dy) < 0.5 ? (i % 3 === 0 ? 1 : -1) : Math.sign(dy);
          if (overlapX < overlapY) {
            a.lx += sx2 * overlapX / 2;
            b.lx -= sx2 * overlapX / 2;
          } else {
            a.ly += sy2 * overlapY / 2;
            b.ly -= sy2 * overlapY / 2;
          }
          moved = true;
        }
      }
    }
    // 지도 경계 안으로 유지
    for (const d of labelItems) {
      d.lx = Math.max(d.w / 2 + 2, Math.min(W - d.w / 2 - 2, d.lx));
      d.ly = Math.max(d.h / 2 + 2, Math.min(H - d.h / 2 - 2, d.ly));
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

  // 현장 마커만 기본 지도에 포함 — 레미콘사 마커는 엑셀에서 개별 이미지로 분리
  els.push(`<circle cx="${sx}" cy="${sy}" r="16" fill="#dc2626" stroke="white" stroke-width="3"/>`);
  if (font) {
    els.push(rText(font, '현장', sx, sy + 5, 10, 'white'));
  } else {
    els.push(`<text x="${sx}" y="${sy + 5}" text-anchor="middle" fill="white" font-size="10" font-family="Arial,sans-serif" font-weight="bold">*</text>`);
  }

  const baseSvg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${els.join('')}</svg>`
  );

  const map = await sharp({
    create: { width: W, height: H, channels: 4, background: { r: 236, g: 234, b: 219, alpha: 1 } },
  })
    .composite([
      ...tiles.map(t => ({ input: t.input, left: t.left, top: t.top })),
      { input: baseSvg, left: 0, top: 0 },
    ])
    .png()
    .toBuffer();

  return { map, labels: labelItems, font };
}

async function generateSvgMap(
  siteLat: number, siteLng: number,
  results: SearchResult[],
): Promise<{ map: Buffer; labels: LabelItem[]; font: any; W: number; H: number } | null> {
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

    // 라벨 위치 계산 + 충돌 해소 (fetchNaverTileMap과 동일 로직)
    const labelItems: LabelItem[] = [];
    for (const r of results) {
      const cx = toX(r.lng), cy = toY(r.lat);
      const label = abbrevName(r.name);
      const tw = 14;
      const w = 30, h = 18;
      labelItems.push({ cx, cy, lx: cx, ly: cy - 26, ox: cx, oy: cy - 26, w, h, tw, label, rank: r.rank, highlight: isHighlight(r.name) });
    }
    const GAP = 3;
    for (let iter = 0; iter < 300; iter++) {
      let moved = false;
      for (let i = 0; i < labelItems.length; i++) {
        for (let j = i + 1; j < labelItems.length; j++) {
          const a = labelItems[i], b = labelItems[j];
          const overlapX = (a.tw + b.tw) / 2 + GAP - Math.abs(a.lx - b.lx);
          const overlapY = (a.h + b.h) / 2 + GAP - Math.abs(a.ly - b.ly);
          if (overlapX > 0 && overlapY > 0) {
            const dx = a.lx - b.lx, dy = a.ly - b.ly;
            const sx2 = Math.abs(dx) < 0.5 ? (i % 2 === 0 ? 1 : -1) : Math.sign(dx);
            const sy2 = Math.abs(dy) < 0.5 ? (i % 3 === 0 ? 1 : -1) : Math.sign(dy);
            if (overlapX < overlapY) {
              a.lx += sx2 * overlapX / 2; b.lx -= sx2 * overlapX / 2;
            } else {
              a.ly += sy2 * overlapY / 2; b.ly -= sy2 * overlapY / 2;
            }
            moved = true;
          }
        }
      }
      for (const d of labelItems) {
        d.lx = Math.max(d.w / 2 + 2, Math.min(W - d.w / 2 - 2, d.lx));
        d.ly = Math.max(d.h / 2 + 2, Math.min(H - d.h / 2 - 2, d.ly));
      }
      if (!moved) break;
    }

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

    // 리더선 (라벨 위치 → 실제 위치 연결, 회사 마커는 엑셀 개별 이미지로 분리)
    let leaderLines = '';
    for (const d of labelItems) {
      const dist = Math.sqrt((d.lx - d.cx) ** 2 + (d.ly - d.cy) ** 2);
      if (dist > 18) {
        const mc = d.highlight ? '#d97706' : '#1d4ed8';
        leaderLines += `<line x1="${d.cx.toFixed(1)}" y1="${d.cy.toFixed(1)}" x2="${d.lx.toFixed(1)}" y2="${d.ly.toFixed(1)}" stroke="${mc}" stroke-width="1" stroke-dasharray="2,2" opacity="0.5"/>`;
      }
    }

    const siteEl = `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="19" fill="#dc2626" stroke="white" stroke-width="3"/>` +
      rText(font, '현장', sx, sy + 5, 10, 'white');

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
      ${grid}${distCircles}${lines}${leaderLines}${siteEl}${legend}${compass}
    </svg>`;

    const map = await sharp(Buffer.from(svg)).png().toBuffer();
    return { map, labels: labelItems, font, W, H };
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

    // 지도 레이아웃 상수 (ws.columns 와 일치해야 함)
    const MAP_COLS = 8, MAP_ROWS = 30;
    const MDW = 7; // Calibri 11pt max digit width at 96 DPI
    const COL_CHARS = [6, 22, 10, 10, 42, 16, 16, 12];
    const COL_PX = COL_CHARS.map(w => Math.trunc(w * MDW + 5));
    const CUM_COL_PX = COL_PX.reduce<number[]>((acc, w) => [...acc, acc[acc.length - 1] + w], [0]);
    const ROW_H_EMU = 16 * 12700; // 203200 EMU
    const DISP_W_PX = CUM_COL_PX[MAP_COLS]; // 978px
    const DISP_H_PX = ROW_H_EMU * MAP_ROWS / 9525; // 640px

    // 디스플레이 픽셀 → twoCellAnchor col/row 앵커 변환
    const pxToAnchor = (xpx: number, ypx: number) => {
      let col = 0;
      while (col < MAP_COLS && CUM_COL_PX[col + 1] !== undefined && CUM_COL_PX[col + 1] <= xpx) col++;
      const colOff = Math.round(Math.max(0, xpx - CUM_COL_PX[col]) * 9525);
      const yemu = Math.round(ypx * 9525);
      const row = Math.min(MAP_ROWS, Math.floor(yemu / ROW_H_EMU));
      const rowOff = Math.max(0, yemu - row * ROW_H_EMU);
      return { col, colOff, row, rowOff };
    };

    type ShapeMarker = { fromXpx: number; fromYpx: number; toXpx: number; toYpx: number; color: string; label: string };
    const shapeMarkers: ShapeMarker[] = [];

    let dataStartRow = 1;
    type MapData = { map: Buffer; labels: LabelItem[]; font: any; W: number; H: number };
    let mapData: MapData | null = null;

    if (siteLat != null && siteLng != null) {
      try {
        const tr = await fetchNaverTileMap(siteLat, siteLng, results, radius ?? 30);
        if (tr) {
          mapData = { ...tr, W: 800, H: 600 };
          console.log('[export] Naver 타일 지도 성공');
        }
      } catch (e) {
        console.error('[export] Naver 타일 오류:', e);
      }

      if (!mapData) {
        try {
          console.log('[export] SVG 폴백 시도');
          mapData = await generateSvgMap(siteLat, siteLng, results);
        } catch (e) {
          console.error('[export] SVG 폴백 오류:', e);
        }
      }
    }

    if (mapData) {
      const { map: baseMap, labels, W: MAP_W, H: MAP_H } = mapData;

      // 기본 지도 이미지만 ExcelJS로 등록 (rId1)
      const baseId = wb.addImage({ buffer: baseMap, extension: 'png' });
      ws.addImage(baseId, { tl: { col: 0, row: 0 }, br: { col: MAP_COLS, row: MAP_ROWS } });

      // 마커는 PNG 이미지 대신 Excel 네이티브 도형(Shape)으로 생성
      // → 도형은 항상 개별 클릭/드래그 가능 (이미지와 달리 z-order 문제 없음)
      for (const d of labels) {
        const fromXpx = (d.lx - d.w / 2) * DISP_W_PX / MAP_W;
        const fromYpx = (d.ly - d.h / 2) * DISP_H_PX / MAP_H;
        const toXpx   = (d.lx + d.w / 2) * DISP_W_PX / MAP_W;
        const toYpx   = (d.ly + d.h / 2) * DISP_H_PX / MAP_H;
        shapeMarkers.push({
          fromXpx, fromYpx, toXpx, toYpx,
          color: d.highlight ? 'd97706' : '1d4ed8',
          label: d.label,
        });
      }
      console.log(`[export] 마커 도형 ${labels.length}개 수집 완료`);

      for (let r = 1; r <= MAP_ROWS; r++) ws.getRow(r).height = 16;
      dataStartRow = MAP_ROWS + 1;
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

    const rawBuf = Buffer.from(await wb.xlsx.writeBuffer());

    // JSZip으로 drawing1.xml 교체: 기본 지도(이미지) + 마커(Excel 도형)
    // Excel 도형은 이미지와 달리 z-order 무관하게 항상 개별 클릭/드래그 가능
    console.log(`[export] shapeMarkers=${shapeMarkers.length} hasMap=${!!mapData}`);
    let buf: Buffer;
    if (shapeMarkers.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const JSZip = require('jszip');
      const zip = await JSZip.loadAsync(rawBuf);

      const baseCx = Math.round(DISP_W_PX * 9525);
      const baseCy = ROW_H_EMU * MAP_ROWS;
      const XDR = 'xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"';
      const XA = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
      const XR = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

      let drawXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr ${XDR} ${XA} ${XR}>\n`;

      // 기본 지도: noSelect+noMove으로 잠금 → 클릭 시 지도가 선택되지 않고 위 도형으로 넘어감
      drawXml += `<xdr:twoCellAnchor editAs="twoCell">`;
      drawXml += `<xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>`;
      drawXml += `<xdr:to><xdr:col>${MAP_COLS}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${MAP_ROWS}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>`;
      drawXml += `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="Map"/>`;
      drawXml += `<xdr:cNvPicPr><a:picLocks noSelect="1" noMove="1" noResize="1" noCrop="1" noGrp="1"/></xdr:cNvPicPr>`;
      drawXml += `</xdr:nvPicPr>`;
      drawXml += `<xdr:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>`;
      drawXml += `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${baseCx}" cy="${baseCy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>`;
      drawXml += `</xdr:pic><xdr:clientData/></xdr:twoCellAnchor>\n`;

      // 마커: Excel 네이티브 도형 (xdr:sp) — 이미지 참조(rId) 불필요, 항상 개별 이동 가능
      shapeMarkers.forEach((m, i) => {
        const id = i + 2;
        const from = pxToAnchor(m.fromXpx, m.fromYpx);
        const to   = pxToAnchor(m.toXpx,   m.toYpx);
        const cx   = Math.round((m.toXpx - m.fromXpx) * 9525);
        const cy   = Math.round((m.toYpx - m.fromYpx) * 9525);

        drawXml += `<xdr:twoCellAnchor editAs="oneCell">`;
        drawXml += `<xdr:from><xdr:col>${from.col}</xdr:col><xdr:colOff>${from.colOff}</xdr:colOff><xdr:row>${from.row}</xdr:row><xdr:rowOff>${from.rowOff}</xdr:rowOff></xdr:from>`;
        drawXml += `<xdr:to><xdr:col>${to.col}</xdr:col><xdr:colOff>${to.colOff}</xdr:colOff><xdr:row>${to.row}</xdr:row><xdr:rowOff>${to.rowOff}</xdr:rowOff></xdr:to>`;
        drawXml += `<xdr:sp macro="" textlink="">`;
        drawXml += `<xdr:nvSpPr><xdr:cNvPr id="${id}" name="Marker_${m.label}"/><xdr:cNvSpPr><a:spLocks noGrp="1"/></xdr:cNvSpPr></xdr:nvSpPr>`;
        drawXml += `<xdr:spPr>`;
        drawXml += `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`;
        drawXml += `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 50000"/></a:avLst></a:prstGeom>`;
        drawXml += `<a:solidFill><a:srgbClr val="${m.color}"/></a:solidFill>`;
        drawXml += `<a:ln w="19050"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln>`;
        drawXml += `</xdr:spPr>`;
        drawXml += `<xdr:txBody>`;
        drawXml += `<a:bodyPr wrap="none" anchor="ctr"><a:noAutofit/></a:bodyPr><a:lstStyle/>`;
        drawXml += `<a:p><a:pPr algn="ctr"/>`;
        drawXml += `<a:r><a:rPr lang="ko-KR" sz="700" b="1" dirty="0"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr>`;
        drawXml += `<a:t>${m.label}</a:t></a:r></a:p>`;
        drawXml += `</xdr:txBody>`;
        drawXml += `</xdr:sp><xdr:clientData/></xdr:twoCellAnchor>\n`;
      });

      drawXml += `</xdr:wsDr>`;
      zip.file('xl/drawings/drawing1.xml', drawXml);

      buf = Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
      console.log(`[export] Excel 도형 마커 ${shapeMarkers.length}개 생성 완료`);
    } else {
      buf = rawBuf;
    }

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
