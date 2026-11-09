import React, { useEffect, useMemo, useState } from "react";
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
      time: 0, duration: Math.max(3, (story && story.durationSeconds) || 15) },
    { id: "main-title", type: "text", layer: 20, time: 0, duration: 3,
      x: 360, y: 110, x_anchor: 0.5, y_anchor: 0.5, width: 660, height: 140,
      text: String(story && story.title || idea || "मेरी नई कार्टून कहानी").slice(0, 80),
      font_family: "Inter", font_size: 48, font_weight: 800,
      fill_color: "#ffd36c", text_align: "center",
      background_color: "#172033", background_padding: [18, 18],
      background_border_radius: 18 }
  ];
  let cursor = 0;
  scenes.slice(0, 5).forEach((scene, i) => {
    const clipDuration = scene.video ? 3 : 0;
    if (scene.video) {
      elements.push({
        id: "motion-video-" + (i + 1), type: "video", layer: 2,
        source: scene.video, fit: "cover",
        x: 0, y: 0, width: 720, height: 1280,
        time: cursor, duration: clipDuration, volume: 1
      });
    } else if (scene.image) {
      elements.push({
        id: "scene-image-" + (i + 1), type: "image", layer: 2,
        source: scene.image, fit: "cover",
        x: 0, y: 0, width: 720, height: 1280,
        time: cursor, duration: 3
      });
    }
    const caption = [scene.visual, scene.dialogue].filter(Boolean).join("\n");
    elements.push({
      id: "scene-caption-" + (i + 1), type: "text", layer: 3,
      time: cursor, duration: 3, x: 360, y: 1080,
      x_anchor: 0.5, y_anchor: 0.5, width: 660, height: 260,
      text: caption.slice(0, 280), font_family: "Inter",
      font_size: 28, font_weight: 700, fill_color: "#ffffff",
      text_align: "center", background_color: "#101827",
      background_padding: [18, 18], background_border_radius: 18
    });
    cursor += 3;
  });
  const totalDuration = Math.max(3, cursor || 15);
  return {
    clipkit_version: "1.0", output_format: "mp4",
    width: 720, height: 1280, duration: totalDuration, frame_rate: 30,
    background_color: "#111827", elements
  };
}
function App() {
  const [idea, setIdea] = useState(() => new URLSearchParams(window.location.search).get("idea") || "");
  const [autoStarted, setAutoStarted] = useState(false);
  const [project, setProject] = useState(() => makeProject());
  const [projectKey, setProjectKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("कहानी लिखें या माइक से बोलें। AI कहानी, चलती 3D-स्टाइल वीडियो क्लिप और Clipkit टाइमलाइन तैयार करेगा।");
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
      setStatus("दूसरा चरण: " + (data.videosCreated || 0) + "/5 चलती वीडियो क्लिप बनीं। Clipkit टाइमलाइन तैयार हो रही है…");
      const next = makeProject(idea.trim(), data);
      setProject(next); setProjectKey(k => k + 1);
      setStoryInfo(data);
      setStatus(data.complete
        ? "कहानी और पाँच चलती वीडियो क्लिप तैयार। अब MP4 export शुरू होगा…"
        : "आंशिक प्रोजेक्ट तैयार: " + (data.videosCreated || 0) + "/5 क्लिप। " + (data.warning || "मुफ्त GPU ने पूरा काम नहीं किया।"));
      if (new URLSearchParams(window.location.search).get("auto") === "1") {
        if (data.videosCreated > 0) await exportMP4(next, { resolution: "source" });
        else setStatus("AI क्लिप नहीं बना पाया, इसलिए MP4 export नहीं किया गया: " + (data.warning || "मुफ्त GPU उपलब्ध नहीं है।"));
      }
    } catch (error) {
      setStatus(error.message || "AI कहानी/तस्वीरें तैयार नहीं कर पाया।");
    } finally { setBusy(false); }
  }

  useEffect(() => {
    if (autoStarted) return;
    const params = new URLSearchParams(window.location.search);
    const initialIdea = params.get("idea");
    if (params.get("auto") === "1" && initialIdea) {
      setAutoStarted(true);
      createWholeCartoon();
    }
  }, [autoStarted]);
\n  async function exportMP4(source, request) {
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
      {storyInfo && <p className="editor-note">किरदार: {storyInfo.characterBible || "AI द्वारा तय"} · चलती वीडियो क्लिप: {storyInfo.videosCreated || 0}/5</p>}
      <p className="editor-note">AI पहले 3D-स्टाइल कार्टून तस्वीरें बनाएगा, फिर Wan 2.2 से उन्हें चलती वीडियो क्लिप में बदलेगा और Clipkit टाइमलाइन में लगाएगा। यह image-to-video जनरेशन है, 3D मॉडल/mesh rigging नहीं। हर क्लिप लगभग 3 सेकंड की हो सकती है; मुफ्त सार्वजनिक GPU की कतार/सीमा के कारण सभी पाँच क्लिप बनना सुनिश्चित नहीं है। AI आवाज़ अभी अलग से जोड़नी बाकी है।</p>
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
