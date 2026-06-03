const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

require("dotenv").config();

const express = require("express");
const multer = require("multer");

const app = express();
const PORT = Number(process.env.PORT || 5174);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin1234";
const SURVEY_URL = process.env.SURVEY_URL || "https://example.com/your-survey";
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 8);

const ROOT = __dirname;
const STORAGE_ROOT = process.env.STORAGE_DIR
  ? path.resolve(process.env.STORAGE_DIR)
  : ROOT;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(STORAGE_ROOT, "data");
const UPLOAD_DIR = path.join(STORAGE_ROOT, "uploads");
const DB_PATH = path.join(DATA_DIR, "db.json");

const sessions = new Set();

function nowIso() {
  return new Date().toISOString();
}

function parseCookies(cookieHeader = "") {
  return cookieHeader.split(";").reduce((acc, part) => {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (!rawKey) return acc;
    acc[rawKey] = decodeURIComponent(rawValue.join("="));
    return acc;
  }, {});
}

function setCookie(res, key, value, options = {}) {
  const attrs = [
    `${key}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax"
  ];
  if (options.maxAge != null) attrs.push(`Max-Age=${options.maxAge}`);
  if (process.env.NODE_ENV === "production") attrs.push("Secure");
  res.setHeader("Set-Cookie", attrs.join("; "));
}

function requireAdmin(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  if (!cookies.admin_session || !sessions.has(cookies.admin_session)) {
    return res.status(401).json({ error: "관리자 로그인이 필요합니다." });
  }
  next();
}

function normalizePhone(phone) {
  return String(phone || "").replace(/[^\d]/g, "");
}

function maskName(name) {
  const clean = String(name || "").trim();
  if (!clean) return "익명";
  const chars = Array.from(clean);
  if (chars.length === 1) return `${chars[0]}*`;
  if (chars.length === 2) return `${chars[0]}*`;
  return `${chars[0]}${"*".repeat(chars.length - 2)}${chars[chars.length - 1]}`;
}

function normalizeTargetKey(target) {
  return String(target || "").trim().toLowerCase().replace(/\s+/g, "");
}

function phoneLast4(phone) {
  const clean = normalizePhone(phone);
  return clean.slice(-4).padStart(4, "0");
}

function getSubmissionPhotos(item) {
  if (Array.isArray(item.photos) && item.photos.length) {
    return item.photos;
  }
  if (item.fileName) {
    return [{
      originalFileName: item.originalFileName || item.fileName,
      fileName: item.fileName,
      fileMime: item.fileMime || "image/jpeg",
      fileSize: item.fileSize || 0
    }];
  }
  return [];
}

function decorateAdminSubmissions(submissions) {
  const firstByTarget = new Map();
  const ascending = [...submissions].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  for (const item of ascending) {
    if (item.shareType !== "single") continue;
    const key = normalizeTargetKey(item.target);
    if (!key) continue;
    if (!firstByTarget.has(key)) firstByTarget.set(key, item);
  }

  return submissions.map((item) => {
    const key = item.shareType === "single" ? normalizeTargetKey(item.target) : "";
    const first = key ? firstByTarget.get(key) : null;
    const duplicateCount = key
      ? submissions.filter((entry) => entry.shareType === "single" && normalizeTargetKey(entry.target) === key).length
      : 0;

    return {
      ...item,
      duplicateInfo: {
        checked: item.shareType === "single",
        isDuplicateTarget: Boolean(first && first.id !== item.id),
        firstSubmissionId: first?.id || null,
        firstSubmissionName: first?.name || null,
        duplicateCount
      },
      photos: getSubmissionPhotos(item).map((photo) => ({
        ...photo,
        photoUrl: `/api/admin/photo/${encodeURIComponent(photo.fileName)}`
      }))
    };
  });
}

function sanitizeSubmission(raw) {
  const name = String(raw.name || "").trim();
  const phone = normalizePhone(raw.phone);
  const shareType = raw.shareType === "group" ? "group" : "single";
  const target = String(raw.target || "").trim();
  const memo = String(raw.memo || "").trim();

  if (name.length < 2) throw new Error("이름을 2글자 이상 입력해주세요.");
  if (phone.length < 8 || phone.length > 15) throw new Error("전화번호를 정확히 입력해주세요.");
  if (!target) throw new Error("공유한 대상 또는 방 이름을 입력해주세요.");
  if (memo.length > 500) throw new Error("메모는 500자 이하로 입력해주세요.");

  return { name, phone, shareType, target, memo };
}

async function ensureStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  try {
    await fs.access(DB_PATH);
  } catch {
    await fs.writeFile(DB_PATH, JSON.stringify({ submissions: [] }, null, 2), "utf8");
  }
}

async function readDb() {
  await ensureStore();
  const raw = await fs.readFile(DB_PATH, "utf8");
  return JSON.parse(raw);
}

async function writeDb(db) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tempPath = `${DB_PATH}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(db, null, 2), "utf8");
  await fs.rename(tempPath, DB_PATH);
}

