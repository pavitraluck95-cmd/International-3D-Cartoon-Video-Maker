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

function makeProject(idea = "", plan = "") {
  const lines = plan.split(/\r?\n/)
    .map(line => line.replace(/^\s*(?:[-*#]+\s*|\d+[.)]\s*)/, "").trim())
    .filter(line => line.length > 12);
  const sceneLines = lines.filter(line => /सीन|scene|दृश्य/i.test(line));
  let scenes = (sceneLines.length >= 3 ? sceneLines : lines).slice(0, 5);
  if (scenes.length < 5) {
    const sentences = (plan || idea || "अपनी कहानी यहाँ लिखें।")
      .split(/[।.!?\n]+/).map(s => s.trim()).filter(Boolean);
    scenes = [...scenes, ...sentences].slice(0, 5);
  }
  while (scenes.length < 5) scenes.push("यहाँ अपना वीडियो क्लिप या तस्वीर जोड़ें।");
  const title = (idea || "मेरी नई कार्टून कहानी").slice(0, 70);
  const elements = [
    { id: "background", type: "shape", layer: 1, shape: "rectangle",
      x: 0, y: 0, width: 720, height: 1280, fill_color: "#111827",
      time: 0, duration: 30 },
    { id: "main-title", type: "text", layer: 2, time: 0, duration: 5,
      x: 360, y: 180, x_anchor: 0.5, y_anchor: 0.5, width: 640, height: 180,
      text: title, font_family: "Inter", font_size: 54, font_weight: 800,
      fill_color: "#ffd36c", text_align: "center" }
  ];
  scenes.forEach((scene, i) => elements.push({
    id: "scene-" + (i + 1), type: "text", layer: i + 3,
    time: i * 6, duration: 6, x: 360, y: 690,
    x_anchor: 0.5, y_anchor: 0.5, width: 620, height: 420,
    text: "सीन " + (i + 1) + "\n" + scene.slice(0, 260),
    font_family: "Inter", font_size: 34, font_weight: 650,
    fill_color: "#ffffff", text_align: "center",
    background_color: "#26344f", background_padding: [24, 24],
    background_border_radius: 22
  }));
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
  const [status, setStatus] = useState("अपनी कहानी लिखें, AI से सीन बनवाएँ या अपनी वीडियो/तस्वीरें जोड़ें।");
  const assetStore = useMemo(() => createLocalAssetStore(), []);

  async function createAIPlan() {
    if (!idea.trim()) { setStatus("पहले कहानी लिखें।"); return; }
    setBusy(true); setStatus("AI Director पाँच सीन का स्टोरीबोर्ड बना रहा है…");
    try {
      const response = await fetch("/api/ai-director", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea: idea.trim() })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "AI Director अभी उपलब्ध नहीं है।");
      const next = makeProject(idea.trim(), data.plan || "");
      setProject(next); setProjectKey(k => k + 1);
      setStatus("5 सीन की एडिटिंग टाइमलाइन तैयार है। अब बाईं ओर से मीडिया जोड़ें और टाइमलाइन में एडिट करें।");
    } catch (error) {
      setStatus(error.message || "AI Director से संपर्क नहीं हो पाया।");
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
      <div><strong>🎬 International 3D Cartoon Editor</strong><small>Clipkit Timeline · Vertical Shorts 9:16</small></div>
    </header>
    <section className="director-bar">
      <label htmlFor="story">AI Director — अपनी कहानी लिखें</label>
      <textarea id="story" value={idea} onChange={e => setIdea(e.target.value)}
        placeholder="उदाहरण: एक छोटा कार्टून हाथी अपने दोस्त को जंगल में खोने से बचाता है…" />
      <div className="director-actions">
        <button onClick={createAIPlan} disabled={busy}>{busy ? "सीन बन रहे हैं…" : "🧠 AI से 5 सीन बनाओ"}</button>
        <button className="reset" onClick={() => { setProject(makeProject(idea)); setProjectKey(k => k + 1); setStatus("नई 30 सेकंड की Shorts टाइमलाइन तैयार है।"); }}>＋ नई Shorts</button>
      </div>
      <p className="editor-status">{rendering ? "MP4 export: " + Math.round(progress * 100) + "%" : status}</p>
      <p className="editor-note">मीडिया जोड़ने के लिए एडिटर के Assets पैनल में Upload करें। मीडिया आपके ब्राउज़र की IndexedDB में सेव किया जाता है। AI Director कहानी/टेक्स्ट बनाता है, खुद 3D फुटेज नहीं बनाता।</p>
    </section>
    <main className="clipkit-shell">
      <Editor key={projectKey} initialSource={project}
        configuration={ADVANCED_CONFIGURATION}
        assetStore={assetStore}
        onSourceChange={setProject}
        onRender={exportMP4}
        rendering={rendering}
        renderProgress={progress}
        exportFormats={[{ id: "mp4", label: "MP4 · फोन पर मुफ्त export" }]}
        theme="dark" backend="auto" />
    </main>
  </div>;
}

createRoot(document.getElementById("root")).render(<App />);
