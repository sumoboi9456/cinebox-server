// Cách chạy (PowerShell): $env:TMDB_KEY="key-của-bạn"; node seed.js
// Cách chạy (bash): TMDB_KEY="key-của-bạn" node seed.js
//
// Nạp 3 trang phim phổ biến từ TMDB + mã trailer YouTube của từng phim,
// ghi ra movies.json. Chỉ chạy 1 lần trước khi triển khai.
// Khóa API đọc từ biến môi trường TMDB_KEY, KHÔNG nằm trong mã nguồn.
const fs = require("fs");

const KEY = process.env.TMDB_KEY;
if (!KEY) {
  console.log("Thiếu biến TMDB_KEY");
  process.exit(1);
}

const base = "https://api.themoviedb.org/3";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // 1. Danh sách thể loại (tiếng Việt) để đổi genre_ids -> tên thể loại
  const g = await (
    await fetch(`${base}/genre/movie/list?api_key=${KEY}&language=vi-VN`)
  ).json();
  const genreMap = Object.fromEntries(g.genres.map((x) => [x.id, x.name]));

  // 2. Ba trang phim phổ biến (mỗi trang 20 phim)
  let all = [];
  for (let page = 1; page <= 3; page++) {
    const r = await (
      await fetch(
        `${base}/movie/popular?api_key=${KEY}&language=vi-VN&page=${page}`
      )
    ).json();
    all = all.concat(r.results);
  }

  // 3. Loại trùng id (TMDB có thể trả cùng một phim ở 2 trang khác nhau,
  // hoặc cùng id với rating khác nhau) — chỉ giữ lần xuất hiện đầu tiên.
  const seen = new Set();
  all = all.filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });

  // 4. Với từng phim, gọi thêm /movie/{id}/videos để lấy mã trailer YouTube.
  // Ưu tiên video type === "Trailer" và site === "YouTube"; nếu không có
  // trailer thì trailerKey = "" (app phải kiểm tra rỗng trước khi mở).
  const movies = [];
  for (const m of all) {
    let trailerKey = "";
    try {
      const v = await (
        await fetch(
          `${base}/movie/${m.id}/videos?api_key=${KEY}&language=vi-VN`
        )
      ).json();
      const trailer =
        (v.results || []).find(
          (x) => x.type === "Trailer" && x.site === "YouTube"
        ) || (v.results || []).find((x) => x.site === "YouTube");
      trailerKey = trailer ? trailer.key : "";
    } catch (e) {
      console.log(`Không lấy được trailer cho phim ${m.id}: ${e.message}`);
    }
    movies.push({
      id: m.id,
      title: m.title,
      year: Number((m.release_date || "0").slice(0, 4)),
      genres: m.genre_ids.map((id) => genreMap[id]).filter(Boolean),
      rating: Math.round(m.vote_average * 10) / 10,
      overview: m.overview || "Chưa có mô tả",
      posterUrl: m.poster_path
        ? `https://image.tmdb.org/t/p/w342${m.poster_path}`
        : "",
      trailerKey,
    });
    await sleep(120); // tránh gọi TMDB quá nhanh liên tiếp
  }

  fs.writeFileSync("movies.json", JSON.stringify(movies, null, 2));
  const withTrailer = movies.filter((m) => m.trailerKey).length;
  console.log(
    `Đã ghi ${movies.length} phim, trong đó ${withTrailer} phim có trailer`
  );
})();
