import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

mkdirSync(join(root, 'data'), { recursive: true });
const db = new Database(join(root, 'data', 'admin.db'));
const schema = readFileSync(join(root, 'schema.sql'), 'utf-8');
db.exec(schema);

// 서울/수도권 샘플 레미콘사 데이터 (좌표 미리 입력)
const companies = [
  { name: '한국레미콘 강남공장',   address: '서울특별시 강남구 테헤란로 123',          phone: '02-1234-5678', capacity: '120㎥/hr', trucks: 15, lat: 37.5085, lng: 127.0630 },
  { name: '대성레미콘 송파지점',   address: '서울특별시 송파구 올림픽로 300',          phone: '02-2345-6789', capacity: '100㎥/hr', trucks: 12, lat: 37.5145, lng: 127.1050 },
  { name: '삼표레미콘 성동공장',   address: '서울특별시 성동구 왕십리로 50',           phone: '02-3456-7890', capacity: '150㎥/hr', trucks: 18, lat: 37.5636, lng: 127.0370 },
  { name: '유진레미콘 광진공장',   address: '서울특별시 광진구 능동로 209',            phone: '02-4567-8901', capacity: '90㎥/hr',  trucks: 10, lat: 37.5484, lng: 127.0850 },
  { name: '동양레미콘 마포지점',   address: '서울특별시 마포구 상암동 1600',           phone: '02-5678-9012', capacity: '110㎥/hr', trucks: 14, lat: 37.5665, lng: 126.8980 },
  { name: '아세아레미콘 구로공장', address: '서울특별시 구로구 경인로 661',            phone: '02-6789-0123', capacity: '130㎥/hr', trucks: 16, lat: 37.4965, lng: 126.8877 },
  { name: '한일레미콘 관악지점',   address: '서울특별시 관악구 남부순환로 1926',       phone: '02-7890-1234', capacity: '80㎥/hr',  trucks: 9,  lat: 37.4784, lng: 126.9516 },
  { name: '성신레미콘 성북공장',   address: '서울특별시 성북구 돌곶이로 13',           phone: '02-8901-2345', capacity: '95㎥/hr',  trucks: 11, lat: 37.6063, lng: 127.0630 },
  { name: '두산레미콘 노원공장',   address: '서울특별시 노원구 동일로 1366',           phone: '02-9012-3456', capacity: '140㎥/hr', trucks: 17, lat: 37.6541, lng: 127.0760 },
  { name: '경기레미콘 성남공장',   address: '경기도 성남시 중원구 둔촌대로 545',       phone: '031-111-2222', capacity: '160㎥/hr', trucks: 20, lat: 37.4449, lng: 127.1388 },
  { name: '수원레미콘 권선공장',   address: '경기도 수원시 권선구 수인로 126',         phone: '031-222-3333', capacity: '120㎥/hr', trucks: 15, lat: 37.2635, lng: 127.0286 },
  { name: '인천레미콘 남동공장',   address: '인천광역시 남동구 논현동 680',            phone: '032-333-4444', capacity: '180㎥/hr', trucks: 22, lat: 37.4019, lng: 126.7310 },
  { name: '고양레미콘 일산공장',   address: '경기도 고양시 일산동구 중앙로 1305',      phone: '031-444-5555', capacity: '110㎥/hr', trucks: 13, lat: 37.6600, lng: 126.7720 },
  { name: '부천레미콘 중동공장',   address: '경기도 부천시 중동로 248',               phone: '032-555-6666', capacity: '100㎥/hr', trucks: 12, lat: 37.5034, lng: 126.7660 },
  { name: '안양레미콘 동안공장',   address: '경기도 안양시 동안구 시민대로 285',       phone: '031-666-7777', capacity: '130㎥/hr', trucks: 16, lat: 37.3943, lng: 126.9565 },
];

db.prepare('DELETE FROM remicon_companies').run();

const insert = db.prepare(`
  INSERT INTO remicon_companies (name, address, phone, capacity, trucks, lat, lng)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

for (const c of companies) {
  insert.run(c.name, c.address, c.phone, c.capacity, c.trucks, c.lat, c.lng);
}

console.log(`샘플 데이터 ${companies.length}개 입력 완료`);
db.close();
