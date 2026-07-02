import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import sharp from 'sharp';
import type { SearchResult } from '@/types';

const NAVER_TILE_BASE = 'http://nrbe.map.naver.net/styles/basic';
const TILE_VERSION_FALLBACK = '1782439410';

let cachedTileVersion = TILE_VERSION_FALLBACK;

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

// Naver 타일 서버에서 실제 지도 이미지 합성
async function fetchNaverTileMap(
  siteLat: number, siteLng: number,
  results: SearchResult[], radius: number,
): Promise<Buffer | null> {
  await refreshNaverTileVersion();

  const W = 800, H = 500, TS = 256;
  const zoom = radius <= 5 ? 14 : radius <= 10 ? 13 : radius <= 20 ? 12 : radius <= 30 ? 11 : 10;

  // 중심 타일 좌표 (소수점 포함)
  const cx = lngToTileX(siteLng, zoom);
  const cy = latToTileY(siteLat, zoom);

  // 필요한 타일 범위 계산
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
        // 타일이 캔버스 경계를 벗어나는 경우 4방향 모두 클리핑
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

  // 회사명에서 짧은 라벨 추출: "한국레미콘 강남공장" → "한국"
  const getLabel = (name: string) => {
    const clean = name
      .replace(/^(\(주\)|\(유\)|\(주식회사\)|\(합\)|\(합자\))\s*/i, '')
      .replace(/^(주식회사|유한회사|합자회사)\s*/i, '')
      .trim();
    const idx = clean.search(/레미콘|콘크리트|시멘트|레미|콘크/);
    const prefix = idx > 0 ? clean.slice(0, idx) : clean;
    return prefix.slice(0, 5).trim();
  };
  // SVG에 한글 동적 삽입 시 librsvg 인코딩 문제 → XML hex entity로 변환
  const svgText = (text: string) =>
    [...text].map(c => `&#x${c.codePointAt(0)!.toString(16).toUpperCase()};`).join('');

  // 마커 SVG 오버레이
  const px = (lat: number, lng: number) => ({
    x: Math.round((lngToTileX(lng, zoom) - cx) * TS + W / 2),
    y: Math.round((latToTileY(lat, zoom) - cy) * TS + H / 2),
  });

  // 라벨 위치 계산 및 de-collision
  type LabelItem = { cx: number; cy: number; lx: number; ly: number; w: number; h: number; label: string };
  const labelItems: LabelItem[] = [];
  for (const r of results.slice(0, 20)) {
    const { x, y } = px(r.lat, r.lng);
    if (x < -25 || x > W + 25 || y < -25 || y > H + 25) continue;
    const label = getLabel(r.name);
    const w = label.length * 12 + 14;
    const h = 20;
    labelItems.push({ cx: x, cy: y, lx: x, ly: y - 22, w, h, label });
  }

  // 반복적으로 겹치는 라벨을 밀어냄
  for (let iter = 0; iter < 60; iter++) {
    let moved = false;
    for (let i = 0; i < labelItems.length; i++) {
      for (let j = i + 1; j < labelItems.length; j++) {
        const a = labelItems[i], b = labelItems[j];
        const overlapX = (a.w + b.w) / 2 + 4 - Math.abs(a.lx - b.lx);
        const overlapY = (a.h + b.h) / 2 + 4 - Math.abs(a.ly - b.ly);
        if (overlapX > 0 && overlapY > 0) {
          const sx2 = a.lx < b.lx ? -1 : 1;
          const sy2 = a.ly < b.ly ? -1 : 1;
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
    if (!moved) break;
  }

  const els: string[] = [];
  for (const d of labelItems) {
    // 라벨이 마커에서 멀어졌으면 선으로 연결
    const dist = Math.sqrt((d.lx - d.cx) ** 2 + (d.ly - d.cy) ** 2);
    if (dist > 18) {
      els.push(`<line x1="${d.cx.toFixed(1)}" y1="${d.cy.toFixed(1)}" x2="${d.lx.toFixed(1)}" y2="${d.ly.toFixed(1)}" stroke="#1d4ed8" stroke-width="1" stroke-dasharray="2,2" opacity="0.6"/>`);
    }
    els.push(`<rect x="${(d.lx - d.w / 2).toFixed(1)}" y="${(d.ly - d.h / 2).toFixed(1)}" width="${d.w}" height="${d.h}" rx="${d.h / 2}" fill="#1d4ed8" stroke="white" stroke-width="2"/>`);
    els.push(`<text x="${d.lx.toFixed(1)}" y="${(d.ly + 4).toFixed(1)}" text-anchor="middle" fill="white" font-size="10" font-family="Arial,sans-serif" font-weight="bold">${svgText(d.label)}</text>`);
  }
  const { x: sx, y: sy } = px(siteLat, siteLng);
  els.push(`<circle cx="${sx}" cy="${sy}" r="16" fill="#dc2626" stroke="white" stroke-width="3"/>`);
  els.push(`<text x="${sx}" y="${sy + 4}" text-anchor="middle" fill="white" font-size="9" font-family="Arial,sans-serif" font-weight="bold">&#xD604;&#xC7A5;</text>`);

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

// SVG 기반 자체 지도 생성 (항상 동작하는 폴백)
async function generateSvgMap(
  siteLat: number, siteLng: number,
  results: SearchResult[],
): Promise<Buffer | null> {
  try {
    const W = 900, H = 560, PAD = 70;

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

    const kmPerPx = (maxLng - minLng) / (W - 2 * PAD) * 111.32 * Math.cos((siteLat * Math.PI) / 180);
    const circles10 = results.length > 0 ? Math.round(results[results.length - 1].distance * 0.4 / kmPerPx) : 0;
    let distCircles = '';
    if (circles10 > 0) {
      [0.33, 0.66, 1.0].forEach(f => {
        const r = Math.round(circles10 * f);
        const km = (results[results.length - 1].distance * f).toFixed(0);
        distCircles += `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${r}" fill="none" stroke="#94a3b8" stroke-width="1" stroke-dasharray="6,4" opacity="0.6"/>`;
        distCircles += `<text x="${(sx + r).toFixed(1)}" y="${(sy - 4).toFixed(1)}" font-size="9" fill="#64748b" font-family="Arial,sans-serif">${km}km</text>`;
      });
    }

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
      markers += `<circle cx="${cx2.toFixed(1)}" cy="${cy2.toFixed(1)}" r="15" fill="#1d4ed8" stroke="white" stroke-width="2.5"/>`;
      markers += `<text x="${cx2.toFixed(1)}" y="${(cy2 + 5).toFixed(1)}" text-anchor="middle" fill="white" font-size="13" font-family="Arial,sans-serif" font-weight="bold">${r.rank}</text>`;
      markers += `<rect x="${(cx2 - 32).toFixed(1)}" y="${(cy2 - 34).toFixed(1)}" width="64" height="16" rx="3" fill="white" fill-opacity="0.85" stroke="#1d4ed8" stroke-width="0.8"/>`;
      markers += `<text x="${cx2.toFixed(1)}" y="${(cy2 - 20).toFixed(1)}" text-anchor="middle" fill="#1d4ed8" font-size="9.5" font-family="Arial,sans-serif" font-weight="bold">${name}</text>`;
    });
    markers += `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="19" fill="#dc2626" stroke="white" stroke-width="3"/>`;
    markers += `<text x="${sx.toFixed(1)}" y="${(sy + 5).toFixed(1)}" text-anchor="middle" fill="white" font-size="10" font-family="Arial,sans-serif" font-weight="bold">현장</text>`;

    const lx = W - PAD - 5, ly = PAD + 5;
    const legend = `
      <rect x="${lx - 100}" y="${ly}" width="100" height="70" rx="4" fill="white" fill-opacity="0.9" stroke="#aaa" stroke-width="1"/>
      <circle cx="${lx - 82}" cy="${ly + 18}" r="8" fill="#dc2626" stroke="white" stroke-width="1.5"/>
      <text x="${lx - 70}" y="${ly + 23}" font-size="10" font-family="Arial,sans-serif" fill="#333">현장</text>
      <circle cx="${lx - 82}" cy="${ly + 40}" r="8" fill="#1d4ed8" stroke="white" stroke-width="1.5"/>
      <text x="${lx - 70}" y="${ly + 45}" font-size="10" font-family="Arial,sans-serif" fill="#333">레미콘사</text>
      <line x1="${lx - 88}" y1="${ly + 57}" x2="${lx - 76}" y2="${ly + 57}" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="4,3"/>
      <text x="${lx - 70}" y="${ly + 62}" font-size="10" font-family="Arial,sans-serif" fill="#333">연결선</text>`;

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
      ws.addImage(imgId, { tl: { col: 0, row: 0 }, br: { col: 8, row: 14 } });
      for (let r = 1; r <= 14; r++) ws.getRow(r).height = 14;
      dataStartRow = 15;
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
      vals.forEach((v, j) => {
        const cell = row.getCell(j + 1);
        cell.value = v;
        cell.alignment = { vertical: 'middle' };
        if (i % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F4FF' } };
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
