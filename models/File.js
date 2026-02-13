const mongoose = require("mongoose");

const fileSchema = new mongoose.Schema(
  {
    path: {
      type: String,
      required: true,
    },

    originalName: {
      type: String,
      required: true,
    },

    password: {
      type: String,
    },

    accessCode: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    downloadCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("File", fileSchema);
