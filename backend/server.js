const express = require("express");
const cors = require("cors");
const multer = require("multer");
const cron = require("node-cron");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

// ── Supabase Admin Client (service role — bypasses RLS) ───────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── Express Setup ─────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 8080;

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: process.env.FRONTEND_URL || "http://localhost:3000", credentials: true }));
app.use(express.json({ limit: "10mb" }));
app.use(rateLimit({ windowMs: 60_000, max: 300 }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// ── Auth Middleware ───────────────────────────────────────────
async function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return res.status(401).json({ message: "Unauthorized" });

  const { data: { user }, error } = await supabase.auth.getUser(auth.split(" ")[1]);
  if (error || !user) return res.status(401).json({ message: "Invalid token" });

  req.uid = user.id;
  next();
}

// ── Storage Helper ────────────────────────────────────────────
async function uploadToStorage(buffer, path, contentType = "audio/webm") {
  const { error } = await supabase.storage
    .from("recordings")
    .upload(path, buffer, { contentType, upsert: false });
  if (error) throw error;

  const { data } = supabase.storage.from("recordings").getPublicUrl(path);
  return data.publicUrl;
}

function formatSize(bytes) {
  if (!bytes) return "0 KB";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getTodayDate() {
  return new Date().toISOString().split("T")[0];
}

// ── Health ────────────────────────────────────────────────────
app.get("/", (_req, res) => res.json({ status: "Audio Guardian API running" }));

// ── Upload Chunk ──────────────────────────────────────────────
app.post("/upload-chunk", requireAuth, upload.single("audio"), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: "No file uploaded" });

  const hasThreat = req.body.hasThreat === "true";
  const uid = req.uid;
  const date = getTodayDate();

  try {
    if (hasThreat) {
      const alertId = Date.now().toString();
      const storagePath = `${uid}/alerts/alert-${alertId}.webm`;
      const downloadUrl = await uploadToStorage(req.file.buffer, storagePath);

      await supabase.from("recordings").insert({
        user_id: uid, type: "alert", date, storage_path: storagePath,
        download_url: downloadUrl, size: req.file.size,
      });
      return res.json({ message: "Alert clip saved", type: "alert" });
    } else {
      const chunkId = Date.now().toString();
      const storagePath = `${uid}/daily/${date}/chunk-${chunkId}.webm`;
      const downloadUrl = await uploadToStorage(req.file.buffer, storagePath);

      await supabase.from("recordings").insert({
        user_id: uid, type: "daily", date, storage_path: storagePath,
        download_url: downloadUrl, size: req.file.size,
      });
      return res.json({ message: "Chunk saved", type: "daily" });
    }
  } catch (err) {
    console.error("Upload error:", err.message);
    res.status(500).json({ message: "Upload failed" });
  }
});

// ── Get Recordings ────────────────────────────────────────────
app.get("/recordings", requireAuth, async (req, res) => {
  const { data, error } = await supabase.from("recordings")
    .select("*").eq("user_id", req.uid).order("created_at", { ascending: false }).limit(100);

  if (error) return res.status(500).json({ message: "Failed" });

  const grouped = {};
  const alerts = [];

  data.forEach(r => {
    if (r.type === "alert") {
      alerts.push({
        name: `alert-${r.id}.webm`, type: "alert",
        size: formatSize(r.size), storagePath: r.storage_path,
        lastModified: new Date(r.created_at).getTime(),
      });
    } else {
      if (!grouped[r.date]) grouped[r.date] = { totalSize: 0, lastModified: 0, chunkList: [] };
      grouped[r.date].totalSize += r.size || 0;
      grouped[r.date].lastModified = Math.max(grouped[r.date].lastModified, new Date(r.created_at).getTime());
      grouped[r.date].chunkList.push({ storagePath: r.storage_path, timestamp: r.created_at, size: r.size || 0 });
    }
  });

  // Sort each day's chunks oldest-first so playback is in chronological order
  const daily = Object.entries(grouped).map(([date, g]) => {
    const sorted = g.chunkList.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    return {
      name: `recording-${date}.webm`, date, type: "daily",
      size: formatSize(g.totalSize), chunks: sorted.length,
      lastModified: g.lastModified, chunkList: sorted,
    };
  });

  // Remove signedUrls batch call — now using /audio-proxy instead


  const recordings = [...daily, ...alerts].sort((a, b) => b.lastModified - a.lastModified);
  res.json({ recordings });
});

