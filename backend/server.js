const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const cron = require("node-cron");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Create uploads directory if not exists
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Multer setup
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

// In-memory state
let userSettings = {
  autoDeleteDays: 3,
};

let panicWords = ['murder', 'kill', 'death', 'threat', 'attack', 'help', 'emergency', 'danger', 'assault', 'weapon', 'gun', 'knife', 'bomb', 'kidnap', 'hostage'];

let alerts = [];

// Health check
app.get("/", (req, res) => {
  res.send("Audio Guardian Backend is running");
});

// Upload audio file
app.post("/upload", upload.single("audio"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded" });
  }
  console.log("File uploaded:", req.file.filename);
  res.status(200).json({ message: "Audio uploaded successfully", file: req.file.filename });
});

// Get all recordings
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

// Delete a recording
app.delete("/recordings/:filename", (req, res) => {
  const filePath = path.join(__dirname, "uploads", req.params.filename);

  fs.unlink(filePath, (err) => {
    if (err) {
      return res.status(500).json({ message: "Delete failed" });
    }
    console.log("File deleted:", req.params.filename);
    res.status(200).json({ message: "File deleted successfully" });
  });
});

// Settings
app.get("/settings", (req, res) => {
  res.json(userSettings);
});

app.post("/settings", (req, res) => {
  const { autoDeleteDays } = req.body;
  if (typeof autoDeleteDays === "number" && autoDeleteDays >= 0) {
    userSettings.autoDeleteDays = autoDeleteDays;
    return res.json({ message: "Settings updated" });
  }
  return res.status(400).json({ message: "Invalid value" });
});

// Panic words
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

// Alerts
app.get('/alerts', (req, res) => {
  res.json({ alerts });
});

app.delete('/alerts', (req, res) => {
  alerts = [];
  res.json({ message: 'Alerts cleared' });
});

// Receive alert from browser speech recognition
app.post('/alert', (req, res) => {
  const { id, timestamp, detectedWords, transcript, severity } = req.body;

  if (!detectedWords || !transcript) {
    return res.status(400).json({ message: 'Missing alert data' });
  }

  const alert = {
    id: id || Date.now(),
    timestamp: timestamp || new Date().toISOString(),
    detectedWords,
    transcript,
    severity: severity || 'medium',
  };

  alerts.unshift(alert);
  if (alerts.length > 100) alerts = alerts.slice(0, 100);

  console.log(`ALERT - Threat detected: "${transcript}" | Words: ${detectedWords.join(', ')} | Severity: ${alert.severity}`);
  res.json({ message: 'Alert saved', alert });
});

// Auto-delete cron job - runs daily at 2 AM
cron.schedule("0 2 * * *", () => {
  console.log("Running auto-delete check...");
  const uploadsPath = path.join(__dirname, "uploads");
  const files = fs.readdirSync(uploadsPath);
  const maxAgeInDays = userSettings.autoDeleteDays;
  const now = Date.now();

  files.forEach((file) => {
    const filePath = path.join(uploadsPath, file);
    const stats = fs.statSync(filePath);
    const ageInDays = (now - stats.mtimeMs) / (1000 * 60 * 60 * 24);

    if (ageInDays > maxAgeInDays) {
      fs.unlinkSync(filePath);
      console.log(`Deleted old file: ${file}`);
    }
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
