import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Editor,
  ADVANCED_CONFIGURATION,
  createLocalAssetStore
} from "@clipkit/editor";
import { ClipkitRuntime } from "@clipkit/runtime";
import "@clipkit/editor/styles.css";
import "./editor.css";

function makeProject(idea = "", story = null) {
  const scenes = story && Array.isArray(story.scenes) ? story.scenes : [];
  const elements = [
    { id: "background", type: "shape", layer: 1, shape: "rectangle",
      x: 0, y: 0, width: 720, height: 1280, fill_color: "#111827",
      time: 0, duration: 30 },
    { id: "main-title", type: "text", layer: 20, time: 0, duration: 3,
      x: 360, y: 110, x_anchor: 0.5, y_anchor: 0.5, width: 660, height: 140,
      text: String(story && story.title || idea || "मेरी नई कार्टून कहानी").slice(0, 80),
      font_family: "Inter", font_size: 48, font_weight: 800,
      fill_color: "#ffd36c", text_align: "center",
      background_color: "#172033", background_padding: [18, 18],
      background_border_radius: 18 }
  ];
  if (scenes.length) {
    scenes.slice(0, 5).forEach((scene, i) => {
      const start = i * 6;
      if (scene.image) {
        elements.push({
          id: "scene-image-" + (i + 1), type: "image", layer: 2,
          source: scene.image, fit: "cover",
          x: 0, y: 0, width: 720, height: 1280,
          time: start, duration: 6
        });
      } else {
        elements.push({
          id: "scene-placeholder-" + (i + 1), type: "shape", layer: 2,
          shape: "rectangle", x: 0, y: 0, width: 720, height: 1280,
          fill_color: "#26344f", time: start, duration: 6
        });
      }
      const caption = [scene.visual, scene.dialogue].filter(Boolean).join("\n");
      elements.push({
        id: "scene-caption-" + (i + 1), type: "text", layer: 3,
        time: start, duration: 6, x: 360, y: 1080,
        x_anchor: 0.5, y_anchor: 0.5, width: 660, height: 260,
        text: caption.slice(0, 280), font_family: "Inter",
        font_size: 28, font_weight: 700, fill_color: "#ffffff",
        text_align: "center", background_color: "#101827",
        background_padding: [18, 18], background_border_radius: 18
      });
    });
  } else {
    for (let i = 0; i < 5; i++) {
      elements.push({
        id: "scene-placeholder-" + (i + 1), type: "text", layer: 3,
        time: i * 6, duration: 6, x: 360, y: 680,
        x_anchor: 0.5, y_anchor: 0.5, width: 620, height: 420,
        text: "सीन " + (i + 1) + "\nयहाँ AI से बनी तस्वीर आएगी",
        font_family: "Inter", font_size: 34, font_weight: 650,
        fill_color: "#ffffff", text_align: "center",
        background_color: "#26344f", background_padding: [24, 24],
        background_border_radius: 22
      });
    }
  }
  return {
    clipkit_version: "1.0", output_format: "mp4",
    width: 720, height: 1280, duration: 30, frame_rate: 30,
    background_color: "#111827", elements
  };
}