// ── Audio / Image Proxy ───────────────────────────────────────
// Streams files from Supabase Storage through the backend so the browser
// can play/display them without CORS or bucket-visibility issues.
app.get("/audio-proxy", requireAuth, async (req, res) => {
  const storagePath = req.query.path;
  if (!storagePath) return res.status(400).end();
  if (!storagePath.startsWith(req.uid + "/")) return res.status(403).end();

  const { data, error } = await supabase.storage.from("recordings").download(storagePath);
  if (error || !data) return res.status(404).end();

  const buffer = Buffer.from(await data.arrayBuffer());
  const isImage = /\.(jpg|jpeg|png)$/i.test(storagePath);
  res.setHeader("Content-Type", isImage ? "image/jpeg" : "audio/webm");
  res.setHeader("Content-Length", buffer.length);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.send(buffer);
});

// ── Delete Recording ──────────────────────────────────────────
app.delete("/recordings/:type/:filename", requireAuth, async (req, res) => {
  const { type, filename } = req.params;
  const uid = req.uid;

  try {
    if (type === "daily") {
      const dateMatch = filename.match(/recording-(\d{4}-\d{2}-\d{2})\.webm/);
      if (!dateMatch) return res.status(400).json({ message: "Invalid filename" });

      const { data } = await supabase.from("recordings")
        .select("id, storage_path").eq("user_id", uid).eq("type", "daily").eq("date", dateMatch[1]);

      if (data?.length) {
        await supabase.from("recordings").delete().eq("user_id", uid).eq("type", "daily").eq("date", dateMatch[1]);
        await supabase.storage.from("recordings").remove(data.map(r => r.storage_path));
      }
    } else {
      const docId = filename.replace("alert-", "").replace(".webm", "");
      const { data } = await supabase.from("recordings").select("storage_path").eq("id", docId).single();
      if (data) {
        await supabase.from("recordings").delete().eq("id", docId);
        await supabase.storage.from("recordings").remove([data.storage_path]);
      }
    }
    res.json({ message: "Deleted" });
  } catch (err) {
    console.error("Delete error:", err.message);
    res.status(500).json({ message: "Delete failed" });
  }
});

// ── Sessions ──────────────────────────────────────────────────
function sessionToDb(body) {
  return {
    duration_seconds: body.durationSeconds,
    total_words: body.totalWords,
    wpm: body.wpm,
    english_words: body.englishWords,
    hindi_words: body.hindiWords,
    aggression_score: body.aggressionScore,
    stress_score: body.stressScore,
    confidence: body.confidence,
    full_transcript: body.fullTranscript,
    top_words: body.topWords,
    filler_words: body.fillerWords,
    grammar_mistakes: body.grammarMistakes,
    spikes: body.spikes,
    date: body.date,
    grammar_rating: body.grammarRating,
    vocab_rating: body.vocabRating,
  };
}

function sessionFromDb(row) {
  return {
    id: row.id,
    date: row.date,
    createdAt: row.created_at,
    durationSeconds: row.duration_seconds,
    totalWords: row.total_words,
    wpm: row.wpm,
    englishWords: row.english_words,
    hindiWords: row.hindi_words,
    aggressionScore: row.aggression_score,
    stressScore: row.stress_score,
    confidence: row.confidence,
    fullTranscript: row.full_transcript,
    topWords: row.top_words,
    fillerWords: row.filler_words,
    grammarMistakes: row.grammar_mistakes,
    spikes: row.spikes,
    grammarRating: row.grammar_rating,
    vocabRating: row.vocab_rating,
  };
}

app.get("/sessions", requireAuth, async (req, res) => {
  const { data, error } = await supabase.from("sessions")
    .select("*").eq("user_id", req.uid).order("created_at", { ascending: false }).limit(50);
  if (error) return res.status(500).json({ message: "Failed" });
  res.json({ sessions: data.map(sessionFromDb) });
});

app.post("/sessions", requireAuth, async (req, res) => {
  const { data, error } = await supabase.from("sessions")
    .insert({ user_id: req.uid, ...sessionToDb(req.body) }).select().single();
  if (error) return res.status(500).json({ message: "Failed" });
  res.json({ session: sessionFromDb(data) });
});

app.delete("/sessions/:id", requireAuth, async (req, res) => {
  const { error } = await supabase.from("sessions").delete().eq("id", req.params.id).eq("user_id", req.uid);
  if (error) return res.status(500).json({ message: "Delete failed", detail: error.message });
  res.json({ message: "Deleted" });
});

// ── Alerts ────────────────────────────────────────────────────
app.get("/alerts", requireAuth, async (req, res) => {
  const { data, error } = await supabase.from("alerts")
    .select("*").eq("user_id", req.uid).order("created_at", { ascending: false }).limit(100);
  if (error) return res.status(500).json({ message: "Failed" });
  res.json({ alerts: data });
});

