const express = require("express");
const path = require("path");
const app = express();
const port = process.env.PORT || 3000;
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_req, res) => res.json({ ok: true, app: "International 3D Cartoon Video Maker" }));

// Free public LTX-Video Space. No API key; shared anonymous GPU capacity.
app.post("/api/generate", async (req, res) => {
  const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
  if (!prompt) return res.status(400).json({ error: "कृपया वीडियो का विवरण लिखें।" });
  if (prompt.length > 1800) return res.status(400).json({ error: "कृपया 1800 अक्षरों से छोटा विवरण लिखें।" });

  const base = "https://lightricks-ltx-video-distilled.hf.space";
  const api = "text_to_video";
  const headers = { "Content-Type": "application/json" };

  try {
    const submit = await fetch(base + "/gradio_api/call/" + api, {
      method: "POST",
      headers,
      body: JSON.stringify({
        data: [
          prompt,
          "blurry, low quality, distorted faces, extra limbs, text, watermark",
          "", "", 432, 768, "text-to-video", 5, 9, 42, true, 1, true
        ]
      }),
      signal: AbortSignal.timeout(30000)
    });
    if (!submit.ok) {
      return res.status(502).json({ error: "मुफ़्त AI इंजन अभी व्यस्त है। थोड़ी देर बाद फिर कोशिश करें।" });
    }
    const queued = await submit.json();
    if (!queued.event_id) return res.status(502).json({ error: "AI इंजन ने काम शुरू नहीं किया।" });

    const result = await fetch(base + "/gradio_api/call/" + api + "/" + encodeURIComponent(queued.event_id), {
      headers,
      signal: AbortSignal.timeout(8 * 60 * 1000)
    });
    if (!result.ok) return res.status(502).json({ error: "AI इंजन से जवाब नहीं मिला। बाद में फिर कोशिश करें।" });

    const raw = await result.text();
    const blocks = raw.split(/\n\n/).filter(Boolean).reverse();
    let videoUrl = "";
    let engineError = "";
    for (const block of blocks) {
      const event = block.match(/^event:\s*(\S+)/m)?.[1];
      const data = block.match(/^data:\s*(.+)$/m)?.[1];
      if (!event || !data) continue;
      if (event === "error") engineError = data;
      if (event === "complete") {
        const payload = JSON.parse(data);
        const findUrl = (value) => {
          if (!value) return "";
          if (typeof value === "string" && /^https?:\/\//.test(value)) return value;
          if (Array.isArray(value)) {
            for (const item of value) { const found = findUrl(item); if (found) return found; }
          } else if (typeof value === "object") {
            if (typeof value.url === "string" && /^https?:\/\//.test(value.url)) return value.url;
            for (const key of ["video", "path", "value", "data"]) {
              const found = findUrl(value[key]); if (found) return found;
            }
          }
          return "";
        };
        videoUrl = findUrl(payload);
        break;
      }
    }
    if (!videoUrl) {
      return res.status(502).json({ error: engineError ? "AI इंजन इस बार वीडियो नहीं बना पाया। फिर कोशिश करें।" : "AI इंजन से वीडियो फ़ाइल नहीं मिली। फिर कोशिश करें।" });
    }
    return res.json({ videoUrl, durationSeconds: 5, message: "वीडियो तैयार है।" });
  } catch (error) {
    const message = error?.name === "TimeoutError"
      ? "वीडियो बनने में ज़्यादा समय लग रहा है। मुफ़्त इंजन की कतार लंबी है—फिर कोशिश करें।"
      : "मुफ़्त AI इंजन अभी उपलब्ध नहीं है। थोड़ी देर बाद फिर कोशिश करें।";
    return res.status(502).json({ error: message });
  }
});

app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.listen(port, "0.0.0.0", () => console.log("App listening on " + port));
