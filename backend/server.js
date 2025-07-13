const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const cron = require("node-cron");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json()); // Needed for req.body in POST
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Create uploads directory if not exists
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    const uniqueName = Date.now() + "-" + file.originalname;
    cb(null, uniqueName);
  },
});
const upload = multer({ storage: storage });

// In-memory settings (can move to DB later)
let userSettings = {
  autoDeleteDays: 7, // default
};

// ✅ Health check route
app.get("/", (req, res) => {
  res.send("Audio Guardian Backend is running");
});

// ✅ Upload encrypted audio file
app.post("/upload", upload.single("audio"), (req, res) => {
  console.log("🎤 File uploaded:", req.file.filename);
  res.status(200).json({ message: "Audio uploaded successfully", file: req.file.filename });
});

// ✅ Get all recordings
app.get("/recordings", (req, res) => {
  fs.readdir(path.join(__dirname, "uploads"), (err, files) => {
    if (err) {
      return res.status(500).json({ message: "Unable to list recordings" });
    }

    const detailedFiles = files.map((file) => {
      const stats = fs.statSync(path.join(__dirname, "uploads", file));
      return {
        name: file,
        lastModified: stats.mtimeMs,
      };
    });

    res.status(200).json({ files: detailedFiles });
  });
});

// ✅ Delete a recording
app.delete("/recordings/:filename", (req, res) => {
  const filePath = path.join(__dirname, "uploads", req.params.filename);

  fs.unlink(filePath, (err) => {
    if (err) {
      console.error("❌ File deletion error:", err);
      return res.status(500).json({ message: "Delete failed" });
    }

    console.log("🗑️ File deleted:", req.params.filename);
    res.status(200).json({ message: "File deleted successfully" });
  });
});

// ✅ Get current auto-delete setting
app.get("/settings", (req, res) => {
  res.json(userSettings);
});

// ✅ Update auto-delete setting
app.post("/settings", (req, res) => {
  const { autoDeleteDays } = req.body;

  if (typeof autoDeleteDays === "number" && autoDeleteDays >= 0) {
    userSettings.autoDeleteDays = autoDeleteDays;
    console.log(`✅ Auto-delete updated to ${autoDeleteDays} days`);
    return res.json({ message: "Settings updated" });
  } else {
    return res.status(400).json({ message: "Invalid value" });
  }
});

// ✅ Auto-delete job every day at 2:00 AM
cron.schedule("0 2 * * *", () => {
  console.log("⏰ Running auto-delete check...");
  const uploadsPath = path.join(__dirname, "uploads");
  const files = fs.readdirSync(uploadsPath);

  const maxAgeInDays = userSettings.autoDeleteDays;
  const now = Date.now();

  files.forEach((file) => {
    const filePath = path.join(uploadsPath, file);
    const stats = fs.statSync(filePath);
    const ageInDays = (now - stats.mtimeMs) / (1000 * 60 * 60 * 24);

    console.log(`${file} is ${ageInDays.toFixed(2)} days old`);

    if (ageInDays > maxAgeInDays) {
      fs.unlinkSync(filePath);
      console.log(`🗑️ Deleted old file: ${file}`);
    }
  });
});

// ✅ Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
let panicWords = ['help', 'emergency']; // Default examples

app.get('/panic-words', (req, res) => {
  res.json({ panicWords });
});

app.post('/panic-words', (req, res) => {
  const { panicWords: newWords } = req.body;

  if (!Array.isArray(newWords)) {
    return res.status(400).json({ message: 'panicWords must be an array' });
  }

  panicWords = newWords;
  res.json({ message: 'Panic words updated successfully' });
});
const { OpenAI } = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.post('/analyze', upload.single('audio'), async (req, res) => {
  try {
    const filePath = req.file.path;

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: 'whisper-1',
    });

    const transcriptText = transcription.text.toLowerCase();
    console.log('🔍 Transcribed Text:', transcriptText);

    // Check for panic words
    const detected = panicWords.find(word => transcriptText.includes(word.toLowerCase()));

    if (detected) {
      console.log(`🚨 Panic word detected: "${detected}"`);
      // (In future) trigger SMS, email, etc.
      return res.json({ alert: true, word: detected });
    } else {
      return res.json({ alert: false, text: transcriptText });
    }

  } catch (err) {
    console.error('❌ Error analyzing audio:', err.message);
    res.status(500).json({ message: 'Whisper API failed' });
  }
});