app.post("/alert", requireAuth, async (req, res) => {
  const { detectedWords, transcript, severity } = req.body;
  if (!detectedWords || !transcript) return res.status(400).json({ message: "Missing data" });

  const { data, error } = await supabase.from("alerts")
    .insert({ user_id: req.uid, detected_words: detectedWords, transcript, severity: severity || "medium" })
    .select().single();
  if (error) return res.status(500).json({ message: "Failed" });

  console.log(`ALERT [${req.uid}] - "${transcript}" | ${detectedWords.join(", ")}`);
  res.json({ alert: data });
});

app.delete("/alerts/:id", requireAuth, async (req, res) => {
  const { error } = await supabase.from("alerts").delete().eq("id", req.params.id).eq("user_id", req.uid);
  if (error) return res.status(500).json({ message: "Delete failed" });
  res.json({ message: "Deleted" });
});

app.delete("/alerts", requireAuth, async (req, res) => {
  await supabase.from("alerts").delete().eq("user_id", req.uid);
  res.json({ message: "Cleared" });
});

// ── Upload Alert Photos ────────────────────────────────────────
app.post("/upload-alert-photos", requireAuth, upload.array("photos", 10), async (req, res) => {
  const files = req.files;
  const { alertId } = req.body;
  const uid = req.uid;

  if (!files || files.length === 0) return res.status(400).json({ message: "No photos" });

  try {
    const storagePaths = [];
    for (let i = 0; i < files.length; i++) {
      const storagePath = `${uid}/alert-photos/alert-${alertId}/photo-${i + 1}.jpg`;
      await uploadToStorage(files[i].buffer, storagePath, "image/jpeg");
      storagePaths.push(storagePath); // store paths, not public URLs — served via /audio-proxy
    }

    if (alertId) {
      await supabase.from("alerts").update({ photo_urls: storagePaths }).eq("id", alertId).eq("user_id", uid);
    }

    res.json({ storagePaths });
  } catch (err) {
    console.error("Alert photo upload error:", err.message);
    res.status(500).json({ message: "Photo upload failed" });
  }
});

// ── Panic Words ───────────────────────────────────────────────
const DEFAULT_PANIC_WORDS = ["murder","kill","death","threat","attack","help","emergency",
  "danger","assault","weapon","gun","knife","bomb","kidnap","hostage"];

app.get("/panic-words", requireAuth, async (req, res) => {
  const { data } = await supabase.from("user_settings").select("panic_words").eq("user_id", req.uid).single();
  res.json({ panicWords: data?.panic_words || DEFAULT_PANIC_WORDS });
});

app.post("/panic-words", requireAuth, async (req, res) => {
  if (!Array.isArray(req.body.panicWords)) return res.status(400).json({ message: "Invalid" });
  await supabase.from("user_settings").upsert({ user_id: req.uid, panic_words: req.body.panicWords });
  res.json({ message: "Updated" });
});

// ── Settings ──────────────────────────────────────────────────
app.get("/settings", requireAuth, async (req, res) => {
  const { data } = await supabase.from("user_settings").select("auto_delete_days").eq("user_id", req.uid).single();
  res.json({ autoDeleteDays: data?.auto_delete_days ?? 3 });
});

app.post("/settings", requireAuth, async (req, res) => {
  if (typeof req.body.autoDeleteDays !== "number") return res.status(400).json({ message: "Invalid" });
  await supabase.from("user_settings").upsert({ user_id: req.uid, auto_delete_days: req.body.autoDeleteDays });
  res.json({ message: "Updated" });
});

// ── Auto-delete Cron ──────────────────────────────────────────
cron.schedule("0 2 * * *", async () => {
  console.log("Running auto-delete...");
  const { data: settings } = await supabase.from("user_settings").select("user_id, auto_delete_days");
  for (const s of (settings || [])) {
    const cutoff = new Date(Date.now() - (s.auto_delete_days || 3) * 86400000).toISOString();
    const { data: recs } = await supabase.from("recordings").select("id, storage_path")
      .eq("user_id", s.user_id).lt("created_at", cutoff);
    if (recs?.length) {
      await supabase.from("recordings").delete().eq("user_id", s.user_id).lt("created_at", cutoff);
      await supabase.storage.from("recordings").remove(recs.map(r => r.storage_path));
    }
    await supabase.from("alerts").delete().eq("user_id", s.user_id).lt("created_at", cutoff);
  }
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

module.exports = app;
