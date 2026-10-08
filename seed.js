// Cách chạy (PowerShell):  $env:TMDB_KEY="key-của-bạn"; node seed.js
const fs = require("fs");
const KEY = process.env.TMDB_KEY;
if (!KEY) { console.log("Thiếu biến TMDB_KEY"); process.exit(1); }
const base = "https://api.themoviedb.org/3";

(async () => {
  const g = await (await fetch(`${base}/genre/movie/list?api_key=${KEY}&language=vi-VN`)).json();
  const genreMap = Object.fromEntries(g.genres.map((x) => [x.id, x.name]));

  let all = [];
  for (let page = 1; page <= 3; page++) {
    const r = await (await fetch(`${base}/movie/popular?api_key=${KEY}&language=vi-VN&page=${page}`)).json();
    all = all.concat(r.results);
  }

  const movies = all.map((m) => ({
    id: m.id,
    title: m.title,
    year: Number((m.release_date || "0").slice(0, 4)),
    genres: m.genre_ids.map((id) => genreMap[id]).filter(Boolean),
    rating: Math.round(m.vote_average * 10) / 10,
    overview: m.overview || "Chưa có mô tả",
    posterUrl: m.poster_path ? `https://image.tmdb.org/t/p/w342${m.poster_path}` : "",
  }));

  fs.writeFileSync("movies.json", JSON.stringify(movies, null, 2));
  console.log("Đã ghi", movies.length, "phim");
})();