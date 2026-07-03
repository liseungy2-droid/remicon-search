export type RemiconCompany = {
  id: number;
  name: string;
  address: string;
  phone: string;
  capacity: string;
  trucks: number;
  lat: number | null;
  lng: number | null;
};

export type SearchResult = {
  id: number;
  name: string;
  address: string;
  phone: string;
  capacity: string;
  trucks: number;
  lat: number;
  lng: number;
  straightDist: number;  // 직선거리 (지도 원 기준)
  distance: number;      // 도로거리 (네이버 길찾기, 없으면 직선거리)
  duration: number;
  rank: number;
};

export type SiteInfo = {
  address: string;
  lat: number;
  lng: number;
};

export type SearchResponse = {
  site: SiteInfo;
  results: SearchResult[];
};
