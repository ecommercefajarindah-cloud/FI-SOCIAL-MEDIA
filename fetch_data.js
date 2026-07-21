/**
 * fetch_data.js
 * ---------------------------------------------------------------
 * Menarik data Instagram + 2 akun TikTok dari Windsor.ai REST API
 * (https://connectors.windsor.ai), menghitung semua metrik/skor/
 * insight yang dipakai dashboard, lalu menulis hasilnya ke data.json.
 *
 * Dijalankan oleh GitHub Actions (lihat .github/workflows/refresh-data.yml)
 * setiap beberapa jam. Butuh env var WINDSOR_API_KEY.
 *
 * PENTING - satu hal yang perlu Anda verifikasi sekali secara manual:
 * parameter "accounts" di bawah ini (untuk memilih akun spesifik dalam
 * connector yang punya banyak akun terhubung) mengikuti pola yang sama
 * dengan yang dipakai Windsor MCP di Claude. Jika saat run pertama
 * workspace Anda hanya py akun tunggal, MUNGKIN tidak perlu di-set.
 * Jika data yang ke-fetch salah akun / kosong, coba jalankan salah satu
 * curl di SETUP.md untuk mengecek nama parameter yang benar
 * (kemungkinan lain: "account_id", atau via filter=[["account_id","eq","..."]]).
 * ---------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');

const API_KEY = process.env.WINDSOR_API_KEY;
if (!API_KEY) {
  console.error('ERROR: environment variable WINDSOR_API_KEY belum di-set.');
  process.exit(1);
}

const BASE_URL = 'https://connectors.windsor.ai';

// Catatan: ID akun Windsor MCP (mis. "_000y57J8zDvQXxRiieH7Grbx8oEtUjZajnP")
// TIDAK dipakai lagi di sini karena REST API publik ternyata tidak memfilter
// lewat parameter "accounts". Filter sekarang berbasis field "username"
// (lihat wf() dan loadTiktok() di bawah) — jauh lebih reliable dan sudah
// diverifikasi lewat curl oleh pengguna.

const BENCH = { instagram: 0.31, tiktok: 1.37 };

// ---------- date window helpers ----------
function addDays(dateStr, delta) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
function todayStr() { return new Date().toISOString().slice(0, 10); }

const CUR_END = addDays(todayStr(), -1);
const CUR_START = addDays(CUR_END, -29);
const PREV_END = addDays(CUR_START, -1);
const PREV_START = addDays(PREV_END, -29);

// ---------- generic helpers ----------
function num(n) { return (n === null || n === undefined || isNaN(n)) ? 0 : n; }
function pct(cur, prev) { if (!prev) return null; return ((cur - prev) / prev * 100); }
function parseDate(str) {
  if (!str) return new Date(NaN);
  let s = String(str).replace(' ', 'T');
  s = s.replace(/(\+\d{2})(\d{2})$/, '$1:$2');
  return new Date(s);
}
const WD_ORDER = [1, 2, 3, 4, 5, 6, 0];

function weekdaySeries(items, dateGetter, viewGetter) {
  const wd = [0,0,0,0,0,0,0], wdCount = [0,0,0,0,0,0,0];
  items.forEach((it) => {
    const d = dateGetter(it);
    if (isNaN(d)) return;
    const day = d.getDay();
    wd[day] += num(viewGetter(it));
    wdCount[day]++;
  });
  return WD_ORDER.map((i) => (wdCount[i] ? wd[i] / wdCount[i] : 0));
}

// ---------- Windsor REST call ----------
// NOTE: awalnya kode ini pakai parameter "accounts=<id>" untuk memilih akun
// spesifik (meniru perilaku Windsor MCP di Claude). Setelah diuji dengan
// curl oleh pengguna, ternyata REST API publik Windsor TIDAK memfilter lewat
// "accounts" — semua akun yang terhubung ke connector tetap ikut terbawa.
// Solusinya: pakai parameter "filter" yang resmi didokumentasikan Windsor
// (filter=[["username","eq","<username>"]]), yang menyaring di sisi server
// berdasarkan field apa pun, termasuk "username". Field "username" juga
// selalu diminta di setiap query supaya bisa dicek ulang di sisi client
// sebagai lapisan pengaman kedua (defense-in-depth) lewat filterByUsername().
async function wf(connector, fields, date_from, date_to, filterExpr) {
  const params = new URLSearchParams();
  params.set('api_key', API_KEY);
  params.set('fields', fields.join(','));
  if (date_from) params.set('date_from', date_from);
  if (date_to) params.set('date_to', date_to);
  if (filterExpr) params.set('filter', JSON.stringify(filterExpr));
  const url = `${BASE_URL}/${connector}?${params.toString()}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Windsor/1.0' } });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`Windsor API error ${res.status} for ${connector} fields=${fields.join(',')}: ${body.slice(0,300)}`);
      return [];
    }
    const json = await res.json();
    if (json.error) {
      console.error('Windsor API error payload:', json.error);
      return [];
    }
    return json.data || json.result || [];
  } catch (e) {
    console.error(`wf() network failure for ${connector} fields=${fields.join(',')}:`, e.message);
    return [];
  }
}

// ================= INSTAGRAM =================
// Hanya ada 1 akun Instagram terhubung di workspace ini, jadi tidak perlu
// filter per-akun (beda dengan TikTok yang punya 2 akun di connector yang sama).
async function loadInstagram() {
  const [dailyAll, followerRows, mediaCur, mediaPrev, accInfoRows, ageRows, genderRows, countryRows, cityRows] = await Promise.all([
    wf('instagram', ['date','reach_1d','likes','comments','saves','shares','views','total_interactions','accounts_engaged'], PREV_START, CUR_END),
    wf('instagram', ['date','follower_count_1d'], CUR_START, CUR_END),
    wf('instagram', ['media_id','timestamp','media_type','media_permalink','media_views','media_reach','media_saved','media_shares','media_like_count','media_comments_count','media_reel_avg_watch_time','media_follows'], CUR_START, CUR_END),
    wf('instagram', ['media_id','timestamp','media_type','media_permalink','media_views','media_reach','media_saved','media_shares','media_like_count','media_comments_count','media_reel_avg_watch_time','media_follows'], PREV_START, PREV_END),
    wf('instagram', ['username','followers_count','follows_count','media_count']),
    wf('instagram', ['audience_age_name','audience_age_size']),
    wf('instagram', ['audience_gender_name','audience_gender_size']),
    wf('instagram', ['audience_country_name','audience_country_size']),
    wf('instagram', ['city','audience_city_size']),
  ]);

  const dailyCur = dailyAll.filter(r => r.date >= CUR_START && r.date <= CUR_END);
  const dailyPrev = dailyAll.filter(r => r.date >= PREV_START && r.date <= PREV_END);
  const sum = (rows, f) => rows.reduce((a, r) => a + num(r[f]), 0);
  const curTotals = { reach: sum(dailyCur,'reach_1d'), likes: sum(dailyCur,'likes'), comments: sum(dailyCur,'comments'), saves: sum(dailyCur,'saves'), shares: sum(dailyCur,'shares'), views: sum(dailyCur,'views'), interactions: sum(dailyCur,'total_interactions'), engaged: sum(dailyCur,'accounts_engaged'), days: dailyCur.length || 1 };
  const prevTotals = { reach: sum(dailyPrev,'reach_1d'), likes: sum(dailyPrev,'likes'), comments: sum(dailyPrev,'comments'), saves: sum(dailyPrev,'saves'), shares: sum(dailyPrev,'shares'), views: sum(dailyPrev,'views'), interactions: sum(dailyPrev,'total_interactions'), engaged: sum(dailyPrev,'accounts_engaged'), days: dailyPrev.length || 1 };
  const newFollowers = followerRows.reduce((a, r) => a + num(r.follower_count_1d), 0);

  const er = curTotals.reach ? curTotals.interactions / curTotals.reach * 100 : 0;
  const erPrev = prevTotals.reach ? prevTotals.interactions / prevTotals.reach * 100 : 0;

  mediaCur.forEach(m => { m.score = num(m.media_views) + num(m.media_saved) * 15 + num(m.media_shares) * 12 + num(m.media_follows) * 20 + num(m.media_like_count); });
  const sorted = mediaCur.slice().sort((a, b) => b.score - a.score);
  const top10 = sorted.slice(0, 10);
  const bottom10 = sorted.slice(-10).reverse();
  const viral = sorted[0] || {};

  const byType = {};
  mediaCur.forEach(m => { const t = m.media_type || 'LAINNYA'; byType[t] = byType[t] || { count: 0, views: 0, likes: 0 }; byType[t].count++; byType[t].views += num(m.media_views); byType[t].likes += num(m.media_like_count); });

  const weekdayAvg = weekdaySeries(mediaCur, m => parseDate(m.timestamp), m => m.media_views);
  const account = accInfoRows[0] || {};

  function distFrom(rows, nameField, sizeField, mapper) {
    const total = rows.reduce((a, r) => a + num(r[sizeField]), 0);
    return rows.map(r => ({ label: mapper ? mapper(r[nameField]) : r[nameField], pct: total ? num(r[sizeField]) / total * 100 : 0 })).sort((a, b) => b.pct - a.pct);
  }
  const genderMap = { F: 'Perempuan', M: 'Laki-laki', U: 'Tidak diketahui' };
  const ageDist = distFrom(ageRows, 'audience_age_name', 'audience_age_size');
  const genderDist = distFrom(genderRows, 'audience_gender_name', 'audience_gender_size', v => genderMap[v] || v);
  const countryDist = distFrom(countryRows, 'audience_country_name', 'audience_country_size').slice(0, 8);

  const provMap = {}; let totalCity = 0;
  cityRows.forEach(r => { const parts = (r.city || '').split(','); const p = parts.length > 1 ? parts[parts.length - 1].trim() : parts[0].trim(); provMap[p] = (provMap[p] || 0) + num(r.audience_city_size); totalCity += num(r.audience_city_size); });
  const provDist = Object.keys(provMap).map(k => ({ label: k, pct: totalCity ? provMap[k] / totalCity * 100 : 0 })).sort((a, b) => b.pct - a.pct).slice(0, 8);

  const m = {
    views: curTotals.views, viewsGrowth: pct(curTotals.views, prevTotals.views),
    reach: curTotals.reach, reachGrowth: pct(curTotals.reach, prevTotals.reach),
    likes: curTotals.likes, likesGrowth: pct(curTotals.likes, prevTotals.likes),
    savesOrFav: curTotals.saves, savesGrowth: pct(curTotals.saves, prevTotals.saves),
    shares: curTotals.shares, sharesGrowth: pct(curTotals.shares, prevTotals.shares),
    comments: curTotals.comments, commentsGrowth: pct(curTotals.comments, prevTotals.comments),
    newFollowers: newFollowers, newFollowersGrowth: null,
    er, erPrev, benchmark: BENCH.instagram, vsBenchmarkPts: er - BENCH.instagram,
    avgViewPerDay: curTotals.views / curTotals.days,
    viralScore: viral.score || 0, viralViews: viral.media_views || 0,
  };

  return { key: 'ig', platform: 'instagram', label: 'Instagram', handle: '@fajarindahotomotif', color: 'ig',
    followersTotal: num(account.followers_count), mediaCount: num(account.media_count),
    curTotals, prevTotals, top10, bottom10, viral, byType, weekdayAvg, ageDist, genderDist, countryDist, provDist,
    dailyCur, dailyPrev, allSorted: sorted, m };
}

// ================= TIKTOK (generic) =================
// "username" dipakai sebagai kunci filter (lihat catatan panjang di atas wf()).
// filterByUsername() adalah lapisan pengaman kedua: kalau suatu baris kebetulan
// tidak membawa field username (mis. karena tidak ter-join di sisi server),
// baris itu TIDAK ikut ke-drop diam-diam — hanya baris yang eksplisit
// username-nya BEDA yang dibuang. Baris tanpa field username tetap disertakan
// dan akan tampak di log sebagai warning supaya ketahuan kalau ada masalah join.
function filterByUsername(rows, expectedUsername, label) {
  let unknownCount = 0;
  const out = rows.filter(r => {
    if (r.username === undefined || r.username === null) { unknownCount++; return true; }
    return r.username === expectedUsername;
  });
  if (unknownCount > 0) {
    console.warn(`[peringatan] ${unknownCount} baris dari "${label}" tidak membawa field username — tidak difilter, cek manual kalau angka akhir terlihat aneh.`);
  }
  return out;
}

async function loadTiktok(username, handle, label, key) {
  const filterExpr = [['username', 'eq', username]];
  const [dailyAllRaw, videosAllRaw, accInfoRowsRaw, ageGenderRowsRaw, countryRowsRaw] = await Promise.all([
    wf('tiktok_organic', ['date','username','followers_count','total_followers_count','likes','shares','comments','unique_video_views','video_views','profile_views','engaged_audience'], PREV_START, CUR_END, filterExpr),
    wf('tiktok_organic', ['video_id','username','video_caption','video_create_datetime','video_views_count','video_likes','video_shares','video_comments','video_favorites','video_reach','video_new_followers','video_average_time_watched','video_duration','video_share_url'], PREV_START, CUR_END, filterExpr),
    wf('tiktok_organic', ['username','display_name','total_followers_count','videos_count','total_likes'], null, null, filterExpr),
    wf('tiktok_organic', ['username','audience_ages_age','audience_ages_percentage','audience_genders_gender','audience_genders_percentage'], null, null, filterExpr),
    wf('tiktok_organic', ['username','audience_countries_country','audience_countries_percentage'], null, null, filterExpr),
  ]);

  const dailyAll = filterByUsername(dailyAllRaw, username, 'daily');
  const videosAll = filterByUsername(videosAllRaw, username, 'videos');
  const accInfoRows = filterByUsername(accInfoRowsRaw, username, 'account info');
  const ageGenderRows = filterByUsername(ageGenderRowsRaw, username, 'demografi usia/gender');
  const countryRows = filterByUsername(countryRowsRaw, username, 'demografi negara');

  const validDaily = dailyAll.filter(r => r.total_followers_count);
  const dailyCur = validDaily.filter(r => r.date >= CUR_START && r.date <= CUR_END);
  const dailyPrev = validDaily.filter(r => r.date >= PREV_START && r.date <= PREV_END);
  const sum = (rows, f) => rows.reduce((a, r) => a + num(r[f]), 0);
  const curTotals = { views: sum(dailyCur,'video_views'), likes: sum(dailyCur,'likes'), shares: sum(dailyCur,'shares'), comments: sum(dailyCur,'comments'), profileViews: sum(dailyCur,'profile_views'), engaged: sum(dailyCur,'engaged_audience'), uniqueViews: sum(dailyCur,'unique_video_views'), days: dailyCur.length || 1 };
  const prevTotals = { views: sum(dailyPrev,'video_views'), likes: sum(dailyPrev,'likes'), shares: sum(dailyPrev,'shares'), comments: sum(dailyPrev,'comments'), profileViews: sum(dailyPrev,'profile_views'), engaged: sum(dailyPrev,'engaged_audience'), uniqueViews: sum(dailyPrev,'unique_video_views'), days: dailyPrev.length || 1 };

  const fS_c = dailyCur.length ? dailyCur[0].total_followers_count : null;
  const fE_c = dailyCur.length ? dailyCur[dailyCur.length - 1].total_followers_count : null;
  const fS_p = dailyPrev.length ? dailyPrev[0].total_followers_count : null;
  const fE_p = dailyPrev.length ? dailyPrev[dailyPrev.length - 1].total_followers_count : null;
  const netFollowersCur = (fS_c !== null && fE_c !== null) ? (fE_c - fS_c) : null;
  const netFollowersPrev = (fS_p !== null && fE_p !== null) ? (fE_p - fS_p) : null;

  const er = curTotals.views ? (curTotals.likes + curTotals.shares + curTotals.comments) / curTotals.views * 100 : 0;
  const erPrev = prevTotals.views ? (prevTotals.likes + prevTotals.shares + prevTotals.comments) / prevTotals.views * 100 : 0;

  videosAll.forEach(v => { v.score = num(v.video_views_count) + num(v.video_favorites) * 15 + num(v.video_shares) * 12 + num(v.video_new_followers) * 20 + num(v.video_likes); });
  const videosCur = videosAll.filter(v => { const d = (v.video_create_datetime || '').slice(0, 10); return d >= CUR_START && d <= CUR_END; });
  const sorted = videosCur.slice().sort((a, b) => b.score - a.score);
  const top10 = sorted.slice(0, 10);
  const bottom10 = sorted.slice(-10).reverse();
  const viral = sorted[0] || {};

  const buckets = { '<20 dtk': { count: 0, views: 0 }, '20-40 dtk': { count: 0, views: 0 }, '>40 dtk': { count: 0, views: 0 } };
  videosCur.forEach(v => { const d = num(v.video_duration); const key2 = d < 20 ? '<20 dtk' : d <= 40 ? '20-40 dtk' : '>40 dtk'; buckets[key2].count++; buckets[key2].views += num(v.video_views_count); });

  const weekdayAvg = weekdaySeries(videosCur, v => parseDate(v.video_create_datetime), v => v.video_views_count);
  const account = accInfoRows[0] || {};
  const ageRows = ageGenderRows.filter(r => r.audience_ages_age);
  const genderRows = ageGenderRows.filter(r => r.audience_genders_gender);
  function distFrom(rows, nameField, pctField, mapper) {
    return rows.map(r => ({ label: mapper ? mapper(r[nameField]) : r[nameField], pct: num(r[pctField]) * 100 })).sort((a, b) => b.pct - a.pct);
  }
  const genderMap2 = { Male: 'Laki-laki', Female: 'Perempuan', Other: 'Lainnya' };
  const ageDist = distFrom(ageRows, 'audience_ages_age', 'audience_ages_percentage');
  const genderDist = distFrom(genderRows, 'audience_genders_gender', 'audience_genders_percentage', v => genderMap2[v] || v);
  const countryDist = distFrom(countryRows, 'audience_countries_country', 'audience_countries_percentage').slice(0, 8);

  const m = {
    views: curTotals.views, viewsGrowth: pct(curTotals.views, prevTotals.views),
    reach: curTotals.uniqueViews, reachGrowth: pct(curTotals.uniqueViews, prevTotals.uniqueViews),
    likes: curTotals.likes, likesGrowth: pct(curTotals.likes, prevTotals.likes),
    savesOrFav: sum(videosCur,'video_favorites'), savesGrowth: null,
    shares: curTotals.shares, sharesGrowth: pct(curTotals.shares, prevTotals.shares),
    comments: curTotals.comments, commentsGrowth: pct(curTotals.comments, prevTotals.comments),
    newFollowers: netFollowersCur, newFollowersGrowth: pct(netFollowersCur, netFollowersPrev),
    er, erPrev, benchmark: BENCH.tiktok, vsBenchmarkPts: er - BENCH.tiktok,
    avgViewPerDay: curTotals.views / curTotals.days,
    viralScore: viral.score || 0, viralViews: viral.video_views_count || 0,
  };
  // savesGrowth (favorites growth) needs previous-period favorites too
  const videosPrev = videosAll.filter(v => { const d = (v.video_create_datetime || '').slice(0, 10); return d >= PREV_START && d <= PREV_END; });
  const favPrev = sum(videosPrev, 'video_favorites');
  m.savesGrowth = pct(m.savesOrFav, favPrev);

  return { key, platform: 'tiktok', label, handle, color: key,
    followersTotal: num(account.total_followers_count), videosCount: num(account.videos_count), totalLikesAllTime: num(account.total_likes),
    curTotals, prevTotals, netFollowersCur, netFollowersPrev, buckets, top10, bottom10, viral, weekdayAvg,
    ageDist, genderDist, countryDist, dailyCur, dailyPrev, allSorted: sorted, m };
}

// ================= MAIN =================
async function main() {
  console.log(`Fetching Windsor data. Periode saat ini: ${CUR_START} s/d ${CUR_END} | Periode lalu: ${PREV_START} s/d ${PREV_END}`);
  const [ig, tt1, tt2] = await Promise.all([
    loadInstagram(),
    loadTiktok('fajarindahotomotif', '@fajarindahotomotif', 'TikTok 1 — Fajar Indah Otomotif', 'tt1'),
    loadTiktok('fiotomotiff', '@fiotomotiff', 'TikTok 2 — Fiotomotif', 'tt2'),
  ]);

  const output = {
    meta: {
      generated_at: new Date().toISOString(),
      period: { current: [CUR_START, CUR_END], previous: [PREV_START, PREV_END] },
    },
    accounts: { instagram: ig, tiktok1: tt1, tiktok2: tt2 },
  };

  const outPath = path.join(__dirname, 'data.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`Selesai. Ditulis ke ${outPath}`);
  console.log(`IG views=${ig.m.views} | TT1 views=${tt1.m.views} | TT2 views=${tt2.m.views}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
