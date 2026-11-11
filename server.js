const express = require("express");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
app.use(express.json()); // cho phép đọc body dạng JSON

// ---------- "Cơ sở dữ liệu" bằng file ----------
const DB_FILE = "db.json";
let db = fs.existsSync(DB_FILE)
  ? JSON.parse(fs.readFileSync(DB_FILE, "utf8"))
  : { users: [], reviews: [], tokens: {} };
// Phòng khi db.json cũ thiếu trường (vd. chỉ có users/reviews)
db.users = db.users || [];
db.reviews = db.reviews || [];
db.tokens = db.tokens || {};

const save = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
const movies = JSON.parse(fs.readFileSync("movies.json", "utf8"));

const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString("hex");

// ---------- Quy tắc kiểm tra dữ liệu (khớp Bảng 3.4 của báo cáo) ----------
const USERNAME_MSG =
  "Tên đăng nhập phải từ 3 đến 20 ký tự, chỉ gồm chữ, số và dấu gạch dưới";
const PASSWORD_MSG = "Mật khẩu phải có ít nhất 6 ký tự";
const RATING_MSG = "Điểm phải là số nguyên từ 1 đến 10";

const validUsername = (u) => typeof u === "string" && /^[A-Za-z0-9_]{3,20}$/.test(u);
const validPassword = (p) => typeof p === "string" && p.length >= 6;
const validRating = (n) => Number.isInteger(n) && n >= 1 && n <= 10;

// ---------- Tài khoản dùng thử: tự tạo khi khởi động nếu chưa có ----------
// Render gói miễn phí có thể mất db.json khi khởi động lại, nên demo luôn
// dùng được mà không cần đăng ký lại.
function ensureDemoUser() {
  if (!db.users.find((u) => u.username === "demo")) {
    const salt = crypto.randomBytes(8).toString("hex");
    db.users.push({ username: "demo", salt, hash: hashPw("demo123", salt) });
    save();
    console.log("Đã tạo tài khoản dùng thử demo / demo123");
  }
}
ensureDemoUser();

// ---------- Chuẩn hóa chuỗi tìm kiếm: thường + bỏ dấu tiếng Việt ----------
// "Ác Quỷ" -> "ac quy", "Avatar" -> "avatar": gõ "a" ra cả hai.
const normalize = (s) =>
  (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .trim();

// ---------- Gắn điểm trung bình cộng đồng + số lượt đánh giá ----------
// Làm tròn 1 chữ số thập phân: (9 + 7) / 2 = 8; (10 + 7) / 2 = 8.5.
function withStats(m) {
  const rs = db.reviews.filter((r) => r.movieId === m.id);
  const avg = rs.length
    ? Math.round((rs.reduce((sum, r) => sum + r.rating, 0) / rs.length) * 10) / 10
    : 0;
  return { ...m, communityRating: avg, reviewCount: rs.length };
}

// ---------- Kiểm tra đăng nhập (token) — middleware auth ----------
// Client gửi: Authorization: Bearer <token>. Không có / sai token -> 401
// và dừng ngay, không chạy tiếp handler phía sau (không gọi next()).
function auth(req, res, next) {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  const username = db.tokens[token];
  if (!username)
    return res
      .status(401)
      .json({ error: "Chưa đăng nhập hoặc phiên đã hết hạn" });
  req.username = username;
  req.token = token; // logout cần biết token nào để xóa
  next();
}

// ---------- Kiểm tra máy chủ còn sống ----------
app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

// ---------- Tài khoản ----------
app.post("/api/register", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res
      .status(400)
      .json({ error: "Thiếu tên đăng nhập hoặc mật khẩu" });
  if (!validUsername(username))
    return res.status(400).json({ error: USERNAME_MSG });
  if (!validPassword(password))
    return res.status(400).json({ error: PASSWORD_MSG });
  if (db.users.find((u) => u.username === username))
    return res.status(409).json({ error: "Tên đăng nhập đã tồn tại" });
  const salt = crypto.randomBytes(8).toString("hex");
  db.users.push({ username, salt, hash: hashPw(password, salt) });
  save();
  res.status(201).json({ message: "Đăng ký thành công" });
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  const u = db.users.find((x) => x.username === username);
  // Băm lại mật khẩu gửi lên với salt đã lưu rồi so sánh hash.
  // Không bao giờ lưu hay so sánh mật khẩu nguyên văn.
  // Cố tình trả cùng một câu lỗi cho "sai tên" và "sai mật khẩu" để
  // kẻ ngoài không dò được tên nào đã tồn tại.
  if (!u || u.hash !== hashPw(password || "", u.salt))
    return res
      .status(401)
      .json({ error: "Sai tên đăng nhập hoặc mật khẩu" });
  const token = crypto.randomBytes(16).toString("hex"); // 32 ký tự hex
  db.tokens[token] = username;
  save();
  res.json({ token, username });
});

