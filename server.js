require("dotenv").config(); // keep for local development

const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const bcrypt = require("bcrypt");
const path = require("path");
const fs = require("fs");
const QRCode = require("qrcode");

const File = require("./models/File");

const app = express();

/* -------------------- Ensure Uploads Folder Exists -------------------- */
if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads");
}

/* -------------------- MongoDB Connection -------------------- */
if (!process.env.MONGO_URI) {
  console.error("❌ MONGO_URI is not defined in environment variables");
  process.exit(1);
}

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => {
    console.error("❌ MongoDB Connection Failed:", err);
    process.exit(1);
  });

/* -------------------- Middleware -------------------- */
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(express.static("public"));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

/* -------------------- Multer Config -------------------- */
const upload = multer({ dest: "uploads/" });

/* -------------------- View Engine -------------------- */
app.set("view engine", "ejs");

/* -------------------- Access Code Generator -------------------- */
const generateAccessCode = async () => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code;
  let exists = true;

  while (exists) {
    code = "";
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    const file = await File.findOne({ accessCode: code });
    exists = !!file;
  }

  return code;
};

/* -------------------- Routes -------------------- */

/* Home */
app.get("/", (req, res) => {
  res.render("index", {
    fileLink: null,
    qrCodePath: null,
    accessCode: null,
  });
});

/* Upload */
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send("No file uploaded");
    }

    const accessCode = await generateAccessCode();

    const fileData = {
      path: req.file.path,
      originalName: req.file.originalname,
      accessCode,
      downloadCount: 0,
    };

    if (req.body.password) {
      fileData.password = await bcrypt.hash(req.body.password, 10);
    }

    const file = await File.create(fileData);

    const baseUrl =
      process.env.BASE_URL ||
      `http://localhost:${process.env.PORT || 3000}`;

    const qrFilePath = `uploads/qr-${file.id}.png`;

    await QRCode.toFile(qrFilePath, `${baseUrl}/file/${file.id}`);

    res.render("index", {
      fileLink: `${baseUrl}/file/${file.id}`,
      qrCodePath: `/uploads/qr-${file.id}.png`,
      accessCode,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Upload error");
  }
});

/* Download via Access Code Page */
app.get("/download", (req, res) => {
  res.render("download", { error: null });
});

app.post("/download", async (req, res) => {
  try {
    const { accessCode } = req.body;
    const file = await File.findOne({ accessCode });

    if (!file) {
      return res.render("download", {
        error: "Invalid access code",
      });
    }

    res.download(file.path, file.originalName);
  } catch (err) {
    console.error(err);
    res.status(500).send("Download error");
  }
});

/* Download via Link / QR */
app.get("/file/:value", async (req, res) => {
  try {
    const value = req.params.value;
    let file;

    if (mongoose.Types.ObjectId.isValid(value)) {
      file = await File.findById(value);
    }

    if (!file) {
      file = await File.findOne({ accessCode: value });
    }

    if (!file) {
      return res.status(404).send("File not found");
    }

    const MAX_DOWNLOADS = 3;

    if (file.downloadCount >= MAX_DOWNLOADS) {
      return res.render("download-limit", {
        message: "This file has reached its maximum download limit.",
      });
    }

    if (file.password) {
      return res.render("password", {
        fileValue: value,
        error: false,
      });
    }

    await File.updateOne(
      { _id: file._id },
      { $inc: { downloadCount: 1 } }
    );

    res.download(file.path, file.originalName);
  } catch (err) {
    console.error(err);
    res.status(500).send("Download error");
  }
});

/* Password Protected Download */
app.post("/file/:value", async (req, res) => {
  try {
    const value = req.params.value;
    const { password } = req.body;

    let file;

    if (mongoose.Types.ObjectId.isValid(value)) {
      file = await File.findById(value);
    }

    if (!file) {
      file = await File.findOne({ accessCode: value });
    }

    if (!file) {
      return res.status(404).send("File not found");
    }

    const MAX_DOWNLOADS = 3;

    if (file.downloadCount >= MAX_DOWNLOADS) {
      return res.render("download-limit", {
        message: "This file has reached its maximum download limit.",
      });
    }

    const isMatch = await bcrypt.compare(password, file.password);

    if (!isMatch) {
      return res.render("password", {
        fileValue: value,
        error: true,
      });
    }

    await File.updateOne(
      { _id: file._id },
      { $inc: { downloadCount: 1 } }
    );

    res.download(file.path, file.originalName);
  } catch (err) {
    console.error(err);
    res.status(500).send("Download error");
  }
});

/* Legal Pages */
app.get("/privacy", (req, res) => {
  res.render("privacy");
});

app.get("/terms", (req, res) => {
  res.render("terms");
});

/* -------------------- Start Server -------------------- */
const PORT = process.env.PORT || 3000;

mongoose.connection.once("open", () => {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
});
