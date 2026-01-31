import express from "express";
import mongoose from "mongoose";
import multer from "multer";
import path from "path";
import bodyParser from "body-parser";
import Note from "./models/Note.js";
import { fileURLToPath } from "url";
import session from "express-session";
import bcrypt from "bcryptjs";
import User from "./models/User.js";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Strategy as FacebookStrategy } from "passport-facebook";
import fetch from "node-fetch";
import dotenv from "dotenv";
import Snippet from "./models/Snippet.js";
import Code from "./models/Code.js";
import Admin from "./models/Admin.js";



dotenv.config();




const app = express();
const PORT = 3000;

/* ---------- Fix __dirname ---------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ---------- Middlewares ---------- */
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static("public"));
app.set("view engine", "ejs");

/* ---------- Session (ONLY ONCE) ---------- */
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false
  })
);

/* ---------- Passport Init ---------- */
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

/* ---------- Google Strategy ---------- */
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
clientSecret: process.env.GOOGLE_CLIENT_SECRET,

      callbackURL: "/auth/google/callback"
    },
    async (accessToken, refreshToken, profile, done) => {
      return done(null, profile);
    }
  )
);

/* ---------- Facebook Strategy (optional) ---------- */
passport.use(
  new FacebookStrategy(
    {
      clientID: process.env.FACEBOOK_APP_ID,
clientSecret: process.env.FACEBOOK_APP_SECRET,

      callbackURL: "/auth/facebook/callback"
    },
    (accessToken, refreshToken, profile, done) => {
      return done(null, profile);
    }
  )
);

/* ---------- MongoDB ---------- */
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.log("❌ Mongo error:", err));

/* ---------- Multer ---------- */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, "public/uploads"));
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  }
});
const upload = multer({ storage });

app.use("/uploads", express.static(path.join(__dirname, "public/uploads")));

/* ---------- Auth Middleware ---------- */
function isAuthenticated(req, res, next) {
  if (req.session.user) return next();
  res.redirect("/login");
}

/* ---------- ROUTES ---------- */

//Ai Chat Route
app.post("/ask-ai", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.json({ reply: "Please type a message." });
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: message }]
            }
          ]
        })
      }
    );

    const data = await response.json();

    if (!data.candidates) {
      console.log("FULL API RESPONSE:", data);
      return res.json({ reply: "No response from AI." });
    }

    const reply = data.candidates[0].content.parts[0].text;
    res.json({ reply });

  } catch (error) {
    console.log("AI ERROR:", error);
    res.json({ reply: "AI Error. Try again later." });
  }
});
//save page route
app.post("/save-code", async (req, res) => {
  if (!req.session.user) {
    return res.json({ success: false, message: "Login required" });
  }

  const { title, language, code } = req.body;

  const newCode = new Code({
    title,
    language,
    code,
    userId: req.session.user._id
  });

  await newCode.save();

  res.json({ success: true });
});

//view saved code
app.get("/my-codes", async (req, res) => {
  if (!req.session.user) return res.redirect("/login");

  const codes = await Code.find({ userId: req.session.user._id });

  res.render("my-codes", { codes });
});

// saved code to open in editor
app.get("/edit-code/:id", async (req, res) => {
  const code = await Code.findById(req.params.id);
  res.render("playground", { code });
});
// ✅ Delete Saved Code
app.post("/delete-code/:id", async (req, res) => {
  try {
    if (!req.session.user) {
      return res.redirect("/login");
    }

    await Code.findByIdAndDelete(req.params.id);
    res.redirect("/my-codes");

  } catch (err) {
    console.log("Delete Error:", err);
    res.send("Delete failed");
  }
});
// ✅ My Codes Page
app.get("/my-codes", async (req, res) => {
  if (!req.session.user) {
    return res.redirect("/login");
  }

  const codes = await Code.find({ userId: req.session.user._id });
  res.render("my-codes", { codes });
});



