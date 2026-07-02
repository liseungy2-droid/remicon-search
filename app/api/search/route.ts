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
      `https://maps.apigw.ntruss.com/map-direction/v1/driving?start=${siteLng},${siteLat}&goal=${goalLng},${goalLat}&option=trafast`,
      {
        headers: {
          'X-NCP-APIGW-API-KEY-ID': process.env.NAVER_CLIENT_ID!,
          'X-NCP-APIGW-API-KEY': process.env.NAVER_CLIENT_SECRET!,
        },
        signal: AbortSignal.timeout(5000),
      }
    );
    const data = await res.json();
    const summary = data.route?.trafast?.[0]?.summary;
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

  const candidates = all
    .map(c => ({ ...c, straightDist: haversine(lat, lng, c.lat!, c.lng!) }))
    .filter(c => c.straightDist <= radius * 1.5)
    .sort((a, b) => a.straightDist - b.straightDist);

  const results: SearchResult[] = [];
  const CHUNK = 5;

  for (let i = 0; i < candidates.length; i += CHUNK) {
    const chunk = candidates.slice(i, i + CHUNK);
    const dirs = await Promise.all(
      chunk.map(c => getDirections(lng, lat, c.lng!, c.lat!))
    );
    chunk.forEach((c, j) => {
      const roadDist = dirs[j].distance > 0 ? dirs[j].distance : c.straightDist;
      if (roadDist > radius) return;
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
        distance: roadDist,
        duration: dirs[j].duration,
      });
    });
  }

  results.sort((a, b) => a.distance - b.distance);
  results.forEach((r, i) => { r.rank = i + 1; });

  return NextResponse.json({ results });
}
