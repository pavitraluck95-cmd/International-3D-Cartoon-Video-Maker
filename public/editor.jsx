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

function makeProject(idea = "", story = null, narrationDataUrl = null) {
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
  if (narrationDataUrl) elements.push({ id: "hindi-dialogue-audio", type: "audio", layer: 0, source: narrationDataUrl, time: 0, duration: Math.max(600, cursor || 600), volume: 100 });
  const totalDuration = Math.max(600, cursor || 600);
  return {
    clipkit_version: "1.0", output_format: "mp4",
    width: 1280, height: 720, duration: totalDuration, frame_rate: 30,
    background_color: "#111827", elements
  };
}

const VIDEO_DB_NAME = "international-2d-video-library";
function openVideoLibrary() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(VIDEO_DB_NAME, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains("videos")) request.result.createObjectStore("videos", {keyPath:"id"}); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("सेव बॉक्स नहीं खुला।"));
  });
}
async function saveVideoToLibrary(blob, name, duration) {
  const db = await openVideoLibrary();
  await new Promise((resolve,reject) => {
    const tx=db.transaction("videos","readwrite");
    tx.objectStore("videos").put({id:Date.now().toString(),name,blob,duration,savedAt:new Date().toISOString()});
    tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error);
  }); db.close();
}
async function readVideoLibrary() {
  const db=await openVideoLibrary();
  const items=await new Promise((resolve,reject)=>{const tx=db.transaction("videos","readonly");const q=tx.objectStore("videos").getAll();q.onsuccess=()=>resolve(q.result||[]);q.onerror=()=>reject(q.error);});
  db.close(); return items.sort((a,b)=>String(b.savedAt).localeCompare(String(a.savedAt)));
}
async function removeVideoFromLibrary(id) {
  const db=await openVideoLibrary();
  await new Promise((resolve,reject)=>{const tx=db.transaction("videos","readwrite");tx.objectStore("videos").delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
  db.close();
}

let nativeTtsChunks = {};
window.onNativeTtsChunk = (id, chunk, last) => {
  const entry = nativeTtsChunks[id];
  if (!entry) return;
  entry.parts.push(chunk);
  if (last) { delete nativeTtsChunks[id]; clearTimeout(entry.timer); entry.resolve("data:audio/wav;base64," + entry.parts.join("")); }
};
window.onNativeTtsError = (id, message) => {
  const entry = nativeTtsChunks[id];
  if (!entry) return;
  delete nativeTtsChunks[id]; clearTimeout(entry.timer); entry.reject(new Error(message));
};
async function makeHindiNarration(story) {
  if (!window.AndroidTTS || typeof window.AndroidTTS.synthesize !== "function") return null;
  for (let i = 0; i < 80 && !window.AndroidTTS.isReady(); i++) await new Promise(resolve => setTimeout(resolve, 250));
  if (!window.AndroidTTS.isReady()) throw new Error("फोन में हिंदी Text-to-Speech आवाज़ तैयार नहीं हुई।");
  const script = (story.scenes || []).map(scene => scene.dialogue).filter(Boolean).join("। ");
  if (!script.trim()) throw new Error("कहानी में बोलने के लिए डायलॉग नहीं मिले।");
  const id = "tts" + Date.now().toString(36);
  const audio = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { delete nativeTtsChunks[id]; reject(new Error("हिंदी आवाज़ बनाने में समय लग गया।")); }, 120000);
    nativeTtsChunks[id] = { parts: [], resolve, reject, timer };
    if (!window.AndroidTTS.synthesize(script.slice(0, 12000), id)) {
      delete nativeTtsChunks[id]; clearTimeout(timer); reject(new Error("फोन की हिंदी आवाज़ शुरू नहीं हो सकी।"));
    }
  });
  return audio;
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
  const [status, setStatus] = useState("एक क्लिक: AI कहानी + डायलॉग + 2D तस्वीरें → MP4 → ऐप का सेव बॉक्स।");
  const [storyInfo, setStoryInfo] = useState(null);
  const assetStore = useMemo(() => createLocalAssetStore(), []);
  const [savedVideos,setSavedVideos]=useState([]);
  useEffect(()=>{readVideoLibrary().then(setSavedVideos).catch(e=>setStatus("सेव बॉक्स नहीं खुला: "+e.message));},[]);
  async function refreshSavedVideos(){setSavedVideos(await readVideoLibrary());}
  function downloadSavedVideo(item){const url=URL.createObjectURL(item.blob);const a=document.createElement("a");a.href=url;a.download=item.name||"cartoon-video.mp4";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}

  async function createWholeCartoon() {
    if (!idea.trim()) setIdea("चालाक पप्पू और भूतिया लड्डू: गाँव में पप्पू को एक ऐसा लड्डू मिलता है जिसे खाते ही अजीब-अजीब आवाज़ें निकलती हैं।");
    setBusy(true); setStoryInfo(null);
    setStatus("चरण 1/4: AI Director हिंदी कहानी और डायलॉग लिख रहा है…");
    try {
      const response = await fetch("https://international-3d-cartoon-video-maker.onrender.com/api/ai-director", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea: (idea.trim() || "चालाक पप्पू और भूतिया लड्डू: गाँव में पप्पू को एक ऐसा लड्डू मिलता है जिसे खाते ही अजीब-अजीब आवाज़ें निकलती हैं।") })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "AI अभी उपलब्ध नहीं है।");
      setStatus("चरण 2/4: " + (data.imagesCreated || 0) + "/10 2D तस्वीरें बनीं। चरण 4/5: Clipkit टाइमलाइन और MP4 export…");
      let narration = null;
      if (window.AndroidTTS) {
        setStatus("चरण 3/5: फोन की हिंदी आवाज़ में डायलॉग तैयार हो रहे हैं…");
        try { narration = await makeHindiNarration(data); } catch (ttsError) { narration = null; setStatus("हिंदी आवाज़ नहीं बन सकी: " + ttsError.message + " — वीडियो की तैयारी जारी है।"); }
      }
      const next = makeProject(idea.trim() || data.title, data, narration);
      setProject(next); setProjectKey(k => k + 1);
      setStoryInfo(data);
      setStatus(data.storyComplete
        ? "कहानी, डायलॉग और 10 स्थानीय 2D दृश्य Clipkit में तैयार हैं। Android MP4 एक्सपोर्ट अभी उपलब्ध नहीं है; कोई तैयार MP4 सेव नहीं हुई है।"
        : "कहानी/दृश्य अधूरे हैं: " + (data.warning || "फिर कोशिश करें।"));
      if (new URLSearchParams(window.location.search).get("auto") === "1") {
        if (data.videoComplete === true && data.imagesCreated === 10) {
          await exportMP4(next, { resolution: "source" });
        } else {
          setStatus(data.warning || "कहानी के दृश्य तैयार हुए हैं, लेकिन MP4 एक्सपोर्ट अभी उपलब्ध नहीं है। कोई MP4 सेव नहीं हुई है।");
        }
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
      setStatus("MP4 तैयार हुई है। ऐप के सेव बॉक्स में सुरक्षित की जा रही है…");
      await saveVideoToLibrary(blob, filename, source.duration || 600);
      await refreshSavedVideos();
      setProgress(1);
      setStatus("MP4 ऐप के ‘मेरे सेव किए वीडियो’ बॉक्स में जमा हो गई है। वहाँ से आप खुद डाउनलोड कर सकते हैं.");
    } catch (error) {
      setStatus("MP4 export नहीं हो पाया: " + (error.message || "अज्ञात समस्या"));
    } finally {
      runtime.dispose(); setRendering(false);
    }
  }

  return <div className="editor-app">
    {isOneClick && <section style={{padding:"32px 20px",textAlign:"center",maxWidth:560,margin:"12vh auto"}}><div style={{fontSize:48}}>🎬</div><h2>आपकी 2D वीडियो तैयार हो रही है</h2><p style={{color:"#ffe1a0",lineHeight:1.7}}>{rendering ? "MP4 बन रही है: " + Math.round(progress * 100) + "%" : status}</p><p style={{color:"#aebbd0",fontSize:13}}>कृपया ऐप खुला रखें। MP4 तैयार होने पर इसी ऐप के सेव बॉक्स में जमा होगी।</p></section>}
    <section style={{maxWidth:900,margin:"18px auto",padding:18,border:"1px solid #46536a",borderRadius:14,background:"#111827"}}>
