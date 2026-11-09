const express = require("express");
const path = require("path");
const app = express();
const port = process.env.PORT || 3000;
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_req, res) => res.json({ ok: true, app: "International 3D Cartoon Video Maker" }));

// Anonymous access to the public Hugging Face Gradio Space. Shared free GPU may be busy.
app.post("/api/generate", async (req, res) => {
  const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
  if (!prompt) return res.status(400).json({ error: "कृपया वीडियो का विवरण लिखें।" });
  if (prompt.length > 1800) return res.status(400).json({ error: "कृपया 1800 अक्षरों से छोटा विवरण लिखें।" });

  const base = "https://lightricks-ltx-video-distilled.hf.space";
  try {
    const submit = await fetch(base + "/gradio_api/call/text_to_video", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: [
        prompt,
        "worst quality, inconsistent motion, blurry, jittery, distorted, watermark",
        "", "", 512, 704, "text-to-video", 3, 9, 42, true, 1, true
      ] }),
      signal: AbortSignal.timeout(45000)
    });
    if (!submit.ok) {
      const detail = (await submit.text()).slice(0, 240);
      console.error("HF submit failed:", submit.status, detail);
      return res.status(502).json({ error: submit.status === 503 || submit.status === 429
        ? "मुफ़्त AI इंजन अभी व्यस्त है। कुछ देर बाद फिर कोशिश करें।"
        : "AI इंजन ने अनुरोध स्वीकार नहीं किया (HTTP " + submit.status + ")।" });
    }

    const queued = await submit.json();
    if (!queued.event_id) {
      console.error("HF returned no event id:", JSON.stringify(queued).slice(0, 300));
      return res.status(502).json({ error: "AI इंजन ने काम शुरू नहीं किया। कुछ देर बाद फिर कोशिश करें।" });
    }

    const result = await fetch(base + "/gradio_api/call/text_to_video/" + encodeURIComponent(queued.event_id), {
      headers: { "Accept": "text/event-stream" },
      signal: AbortSignal.timeout(8 * 60 * 1000)
    });
    if (!result.ok) {
      const detail = (await result.text()).slice(0, 240);
      console.error("HF result failed:", result.status, detail);
      return res.status(502).json({ error: "AI इंजन से वीडियो परिणाम नहीं मिला (HTTP " + result.status + ")।" });
    }

    const raw = await result.text();
    let completedData = null;
    let engineError = "";
    // Parse SSE blocks; Gradio may return a video filepath rather than a public URL.
    for (const block of raw.split(/\r?\n\r?\n/)) {
      const event = block.match(/^event:\s*(\S+)/m)?.[1];
      const data = block.split(/\r?\n/).filter(line => line.startsWith("data:"))
        .map(line => line.slice(5).trim()).join("\n");
      if (!event || !data) continue;
      if (event === "error") engineError = data;
      if (event === "complete") {
        try { completedData = JSON.parse(data); }
        catch (e) { console.error("HF complete JSON parse failed:", data.slice(0, 300)); }
      }
    }

    if (engineError) {
      const errorBlock = raw.split(/\r?\n\r?\n/).find(block => /^event:\s*error/m.test(block)) || "";
      console.error("HF generation event error; raw SSE block:", errorBlock.slice(0, 1800));
      console.error("HF generation event error data:", engineError.slice(0, 500));
      return res.status(502).json({ error: "मुफ़्त AI इंजन इस समय वीडियो नहीं बना पाया। यह साझा GPU की व्यस्तता या इंजन की अस्थायी समस्या हो सकती है।" });
    }
    if (!completedData) {
      console.error("HF no complete event; response:", raw.slice(-700));
      return res.status(502).json({ error: "AI इंजन ने समय पर परिणाम नहीं दिया। कृपया दोबारा कोशिश करें।" });
    }

    const findVideo = (value) => {
      if (!value) return null;
      if (Array.isArray(value)) {
        for (const item of value) { const found = findVideo(item); if (found) return found; }
      } else if (typeof value === "object") {
        // Gradio file component commonly returns {path, url, ...}.
        if (value.video && typeof value.video === "object") {
          const found = findVideo(value.video); if (found) return found;
        }
        if (typeof value.url === "string" && value.url) {
          return /^https?:\/\//.test(value.url) ? value.url : new URL(value.url, base).href;
        }
        if (typeof value.path === "string" && value.path) {
          if (/^https?:\/\//.test(value.path)) return value.path;
          const cleanPath = value.path.replace(/^\/+/, "");
          return base + "/gradio_api/file=" + encodeURIComponent("/" + cleanPath);
        }
        for (const key of ["data", "value", "output", "files"]) {
          const found = findVideo(value[key]); if (found) return found;
        }
      } else if (typeof value === "string" && /^https?:\/\//.test(value)) {
        return value;
      }
      return null;
    };

    const videoUrl = findVideo(completedData);
    if (!videoUrl) {
      console.error("HF complete event had no recognized video file:", JSON.stringify(completedData).slice(0, 700));
      return res.status(502).json({ error: "AI इंजन ने जवाब दिया, लेकिन वीडियो फ़ाइल नहीं मिली। इंजन का आउटपुट बदल गया हो सकता है।" });
    }
    console.log("HF video generated successfully.");
    return res.json({ videoUrl, durationSeconds: 3, message: "वीडियो तैयार है।" });
  } catch (error) {
    console.error("Video generation request failed:", error?.name, error?.message);
    const message = error?.name === "TimeoutError" || error?.name === "AbortError"
      ? "मुफ़्त इंजन की कतार में बहुत देर हो गई। थोड़ी देर बाद फिर कोशिश करें।"
      : "मुफ़्त AI इंजन से संपर्क नहीं हो पाया। थोड़ी देर बाद फिर कोशिश करें।";
    return res.status(502).json({ error: message });
  }
});

app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.listen(port, "0.0.0.0", () => console.log("App listening on " + port));
