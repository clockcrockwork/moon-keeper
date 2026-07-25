// 観測地の推定。
//
// 月相（照明率）は世界共通なので、位置情報は「欠けの傾き」にしか効かない。
// だから初回訪問でいきなり許可ダイアログを出すことはしない。
// パネルで明示的に「現在地を使う」を押した時だけ Geolocation を要求し、
// それ以外はタイムゾーンから概算する。

// 主要な IANA タイムゾーンの緯度。経度は UTC オフセットから出せるので持たない。
// 表を小さく保つため、人口の多いゾーンだけに絞ってある。
const ZONE_LATITUDE = {
  'Africa/Cairo': 30.0, 'Africa/Johannesburg': -26.2, 'Africa/Lagos': 6.5,
  'Africa/Nairobi': -1.3, 'Africa/Casablanca': 33.6, 'Africa/Algiers': 36.8,
  'America/Anchorage': 61.2, 'America/Argentina/Buenos_Aires': -34.6,
  'America/Bogota': 4.7, 'America/Chicago': 41.9, 'America/Denver': 39.7,
  'America/Halifax': 44.6, 'America/Lima': -12.0, 'America/Los_Angeles': 34.1,
  'America/Mexico_City': 19.4, 'America/New_York': 40.7, 'America/Phoenix': 33.4,
  'America/Santiago': -33.4, 'America/Sao_Paulo': -23.6, 'America/Toronto': 43.7,
  'America/Vancouver': 49.3, 'Asia/Bangkok': 13.8, 'Asia/Dhaka': 23.8,
  'Asia/Dubai': 25.2, 'Asia/Ho_Chi_Minh': 10.8, 'Asia/Hong_Kong': 22.3,
  'Asia/Jakarta': -6.2, 'Asia/Jerusalem': 31.8, 'Asia/Kabul': 34.5,
  'Asia/Karachi': 24.9, 'Asia/Kathmandu': 27.7, 'Asia/Kolkata': 22.6,
  'Asia/Kuala_Lumpur': 3.1, 'Asia/Manila': 14.6, 'Asia/Riyadh': 24.7,
  'Asia/Seoul': 37.6, 'Asia/Shanghai': 31.2, 'Asia/Singapore': 1.4,
  'Asia/Taipei': 25.0, 'Asia/Tashkent': 41.3, 'Asia/Tehran': 35.7,
  'Asia/Tokyo': 35.7, 'Australia/Adelaide': -34.9, 'Australia/Brisbane': -27.5,
  'Australia/Melbourne': -37.8, 'Australia/Perth': -31.9, 'Australia/Sydney': -33.9,
  'Europe/Amsterdam': 52.4, 'Europe/Athens': 38.0, 'Europe/Berlin': 52.5,
  'Europe/Brussels': 50.8, 'Europe/Bucharest': 44.4, 'Europe/Budapest': 47.5,
  'Europe/Copenhagen': 55.7, 'Europe/Dublin': 53.3, 'Europe/Helsinki': 60.2,
  'Europe/Istanbul': 41.0, 'Europe/Kyiv': 50.5, 'Europe/Lisbon': 38.7,
  'Europe/London': 51.5, 'Europe/Madrid': 40.4, 'Europe/Moscow': 55.8,
  'Europe/Oslo': 59.9, 'Europe/Paris': 48.9, 'Europe/Prague': 50.1,
  'Europe/Rome': 41.9, 'Europe/Stockholm': 59.3, 'Europe/Vienna': 48.2,
  'Europe/Warsaw': 52.2, 'Europe/Zurich': 47.4, 'Pacific/Auckland': -36.8,
  'Pacific/Honolulu': 21.3,
};

// 表に無いゾーンのための、地域ごとのおおよその緯度
const REGION_LATITUDE = {
  Africa: 5, America: 35, Antarctica: -70, Asia: 30, Atlantic: 35,
  Australia: -30, Europe: 50, Indian: -10, Pacific: -15,
};

const DEFAULT = { lat: 35.68, lon: 139.77 };   // 作者の街

/**
 * タイムゾーンから観測地を概算する。
 *
 * 経度は UTC オフセットから出す（15°/時）。数度の誤差で済み、表も要らない。
 * 緯度はオフセットからは分からないので小さな表を引く。
 */
export function locationFromTimezone(date = new Date()) {
  // getTimezoneOffset() は「UTC より何分遅れているか」を返すので符号を反転する
  const lon = Math.max(-180, Math.min(180, -date.getTimezoneOffset() / 4));

  let zone = '';
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    zone = '';
  }

  if (zone in ZONE_LATITUDE) {
    return { lat: ZONE_LATITUDE[zone], lon, source: 'timezone' };
  }

  const region = zone.split('/')[0];
  if (region in REGION_LATITUDE) {
    return { lat: REGION_LATITUDE[region], lon, source: 'region' };
  }

  return { ...DEFAULT, source: 'default' };
}

/**
 * Geolocation を要求する。呼ばれるまで許可ダイアログは出ない。
 * 失敗・拒否時はタイムゾーン推定を返す（例外は投げない）。
 */
export function requestGeolocation({ timeout = 10000 } = {}) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({ ...locationFromTimezone(), error: 'unsupported' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          source: 'geolocation',
        }),
      (err) => resolve({ ...locationFromTimezone(), error: err.code === 1 ? 'denied' : 'failed' }),
      { timeout, maximumAge: 60 * 60 * 1000, enableHighAccuracy: false }
    );
  });
}

/** state.location の設定から実際に使う観測地を決める。 */
export function resolveLocation(location) {
  if (location.lat !== null && location.lon !== null) {
    return { lat: location.lat, lon: location.lon, source: location.mode };
  }
  return locationFromTimezone();
}
