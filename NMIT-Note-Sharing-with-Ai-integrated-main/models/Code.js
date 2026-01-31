import mongoose from "mongoose";

const codeSchema = new mongoose.Schema({
  userId: String,
  title: String,
  language: String,
  code: String,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const Code = mongoose.model("Code", codeSchema);
export default Code;
