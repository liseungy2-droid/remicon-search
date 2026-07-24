'use client';

import { useState, useRef, useCallback } from 'react';
import Script from 'next/script';
import type { SearchResult } from '@/types';

declare global {
  interface Window {
    naver: any;
  }
}

export default function SearchPage() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const infoWindowsRef = useRef<any[]>([]);

  const [address, setAddress] = useState('');
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<{ lat: number; lng: number; address: string } | null>(null);
  const [radius, setRadius] = useState(30);
  const [filterMode, setFilterMode] = useState<'distance' | 'time'>('distance');
  const [maxDuration, setMaxDuration] = useState(40);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [searched, setSearched] = useState(false);

  const siteRef = useRef<{ lat: number; lng: number } | null>(null);
  const resultsRef = useRef<SearchResult[]>([]);
  const onExcludeRef = useRef<(id: number) => void>(() => {});
  const onMoveRef = useRef<(id: number, lat: number, lng: number) => void>(() => {});
  const circlesRef = useRef<any[]>([]);

  const initMap = useCallback(() => {
    if (!mapRef.current || !window.naver) return;
    const map = new window.naver.maps.Map(mapRef.current, {
      center: new window.naver.maps.LatLng(36.5, 127.5),
      zoom: 7,
      zoomControl: true,
      zoomControlOptions: { position: window.naver.maps.Position.TOP_RIGHT },
    });
    mapInstanceRef.current = map;
    setMapReady(true);
  }, []);

  const geocodeAddress = useCallback((query: string) => {
    if (!query || !window.naver?.maps?.Service) return;
    window.naver.maps.Service.geocode({ query }, (status: any, response: any) => {
      if (status !== window.naver.maps.Service.Status.OK || !response.v2.addresses?.length) {
        setSuggestions([]);
        setShowSuggestions(false);
        return;
      }
      setSuggestions(response.v2.addresses);
      setShowSuggestions(true);
    });
  }, []);

  const selectSuggestion = (item: any) => {
    const lat = parseFloat(item.y);
    const lng = parseFloat(item.x);
    const addr = item.roadAddress || item.jibunAddress;
    setAddress(addr);
    setSelectedLocation({ lat, lng, address: addr });
    setSuggestions([]);
    setShowSuggestions(false);
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setCenter(new window.naver.maps.LatLng(lat, lng));
      mapInstanceRef.current.setZoom(12);
    }
  };

  const clearCircles = () => {
    circlesRef.current.forEach(c => c.setMap(null));
    circlesRef.current = [];
  };

  const clearMarkers = () => {
    infoWindowsRef.current.forEach(iw => iw.close());
    infoWindowsRef.current = [];
    markersRef.current.forEach(m => m.setMap(null));
    markersRef.current = [];
    clearCircles();
  };

  const updateMarkers = useCallback((site: { lat: number; lng: number }, companies: SearchResult[], onExclude: (id: number) => void, onMove: (id: number, lat: number, lng: number) => void) => {
    const map = mapInstanceRef.current;
    if (!map) return;
    clearMarkers();

    // 현장 마커
    const siteMarker = new window.naver.maps.Marker({
      position: new window.naver.maps.LatLng(site.lat, site.lng),
      map,
      icon: {
        content: '<div style="background:#dc2626;color:white;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:10px;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4)">현장</div>',
        anchor: new window.naver.maps.Point(18, 18),
      },
    });
    markersRef.current.push(siteMarker);

    const HIGHLIGHT_NAMES = ['유진기업', '이순산업', '현대개발 본사', '현대개발 김해', '당진기업'];
    const isHighlight = (name: string) =>
      HIGHLIGHT_NAMES.some(k => k.split(' ').every(word => name.includes(word)));

    // 레미콘사 마커
    companies.forEach((c, i) => {
      const highlight = isHighlight(c.name);
      const markerColor = highlight ? '#d97706' : '#1d4ed8';
      const shortName = c.name
        .replace(/^\(주\)\s*/, '').replace(/\s*\(주\)$/, '')
        .replace(/^주식회사\s*/, '').trim().slice(0, 5);
      const lH = 24;
      const lW = shortName.length * 12 + 20;
      const r = lH / 2 - 1;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${lW}" height="${lH}"><rect x="1" y="1" width="${lW - 2}" height="${lH - 2}" rx="${r}" ry="${r}" fill="${markerColor}" stroke="white" stroke-width="2"/><text x="${lW / 2}" y="${lH / 2 + 4}" text-anchor="middle" fill="white" font-size="11" font-weight="bold" font-family="'Malgun Gothic','Apple SD Gothic Neo',sans-serif">${shortName}</text></svg>`;
      const marker = new window.naver.maps.Marker({
        position: new window.naver.maps.LatLng(c.lat, c.lng),
        map,
        draggable: true,
        icon: {
          content: `<img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}" width="${lW}" height="${lH}" style="cursor:grab;display:block;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.35))" />`,
          anchor: new window.naver.maps.Point(Math.round(lW / 2), Math.round(lH / 2)),
        },
      });

      const iw = new window.naver.maps.InfoWindow({
        content: `<div style="padding:10px 14px;font-size:12px;line-height:1.7;min-width:180px;font-family:inherit">
          <b style="font-size:13px;color:#111">${c.name}</b><br>
          <span style="color:#666">${c.address}</span><br>
          <span style="color:#444">거리: ${c.distance.toFixed(1)}km&nbsp;&nbsp;소요: ${c.duration > 0 ? Math.round(c.duration / 60000) + '분' : '-'}</span><br>
          <div style="margin-top:8px;display:flex;gap:6px">
            <button onclick="window.__vmc_exclude_${c.id}()" style="flex:1;padding:4px 8px;background:#ef4444;color:white;border:none;border-radius:4px;font-size:11px;cursor:pointer">제외</button>
            <button onclick="window.__vmc_close_${c.id}()" style="flex:1;padding:4px 8px;background:#e5e7eb;color:#333;border:none;border-radius:4px;font-size:11px;cursor:pointer">닫기</button>
          </div>
        </div>`,
        borderWidth: 1,
        borderColor: '#e5e7eb',
        backgroundColor: '#ffffff',
      });

      (window as any)[`__vmc_exclude_${c.id}`] = () => { iw.close(); onExclude(c.id); };
      (window as any)[`__vmc_close_${c.id}`] = () => iw.close();

      window.naver.maps.Event.addListener(marker, 'click', () => {
        infoWindowsRef.current.forEach(w => w.close());
        iw.open(map, marker);
      });

      window.naver.maps.Event.addListener(marker, 'dragend', () => {
        const pos = marker.getPosition();
        onMove(c.id, pos.lat(), pos.lng());
        iw.close();
      });

      markersRef.current.push(marker);
      infoWindowsRef.current.push(iw);
    });

    // 반경 원 (10 / 20 / 30km 점선)
    const RINGS = [
      { km: 10, color: '#3b82f6' },
      { km: 20, color: '#f59e0b' },
      { km: 30, color: '#ef4444' },
    ];
    RINGS.forEach(({ km, color }) => {
      const circle = new window.naver.maps.Circle({
        map,
        center: new window.naver.maps.LatLng(site.lat, site.lng),
        radius: km * 1000,
        strokeColor: color,
        strokeWeight: 1.5,
        strokeOpacity: 0.6,
        strokeStyle: 'shortdash',
        fillOpacity: 0,
      });
      // 라벨: 원의 오른쪽 (동쪽 끝)
      const labelLng = site.lng + (km * 1000) / (111320 * Math.cos((site.lat * Math.PI) / 180));
      const label = new window.naver.maps.Marker({
        position: new window.naver.maps.LatLng(site.lat, labelLng),
        map,
        icon: {
          content: `<div style="background:white;border:1px solid ${color};border-radius:3px;padding:1px 5px;font-size:10px;color:${color};font-weight:600;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,0.15)">${km}km</div>`,
          anchor: new window.naver.maps.Point(0, 10),
        },
      });
      circlesRef.current.push(circle, label);
    });

    if (companies.length > 0) {
      const bounds = new window.naver.maps.LatLngBounds(
        new window.naver.maps.LatLng(site.lat, site.lng),
        new window.naver.maps.LatLng(site.lat, site.lng),
      );
      companies.forEach(c => bounds.extend(new window.naver.maps.LatLng(c.lat, c.lng)));
      map.fitBounds(bounds, { padding: 70 });
    } else {
      map.setCenter(new window.naver.maps.LatLng(site.lat, site.lng));
      map.setZoom(11);
    }
  }, []);

  const handleExclude = (id: number) => {
    const updated = resultsRef.current
      .filter(r => r.id !== id)
      .map((r, i) => ({ ...r, rank: i + 1 }));
    resultsRef.current = updated;
    setResults(updated);
    if (siteRef.current) updateMarkers(siteRef.current, updated, onExcludeRef.current, onMoveRef.current);
  };
  onExcludeRef.current = handleExclude;

  const handleMove = (id: number, lat: number, lng: number) => {
    const updated = resultsRef.current.map(r => r.id === id ? { ...r, lat, lng } : r);
    resultsRef.current = updated;
    setResults(updated);
    if (siteRef.current) updateMarkers(siteRef.current, updated, onExcludeRef.current, onMoveRef.current);
  };
  onMoveRef.current = handleMove;

  const handleSearch = async () => {
    if (!selectedLocation) return;
    setLoading(true);
    setSearched(false);
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: selectedLocation.lat, lng: selectedLocation.lng, radius, filterMode, maxDuration }),
      });
      const data = await res.json();
      resultsRef.current = data.results;
      siteRef.current = selectedLocation;
      setResults(data.results);
      setSearched(true);
      updateMarkers(selectedLocation, data.results, onExcludeRef.current, onMoveRef.current);
    } finally {
      setLoading(false);
    }
  };

  const [exporting, setExporting] = useState(false);

  const handleExportExcel = async () => {
    setExporting(true);
    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          results,
          siteAddress: selectedLocation?.address,
          siteLat: selectedLocation?.lat,
          siteLng: selectedLocation?.lng,
          radius,
        }),
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `레미콘사_${selectedLocation?.address || '검색결과'}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <Script
        src={`https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${process.env.NEXT_PUBLIC_NAVER_CLIENT_ID}&submodules=geocoder`}
        strategy="afterInteractive"
        onLoad={initMap}
      />

      <div className="space-y-4 print:space-y-3">
        {/* 검색 컨트롤 */}
        <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm print:hidden">
          <h1 className="text-base font-semibold text-gray-800 mb-3">현장 주변 레미콘사 검색</h1>

          <div className="flex gap-3 items-end flex-wrap">
            {/* 주소 입력 */}
            <div className="flex-1 min-w-[240px] relative">
              <label className="text-xs text-gray-500 mb-1 block">현장 주소</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={address}
                  onChange={e => {
                    setAddress(e.target.value);
                    setSelectedLocation(null);
                    setShowSuggestions(false);
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); geocodeAddress(address); }
                    if (e.key === 'Escape') setShowSuggestions(false);
                  }}
                  placeholder="주소 입력 후 Enter 또는 확인 버튼"
                  className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gray-900"
                />
                <button
                  onClick={() => geocodeAddress(address)}
                  disabled={!address || !mapReady}
                  className="border border-gray-300 rounded-md px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-40 whitespace-nowrap"
                >
                  주소 확인
                </button>
              </div>

              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-md shadow-lg z-20 mt-1 max-h-52 overflow-y-auto">
                  {suggestions.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => selectSuggestion(s)}
                      className="w-full text-left px-3 py-2.5 text-sm hover:bg-blue-50 border-b border-gray-100 last:border-0"
                    >
                      <div className="font-medium text-gray-900">{s.roadAddress || s.jibunAddress}</div>
                      {s.roadAddress && s.jibunAddress && (
                        <div className="text-xs text-gray-400 mt-0.5">{s.jibunAddress}</div>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {selectedLocation && (
                <p className="text-xs text-green-600 mt-1.5">✓ {selectedLocation.address}</p>
              )}
            </div>

            {/* 필터 모드 + 조건 */}
            <div className="flex flex-col gap-2 w-56">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">검색 기준</label>
                <div className="flex gap-1">
                  {(['distance', 'time'] as const).map(mode => (
                    <button
                      key={mode}
                      onClick={() => setFilterMode(mode)}
                      className={`flex-1 py-1.5 text-xs rounded-md border font-medium transition-colors ${
                        filterMode === mode
                          ? 'bg-gray-900 text-white border-gray-900'
                          : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      {mode === 'distance' ? '거리 기준' : '시간 기준'}
                    </button>
                  ))}
                </div>
              </div>

              {filterMode === 'distance' ? (
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">
                    반경: <span className="font-semibold text-gray-900">{radius}km</span>
                  </label>
                  <input
                    type="range"
                    min={10}
                    max={40}
                    step={5}
                    value={radius}
                    onChange={e => setRadius(Number(e.target.value))}
                    className="w-full accent-gray-900"
                  />
                  <div className="flex justify-between text-xs text-gray-400 mt-0.5">
                    <span>10km</span><span>30km</span><span>40km</span>
                  </div>
                </div>
              ) : (
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">
                    소요시간: <span className="font-semibold text-gray-900">{maxDuration}분</span>
                  </label>
                  <input
                    type="range"
                    min={20}
                    max={70}
                    step={10}
                    value={maxDuration}
                    onChange={e => setMaxDuration(Number(e.target.value))}
                    className="w-full accent-gray-900"
                  />
                  <div className="flex justify-between text-xs text-gray-400 mt-0.5">
                    <span>20분</span><span>기본 40분</span><span>70분</span>
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={handleSearch}
              disabled={!selectedLocation || loading}
              className="bg-[#0a0a0a] hover:bg-[#333] text-white px-5 py-2 rounded-md text-sm font-medium disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              {loading ? '검색 중...' : '검색'}
            </button>
          </div>
        </div>

        {/* 인쇄용 헤더 */}
        <div className="hidden print:block mb-2">
          <h1 className="text-lg font-bold text-gray-900">현장 주변 레미콘사 검색 결과</h1>
          {selectedLocation && (
            <p className="text-sm text-gray-600">
              현장: {selectedLocation.address} · {filterMode === 'distance' ? `반경 ${radius}km` : `소요시간 ${maxDuration}분`} 이내
            </p>
          )}
        </div>

        {/* 지도 */}
        <div
          ref={mapRef}
          className="w-full rounded-lg border border-gray-200 shadow-sm print:border-0 print:rounded-none bg-gray-100"
          style={{ height: 480 }}
        />

        {/* 결과 테이블 */}
        {results.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 print:hidden">
              <div>
                <h2 className="text-sm font-semibold text-gray-700">
                  검색 결과 <span className="text-gray-400 font-normal">{results.length}개</span>
                </h2>
                <p className="text-xs text-red-500 mt-0.5">
                  {filterMode === 'time'
                    ? '※ 거리·소요시간은 네이버 최적경로(최소시간) 기준 / 반경표시는 직선거리'
                    : '※ 거리·소요시간은 네이버 최단거리 기준 / 반경표시는 직선거리'}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleExportExcel}
                  disabled={exporting}
                  className="text-xs border border-gray-300 rounded-md px-3 py-1.5 hover:bg-gray-50 font-medium disabled:opacity-50"
                >
                  {exporting ? '지도 캡처 중...' : '엑셀 다운로드'}
                </button>
                <button
                  onClick={() => window.print()}
                  className="text-xs border border-gray-300 rounded-md px-3 py-1.5 hover:bg-gray-50 font-medium"
                >
                  인쇄 / PDF
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    {['순위', '업체명', '거리(km)', '소요시간', '소재지', '전화', '생산능력', '믹서트럭(대)'].map(h => (
                      <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {results.map(r => (
                    <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-3 py-2.5">
                        <span className="inline-flex items-center justify-center w-6 h-6 bg-blue-700 text-white rounded-full text-xs font-bold">
                          {r.rank}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-medium text-gray-900 whitespace-nowrap">{r.name}</td>
                      <td className="px-3 py-2.5 text-gray-700">{r.distance.toFixed(1)}</td>
                      <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">
                        {r.duration > 0 ? `${Math.round(r.duration / 60000)}분` : '-'}
                      </td>
                      <td className="px-3 py-2.5 text-gray-600 max-w-xs truncate">{r.address}</td>
                      <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{r.phone}</td>
                      <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{r.capacity}</td>
                      <td className="px-3 py-2.5 text-gray-600 text-center">{r.trucks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {searched && results.length === 0 && (
          <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-sm text-gray-500 shadow-sm">
            {filterMode === 'distance'
              ? `반경 ${radius}km 이내 등록된 레미콘사가 없습니다.`
              : `소요시간 ${maxDuration}분 이내 등록된 레미콘사가 없습니다.`}
          </div>
        )}
      </div>
    </>
  );
}
