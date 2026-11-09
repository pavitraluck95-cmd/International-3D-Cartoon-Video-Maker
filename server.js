const express = require("express");
const path = require("path");
const app = express();
const port = process.env.PORT || 3000;
app.use(express.json({ limit: "10mb" }));
const publicDir = path.join(__dirname, "public");
const distDir = path.join(__dirname, "dist");
app.use(express.static(distDir));
app.use(express.static(publicDir));

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
        null, null, 512, 704, "text-to-video", 2, 9, 42, true, 3, false
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


// Image-to-video through the public Wan2.2 ZeroGPU Space.
// Images are sent only for this generation request; they are not stored by this app.
app.post("/api/animate-image", async (req, res) => {
  const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
  const imageData = typeof req.body?.imageData === "string" ? req.body.imageData : "";
  const mimeType = typeof req.body?.mimeType === "string" ? req.body.mimeType : "";
  if (!prompt) return res.status(400).json({ error: "तस्वीर में क्या होना चाहिए, उसका विवरण लिखें।" });
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(imageData) || !["image/jpeg","image/png","image/webp"].includes(mimeType)) {
    return res.status(400).json({ error: "कृपया JPG, PNG या WEBP तस्वीर चुनें।" });
  }
  const base = "https://openking-wan2-video-generation.hf.space";
  try {
    const encoded = imageData.split(",")[1];
    const bytes = Buffer.from(encoded, "base64");
    if (!bytes.length || bytes.length > 6 * 1024 * 1024) {
      return res.status(400).json({ error: "तस्वीर 6 MB से छोटी होनी चाहिए।" });
    }
    const ext = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
    const form = new FormData();
    form.append("files", new Blob([bytes], { type: mimeType }), "input." + ext);
    const upload = await fetch(base + "/gradio_api/upload", { method: "POST", body: form, signal: AbortSignal.timeout(60000) });
    if (!upload.ok) {
      console.error("Wan image upload failed:", upload.status, (await upload.text()).slice(0, 500));
      return res.status(502).json({ error: "मुफ़्त तस्वीर-वीडियो इंजन अभी तस्वीर स्वीकार नहीं कर रहा। बाद में फिर कोशिश करें।" });
    }
    const uploaded = await upload.json();
    const imagePath = Array.isArray(uploaded) ? uploaded[0] : uploaded;
    if (typeof imagePath !== "string") {
      console.error("Wan upload returned unexpected data:", JSON.stringify(uploaded).slice(0, 500));
      return res.status(502).json({ error: "इंजन से तस्वीर का पता नहीं मिला।" });
    }
    const submit = await fetch(base + "/gradio_api/call/generate_video", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: [prompt, { path: imagePath, meta: { _type: "gradio.FileData" }, orig_name: "input." + ext }, 832, 480, 49, 20, 5, -1] }),
      signal: AbortSignal.timeout(60000)
    });
    if (!submit.ok) {
      console.error("Wan submit failed:", submit.status, (await submit.text()).slice(0, 500));
      return res.status(502).json({ error: "मुफ़्त AI इंजन ने अनुरोध स्वीकार नहीं किया।" });
    }
    const queued = await submit.json();
    if (!queued.event_id) return res.status(502).json({ error: "इंजन ने वीडियो बनाना शुरू नहीं किया।" });
    const result = await fetch(base + "/gradio_api/call/generate_video/" + encodeURIComponent(queued.event_id), {
      headers: { "Accept": "text/event-stream" }, signal: AbortSignal.timeout(4 * 60 * 1000)
    });
    if (!result.ok) return res.status(502).json({ error: "इंजन से वीडियो परिणाम नहीं मिला।" });
    const raw = await result.text();
    let completed = null, failed = false;
    for (const block of raw.split(/\r?\n\r?\n/)) {
      const event = block.match(/^event:\s*(\S+)/m)?.[1];
      const data = block.split(/\r?\n/).filter(x => x.startsWith("data:")).map(x => x.slice(5).trim()).join("\n");
      if (event === "error") failed = true;
      if (event === "complete" && data) { try { completed = JSON.parse(data); } catch {} }
    }
    if (failed || !completed) {
      console.error("Wan generation failed:", raw.slice(-1200));
      return res.status(502).json({ error: "मुफ़्त GPU व्यस्त है या तस्वीर से वीडियो नहीं बन पाया। थोड़ी देर बाद फिर कोशिश करें।" });
    }
    const findVideo = (v) => {
      if (Array.isArray(v)) { for (const x of v) { const f = findVideo(x); if (f) return f; } }
      else if (v && typeof v === "object") {
        if (typeof v.url === "string" && v.url) return /^https?:/.test(v.url) ? v.url : new URL(v.url, base).href;
        if (typeof v.path === "string" && v.path) return /^https?:/.test(v.path) ? v.path : base + "/gradio_api/file=" + encodeURIComponent(v.path);
        for (const k of ["data","value","output","video","files"]) { const f = findVideo(v[k]); if (f) return f; }
      } else if (typeof v === "string" && /^https?:/.test(v)) return v;
      return null;
    };
    const videoUrl = findVideo(completed);
    if (!videoUrl) return res.status(502).json({ error: "वीडियो बना, लेकिन डाउनलोड लिंक नहीं मिला।" });
    return res.json({ videoUrl, durationSeconds: 2, message: "तस्वीर से छोटी टेस्ट क्लिप तैयार है।" });
  } catch (error) {
    console.error("Wan image-to-video error:", error?.name, error?.message);
    return res.status(502).json({ error: "तस्वीर से वीडियो बनाने वाला मुफ्त इंजन अभी जवाब नहीं दे रहा। बाद में कोशिश करें।" });
  }
});