// Map language to Judge0 language IDs
const JUDGE0_LANGS = {
  c: 50,        // C (GCC 9.2.0)
  cpp: 54,      // C++ (GCC 9.2.0)
  java: 62,     // Java (OpenJDK 13)
  python: 71,   // Python (3.8.1)
  js: 63        // JavaScript (Node.js 12.14.0)
};

app.post("/run-code", async (req, res) => {
  try {
    const { language, code, stdin } = req.body;

    if (!language || !code) {
      return res.status(400).json({ error: "Language and code are required" });
    }

    const langId = JUDGE0_LANGS[language];
    if (!langId) {
      return res.status(400).json({ error: "Unsupported language" });
    }

    // 1. Submit code to Judge0
    const submitRes = await fetch("https://ce.judge0.com/submissions?base64_encoded=false&wait=true", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        language_id: langId,
        source_code: code,
        stdin: stdin || ""
      })
    });

    const result = await submitRes.json();

    return res.json({
      stdout: result.stdout,
      stderr: result.stderr,
      compile_output: result.compile_output,
      status: result.status
    });

  } catch (err) {
    console.error("RUN CODE ERROR:", err);
    res.status(500).json({ error: "Server error while running code" });
  }
});
//code route
// Render page
app.get("/playground", (req, res) => {
  res.render("playground", { code: {} });
});


// auto saved route
app.post("/save-code", isAuthenticated, async (req, res) => {
  const { title, language, code } = req.body;

  const newCode = new Code({
    title,
    language,
    code,
    userId: req.session.user._id
  });

  await newCode.save();
  res.json({ success: true });
});

//saved code list
app.get("/my-codes", isAuthenticated, async (req, res) => {
  const codes = await Code.find({ userId: req.session.user._id }).sort({ createdAt: -1 });

  res.render("mycodes", { codes });
});

//view single saved code
app.get("/code/:id", isAuthenticated, async (req, res) => {
  const code = await Code.findById(req.params.id);
  res.render("playground", {
    user: req.session.user,
    code
  });
});



// Save & generate share link
app.post("/snippet/save", async (req, res) => {
  try {
    const { name, language, code } = req.body;

    const snippet = new Snippet({
      userId: req.session.user ? req.session.user._id.toString() : "guest",
      name,
      language,
      code
    });

    await snippet.save();

    const link = `http://localhost:3000/snippet/${snippet._id}`;
    res.json({ success: true, link });
  } catch (err) {
    console.log("Snippet Save Error:", err);
    res.json({ success: false });
  }
});

// View shared snippet
app.get("/snippet/:id", async (req, res) => {
  const snippet = await Snippet.findById(req.params.id);
  if (!snippet) return res.send("Snippet not found");

  res.render("snippet-view", { snippet });
});

// Home
// Home
app.get("/", async (req, res) => {
  try {
    // ✅ Top 4 notes by rating
    const notes = await Note.find({ removed: false })
    .sort({ rating: -1 })
    .limit(4);


    // ✅ Leaderboard: group by uploadedBy
    const leaderboard = await Note.aggregate([
      {
        $group: {
          _id: "$uploadedBy",
          totalNotes: { $sum: 1 },
          totalDownloads: {
            $sum: { $ifNull: ["$downloads", 0] } // handle old docs
          },
          avgRating: { $avg: "$rating" }
        }
      },
      {
        $sort: {
          totalDownloads: -1, // 👈 most downloaded first
          avgRating: -1       // then by rating
        }
      },
      { $limit: 5 }
    ]);

    res.render("index", {
      notes,
      leaderboard,
      user: req.session.user
    });

  } catch (err) {
    console.log("HOME ERROR:", err);
    res.send("Error loading home page");
  }
});
// Live Leaderboard API
app.get("/api/leaderboard", async (req, res) => {
  try {
    const leaderboard = await Note.aggregate([
      {
        $group: {
          _id: "$uploadedBy",
          totalNotes: { $sum: 1 },
          totalDownloads: { $sum: { $ifNull: ["$downloads", 0] } },
          avgRating: { $avg: "$rating" }
        }
      },
      {
        $sort: { totalDownloads: -1, avgRating: -1 }
      },
      { $limit: 5 }
    ]);

    res.json(leaderboard);
  } catch (err) {
    res.json([]);
  }
});