function App() {
  const [idea, setIdea] = useState("");
  const [project, setProject] = useState(() => makeProject());
  const [projectKey, setProjectKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("कहानी लिखें या माइक से बोलें। AI कहानी, कार्टून तस्वीरें और Clipkit टाइमलाइन तैयार करेगा।");
  const [storyInfo, setStoryInfo] = useState(null);
  const assetStore = useMemo(() => createLocalAssetStore(), []);

  async function createWholeCartoon() {
    if (!idea.trim()) { setStatus("पहले कहानी का विषय लिखें या बोलें।"); return; }
    setBusy(true); setStoryInfo(null);
    setStatus("पहला चरण: AI कहानी और किरदार तय कर रहा है…");
    try {
      const response = await fetch("/api/ai-movie", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea: idea.trim() })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "AI अभी उपलब्ध नहीं है।");
      setStatus("दूसरा चरण: " + data.imagesCreated + "/5 कार्टून तस्वीरें बनीं। Clipkit टाइमलाइन तैयार हो रही है…");
      const next = makeProject(idea.trim(), data);
      setProject(next); setProjectKey(k => k + 1);
      setStoryInfo(data);
      setStatus(data.complete
        ? "कहानी और पाँच कार्टून तस्वीरें Clipkit टाइमलाइन में लगा दी गई हैं। अब Play करें और Export से MP4 बनाएँ।"
        : "आंशिक प्रोजेक्ट तैयार है। " + (data.warning || "कुछ तस्वीरें नहीं बन पाईं।") + " बाकी तस्वीरें एडिटर में जोड़ सकते हैं।");
    } catch (error) {
      setStatus(error.message || "AI कहानी/तस्वीरें तैयार नहीं कर पाया।");
    } finally { setBusy(false); }
  }

  async function exportMP4(source, request) {
    if (!("VideoEncoder" in window) || !("VideoFrame" in window)) {
      setStatus("इस मोबाइल ब्राउज़र में MP4 export के लिए WebCodecs उपलब्ध नहीं है। Chrome के नवीनतम संस्करण में खोलें।");
      return;
    }
    setRendering(true); setProgress(0); setStatus("आपके फोन पर MP4 बन रही है। स्क्रीन खुली रखें…");
    const canvas = document.createElement("canvas");
    const runtime = new ClipkitRuntime(canvas);
    try {
      const ready = await runtime.init({ backend: "auto" });
      if (!ready) throw new Error("इस डिवाइस पर WebGL/WebGPU उपलब्ध नहीं है।");
      runtime.load(source);
      await runtime.preload(source);
      const blob = await runtime.export({
        renderResolution: request.resolution || "source",
        onProgress: value => setProgress(value)
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "international-cartoon-short.mp4";
      document.body.appendChild(a); a.click(); a.remove();
      setStatus("MP4 तैयार है और डाउनलोड शुरू हो गया।");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) {
      setStatus("MP4 export नहीं हो पाया: " + (error.message || "अज्ञात समस्या"));
    } finally {
      runtime.dispose(); setRendering(false);
    }
  }

  return <div className="editor-app">
    <header className="editor-header">
      <a href="/" className="back-link">← मुख्य ऐप</a>
      <div><strong>🎬 International 3D Cartoon Video Maker</strong><small>AI Story + Cartoon Images + Clipkit Editor</small></div>
    </header>
    <section className="director-bar">
      <label htmlFor="story">अपनी कहानी लिखें या बोलें</label>
      <textarea id="story" value={idea} onChange={e => setIdea(e.target.value)}
        placeholder="उदाहरण: एक छोटा हाथी जंगल में खोए अपने दोस्त को ढूँढता है…" />
      <div className="director-actions">
        <button onClick={createWholeCartoon} disabled={busy}>{busy ? "AI काम कर रहा है…" : "✨ पूरी कार्टून वीडियो तैयार करो"}</button>
        <button className="reset" onClick={() => { setProject(makeProject(idea)); setProjectKey(k => k + 1); setStoryInfo(null); setStatus("नई खाली 30 सेकंड की Shorts टाइमलाइन तैयार है।"); }}>＋ नई Shorts</button>
      </div>
      <p className="editor-status">{rendering ? "MP4 export: " + Math.round(progress * 100) + "%" : status}</p>
      {storyInfo && <p className="editor-note">किरदार: {storyInfo.characterBible || "AI द्वारा तय"} · कार्टून तस्वीरें: {storyInfo.imagesCreated}/5</p>}
      <p className="editor-note">AI कहानी और स्थिर कार्टून तस्वीरें बनाकर Clipkit टाइमलाइन में लगाएगा। मुफ्त सार्वजनिक AI सेवाओं में कतार/दैनिक सीमा हो सकती है। यह अभी स्थिर चित्रों से बना एनिमेटेड स्लाइड-सीन है, पूर्ण 3D चलती हुई character animation या AI voice नहीं।</p>
    </section>
    <main className="clipkit-shell">
      <Editor key={projectKey} initialSource={project}
        configuration={ADVANCED_CONFIGURATION}
        assetStore={assetStore}
        onSourceChange={setProject}
        onRender={exportMP4}
        rendering={rendering}
        renderProgress={progress}
        exportFormats={[{ id: "mp4", label: "MP4 · फोन पर export" }]}
        theme="dark" backend="auto" />
    </main>
  </div>;
}

createRoot(document.getElementById("root")).render(<App />);
