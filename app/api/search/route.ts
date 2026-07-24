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

async function getDirections(siteLng: number, siteLat: number, goalLng: number, goalLat: number, filterMode: 'distance' | 'time'): Promise<{ distance: number; duration: number }> {
  const option = filterMode === 'time' ? 'traoptimal' : 'trafast';
  try {
    const res = await fetch(
      `https://maps.apigw.ntruss.com/map-direction/v1/driving?start=${siteLng},${siteLat}&goal=${goalLng},${goalLat}&option=${option}`,
      {
        headers: {
          'X-NCP-APIGW-API-KEY-ID': process.env.NAVER_CLIENT_ID!,
          'X-NCP-APIGW-API-KEY': process.env.NAVER_CLIENT_SECRET!,
        },
        signal: AbortSignal.timeout(8000),
      }
    );
    const data = await res.json();
    const summary = data.route?.[option]?.[0]?.summary;
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
  const { lat, lng, radius, filterMode = 'distance', maxDuration = 40 } = await request.json();

  const db = getDB();
  const result = await db.execute('SELECT * FROM remicon_companies WHERE lat IS NOT NULL AND lng IS NOT NULL');
  const all = result.rows as unknown as RemiconCompany[];

  // 시간 모드: 소요시간(분) × 1.5km 를 직선거리 사전 필터로 사용
  const preFilterRadius = filterMode === 'time' ? maxDuration * 1.5 : radius;

  const candidates = all
    .map(c => ({ ...c, straightDist: haversine(lat, lng, c.lat!, c.lng!) }))
    .filter(c => c.straightDist <= preFilterRadius)
    .sort((a, b) => a.straightDist - b.straightDist);

  const results: SearchResult[] = [];
  const CHUNK = 5;

  for (let i = 0; i < candidates.length; i += CHUNK) {
    const chunk = candidates.slice(i, i + CHUNK);
    const dirs = await Promise.all(
      chunk.map(c => getDirections(lng, lat, c.lng!, c.lat!, filterMode))
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

  let filtered: SearchResult[];
  if (filterMode === 'time') {
    const maxMs = maxDuration * 60 * 1000;
    results.sort((a, b) => a.duration - b.duration);
    filtered = results.filter(r => r.duration > 0 && r.duration <= maxMs);
  } else {
    results.sort((a, b) => a.distance - b.distance);
    filtered = results.filter(r => r.distance <= radius);
  }
  filtered.forEach((r, i) => { r.rank = i + 1; });

  return NextResponse.json({ results: filtered });
}