// Google Login
app.get("/auth/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

// Google Callback - SAVE USER
app.get("/auth/google/callback",
  passport.authenticate("google", { failureRedirect: "/login" }),
  async (req, res) => {
    try {
      const profile = req.user;

      let existingUser = await User.findOne({
        email: profile.emails[0].value
      });

      if (!existingUser) {
        existingUser = new User({
          name: profile.displayName,
          email: profile.emails[0].value,
          password: "google-auth"
        });
        await existingUser.save();
      }

      req.session.user = existingUser;
      res.redirect("/");
    } catch (err) {
      console.log(err);
      res.redirect("/login");
    }
  }
);

// Logout
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

// Upload Page
app.get("/upload", isAuthenticated, (req, res) => {
  res.render("upload");
});

// Handle Upload
app.post("/upload",
  isAuthenticated,   // ✅ protect route
  upload.fields([
    { name: "file", maxCount: 1 },
    { name: "coverImage", maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const note = new Note({
        title: req.body.title,
        subject: req.body.subject,
        uploadedBy: req.session.user.name,
        uploadedById: req.session.user._id.toString(),
file: req.files.file[0].filename,
    // ✅ fixed
        coverImage: req.files.coverImage[0].filename
      });

      await note.save();
      res.redirect("/");

    } catch (err) {
      console.log("UPLOAD ERROR:", err);
      res.send("Upload failed");
    }
  }
);
// Download Note + increase download count
app.get("/download/:id", isAuthenticated, async (req, res) => {
  try {
    const note = await Note.findById(req.params.id);
    if (!note) {
      return res.send("Note not found");
    }

    // 👇 safely increment downloads
    note.downloads = (note.downloads || 0) + 1;
    await note.save();

    const filePath = path.join(__dirname, "public/uploads", note.file);
    res.download(filePath);
  } catch (err) {
    console.log("DOWNLOAD ERROR:", err);
    res.send("Error while downloading");
  }
});



// View Note
app.get("/view/:id", isAuthenticated, async (req, res) => {
  const note = await Note.findOne({ 
  _id: req.params.id,
  removed: false
});
  const filePath = path.join(__dirname, "public/uploads", note.file);
  res.sendFile(filePath);
});

// Download Note
app.get("/download/:id", isAuthenticated, async (req, res) => {
  const note = await Note.findById(req.params.id);
  const filePath = path.join(__dirname, "public/uploads", note.file);
  res.download(filePath);
});

// Rating
app.post("/rate/:id", async (req, res) => {
  try {
    if (!req.session.user) {
      return res.json({ success: false, message: "Login required" });
    }

    const note = await Note.findById(req.params.id);
    if (!note) {
      return res.json({ success: false, message: "Note not found" });
    }

    const userId = req.session.user._id.toString();

    // ❌ Prevent own note rating
    if (note.uploadedById?.toString() === userId) {
      return res.json({
        success: false,
        message: "You cannot rate your own note"
      });
    }

    // ❌ Prevent multiple ratings
    const alreadyRated = note.ratings.find(r => r.userId === userId);
    if (alreadyRated) {
      return res.json({
        success: false,
        message: "You already rated this note"
      });
    }

    const rating = Number(req.body.rating);

    // Save rating
    note.ratings.push({ userId, value: rating });

    const total = note.ratings.reduce((sum, r) => sum + r.value, 0);
    note.ratingCount = note.ratings.length;
    note.rating = total / note.ratingCount;

    await note.save();

    res.json({
      success: true,
      rating: note.rating.toFixed(1),
      ratingCount: note.ratingCount
    });

  } catch (err) {
    console.log("❌ Rating Error:", err);
    res.json({ success: false, message: "Server error" });
  }
});





// Register Page
app.get("/register", (req, res) => {
  res.render("register", { error: null });
});


// Login Page
app.get("/login", (req, res) => {
  res.render("login");
});

// Register User
app.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.render("register", {
        error: "This email is already registered. Please login instead."
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = new User({
      name,
      email,
      password: hashedPassword
    });

    await user.save();
    res.redirect("/login");
  } catch (err) {
    console.log(err);
    res.render("register", {
      error: "Something went wrong. Please try again."
    });
  }
});

//note route 
app.get("/notes", async (req, res) => {
  if (!req.session.user) {
    return res.redirect("/login");
  }

  const { search, subject, sort } = req.query;

 let query = { removed: false };


  // 🔍 Search by title
  if (search) {
    query.title = { $regex: search, $options: "i" };
  }

  // 📂 Filter by subject
  if (subject && subject !== "all") {
    query.subject = subject;
  }

  let sortOption = { createdAt: -1 };

  // ⭐ Sorting options
  if (sort === "rating") {
    sortOption = { rating: -1 };
  } else if (sort === "oldest") {
    sortOption = { createdAt: 1 };
  }

  const notes = await Note.find(query).sort(sortOption);

  // Get unique subjects for dropdown
  const subjects = await Note.distinct("subject");

  res.render("notes", {
    notes,
    subjects,
    user: req.session.user
  });
});



// Normal Login
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email });
  if (!user) return res.send("User not found");

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.send("Wrong password");

  req.session.user = user;
  res.redirect("/");
});