// Free AI Director (anonymous public gateway; limited shared capacity, no API key).
// This plans a short cartoon story and scene prompts; it does NOT render video.
app.post("/api/ai-director", async (req, res) => {
  const idea = typeof req.body?.idea === "string" ? req.body.idea.trim() : "";
  if (!idea) return res.status(400).json({ error: "कहानी का विषय लिखें।" });
  if (idea.length > 1600) return res.status(400).json({ error: "विषय 1600 अक्षरों से छोटा रखें।" });
  const system = "You are a professional 3D cartoon short-film writer and storyboard director. Reply in simple Hindi. Create one original family-friendly YouTube Short of exactly about 30 seconds, split into 5 scenes of about 6 seconds each. Keep character names, clothes, colors, proportions and environment consistent across all scenes. Include: catchy Hindi title, character continuity sheet, 5 numbered scenes with visual action/camera movement, Hindi dialogue or narration, sound/music cue, and one concise English visual-generation prompt per scene. Do not claim to render or create a video. Avoid copyrighted characters and existing franchises. Keep output compact and practical.";
  try {
    const upstream = await fetch("https://vireonix.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "auto",
        messages: [{ role: "system", content: system }, { role: "user", content: idea }],
        temperature: 0.7,
        max_tokens: 1800
      }),
      signal: AbortSignal.timeout(90000)
    });
    const raw = await upstream.text();
    if (!upstream.ok) {
      console.error("AI Director Vireonix error:", upstream.status, raw.slice(0, 700));
      return res.status(upstream.status === 429 ? 429 : 502).json({
        error: upstream.status === 429
          ? "मुफ्त AI Director की आज की सीमा पूरी हो गई या कतार व्यस्त है। बाद में फिर कोशिश करें।"
          : "मुफ्त AI Director अभी उपलब्ध नहीं है। कुछ देर बाद फिर कोशिश करें।"
      });
    }
    let data;
    try { data = JSON.parse(raw); } catch {
      console.error("AI Director invalid Vireonix JSON:", raw.slice(0, 500));
      return res.status(502).json({ error: "AI Director से सही जवाब नहीं मिला।" });
    }
    const answer = data?.choices?.[0]?.message?.content;
    if (typeof answer !== "string" || !answer.trim()) {
      console.error("AI Director empty Vireonix response:", raw.slice(0, 700));
      return res.status(502).json({ error: "AI Director ने खाली जवाब दिया।" });
    }
    return res.json({ plan: answer.trim(), model: data.model || "auto" });
  } catch (error) {
    console.error("AI Director Vireonix request failed:", error?.name, error?.message);
    return res.status(502).json({ error: "AI Director से संपर्क नहीं हो पाया। मुफ्त सेवा की उपलब्धता बदल सकती है।" });
  }
});


