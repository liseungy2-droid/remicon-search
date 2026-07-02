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
  distance: number;
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
