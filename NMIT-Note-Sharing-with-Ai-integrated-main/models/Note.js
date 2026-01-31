import mongoose from "mongoose";

const noteSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true
  },

  subject: {
    type: String,
    required: true
  },

  uploadedBy: {
    type: String,
    required: true
  },

  uploadedById: {
    type: String,
    default: ""
  },

  file: {
    type: String,
    required: true
  },

  coverImage: {
    type: String,
    required: true
  },

  downloads: {
    type: Number,
    default: 0
  },

  ratings: [
    {
      userId: String,
      value: Number
    }
  ],

  rating: {
    type: Number,
    default: 0
  },

  ratingCount: {
    type: Number,
    default: 0
  },

  comments: {
    type: [String],
    default: []
  },

  // ✅ ADMIN MODULE FIELDS
  approved: {
    type: Boolean,
    default: false
  },

  removed: {
    type: Boolean,
    default: false
  },

  createdAt: {
    type: Date,
    default: Date.now
  }
});

const Note = mongoose.model("Note", noteSchema);
export default Note;
