// 月相の計算。外部ライブラリなし。
//
// Meeus 『Astronomical Algorithms』の短縮版（25章: 太陽、47章: 月、48章: 照明）。
// 期待精度は照明率が ±0.5% 程度、角度が ±1° 程度。この用途には十分すぎる。
//
// 注意: 照明率（欠け具合）は世界中どこで見ても同じ。緯度経度が効くのは
// 「欠けの傾き」だけ。だからこそ位置情報に意味があり、
// 拒否されても月相自体は正しく出る。

const DEG = Math.PI / 180;
const SYNODIC_MONTH = 29.530588853;

const sin = (deg) => Math.sin(deg * DEG);
const cos = (deg) => Math.cos(deg * DEG);

/** 度を 0–360 に正規化。 */
function norm360(x) {
  return ((x % 360) + 360) % 360;
}

/** Date → ユリウス日。 */
export function julianDay(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

/** 太陽の見かけの黄経（度）と地心距離（km）。 */
function sunPosition(T) {
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
  const e = 0.016708634 - 0.000042037 * T - 0.0000001267 * T * T;

  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * sin(M) +
    (0.019993 - 0.000101 * T) * sin(2 * M) +
    0.000289 * sin(3 * M);

  const trueLong = L0 + C;
  const v = M + C;                                   // 真近点角
  const R = (1.000001018 * (1 - e * e)) / (1 + e * cos(v));   // AU

  // 章動と光行差をまとめた簡易補正
  const omega = 125.04 - 1934.136 * T;
  const apparentLong = trueLong - 0.00569 - 0.00478 * sin(omega);

  return { longitude: norm360(apparentLong), distance: R * 149597870.7 };
}

/** 月の黄経・黄緯（度）と地心距離（km）。 */
function moonPosition(T) {
  const Lp = 218.3164477 + 481267.88123421 * T;      // 平均黄経
  const D = 297.8501921 + 445267.1114034 * T;        // 平均離角
  const M = 357.5291092 + 35999.0502909 * T;         // 太陽の平均近点角
  const Mp = 134.9633964 + 477198.8675055 * T;       // 月の平均近点角
  const F = 93.272095 + 483202.0175233 * T;          // 緯度引数

  const longitude =
    Lp +
    6.288774 * sin(Mp) +
    1.274027 * sin(2 * D - Mp) +
    0.658314 * sin(2 * D) +
    0.213618 * sin(2 * Mp) -
    0.185116 * sin(M) -
    0.114332 * sin(2 * F) +
    0.058793 * sin(2 * D - 2 * Mp) +
    0.057066 * sin(2 * D - M - Mp) +
    0.053322 * sin(2 * D + Mp) +
    0.045758 * sin(2 * D - M) -
    0.040923 * sin(M - Mp) -
    0.03472 * sin(D) -
    0.030383 * sin(M + Mp) +
    0.015327 * sin(2 * D - 2 * F) -
    0.012528 * sin(Mp + 2 * F) +
    0.01098 * sin(Mp - 2 * F) +
    0.010675 * sin(4 * D - Mp) +
    0.010034 * sin(3 * Mp);

  const latitude =
    5.128122 * sin(F) +
    0.280602 * sin(Mp + F) +
    0.277693 * sin(Mp - F) +
    0.173237 * sin(2 * D - F) +
    0.055413 * sin(2 * D - Mp + F) +
    0.046271 * sin(2 * D - Mp - F) +
    0.032573 * sin(2 * D + F) +
    0.017198 * sin(2 * Mp + F) +
    0.009266 * sin(2 * D + Mp - F) +
    0.008822 * sin(2 * Mp - F) +
    0.008216 * sin(2 * D - M - F) +
    0.004324 * sin(2 * D - 2 * Mp - F);

  const distance =
    385000.56 -
    20905.355 * cos(Mp) -
    3699.111 * cos(2 * D - Mp) -
    2955.968 * cos(2 * D) -
    569.925 * cos(2 * Mp) +
    48.888 * cos(M) -
    3.149 * cos(2 * F) +
    246.158 * cos(2 * D - 2 * Mp) -
    152.138 * cos(2 * D - M - Mp) -
    170.733 * cos(2 * D + Mp) -
    204.586 * cos(2 * D - M) -
    129.62 * cos(M - Mp) +
    108.743 * cos(D) +
    104.755 * cos(M + Mp);

  return { longitude: norm360(longitude), latitude, distance };
}

/** 黄道座標 → 赤道座標（ラジアン）。 */
function toEquatorial(longitude, latitude, obliquity) {
  const sl = sin(longitude);
  const cl = cos(longitude);
  const sb = sin(latitude);
  const cb = cos(latitude);
  const se = sin(obliquity);
  const ce = cos(obliquity);

  const ra = Math.atan2(sl * ce - (sb / cb) * se, cl);
  const dec = Math.asin(sb * ce + cb * se * sl);
  return { ra, dec };
}

/** グリニッジ平均恒星時（度）。 */
function greenwichSiderealTime(jd, T) {
  return norm360(
    280.46061837 +
      360.98564736629 * (jd - 2451545.0) +
      0.000387933 * T * T -
      (T * T * T) / 38710000
  );
}

const MOON_NAMES = [
  [0.7, '新月'],
  [2.5, '繊月'],
  [4.0, '三日月'],
  [6.5, '夕月'],
  [8.5, '上弦'],
  [11.0, '九夜月'],
  [12.5, '十三夜'],
  [14.0, '小望月'],
  [15.8, '満月'],
  [17.0, '十六夜'],
  [18.5, '立待月'],
  [20.5, '寝待月'],
  [23.0, '下弦'],
  [26.0, '有明月'],
  [28.5, '三十日月'],
];

/** 月齢（日）から和名を返す。 */
export function moonName(age) {
  for (const [limit, name] of MOON_NAMES) {
    if (age < limit) return name;
  }
  return '新月';
}

/**
 * 指定時刻・指定地点の月相。
 *
 * @param {Date} date
 * @param {{lat: number, lon: number}} [observer] 度。省略すると欠けの傾きは
 *   天球上の位置角のみ（観測地による回転を含まない）になる。
 */
export function moonPhase(date = new Date(), observer = null) {
  const jd = julianDay(date);
  const T = (jd - 2451545.0) / 36525;

  const sun = sunPosition(T);
  const moon = moonPosition(T);
  const obliquity = 23.439291 - 0.0130042 * T;

  const sunEq = toEquatorial(sun.longitude, 0, obliquity);
  const moonEq = toEquatorial(moon.longitude, moon.latitude, obliquity);

  // 地心離角（Meeus 48.2）
  const elongation = Math.acos(
    Math.min(1, Math.max(-1, cos(moon.latitude) * cos(moon.longitude - sun.longitude)))
  );

  // 位相角 i（Meeus 48.3）。0 = 満月, π = 新月
  const phaseAngle = Math.atan2(
    sun.distance * Math.sin(elongation),
    moon.distance - sun.distance * Math.cos(elongation)
  );

  const illuminatedFraction = (1 + Math.cos(phaseAngle)) / 2;

  // 満ちているか欠けているか: 月が太陽より東にあれば満ちていく
  const waxing = sin(moon.longitude - sun.longitude) > 0;

  const ratio = phaseAngle / Math.PI;
  const phase01 = waxing ? (1 - ratio) / 2 : (1 + ratio) / 2;
  const age = phase01 * SYNODIC_MONTH;

  // 明端の位置角 χ（Meeus 48.5）。天の北から東向きに測る
  const dRa = sunEq.ra - moonEq.ra;
  const brightLimbAngle = Math.atan2(
    Math.cos(sunEq.dec) * Math.sin(dRa),
    Math.sin(sunEq.dec) * Math.cos(moonEq.dec) -
      Math.cos(sunEq.dec) * Math.sin(moonEq.dec) * Math.cos(dRa)
  );

  // パララクティック角 q。ここで初めて観測地の緯度経度が効く。
  // 天の北と天頂方向のなす角で、これを引くと「見上げた時の傾き」になる。
  let parallacticAngle = 0;
  if (observer) {
    const lst = greenwichSiderealTime(jd, T) + observer.lon;
    const H = (lst - (moonEq.ra / DEG)) * DEG;      // 時角
    parallacticAngle = Math.atan2(
      Math.sin(H),
      Math.tan(observer.lat * DEG) * Math.cos(moonEq.dec) -
        Math.sin(moonEq.dec) * Math.cos(H)
    );
  }

  return {
    date,
    illuminatedFraction,
    phaseAngle,
    phase01,
    age,
    waxing,
    name: moonName(age),
    brightLimbAngle,
    parallacticAngle,
    /** 画面上での明端の傾き（天頂を上とした時の角度、ラジアン） */
    screenLimbAngle: brightLimbAngle - parallacticAngle,
    moonDistance: moon.distance,
  };
}

/**
 * 手動スライダー用。phase01 から位相角と照明率を作る。
 * 欠けの傾きは実際の空の値をそのまま使いたいので、呼び出し側で
 * moonPhase() の screenLimbAngle と組み合わせる。
 */
export function phaseFromSlider(phase01) {
  const p = ((phase01 % 1) + 1) % 1;
  const waxing = p < 0.5;
  const ratio = waxing ? 1 - 2 * p : 2 * p - 1;
  const phaseAngle = ratio * Math.PI;
  const age = p * SYNODIC_MONTH;
  return {
    illuminatedFraction: (1 + Math.cos(phaseAngle)) / 2,
    phaseAngle,
    phase01: p,
    age,
    waxing,
    name: moonName(age),
  };
}
