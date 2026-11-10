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
      x: 0, y: 0, width: 1280, height: 720, fill_color: "#111827",
      time: 0, duration: Math.max(600, (story && story.durationSeconds) || 600) },
    { id: "main-title", type: "text", layer: 20, time: 0, duration: 3,
      x: 640, y: 65, x_anchor: 0.5, y_anchor: 0.5, width: 1160, height: 110,
      text: String(story && story.title || idea || "मेरी नई कार्टून कहानी").slice(0, 80),
      font_family: "Inter", font_size: 48, font_weight: 800,
      fill_color: "#ffd36c", text_align: "center",
      background_color: "#172033", background_padding: [18, 18],
      background_border_radius: 18 }
  ];
  let cursor = 0;
  scenes.slice(0, 10).forEach((scene, i) => {
    const clipDuration = scene.video ? 60 : 0;
    if (scene.video) {
      elements.push({
        id: "motion-video-" + (i + 1), type: "video", layer: 2,
        source: scene.video, fit: "cover",
        x: 0, y: 0, width: 1280, height: 720,
        time: cursor, duration: clipDuration, volume: 1
      });
    } else if (scene.image) {
      elements.push({
        id: "scene-image-" + (i + 1), type: "image", layer: 2,
        source: scene.image, fit: "cover",
        x: 0, y: 0, width: 1280, height: 720,
        time: cursor, duration: 60
      });
    }
    const caption = [scene.visual, scene.dialogue].filter(Boolean).join("\n");
    elements.push({
      id: "scene-caption-" + (i + 1), type: "text", layer: 3,
      time: cursor, duration: 60, x: 640, y: 610,
      x_anchor: 0.5, y_anchor: 0.5, width: 1160, height: 180,
      text: caption.slice(0, 280), font_family: "Inter",
      font_size: 28, font_weight: 700, fill_color: "#ffffff",
      text_align: "center", background_color: "#101827",
      background_padding: [18, 18], background_border_radius: 18
    });
    cursor += 60;
  });
  const totalDuration = Math.max(600, cursor || 600);
  return {
    clipkit_version: "1.0", output_format: "mp4",
    width: 1280, height: 720, duration: totalDuration, frame_rate: 30,
    background_color: "#111827", elements
  };
}
function App() {
  const [idea, setIdea] = useState(() => new URLSearchParams(window.location.search).get("idea") || "");
  const isOneClick = new URLSearchParams(window.location.search).get("auto") === "1";
  const [autoStarted, setAutoStarted] = useState(false);
  const [project, setProject] = useState(() => makeProject());
  const [projectKey, setProjectKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("एक क्लिक: AI कहानी + डायलॉग + 2D तस्वीरें → Clipkit टाइमलाइन → MP4 Gallery सेव।");
  const [storyInfo, setStoryInfo] = useState(null);
  const assetStore = useMemo(() => createLocalAssetStore(), []);

  async function createWholeCartoon() {
    if (!idea.trim()) setIdea("चालाक पप्पू और भूतिया लड्डू: गाँव में पप्पू को एक ऐसा लड्डू मिलता है जिसे खाते ही अजीब-अजीब आवाज़ें निकलती हैं।");
    setBusy(true); setStoryInfo(null);
    setStatus("चरण 1/4: AI Director हिंदी कहानी और डायलॉग लिख रहा है…");
    try {
      const response = await fetch("/api/ai-director", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea: (idea.trim() || "चालाक पप्पू और भूतिया लड्डू: गाँव में पप्पू को एक ऐसा लड्डू मिलता है जिसे खाते ही अजीब-अजीब आवाज़ें निकलती हैं।") })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "AI अभी उपलब्ध नहीं है।");
      setStatus("चरण 2/4: " + (data.imagesCreated || 0) + "/10 2D तस्वीरें बनीं। चरण 3/4: Clipkit टाइमलाइन और MP4 export…");
      const next = makeProject(idea.trim() || data.title, data);
      setProject(next); setProjectKey(k => k + 1);
      setStoryInfo(data);
      setStatus(data.complete
        ? "चरण 3/4: कहानी, डायलॉग और 10 तस्वीरें Clipkit में। चरण 4/4: MP4 export और Gallery सेव…"
        : "आंशिक 2D प्रोजेक्ट: " + (data.imagesCreated || 0) + "/10 तस्वीरें। " + (data.warning || "मुफ्त Image AI व्यस्त है।"));
      if (new URLSearchParams(window.location.search).get("auto") === "1") {
        if (data.complete && data.imagesCreated === 10) await exportMP4(next, { resolution: "source" });
        else setStatus("सभी 10 तस्वीरें नहीं बनीं, इसलिए पूरी MP4 export नहीं की गई।");
      }
    } catch (error) {
      setStatus(error.message || "मुफ्त AI कहानी/2D तस्वीरें तैयार नहीं कर पाया।");
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
      const filename = "international-2d-comedy-story.mp4";
      if (window.AndroidSaveVideo && typeof window.AndroidSaveVideo.beginSave === "function") {
        setStatus("MP4 फोन की Gallery में सेव हो रही है…");
        if (!window.AndroidSaveVideo.beginSave(filename)) throw new Error("Gallery में MP4 फ़ाइल नहीं बन पाई।");
        try {
          const bytes = new Uint8Array(await blob.arrayBuffer());
          const chunkSize = 256 * 1024;
          for (let i = 0; i < bytes.length; i += chunkSize) {
            let binary = "";
            const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
            for (let j = 0; j < chunk.length; j += 0x8000) {
              binary += String.fromCharCode(...chunk.subarray(j, Math.min(j + 0x8000, chunk.length)));
            }
            if (!window.AndroidSaveVideo.appendChunk(btoa(binary))) throw new Error("Gallery में MP4 डेटा सेव नहीं हो पाया।");
            setProgress(Math.min(0.99, (i + chunk.length) / bytes.length));
          }
          if (!window.AndroidSaveVideo.finishSave()) throw new Error("Gallery में MP4 फ़ाइल पूरी नहीं हो पाई।");
        } catch (saveError) {
          window.AndroidSaveVideo.cancelSave();
          throw saveError;
        }
        setStatus("MP4 सेव हो गई। अब Gallery खोली जा रही है…");
        if (typeof window.AndroidSaveVideo.openGallery === "function") window.AndroidSaveVideo.openGallery();
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        setStatus("MP4 तैयार है। डाउनलोड शुरू हुआ; फोन के Downloads में देखें।");
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
    } catch (error) {
      setStatus("MP4 export नहीं हो पाया: " + (error.message || "अज्ञात समस्या"));
    } finally {
      runtime.dispose(); setRendering(false);
    }
  }

  return <div className="editor-app">
    {isOneClick && <section style={{padding:"32px 20px",textAlign:"center",maxWidth:560,margin:"12vh auto"}}><div style={{fontSize:48}}>🎬</div><h2>आपकी 2D वीडियो तैयार हो रही है</h2><p style={{color:"#ffe1a0",lineHeight:1.7}}>{rendering ? "MP4 बन रही है: " + Math.round(progress * 100) + "%" : status}</p><p style={{color:"#aebbd0",fontSize:13}}>कृपया ऐप खुला रखें। वीडियो सेव होने पर Gallery खोलने की कोशिश होगी।</p></section>}
    {!isOneClick && <>
    <header className="editor-header">
      <a href="/" className="back-link">← मुख्य ऐप</a>
      <div><strong>😂 2D कॉमेडी कार्टून वीडियो मेकर</strong><small>2D Comedy Story + Dialogues + Pictures + Clipkit</small></div>
    </header>
    <section className="director-bar">
      <label htmlFor="story">अपनी कहानी लिखें या बोलें</label>
      <textarea id="story" value={idea} onChange={e => setIdea(e.target.value)}
        placeholder="उदाहरण: एक छोटा हाथी जंगल में खोए अपने दोस्त को ढूँढता है…" />
      <div className="director-actions">
        <button onClick={createWholeCartoon} disabled={busy}>{busy ? "AI काम कर रहा है…" : "🎬 मेरी आज की 2D वीडियो तैयार करो"}</button>
        <button className="reset" onClick={() => { setProject(makeProject(idea)); setProjectKey(k => k + 1); setStoryInfo(null); setStatus("नई खाली 10 मिनट की 2D कहानी टाइमलाइन तैयार है।"); }}>＋ नई कहानी</button>
      </div>
      <p className="editor-status">{rendering ? "MP4 export: " + Math.round(progress * 100) + "%" : status}</p>
      {storyInfo && <p className="editor-note">किरदार: {storyInfo.characterBible || "AI द्वारा तय"} · 2D तस्वीरें: {storyInfo.imagesCreated || 0}/10</p>}
      <p className="editor-note">एक क्लिक पर AI Director कहानी और डायलॉग लिखेगा, 10 2D तस्वीरें बनाएगा, Clipkit टाइमलाइन में लगाएगा और MP4 export करके Gallery में सेव करने की कोशिश करेगा। यह पहला संस्करण तस्वीरों और डायलॉग कैप्शन का 2D स्टोरी वीडियो है; पात्रों की पूरी frame-by-frame animation और AI voice/music अभी शामिल नहीं हैं। मुफ्त सार्वजनिक Image AI की कतार/सीमा के कारण generation की गारंटी नहीं है।</p>
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
    </>}
  </div>;
}

createRoot(document.getElementById("root")).render(<App />);
