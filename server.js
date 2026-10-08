const express = require("express");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
app.use(express.json());                       // cho phép đọc body dạng JSON

// ---------- "Cơ sở dữ liệu" bằng file ----------
const DB_FILE = "db.json";
let db = fs.existsSync(DB_FILE)
  ? JSON.parse(fs.readFileSync(DB_FILE, "utf8"))
  : { users: [], reviews: [], tokens: {} };
const save = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
const movies = JSON.parse(fs.readFileSync("movies.json", "utf8"));

const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString("hex");

// ---------- Kiểm tra đăng nhập (token) ----------
function auth(req, res, next) {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  const username = db.tokens[token];
  if (!username) return res.status(401).json({ error: "Chưa đăng nhập" });
  req.username = username;
  next();
}

// ---------- Tài khoản ----------
app.post("/api/register", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: "Thiếu tên đăng nhập hoặc mật khẩu" });
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
  if (!u || u.hash !== hashPw(password || "", u.salt))
    return res.status(401).json({ error: "Sai tên đăng nhập hoặc mật khẩu" });
  const token = crypto.randomBytes(16).toString("hex");
  db.tokens[token] = username;
  save();
  res.json({ token, username });
});

// ---------- Phim ----------
app.get("/api/movies", (req, res) => {
  const search = (req.query.search || "").toLowerCase();
  const genre = req.query.genre || "";
  let list = movies.filter((m) => m.title.toLowerCase().includes(search));
  if (genre) list = list.filter((m) => m.genres.includes(genre));
  res.json(list);
});

app.get("/api/movies/:id", (req, res) => {
  const m = movies.find((x) => x.id === Number(req.params.id));
  if (!m) return res.status(404).json({ error: "Không tìm thấy phim" });
  res.json(m);
});

// ---------- Đánh giá ----------
app.get("/api/movies/:id/reviews", (req, res) => {
  res.json(db.reviews.filter((r) => r.movieId === Number(req.params.id)));
});

app.post("/api/movies/:id/reviews", auth, (req, res) => {
  const { rating, comment } = req.body;
  const review = {
    movieId: Number(req.params.id),
    username: req.username,
    rating: Number(rating),
    comment: comment || "",
    createdAt: new Date().toISOString(),
  };
  db.reviews.push(review);
  save();
  res.status(201).json(review);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () =>
  console.log(`Server chạy tại http://localhost:${PORT}`)
);