async function requestCartoonImage(prompt) {
  const base = "https://akhaliq-z-image-turbo.hf.space";
  const submit = await fetch(base + "/gradio_api/call/generate_image", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: [prompt, 1024, 576, 9, -1, true] }),
    signal: AbortSignal.timeout(90000)
  });
  if (!submit.ok) throw new Error("मुफ्त Cartoon Image GPU व्यस्त है या सीमा पूरी है (HTTP " + submit.status + ")।");
  const queued = await submit.json();
  if (!queued.event_id) throw new Error("Image AI ने generation शुरू नहीं किया।");
  const result = await fetch(base + "/gradio_api/call/generate_image/" + encodeURIComponent(queued.event_id), {
    headers: { "Accept": "text/event-stream" }, signal: AbortSignal.timeout(180000)
  });
  if (!result.ok) throw new Error("Image AI से परिणाम नहीं मिला।");
  const raw = await result.text();
  let completed = null, failed = false;
  for (const block of raw.split(/\r?\n\r?\n/)) {
    const event = block.match(/^event:\s*(\S+)/m);
    const data = block.split(/\r?\n/).filter(line => line.startsWith("data:"))
      .map(line => line.slice(5).trim()).join("\n");
    if (event && event[1] === "error") failed = true;
    if (event && event[1] === "complete" && data) { try { completed = JSON.parse(data); } catch (e) {} }
  }
  if (failed || !completed) throw new Error("Image AI GPU व्यस्त है या तस्वीर नहीं बना पाया।");
  function findImage(value) {
    if (Array.isArray(value)) {
      for (const item of value) { const found = findImage(item); if (found) return found; }
    } else if (value && typeof value === "object") {
      if (typeof value.url === "string" && value.url) return /^https?:\/\//.test(value.url) ? value.url : new URL(value.url, base).href;
      if (typeof value.path === "string" && value.path) return /^https?:\/\//.test(value.path)
        ? value.path : base + "/gradio_api/file=" + encodeURIComponent(value.path);
      for (const key of ["data", "value", "output", "image", "files"]) {
        const found = findImage(value[key]); if (found) return found;
      }
    } else if (typeof value === "string" && /^https?:\/\//.test(value)) return value;
    return null;
  }
  const imageUrl = findImage(completed);
  if (!imageUrl) throw new Error("Image AI ने तस्वीर का डाउनलोड पता नहीं दिया।");
  const imageResponse = await fetch(imageUrl, { signal: AbortSignal.timeout(60000) });
  if (!imageResponse.ok) throw new Error("बनी हुई तस्वीर डाउनलोड नहीं हो सकी।");
  const contentType = imageResponse.headers.get("content-type") || "image/png";
  if (!contentType.startsWith("image/")) throw new Error("Image AI ने image file के बजाय दूसरा परिणाम दिया।");
  const bytes = Buffer.from(await imageResponse.arrayBuffer());
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new Error("तस्वीर का आकार बहुत बड़ा है।");
  return "data:" + contentType + ";base64," + bytes.toString("base64");
}


