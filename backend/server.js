const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Create uploads directory if not exists
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Multer setup for file upload
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

// Health check
app.get("/", (req, res) => {
  res.send("Audio Guardian Backend is running");
});

// Upload encrypted audio file
app.post("/upload", upload.single("audio"), (req, res) => {
  console.log("File uploaded:", req.file.filename);
  res.status(200).json({ message: "Audio uploaded successfully", file: req.file.filename });
});
// Get list of uploaded files
app.get('/recordings', (req, res) => {
  fs.readdir(path.join(__dirname, 'uploads'), (err, files) => {
    if (err) {
      return res.status(500).json({ message: 'Unable to list recordings' });
    }
    res.status(200).json({ files });
  });
});


app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
