import { NextRequest, NextResponse } from 'next/server';
import { getDB } from '@/lib/db';
import * as XLSX from 'xlsx';

async function naverGeocode(query: string): Promise<{ lat: number; lng: number } | null> {
  const res = await fetch(
    `https://maps.apigw.ntruss.com/map-geocode/v2/geocode?query=${encodeURIComponent(query)}`,
    {
      headers: {
        'X-NCP-APIGW-API-KEY-ID': process.env.NAVER_CLIENT_ID!,
        'X-NCP-APIGW-API-KEY': process.env.NAVER_CLIENT_SECRET!,
      },
      signal: AbortSignal.timeout(8000),
    }
  );
  const data = await res.json();
  if (data.addresses?.length > 0) {
    return { lat: parseFloat(data.addresses[0].y), lng: parseFloat(data.addresses[0].x) };
  }
  return null;
}

async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const result = await naverGeocode(address);
    if (result) return result;
    const simplified = address.replace(/-\d+$/, '').trim();
    if (simplified !== address) {
      const result2 = await naverGeocode(simplified);
      if (result2) return result2;
    }
    const broader = simplified.replace(/\s+\S+$/, '').trim();
    if (broader !== simplified && broader.length > 5) {
      return await naverGeocode(broader);
    }
  } catch (e) {
    console.error('[geocode] 오류:', e);
  }
  return null;
}

function getField(row: Record<string, unknown>, ...keys: string[]): string {
  const normalized: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    normalized[k.replace(/\s+/g, '')] = String(v ?? '').replace(/\s+/g, ' ').trim();
  }
  for (const key of keys) {
    const nk = key.replace(/\s+/g, '');
    if (normalized[nk] !== undefined) return normalized[nk];
    const found = Object.keys(normalized).find(k => k.startsWith(nk));
    if (found) return normalized[found];
  }
  return '';
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    if (!file) return NextResponse.json({ error: '파일이 없습니다' }, { status: 400 });

    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

    if (rows.length > 0) {
      console.log('[upload] 컬럼:', Object.keys(rows[0]));
      console.log('[upload] 첫 행 샘플:', JSON.stringify(rows[0]).slice(0, 300));
    }

    const db = getDB();
    await db.execute('DELETE FROM remicon_companies');

    let success = 0;
    let failed = 0;

    const CHUNK = 5;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      await Promise.all(
        chunk.map(async (row) => {
          const bizName = getField(row, '업체명');
          const factoryName = getField(row, '공장명');
          const name = factoryName ? `${bizName} ${factoryName}` : bizName;
          const address = getField(row, '소재지');
          const phone = getField(row, '전화');
          const capacity = getField(row, '생산능력');
          const trucks = parseInt(getField(row, '믹서트럭')) || 0;

          if (!name || !address) return;

          const coords = await geocodeAddress(address);
          await db.execute({
            sql: 'INSERT INTO remicon_companies (name, address, phone, capacity, trucks, lat, lng) VALUES (?, ?, ?, ?, ?, ?, ?)',
            args: [name, address, phone, capacity, trucks, coords?.lat ?? null, coords?.lng ?? null],
          });
          if (coords) {
            success++;
          } else {
            if (failed < 5) console.log(`[geocode 실패] "${address}"`);
            failed++;
          }
        })
      );
    }

    return NextResponse.json({ ok: true, total: rows.length, success, failed });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