async function generateWanMotionClip(imageData, prompt) {
  const base = "https://openking-wan2-video-generation.hf.space";
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(imageData || "");
  if (!match) throw new Error("दृश्य की reference image सही नहीं है।");
  const mimeType = "image/" + match[1];
  const bytes = Buffer.from(match[2], "base64");
  const ext = match[1] === "jpeg" ? "jpg" : match[1];
  const form = new FormData();
  form.append("files", new Blob([bytes], { type: mimeType }), "scene." + ext);
  const upload = await fetch(base + "/gradio_api/upload", {
    method: "POST", body: form, signal: AbortSignal.timeout(60000)
  });
  if (!upload.ok) throw new Error("Wan AI reference image upload नहीं कर पाया।");
  const uploaded = await upload.json();
  const imagePath = Array.isArray(uploaded) ? uploaded[0] : uploaded;
  if (typeof imagePath !== "string") throw new Error("Wan AI को reference image नहीं मिली।");
  const submit = await fetch(base + "/gradio_api/call/generate_video", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: [
      prompt, { path: imagePath, meta: { _type: "gradio.FileData" }, orig_name: "scene." + ext },
      832, 480, 73, 20, 5, -1
    ] }),
    signal: AbortSignal.timeout(60000)
  });
  if (!submit.ok) throw new Error("Wan 2.2 वीडियो इंजन ने अनुरोध स्वीकार नहीं किया।");
  const queued = await submit.json();
  if (!queued.event_id) throw new Error("Wan 2.2 ने वीडियो बनाना शुरू नहीं किया।");
  const result = await fetch(base + "/gradio_api/call/generate_video/" + encodeURIComponent(queued.event_id), {
    headers: { "Accept": "text/event-stream" }, signal: AbortSignal.timeout(240000)
  });
  if (!result.ok) throw new Error("Wan 2.2 से वीडियो परिणाम नहीं मिला।");
  const raw = await result.text();
  let completed = null, failed = false;
  for (const block of raw.split(/\r?\n\r?\n/)) {
    const event = block.match(/^event:\s*(\S+)/m)?.[1];
    const data = block.split(/\r?\n/).filter(line => line.startsWith("data:"))
      .map(line => line.slice(5).trim()).join("\n");
    if (event === "error") failed = true;
    if (event === "complete" && data) { try { completed = JSON.parse(data); } catch {} }
  }
  if (failed || !completed) throw new Error("Wan 2.2 का मुफ्त GPU व्यस्त है या वीडियो नहीं बना पाया।");
  function findVideo(value) {
    if (Array.isArray(value)) {
      for (const item of value) { const found = findVideo(item); if (found) return found; }
    } else if (value && typeof value === "object") {
      if (typeof value.url === "string" && value.url) return /^https?:/.test(value.url) ? value.url : new URL(value.url, base).href;
      if (typeof value.path === "string" && value.path) return /^https?:/.test(value.path) ? value.path : base + "/gradio_api/file=" + encodeURIComponent(value.path);
      for (const key of ["data", "value", "output", "video", "files"]) {
        const found = findVideo(value[key]); if (found) return found;
      }
    } else if (typeof value === "string" && /^https?:/.test(value)) return value;
    return null;
  }
  const videoUrl = findVideo(completed);
  if (!videoUrl) throw new Error("Wan 2.2 ने MP4 का पता नहीं दिया।");
  const videoResponse = await fetch(videoUrl, { signal: AbortSignal.timeout(60000) });
  if (!videoResponse.ok) throw new Error("बनी हुई वीडियो डाउनलोड नहीं हो सकी।");
  const contentType = videoResponse.headers.get("content-type") || "video/mp4";
  if (!contentType.startsWith("video/")) throw new Error("Wan 2.2 ने MP4 के बजाय दूसरा परिणाम दिया।");
  const videoBytes = Buffer.from(await videoResponse.arrayBuffer());
  if (!videoBytes.length || videoBytes.length > 18 * 1024 * 1024) throw new Error("बनी हुई वीडियो का आकार बहुत बड़ा है।");
  return "data:video/mp4;base64," + videoBytes.toString("base64");
}

