import { NextResponse } from 'next/server';
import { getDB } from '@/lib/db';
import type { RemiconCompany } from '@/types';

export async function GET() {
  const db = getDB();
  const result = await db.execute('SELECT * FROM remicon_companies ORDER BY name');
  const companies = result.rows as unknown as RemiconCompany[];
  return NextResponse.json({ companies, count: companies.length });
}