// Đăng xuất: xóa đúng token của người gọi khỏi db.tokens.
app.post("/api/logout", auth, (req, res) => {
  delete db.tokens[req.token];
  save();
  res.json({ message: "Đã đăng xuất" });
});

// Đổi mật khẩu (PUT /api/me/password)
app.put("/api/me/password", auth, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const u = db.users.find((x) => x.username === req.username);
  if (!u || u.hash !== hashPw(oldPassword || "", u.salt)) {
    return res.status(400).json({ error: "Mật khẩu hiện tại không đúng" });
  }
  if (!validPassword(newPassword)) {
    return res.status(400).json({ error: PASSWORD_MSG });
  }
  if (newPassword === oldPassword) {
    return res
      .status(400)
      .json({ error: "Mật khẩu mới phải khác mật khẩu hiện tại" });
  }
  u.hash = hashPw(newPassword, u.salt); // giữ nguyên salt cũ
  save();
  res.json({ message: "Đổi mật khẩu thành công" });
});

// ---------- Phim ----------
app.get("/api/movies", (req, res) => {
  const search = normalize(req.query.search);
  const genre = req.query.genre || "";
  // Gợi ý theo chữ cái đầu: chỉ lấy phim có tên BẮT ĐẦU bằng chuỗi đã gõ
  // (startsWith, không phải includes) sau khi đã chuẩn hóa.
  let list = movies.filter((m) => normalize(m.title).startsWith(search));
  if (genre) list = list.filter((m) => m.genres.includes(genre));
  res.json(list.map(withStats));
});

app.get("/api/movies/:id", (req, res) => {
  const m = movies.find((x) => x.id === Number(req.params.id));
  if (!m) return res.status(404).json({ error: "Không tìm thấy phim" });
  res.json(withStats(m));
});

// ---------- Nơi xem phim hợp pháp (TMDB watch providers) ----------
// Khóa TMDB chỉ nằm trên máy chủ (biến môi trường TMDB_KEY của Render),
// app Android chỉ gọi qua API này nên không lộ khóa. Cần thêm TMDB_KEY
// vào mục Environment trên trang quản trị Render rồi mới dùng được.
// Trả về: { movieId, link, providers: [{ name, type }] } với type là
// flatrate (xem theo gói), rent (thuê) hoặc buy (mua), ưu tiên flatrate.
const TMDB_BASE = "https://api.themoviedb.org/3";

app.get("/api/movies/:id/watch", async (req, res) => {
  const KEY = process.env.TMDB_KEY;
  if (!KEY)
    return res.status(503).json({ error: "Chưa cấu hình TMDB_KEY trên máy chủ" });
  const movieId = Number(req.params.id);
  if (!movies.find((x) => x.id === movieId))
    return res.status(404).json({ error: "Không tìm thấy phim" });
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const r = await fetch(
      `${TMDB_BASE}/movie/${movieId}/watch/providers?api_key=${KEY}`,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    if (!r.ok)
      return res
        .status(502)
        .json({ error: "Không lấy được dữ liệu nơi xem từ TMDB" });
    const data = await r.json();
    const vn = (data.results && data.results.VN) || null;
    const providers = [];
    const seen = new Set();
    if (vn) {
      for (const type of ["flatrate", "rent", "buy"]) {
        for (const p of vn[type] || []) {
          if (!seen.has(p.provider_name)) {
            seen.add(p.provider_name);
            providers.push({ name: p.provider_name, type });
          }
        }
      }
    }
    res.json({ movieId, link: vn ? vn.link : null, providers });
  } catch (e) {
    res.status(502).json({ error: "Không lấy được dữ liệu nơi xem từ TMDB" });
  }
});

