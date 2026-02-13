require("dotenv").config(); // MUST be first
const QRCode = require("qrcode");

const express = require("express");
const multer = require("multer");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const path = require("path");
const fs = require("fs"); 

const File = require("./models/file");

if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads");
}

mongoose.connect(process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 30000,
})
.then(() => {
  console.log("✅ MongoDB connected successfully");
})
.catch((err) => {
  console.error("❌ MongoDB connection failed:", err);
  process.exit(1);
});
console.log("MONGO_URI:", process.env.MONGO_URI);



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

const app = express();

/* -------------------- Static files -------------------- */
app.use(express.static("public"));
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

/* -------------------- Middleware -------------------- */
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

/* -------------------- Multer config -------------------- */
const upload = multer({ dest: "uploads" });

/* -------------------- Database -------------------- */
// mongoose
//   .connect(process.env.MONGO_URI)
//   .then(() => console.log("MongoDB connected"))
//   .catch((err) => console.error("MongoDB connection error:", err));

/* -------------------- View engine -------------------- */
app.set("view engine", "ejs");

/* -------------------- Routes -------------------- */

/* Home page */
app.get("/", (req, res) => {
  res.render("index", {
    fileLink: null,
    qrCodePath: null,
    accessCode: null,
  });
});

/* Upload file */
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
    res.status(500).send("Something went wrong");
  }
});

/* -------------------- DOWNLOAD USING ACCESS CODE -------------------- */

/* Download page */
app.get("/download", (req, res) => {
  res.render("download", { error: null });
});

/* Download submit */
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

/* -------------------- DOWNLOAD VIA LINK / QR -------------------- */
async function handleDownload(req, res) {
  try {
    const file = await File.findOneAndUpdate(
      {
        _id: req.params.id,
        downloadCount: { $lt: MAX_DOWNLOADS } // limit condition
      },
      { $inc: { downloadCount: 1 } }, // atomic increment
      { new: true }
    );

    if (!file) {
      return res.status(403).render("download-limit", {
        message: "This file has reached its maximum download limit."
      });
    }

    // 🔐 Password check (same as your logic)
    if (file.password) {

      if (!req.body.password) {
        return res.render("password", {
          fileId: file.id,
          error: false
        });
      }

      const isMatch = await bcrypt.compare(
        req.body.password,
        file.password
      );

      if (!isMatch) {
        return res.render("password", {
          fileId: file.id,
          error: true
        });
      }
    }

    res.download(file.path, file.originalName);

  } catch (err) {
    console.error(err);
    res.status(500).send("Download error");
  }
}

// Universal Download Route
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
        message: "This file has reached its maximum download limit."
      });
    }

    // 🔐 If password exists → show password page
    if (file.password) {
      return res.render("password", {
        fileValue: value,
        error: false
      });
    }

    // No password → increment & download
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
        message: "This file has reached its maximum download limit."
      });
    }

    // Compare password
    const isMatch = await bcrypt.compare(password, file.password);

    if (!isMatch) {
      return res.render("password", {
        fileValue: value,
        error: true
      });
    }

    // Correct password → increment & download
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





/* -------------------- Legal Pages -------------------- */
app.get("/privacy", (req, res) => {
  res.render("privacy");
});

app.get("/terms", (req, res) => {
  res.render("terms");
});

/* -------------------- Server -------------------- */
const PORT = process.env.PORT || 3000;

mongoose.connection.once("open", () => {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
});