app.post("/api/ai-movie", async (req, res) => {
  const idea = req.body && typeof req.body.idea === "string" ? req.body.idea.trim() : "";
  if (!idea) return res.status(400).json({ error: "पहले कहानी का विषय लिखें या बोलें।" });
  if (idea.length > 1400) return res.status(400).json({ error: "कहानी 1400 अक्षरों से छोटी रखें।" });
  const system = [
    "You are a professional family-friendly 3D cartoon film director and storyboard writer.",
    "Return ONLY valid JSON with this exact shape:",
    '{"title":"Hindi title","characterBible":"consistent character descriptions","scenes":[{"n":1,"duration":6,"visual":"Hindi visual description","dialogue":"short Hindi narration/dialogue","imagePrompt":"English image generation prompt"}]}',
    "Create exactly 5 scenes for a 30-second vertical 9:16 cartoon short.",
    "Maintain exactly the same characters, faces, clothing, colors and proportions across all scenes.",
    "Every imagePrompt must repeat the full key character appearance from characterBible, then describe the current scene action and setting.",
    "Image prompts must request polished high-quality 3D animated family-film cartoon art, expressive characters, cinematic lighting, vertical composition, no text, no subtitles, no watermark.",
    "Make scenes visually different but story-continuous. Use original characters, no copyrighted franchise characters.",
    "Keep each dialogue concise (max 18 Hindi words)."
  ].join(" ");
  try {
    const upstream = await fetch("https://vireonix.ai/v1/chat/completions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "auto",
        messages: [{ role: "system", content: system }, { role: "user", content: idea }],
        temperature: 0.65, max_tokens: 2200
      }),
      signal: AbortSignal.timeout(90000)
    });
    const raw = await upstream.text();
    if (!upstream.ok) return res.status(upstream.status === 429 ? 429 : 502).json({
      error: upstream.status === 429 ? "मुफ्त Story AI की सीमा पूरी है या सेवा व्यस्त है।" : "Story AI अभी जवाब नहीं दे रहा।"
    });
    const response = JSON.parse(raw);
    let content = response.choices && response.choices[0] && response.choices[0].message && response.choices[0].message.content;
    if (Array.isArray(content)) content = content.map(part => part.text || "").join("\n");
    if (typeof content !== "string") return res.status(502).json({ error: "Story AI ने कहानी नहीं दी।" });
    const jsonText = content.trim().replace(/^\x60{3}(?:json)?\s*/i, "").replace(/\s*\x60{3}$/, "");
    const story = JSON.parse(jsonText);
    if (!Array.isArray(story.scenes) || story.scenes.length < 5) {
      return res.status(502).json({ error: "Story AI ने पाँच पूरे दृश्य नहीं दिए।" });
    }
    story.scenes = story.scenes.slice(0, 5);
    const images = [];
    const videos = [];
    let imageError = "";
    let videoError = "";
    for (let i = 0; i < story.scenes.length; i++) {
      const scene = story.scenes[i];
      const imagePrompt = String(scene.imagePrompt || scene.visual || "").slice(0, 1800);
      try {
        const image = await requestCartoonImage(imagePrompt);
        images.push(image);
        const motionPrompt = [
          imagePrompt,
          "Animate this exact 3D cartoon character and scene with clear continuous full-body movement, natural walking or action matching the scene, expressive face and eyes, moving hands and body, smooth cinematic camera movement, stable character identity, consistent clothes and colors, polished animated feature film quality, vertical-friendly centered framing. The character must visibly move; do not make a still image or slideshow."
        ].join(" ");
        const video = await generateWanMotionClip(image, motionPrompt);
        videos.push(video);
      } catch (error) {
        const message = error.message || "3D motion video नहीं बन पाई।";
        if (images.length < i + 1) imageError = message;
        else videoError = message;
        console.error("AI movie scene " + (i + 1) + " failed:", message);
        break;
      }
    }
    const readyCount = videos.length;
    return res.json({
      title: String(story.title || idea).slice(0, 100),
      characterBible: String(story.characterBible || ""),
      scenes: story.scenes.map((scene, index) => ({
        n: index + 1, duration: 3, visual: String(scene.visual || ""),
        dialogue: String(scene.dialogue || ""),
        image: images[index] || null,
        video: videos[index] || null
      })),
      imagesCreated: images.length,
      videosCreated: readyCount,
      durationSeconds: readyCount * 3,
      complete: readyCount === 5,
      warning: videoError || imageError || (readyCount === 5 ? "" : "कुछ 3D चलती वीडियो क्लिप अभी नहीं बन पाईं।")
    });
  } catch (error) {
    console.error("AI movie pipeline error:", error && error.name, error && error.message);
    return res.status(502).json({
      error: error && error.name === "TimeoutError"
        ? "AI की साझा कतार में बहुत समय लग गया। बाद में फिर कोशिश करें।"
        : (error && error.message || "AI वीडियो तैयारी में समस्या आई।")
    });
  }
});

app.get("/editor", (_req, res) => res.sendFile(path.join(distDir, "editor.html"), (err) => { if (err) res.sendFile(path.join(publicDir, "editor.html")); }));
app.get("*", (_req, res) => res.sendFile(path.join(distDir, "index.html"), (err) => { if (err) res.sendFile(path.join(publicDir, "index.html")); }));
app.listen(port, "0.0.0.0", () => console.log("App listening on " + port));
