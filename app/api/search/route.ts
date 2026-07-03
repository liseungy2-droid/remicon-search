import { NextRequest, NextResponse } from 'next/server';
import { getDB } from '@/lib/db';
import type { RemiconCompany, SearchResult } from '@/types';

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function getDirections(siteLng: number, siteLat: number, goalLng: number, goalLat: number): Promise<{ distance: number; duration: number }> {
  try {
    const res = await fetch(
      `https://maps.apigw.ntruss.com/map-direction/v1/driving?start=${siteLng},${siteLat}&goal=${goalLng},${goalLat}&option=tracomfort`,
      {
        headers: {
          'X-NCP-APIGW-API-KEY-ID': process.env.NAVER_CLIENT_ID!,
          'X-NCP-APIGW-API-KEY': process.env.NAVER_CLIENT_SECRET!,
        },
        signal: AbortSignal.timeout(8000),
      }
    );
    const data = await res.json();
    const summary = data.route?.tracomfort?.[0]?.summary;
    if (summary) {
      return {
        distance: summary.distance / 1000,
        duration: summary.duration,
      };
    }
  } catch { /* 폴백 */ }
  return { distance: 0, duration: 0 };
}

export async function POST(request: NextRequest) {
  const { lat, lng, radius } = await request.json();

  const db = getDB();
  const result = await db.execute('SELECT * FROM remicon_companies WHERE lat IS NOT NULL AND lng IS NOT NULL');
  const all = result.rows as unknown as RemiconCompany[];

  // 포함/제외는 직선거리로만 판단 → API 성패와 무관하게 매번 동일한 결과
  const candidates = all
    .map(c => ({ ...c, straightDist: haversine(lat, lng, c.lat!, c.lng!) }))
    .filter(c => c.straightDist <= radius)
    .sort((a, b) => a.straightDist - b.straightDist);

  const results: SearchResult[] = [];
  const CHUNK = 5;

  // 길찾기 API는 도로거리·소요시간 표시용으로만 사용 (포함 여부에 영향 없음)
  for (let i = 0; i < candidates.length; i += CHUNK) {
    const chunk = candidates.slice(i, i + CHUNK);
    const dirs = await Promise.all(
      chunk.map(c => getDirections(lng, lat, c.lng!, c.lat!))
    );
    chunk.forEach((c, j) => {
      results.push({
        rank: 0,
        id: c.id,
        name: c.name,
        address: c.address,
        phone: c.phone,
        capacity: c.capacity,
        trucks: c.trucks,
        lat: c.lat!,
        lng: c.lng!,
        straightDist: c.straightDist,
        distance: dirs[j].distance > 0 ? dirs[j].distance : c.straightDist,
        duration: dirs[j].duration,
      });
    });
  }

  results.sort((a, b) => a.distance - b.distance);

  // 도로거리가 반경 초과하는 결과 제거 (API 실패 시 straightDist로 대체되므로 일관성 유지됨)
  const filtered = results.filter(r => r.distance <= radius);
  filtered.forEach((r, i) => { r.rank = i + 1; });

  return NextResponse.json({ results: filtered });
}