function buildLeaderboard(submissions) {
  const grouped = new Map();
  for (const item of submissions) {
    if (item.status !== "approved") continue;
    const key = item.phone;
    const existing = grouped.get(key) || {
      name: item.name,
      phone: item.phone,
      approvedCount: 0,
      proofCount: 0,
      latestApprovedAt: item.updatedAt || item.createdAt
    };
    existing.approvedCount += Number(item.approvedCount || 0);
    existing.proofCount += 1;
    existing.latestApprovedAt = item.updatedAt || item.createdAt;
    grouped.set(key, existing);
  }

  return Array.from(grouped.values())
    .sort((a, b) => {
      if (b.approvedCount !== a.approvedCount) return b.approvedCount - a.approvedCount;
      return new Date(a.latestApprovedAt) - new Date(b.latestApprovedAt);
    })
    .map((item, index) => ({
      rank: index + 1,
      maskedName: maskName(item.name),
      phoneLast4: phoneLast4(item.phone),
      approvedCount: item.approvedCount,
      proofCount: item.proofCount,
      prizeCandidate: index < 3
    }));
}

function safeFilePath(fileName) {
  const clean = path.basename(fileName || "");
  return path.join(UPLOAD_DIR, clean);
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    cb(null, `${crypto.randomUUID()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("사진 파일만 업로드할 수 있습니다."));
    }
    cb(null, true);
  }
});

app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

app.get("/api/config", (_req, res) => {
  res.json({ surveyUrl: SURVEY_URL, maxUploadMb: MAX_UPLOAD_MB });
});

app.get("/api/leaderboard", async (_req, res) => {
  const db = await readDb();
  const approvedTotal = db.submissions
    .filter((item) => item.status === "approved")
    .reduce((sum, item) => sum + Number(item.approvedCount || 0), 0);
  const pendingTotal = db.submissions.filter((item) => item.status === "pending").length;
  res.json({
    leaderboard: buildLeaderboard(db.submissions),
    stats: {
      approvedTotal,
      pendingTotal,
      proofTotal: db.submissions.length
    }
  });
});

app.post("/api/submissions", upload.array("proofPhotos", 8), async (req, res) => {
  try {
    if (!req.files?.length) throw new Error("인증 사진을 업로드해주세요.");
    if (req.body.consent !== "true") throw new Error("개인정보 수집 및 이용 동의가 필요합니다.");

    const clean = sanitizeSubmission(req.body);
    const photos = req.files.map((file) => ({
      originalFileName: file.originalname,
      fileName: file.filename,
      fileMime: file.mimetype,
      fileSize: file.size
    }));
    const db = await readDb();
    const submission = {
      id: crypto.randomUUID(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      status: "pending",
      approvedCount: 0,
      adminMemo: "",
      ...clean,
      photos
    };
    db.submissions.unshift(submission);
    await writeDb(db);
    res.status(201).json({
      submissionId: submission.id,
      status: submission.status,
      message: "인증이 접수되었습니다. 관리자가 확인한 뒤 순위에 반영됩니다."
    });
  } catch (error) {
    if (req.files?.length) {
      await Promise.all(req.files.map((file) => fs.unlink(safeFilePath(file.filename)).catch(() => {})));
    }
    res.status(400).json({ error: error.message || "인증 접수에 실패했습니다." });
  }
});

app.post("/api/admin/login", (req, res) => {
  const password = String(req.body.password || "");
  const expected = Buffer.from(ADMIN_PASSWORD);
  const actual = Buffer.from(password);
  const sameLength = expected.length === actual.length;
  const matches = sameLength && crypto.timingSafeEqual(expected, actual);
  if (!matches) return res.status(401).json({ error: "비밀번호가 올바르지 않습니다." });

  const token = crypto.randomBytes(32).toString("hex");
  sessions.add(token);
  setCookie(res, "admin_session", token, { maxAge: 60 * 60 * 8 });
  res.json({ ok: true });
});

app.post("/api/admin/logout", requireAdmin, (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  sessions.delete(cookies.admin_session);
  setCookie(res, "admin_session", "", { maxAge: 0 });
  res.json({ ok: true });
});

app.get("/api/admin/me", requireAdmin, (_req, res) => {
  res.json({ authenticated: true });
});

app.get("/api/admin/submissions", requireAdmin, async (_req, res) => {
  const db = await readDb();
  res.json({
    submissions: decorateAdminSubmissions(db.submissions),
    leaderboard: buildLeaderboard(db.submissions)
  });
});

app.patch("/api/admin/submissions/:id", requireAdmin, async (req, res) => {
  const db = await readDb();
  const item = db.submissions.find((entry) => entry.id === req.params.id);
  if (!item) return res.status(404).json({ error: "인증 내역을 찾을 수 없습니다." });

  const nextStatus = ["pending", "approved", "rejected"].includes(req.body.status)
    ? req.body.status
    : item.status;
  const approvedCount = Math.max(0, Math.min(9999, Number(req.body.approvedCount || 0)));
  const adminMemo = String(req.body.adminMemo || "").slice(0, 500);

  item.status = nextStatus;
  item.approvedCount = nextStatus === "approved" ? Math.max(1, approvedCount || 1) : 0;
  item.adminMemo = adminMemo;
  item.updatedAt = nowIso();
  await writeDb(db);
  res.json({ submission: decorateAdminSubmissions([item])[0] });
});

app.delete("/api/admin/submissions/:id", requireAdmin, async (req, res) => {
  const db = await readDb();
  const index = db.submissions.findIndex((entry) => entry.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: "인증 내역을 찾을 수 없습니다." });
  const [removed] = db.submissions.splice(index, 1);
  await writeDb(db);
  await Promise.all(getSubmissionPhotos(removed).map((photo) => fs.unlink(safeFilePath(photo.fileName)).catch(() => {})));
  res.json({ ok: true });
});

app.get("/api/admin/photo/:fileName", requireAdmin, async (req, res) => {
  const filePath = safeFilePath(req.params.fileName);
  try {
    await fs.access(filePath);
    res.sendFile(filePath);
  } catch {
    res.status(404).json({ error: "사진 파일을 찾을 수 없습니다." });
  }
});

app.get("/api/admin/export.csv", requireAdmin, async (_req, res) => {
  const db = await readDb();
  const columns = [
    "createdAt",
    "status",
    "name",
    "phone",
    "shareType",
    "target",
    "approvedCount",
    "photoCount",
    "memo",
    "adminMemo"
  ];
  const escapeCsv = (value) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const body = [
    columns.join(","),
    ...db.submissions.map((item) => columns.map((key) => {
      if (key === "photoCount") return escapeCsv(getSubmissionPhotos(item).length);
      return escapeCsv(item[key]);
    }).join(","))
  ].join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=survey-share-proofs.csv");
  res.send(`\uFEFF${body}`);
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: `업로드 오류: ${error.message}` });
  }
  res.status(500).json({ error: error.message || "서버 오류가 발생했습니다." });
});

ensureStore().then(() => {
  app.listen(PORT, () => {
    console.log(`Survey proof app running on http://localhost:${PORT}`);
  });
});