/* Admin routes can be added here */
function isAdmin(req, res, next) {
  if (req.session.admin) return next();
  res.redirect("/admin/login");
}

// Admin Login Page
app.get("/admin/login", (req, res) => {
  res.render("admin-login", { error: null });
});

// Admin Login POST
app.post("/admin/login", async (req, res) => {
  const { username, password } = req.body;

  console.log("USERNAME RECEIVED:", username);
  console.log("PASSWORD RECEIVED:", password);

  const admin = await Admin.findOne({ username });

  console.log("HASH IN DATABASE:", admin.password);

  if (!admin) {
    return res.render("admin-login", { error: "Admin not found" });
  }

  const match = await bcrypt.compare(password, admin.password);
  console.log("BCRYPT RESULT:", match);

  if (!match) {
    return res.render("admin-login", { error: "Incorrect password" });
  }

  req.session.admin = admin;
  res.redirect("/admin/dashboard");
  console.log("USERNAME RECEIVED:", username);
console.log("PASSWORD RECEIVED:", password);
console.log("HASH IN DATABASE:", admin.password);

});

// Admin Logout
app.get("/admin/logout", (req, res) => {
  req.session.admin = null;
  res.redirect("/admin/login");
});
app.get("/admin/dashboard", isAdmin, async (req, res) => {
  const totalNotes = await Note.countDocuments();
  const approvedNotes = await Note.countDocuments({ approved: true });
  const pendingNotes = await Note.countDocuments({ approved: false });
  const removedNotes = await Note.countDocuments({ removed: true });

  res.render("admin-dashboard", {
    admin: req.session.admin,
    totalNotes,
    approvedNotes,
    pendingNotes,
    removedNotes
  });
});
app.get("/admin/manage-notes", isAdmin, async (req, res) => {
  const notes = await Note.find().sort({ createdAt: -1 });
  res.render("admin-manage-notes", { notes });
});

app.post("/admin/remove/:id", isAdmin, async (req, res) => {
  await Note.findByIdAndUpdate(req.params.id, { removed: true });
  res.redirect("/admin/manage-notes");
});


app.get("/admin/search", isAdmin, async (req, res) => {
  const { q } = req.query;

  const notes = await Note.find({
    $or: [
      { title: { $regex: q, $options: "i" } },
      { subject: { $regex: q, $options: "i" } },
      { uploadedBy: { $regex: q, $options: "i" } }
    ]
  });

  res.render("admin-search", { notes, q });
});
app.get("/admin/reports", isAdmin, async (req, res) => {
  const topRated = await Note.find().sort({ rating: -1 }).limit(5);
  const mostDownloaded = await Note.find().sort({ downloads: -1 }).limit(5);

  res.render("admin-reports", {
    topRated,
    mostDownloaded
  });
});


/* ---------- Server ---------- */
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
