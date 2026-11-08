const express = require("express");
const path = require("path");
const app = express();
const port = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, "public")));
app.get("/api/health", (_req, res) => res.json({ ok: true, app: "International 3D Cartoon Video Maker" }));
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.listen(port, "0.0.0.0", () => console.log("App listening on " + port));