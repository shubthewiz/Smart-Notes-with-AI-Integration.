import mongoose from "mongoose";

const snippetSchema = new mongoose.Schema({
  userId: String,
  name: String,
  language: String,
  code: String,
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model("Snippet", snippetSchema);