<h3>📁 मेरे सेव किए वीडियो ({savedVideos.length})</h3>
{savedVideos.length===0?<p>अभी कोई तैयार MP4 नहीं है।</p>:savedVideos.map(item=><div key={item.id} style={{padding:"12px 0",borderTop:"1px solid #374151"}}>
<strong>{item.name}</strong><small style={{display:"block",opacity:.75}}>{new Date(item.savedAt).toLocaleString("hi-IN")} · MP4</small>
<video controls playsInline preload="metadata" src={URL.createObjectURL(item.blob)} style={{display:"block",width:"100%",maxHeight:260,marginTop:8}}/>
<button onClick={()=>downloadSavedVideo(item)}>⬇️ MP4 डाउनलोड करें</button>
<button className="reset" onClick={async()=>{await removeVideoFromLibrary(item.id);await refreshSavedVideos();}}>हटाएँ</button>
</div>)}</section>
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
      <p className="editor-note">एक क्लिक पर AI Director कहानी और डायलॉग लिखता है और स्थानीय 2D दृश्य Clipkit टाइमलाइन में लगाता है। Android-संगत MP4 export अभी लागू नहीं है, इसलिए ऐप तैयार MP4 होने का दावा नहीं करेगा। यह संस्करण 2D तस्वीरों, डायलॉग कैप्शन और समर्थित Android फोन पर हिंदी Text-to-Speech narration को जोड़ता है; पात्रों की पूरी frame-by-frame animation और बैकग्राउंड संगीत अभी शामिल नहीं हैं। मुफ्त सार्वजनिक Image AI की कतार/सीमा के कारण generation की गारंटी नहीं है।</p>
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
