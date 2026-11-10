const express = require("express");
const path = require("path");
const app = express();
const port = process.env.PORT || 3000;
app.use(express.json({ limit: "10mb" }));
app.use((req, res, next) => {
  const origin = req.headers.origin || "";
  const allowed = ["capacitor://localhost", "http://localhost", "https://localhost", "https://international-3d-cartoon-video-maker.onrender.com"];
  if (allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const publicDir = path.join(__dirname, "public");
const distDir = path.join(__dirname, "dist");
app.use(express.static(distDir));
app.use(express.static(publicDir));

app.get("/api/health", (_req, res) => res.json({ ok: true, app: "International 2D Cartoon Video Maker" }));

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
  const base = "https://cbensimon-wan2-2-fp8da-aoti-preview2.hf.space";
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
      body: JSON.stringify({ data: [{ path: imagePath, url: base + "/gradio_api/file=" + imagePath, orig_name: "input." + ext, size: null, mime_type: mimeType, meta: { _type: "gradio.FileData" } }, null, prompt, 6, "色调艳丽, 过曝, 静态, 细节模糊不清, 字幕, 最差质量, 低质量, 畸形的, 多余的手指, 静止不动的画面", 3.5, 1, 1, 42, true, 6, "UniPCMultistep", 3, 16, false, true] }),
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



/** Local 2D illustration fallback; works without a public image GPU. */
async function requestCartoonImage(prompt) {
  const safe = String(prompt || "मजेदार गाँव का दृश्य").replace(/[&<>"]/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[ch])).slice(0, 150);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><rect width="1280" height="720" fill="#dbeafe"/><circle cx="1080" cy="120" r="68" fill="#fde047"/><path d="M0 500 Q250 420 500 510 T1000 500 T1280 490 V720 H0Z" fill="#86c98a"/><path d="M0 610 Q300 530 650 620 T1280 590 V720 H0Z" fill="#55a86b"/><g stroke="#253047" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"><circle cx="470" cy="310" r="105" fill="#f6c79a"/><path d="M375 275 Q380 175 480 190 Q565 190 570 270" fill="#3b2a22"/><circle cx="435" cy="310" r="12" fill="#253047"/><circle cx="505" cy="310" r="12" fill="#253047"/><path d="M440 355 Q470 385 510 350" fill="none"/><path d="M385 430 Q470 390 555 435 L590 610 H350Z" fill="#ef6b55"/><circle cx="790" cy="330" r="100" fill="#e8b889"/><path d="M700 295 Q715 200 800 220 Q875 225 885 300" fill="#47352b"/><circle cx="755" cy="325" r="11" fill="#253047"/><circle cx="820" cy="325" r="11" fill="#253047"/><path d="M760 365 Q790 390 830 360" fill="none"/><path d="M710 445 Q790 405 870 450 L900 610 H680Z" fill="#4385d1"/></g><rect x="70" y="48" width="1140" height="104" rx="24" fill="#fff" opacity=".94"/><text x="640" y="112" text-anchor="middle" font-family="sans-serif" font-size="30" font-weight="700" fill="#253047">' + safe + '</text></svg>';
  return "data:image/svg+xml;base64," + Buffer.from(svg, "utf8").toString("base64");
}

/** Built-in family-friendly Hindi comedy fallback for when the optional story model is unavailable. */
function makeFallbackComedyStory(idea) {
  const topic = String(idea || "गाँव की मजेदार कहानी").trim().slice(0, 160);
  const beats = [
    ["सुबह की घोषणा", "मोहन बोला, आज मैं गाँव की सबसे बड़ी समस्या हल करूँगा।", "मोहन चौपाल में घोषणा करता है"],
    ["पहला सवाल", "चिंटू बोला, समस्या क्या है? मोहन बोला, वही तो पता करना है।", "दो दोस्त चौपाल में बहस करते हैं"],
    ["गलतफहमी", "गुड़िया ने समझा कि उनकी बकरी खो गई है और खोज शुरू कर दी।", "गुड़िया हाथ में डायरी लेकर आती है"],
    ["घंटी का राज", "बकरी की घंटी बजी, पर आवाज़ मोहन की जेब से आई।", "मोहन की जेब से घंटी बजती है"],
    ["सरपंच की पूछताछ", "सरपंच ने पूछा, घंटी जेब में क्यों? मोहन बोला, सुरक्षा में रखी है।", "सरपंच मोहन से सवाल करता है"],
    ["उल्टा नक्शा", "चिंटू ने नक्शा बनाया, जिसमें गाँव की जगह समोसे की दुकान थी।", "चिंटू उल्टा नक्शा दिखाता है"],
    ["खोज अभियान", "तीनों बकरी खोजते-खोजते हलवाई की दुकान पहुँच गए।", "तीनों दुकान के सामने दौड़ते हैं"],
    ["बकरी मिली", "बकरी दुकान के पीछे आराम से पत्ते खा रही थी।", "बकरी दुकान के पीछे पत्ते खाती है"],
    ["समोसे की चोरी", "मोहन ने आवाज़ लगाई तो बकरी चिंटू का समोसा लेकर भागी।", "बकरी समोसा लेकर भागती है और दोस्त पीछे दौड़ते हैं"],
    ["हँसी वाला अंत", "सरपंच बोला, बकरी मिली या समोसा गया? सब हँस पड़े।", "सभी पात्र चौपाल पर हँसते हैं"]
  ];
  return {
    title: topic + " — गाँव की मजेदार कॉमेडी",
    characterBible: "मोहन: पीली कमीज़, नीली पैंट; चिंटू: हरी कमीज़; गुड़िया: गुलाबी पोशाक; सरपंच: सफेद कुर्ता और पगड़ी। सभी दृश्य रंगीन 2D कार्टून शैली में।",
    scenes: beats.map((b) => ({
      visual: b[2] + "। कहानी का विषय: " + topic,
      dialogue: b[1],
      imagePrompt: "Original family-friendly 2D Indian village cartoon. Consistent characters: Mohan in yellow shirt and blue pants, Chintu in green shirt, Gudiya in pink outfit, Sarpanch in white kurta and turban. Scene: " + b[2] + ". Bright colors, expressive faces, 16:9, no text, no watermark."
    }))
  };
}

// Free AI Director (anonymous public gateway; limited shared capacity, no API key).
// This plans a short cartoon story and scene prompts; it does NOT render video.
app.post("/api/ai-director", async (req, res) => {
  const idea = typeof req.body?.idea === "string" ? req.body.idea.trim() : "";
  if (!idea) return res.status(400).json({ error: "कहानी का विषय लिखें।" });
  if (idea.length > 1600) return res.status(400).json({ error: "विषय 1600 अक्षरों से छोटा रखें।" });
  const system = "You are a professional 2D cartoon comedy story writer and storyboard director. Reply in simple Hindi. Create an original family-friendly 10-minute Hindi comedy story split into exactly 10 scenes of about 60 seconds each. Keep character names, clothes, colors, proportions and environment consistent across all scenes. Include a catchy Hindi title, character continuity sheet, and exactly 10 numbered scenes with visual action, Hindi dialogue, and one concise image-generation prompt per scene. Do not claim to render video. Avoid copyrighted characters and existing franchises.";
  try {
    let story;
    try {
      const upstream = await fetch("https://vireonix.ai/v1/chat/completions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "auto",
          messages: [{ role: "system", content: system }, { role: "user", content: idea }],
          temperature: 0.75, max_tokens: 6500
        }),
        signal: AbortSignal.timeout(90000)
      });
      if (!upstream.ok) throw new Error("Story AI HTTP " + upstream.status);
      const response = await upstream.json();
      let content = response.choices && response.choices[0] && response.choices[0].message && response.choices[0].message.content;
      if (Array.isArray(content)) content = content.map(part => part.text || "").join("\\n");
      if (typeof content !== "string") throw new Error("Story AI returned no story text");
      const cleaned = content.trim().replace(/^`{3}(?:json)?\s*/i, "").replace(/\s*`{3}$/, "");
      const firstBrace = cleaned.indexOf("{");
      const lastBrace = cleaned.lastIndexOf("}");
      if (firstBrace < 0 || lastBrace <= firstBrace) throw new Error("Story AI did not return a JSON object");
      story = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
      if (!Array.isArray(story.scenes) || story.scenes.length !== 10) throw new Error("Story AI returned an incomplete 10-scene story");
    } catch (storyError) {
      console.error("Story AI unavailable; using built-in Hindi comedy fallback:", storyError && storyError.message);
      story = makeFallbackComedyStory(idea);
    }
    const scenes = [];
    for (let i = 0; i < story.scenes.length; i++) {
      const scene = story.scenes[i];
      const imagePrompt = String(scene.imagePrompt || scene.visual || "").slice(0, 1800);
      try {
        const image = await requestCartoonImage(imagePrompt);
        scenes.push({
          n: i + 1, duration: 60,
          visual: String(scene.visual || ""),
          dialogue: String(scene.dialogue || ""),
          image
        });
      } catch (error) {
        console.error("2D cartoon image scene " + (i + 1) + " failed; using built-in 2D fallback:", error.message || error);
        // Keep the one-click story pipeline usable when the shared free image GPU is unavailable.
        // This is an original, locally-rendered 2D vector illustration, not an AI-generated image.
        const esc = (value) => String(value || "").replace(/[&<>"]/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[ch]));
        const label = esc(String(scene.visual || "मजेदार कार्टून दृश्य").slice(0, 110));
        const palette = ["#fef3c7","#dbeafe","#dcfce7","#fce7f3","#ede9fe"];
        const bg = palette[i % palette.length];
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><rect width="1280" height="720" fill="' + bg + '"/><circle cx="1080" cy="120" r="65" fill="#fde047"/><path d="M0 540 Q250 440 500 545 T1000 530 T1280 520 V720 H0Z" fill="#86c98a"/><path d="M0 610 Q300 530 650 620 T1280 590 V720 H0Z" fill="#55a86b"/><g stroke="#253047" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"><circle cx="470" cy="310" r="105" fill="#f6c79a"/><path d="M375 275 Q380 175 480 190 Q565 190 570 270" fill="#3b2a22"/><circle cx="435" cy="310" r="12" fill="#253047"/><circle cx="505" cy="310" r="12" fill="#253047"/><path d="M440 355 Q470 385 510 350" fill="none"/><path d="M385 430 Q470 390 555 435 L590 610 H350Z" fill="#ef6b55"/><circle cx="790" cy="330" r="100" fill="#e8b889"/><path d="M700 295 Q715 200 800 220 Q875 225 885 300" fill="#47352b"/><circle cx="755" cy="325" r="11" fill="#253047"/><circle cx="820" cy="325" r="11" fill="#253047"/><path d="M760 365 Q790 390 830 360" fill="none"/><path d="M710 445 Q790 405 870 450 L900 610 H680Z" fill="#4385d1"/></g><rect x="90" y="55" width="1100" height="90" rx="28" fill="#ffffff" opacity=".92"/><text x="640" y="112" text-anchor="middle" font-family="sans-serif" font-size="34" font-weight="700" fill="#253047">2D Comedy • दृश्य ' + (i + 1) + '</text><text x="640" y="675" text-anchor="middle" font-family="sans-serif" font-size="25" fill="#183b2a">' + label + '</text></svg>';
        const image = "data:image/svg+xml;base64," + Buffer.from(svg, "utf8").toString("base64");
        scenes.push({
          n: i + 1, duration: 60,
          visual: String(scene.visual || ""),
          dialogue: String(scene.dialogue || ""),
          image
        });
      }
    }
    return res.json({
      title: String(story.title || idea).slice(0, 100),
      characterBible: String(story.characterBible || ""),
      scenes, imagesCreated: scenes.length, videosCreated: 0,
      durationSeconds: 600, complete: true,
      message: "10 मिनट की 2D कहानी और 10 दृश्य तैयार हैं।"
    });
  } catch (error) {
    console.error("2D AI movie pipeline error:", error && error.name, error && error.message);
    return res.status(502).json({
      error: error && error.name === "TimeoutError"
        ? "मुफ्त AI की कतार में बहुत समय लग गया। बाद में फिर कोशिश करें।"
        : (error && error.message || "2D कहानी/तस्वीरें तैयार नहीं हो पाईं।")
    });
  }
});

app.get("/editor", (_req, res) => res.sendFile(path.join(distDir, "editor.html"), (err) => { if (err) res.sendFile(path.join(publicDir, "editor.html")); }));
app.get("*", (_req, res) => res.sendFile(path.join(distDir, "index.html"), (err) => { if (err) res.sendFile(path.join(publicDir, "index.html")); }));
app.listen(port, "0.0.0.0", () => console.log("App listening on " + port));
