require("dotenv").config(); // keep for local development

const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const bcrypt = require("bcrypt");
const path = require("path");
const fs = require("fs");
const QRCode = require("qrcode");
const sgMail = require("@sendgrid/mail");

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

// Trust proxy for Render and other hosting platforms
app.set('trust proxy', 1);

app.use(express.static("public"));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

/* -------------------- Multer Config -------------------- */
const upload = multer({ dest: "uploads/" });

/* -------------------- View Engine -------------------- */
app.set("view engine", "ejs");

/* -------------------- SendGrid Configuration -------------------- */
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

/* -------------------- Email Service -------------------- */
const sendShareEmail = async (recipientEmail, fileName, fileLink, accessCode) => {
  console.log("=== Email Debug ===");
  console.log("Recipient:", recipientEmail);
  console.log("File Name:", fileName);
  console.log("Has SendGrid API Key:", !!process.env.SENDGRID_API_KEY);
  console.log("Has SendGrid From Email:", !!process.env.FROM_EMAIL);
  
  // Try SendGrid first
  if (process.env.SENDGRID_API_KEY && process.env.FROM_EMAIL) {
    console.log("Using SendGrid...");
    await sendSendGridEmail(recipientEmail, fileName, fileLink, accessCode);
  }
  // Fallback to Gmail SMTP
  else if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    console.log("Using Gmail SMTP fallback...");
    await sendGmailEmail(recipientEmail, fileName, fileLink, accessCode);
  }
  else {
    console.log("No email service configured - skipping email");
    console.log("Configure either:");
    console.log("  - SENDGRID_API_KEY + FROM_EMAIL (for SendGrid)");
    console.log("  - GMAIL_USER + GMAIL_APP_PASSWORD (for Gmail)");
    return;
  }
};

/* -------------------- SendGrid Email Service -------------------- */
const sendSendGridEmail = async (recipientEmail, fileName, fileLink, accessCode) => {
  console.log("API Key starts with:", process.env.SENDGRID_API_KEY?.substring(0, 10) + "...");

  const msg = {
    to: recipientEmail,
    from: process.env.FROM_EMAIL,
    subject: `File Shared: ${fileName}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">File Shared via CipherShare</h2>
        <p>Hi there,</p>
        <p>A file has been shared with you: <strong>${fileName}</strong></p>
        
        <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px; margin: 20px 0;">
          <h3 style="margin-top: 0;">Download Options:</h3>
          <p><strong>Direct Link:</strong></p>
          <a href="${fileLink}" style="display: inline-block; background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin: 10px 0;">Download File</a>
          
          <p style="margin-top: 20px;"><strong>Access Code:</strong> <code style="background-color: #e9ecef; padding: 5px 10px; border-radius: 3px;">${accessCode}</code></p>
        </div>
        
        <p><small>Note: If the file is password protected, you'll need the password provided by the sender.</small></p>
        
        <hr style="margin: 30px 0;">
        <p style="color: #666; font-size: 12px;">This email was sent via CipherShare - Secure File Sharing System</p>
      </div>
    `,
  };

  try {
    console.log("Attempting to send email...");
    console.log("Message object:", {
      to: msg.to,
      from: msg.from,
      subject: msg.subject
    });
    
    const response = await sgMail.send(msg);
    console.log(`Email sent successfully to ${recipientEmail}`);
    console.log("SendGrid response:", response);
  } catch (error) {
    console.error('=== SendGrid Error Details ===');
    console.error('Error:', error.message);
    console.error('Response:', error.response?.body);
    console.error('Status Code:', error.response?.statusCode);
    console.error('Full error:', error);
  }
};

/* -------------------- Gmail SMTP Fallback -------------------- */
const sendGmailEmail = async (recipientEmail, fileName, fileLink, accessCode) => {
  try {
    const nodemailer = require('nodemailer');
    
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
      }
    });

    const mailOptions = {
      from: process.env.GMAIL_USER,
      to: recipientEmail,
      subject: `File Shared: ${fileName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">🔐 File Shared via CipherShare</h2>
          <p>Hi there,</p>
          <p>A file has been shared with you: <strong>${fileName}</strong></p>
          
          <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px; margin: 20px 0;">
            <h3 style="margin-top: 0;">Download Options:</h3>
            <p><strong>🔗 Direct Link:</strong></p>
            <a href="${fileLink}" style="display: inline-block; background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin: 10px 0;">Download File</a>
            
            <p style="margin-top: 20px;"><strong>🔑 Access Code:</strong> <code style="background-color: #e9ecef; padding: 5px 10px; border-radius: 3px;">${accessCode}</code></p>
          </div>
          
          <p><small>Note: If the file is password protected, you'll need the password provided by the sender.</small></p>
          
          <hr style="margin: 30px 0;">
          <p style="color: #666; font-size: 12px;">This email was sent via CipherShare - Secure File Sharing System</p>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log(`Gmail sent successfully to ${recipientEmail}`);
  } catch (error) {
    console.error('Gmail Error:', error);
  }
};

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
    emailSent: false,
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
      `${req.protocol}://${req.get('host')}`;

    const qrFilePath = `uploads/qr-${file.id}.png`;

    await QRCode.toFile(qrFilePath, `${baseUrl}/file/${file.id}`);

    // Send email if recipient email is provided
    console.log("=== Upload Route Debug ===");
    console.log("Request body:", req.body);
    console.log("Has email field:", !!req.body.email);
    console.log("Email value:", req.body.email);
    
    if (req.body.email) {
      console.log("Calling sendShareEmail function...");
      await sendShareEmail(
        req.body.email,
        req.file.originalname,
        `${baseUrl}/file/${file.id}`,
        accessCode
      );
    } else {
      console.log("No recipient email provided - skipping email sending");
    }

    res.render("index", {
      fileLink: `${baseUrl}/file/${file.id}`,
      qrCodePath: `/uploads/qr-${file.id}.png`,
      accessCode,
      emailSent: !!req.body.email && !!process.env.SENDGRID_API_KEY,
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

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});