// ---------- Đánh giá ----------
app.get("/api/movies/:id/reviews", (req, res) => {
  res.json(db.reviews.filter((r) => r.movieId === Number(req.params.id)));
});

app.post("/api/movies/:id/reviews", auth, (req, res) => {
  const movieId = Number(req.params.id);
  if (!movies.find((x) => x.id === movieId))
    return res.status(404).json({ error: "Không tìm thấy phim" });
  const score = Number(req.body.rating);
  const comment = String(req.body.comment || "").trim();
  if (!validRating(score))
    return res.status(400).json({ error: RATING_MSG });
  if (comment.length > 500)
    return res.status(400).json({ error: "Bình luận tối đa 500 ký tự" });
  // Mỗi người chỉ có một đánh giá cho mỗi phim.
  if (
    db.reviews.find((r) => r.movieId === movieId && r.username === req.username)
  )
    return res
      .status(409)
      .json({ error: "Bạn đã đánh giá phim này, hãy sửa đánh giá cũ" });
  const review = {
    movieId,
    username: req.username,
    rating: score,
    comment,
    createdAt: new Date().toISOString(),
  };
  db.reviews.push(review);
  save();
  res.status(201).json(review);
});

// Sửa đánh giá của chính mình
app.put("/api/movies/:id/reviews/mine", auth, (req, res) => {
  const movieId = Number(req.params.id);
  const review = db.reviews.find(
    (r) => r.movieId === movieId && r.username === req.username
  );
  if (!review)
    return res.status(404).json({ error: "Bạn chưa đánh giá phim này" });
  const score = Number(req.body.rating);
  const comment = String(req.body.comment || "").trim();
  if (!validRating(score))
    return res.status(400).json({ error: RATING_MSG });
  if (comment.length > 500)
    return res.status(400).json({ error: "Bình luận tối đa 500 ký tự" });
  review.rating = score;
  review.comment = comment;
  review.updatedAt = new Date().toISOString();
  save();
  res.json(review);
});

// Xóa đánh giá của chính mình
app.delete("/api/movies/:id/reviews/mine", auth, (req, res) => {
  const movieId = Number(req.params.id);
  const before = db.reviews.length;
  db.reviews = db.reviews.filter(
    (r) => !(r.movieId === movieId && r.username === req.username)
  );
  if (db.reviews.length === before)
    return res.status(404).json({ error: "Bạn chưa đánh giá phim này" });
  save();
  res.json({ message: "Đã xóa đánh giá" });
});

// Lấy danh sách đánh giá của cá nhân (GET /api/me/reviews)
app.get("/api/me/reviews", auth, (req, res) => {
  const userReviews = db.reviews.filter((r) => r.username === req.username);
  const result = userReviews.map((r) => {
    const movie = movies.find((m) => m.id === r.movieId);
    return {
      ...r,
      movieTitle: movie ? movie.title : "Phim không tồn tại",
      year: movie ? movie.year : 0,
    };
  });
  res.json(result);
});

// Xóa đánh giá của cá nhân (DELETE /api/me/reviews/:movieId)
// Giữ lại để tương thích với màn "Đánh giá của tôi" trên app cũ:
// cùng một việc xóa, chỉ khác đường dẫn so với /reviews/mine.
app.delete("/api/me/reviews/:movieId", auth, (req, res) => {
  const movieId = Number(req.params.movieId);
  const initialLength = db.reviews.length;
  // Lọc giữ lại tất cả những đánh giá KHÔNG phải của user này về bộ phim này
  db.reviews = db.reviews.filter(
    (r) => !(r.movieId === movieId && r.username === req.username)
  );
  if (db.reviews.length === initialLength) {
    return res.status(404).json({ error: "Không tìm thấy bài đánh giá để xóa" });
  }
  save();
  res.json({ message: "Xóa đánh giá thành công" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () =>
  console.log(`Server chạy tại http://localhost:${PORT}`)
);
