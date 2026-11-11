import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

const VIDEO_DB_NAME = "international-2d-video-library";

function openVideoLibrary() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(VIDEO_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("videos")) {
        request.result.createObjectStore("videos", { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("सेव बॉक्स नहीं खुला।"));
  });
}

async function saveVideoToLibrary(blob, name, duration) {
  const db = await openVideoLibrary();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("videos", "readwrite");
    tx.objectStore("videos").put({
      id: Date.now().toString(),
      name,
      blob,
      duration,
      savedAt: new Date().toISOString()
    });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function readVideoLibrary() {
  const db = await openVideoLibrary();
  const items = await new Promise((resolve, reject) => {
    const tx = db.transaction("videos", "readonly");
    const request = tx.objectStore("videos").getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return items.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
}

async function removeVideoFromLibrary(id) {
  const db = await openVideoLibrary();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("videos", "readwrite");
    tx.objectStore("videos").delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function saveMp4ToAndroidGallery(blob, filename) {
  const bridge = window.AndroidSaveVideo;
  if (!bridge || typeof bridge.beginSave !== "function" ||
      typeof bridge.appendChunk !== "function" ||
      typeof bridge.finishSave !== "function") {
    return false;
  }
  if (!bridge.beginSave(filename)) {
    throw new Error("फोन की Gallery में MP4 सेव करना शुरू नहीं हो पाया।");
  }
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const chunkSize = 48 * 1024;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const end = Math.min(bytes.length, offset + chunkSize);
      let binary = "";
      for (let p = offset; p < end; p += 8192) {
        binary += String.fromCharCode(...bytes.subarray(p, Math.min(end, p + 8192)));
      }
      if (!bridge.appendChunk(btoa(binary))) {
        throw new Error("MP4 का एक हिस्सा Gallery में सेव नहीं हो पाया।");
      }
    }
    if (!bridge.finishSave()) {
      throw new Error("MP4 फाइल Gallery में पूरी तरह सेव नहीं हुई।");
    }
    return true;
  } catch (error) {
    try { if (bridge.cancelSave) bridge.cancelSave(); } catch (_) {}
    throw error;
  }
}

let nativeTtsChunks = {};
window.onNativeTtsChunk = (id, chunk, last) => {
  const entry = nativeTtsChunks[id];
  if (!entry) return;
  entry.parts.push(chunk);
  if (last) {
    delete nativeTtsChunks[id];
    clearTimeout(entry.timer);
    entry.resolve("data:audio/wav;base64," + entry.parts.join(""));
  }
};
window.onNativeTtsError = (id, message) => {
  const entry = nativeTtsChunks[id];
  if (!entry) return;
  delete nativeTtsChunks[id];
  clearTimeout(entry.timer);
  entry.reject(new Error(message));
};

async function makeHindiNarration(story) {
  if (!window.AndroidTTS || typeof window.AndroidTTS.synthesize !== "function") return null;
  for (let i = 0; i < 80 && !window.AndroidTTS.isReady(); i++) {
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!window.AndroidTTS.isReady()) {
    throw new Error("फोन में हिंदी Text-to-Speech आवाज़ तैयार नहीं हुई।");
  }
  const script = (story.scenes || []).map(scene => scene.dialogue).filter(Boolean).join("। ");
  if (!script.trim()) throw new Error("कहानी में बोलने के लिए डायलॉग नहीं मिले।");
  const id = "tts" + Date.now().toString(36);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      delete nativeTtsChunks[id];
      reject(new Error("हिंदी आवाज़ बनाने में समय लग गया।"));
    }, 120000);
    nativeTtsChunks[id] = { parts: [], resolve, reject, timer };
    if (!window.AndroidTTS.synthesize(script.slice(0, 12000), id)) {
      delete nativeTtsChunks[id];
      clearTimeout(timer);
      reject(new Error("फोन की हिंदी आवाज़ शुरू नहीं हो सकी।"));
    }
  });
}

function downloadSavedVideo(item) {
  const url = URL.createObjectURL(item.blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = item.name || "cartoon-video.mp4";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function App() {
  const params = new URLSearchParams(window.location.search);
  const isOneClick = params.get("auto") === "1";
  const [idea, setIdea] = useState(() => params.get("idea") || "");
  const [autoStarted, setAutoStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("एक क्लिक: AI कहानी + डायलॉग + 2D दृश्य → MP4 → ऐप की Library।");
  const [storyInfo, setStoryInfo] = useState(null);
  const [savedVideos, setSavedVideos] = useState([]);

  useEffect(() => {
    readVideoLibrary().then(setSavedVideos).catch(error => {
      setStatus("सेव बॉक्स नहीं खुला: " + error.message);
    });
  }, []);

  async function refreshSavedVideos() {
    setSavedVideos(await readVideoLibrary());
  }

  async function sendToGallery(item) {
    try {
      const saved = await saveMp4ToAndroidGallery(item.blob, item.name || "cartoon-video.mp4");
      if (saved) {
        setStatus("आपके कहने पर MP4 फोन की Gallery में भेज दी गई है।");
      } else {
        downloadSavedVideo(item);
        setStatus("इस APK में Gallery का सीधा विकल्प उपलब्ध नहीं है। आपकी अनुमति से MP4 डाउनलोड शुरू किया है; डाउनलोड की गई फाइल को Gallery में रखें।");
      }
    } catch (error) {
      setStatus(error.message || "Gallery में MP4 सेव नहीं हो पाई।");
    }
  }

  async function createWholeCartoon() {
    const prompt = idea.trim() || "चालाक पप्पू और भूतिया लड्डू: गाँव में पप्पू को एक ऐसा लड्डू मिलता है जिसे खाते ही अजीब-अजीब आवाज़ें निकलती हैं।";
    setBusy(true);
    setStoryInfo(null);
    setStatus("चरण 1/5: AI Director हिंदी कहानी और डायलॉग लिख रहा है…");
    try {
      const response = await fetch("https://international-3d-cartoon-video-maker.onrender.com/api/ai-director", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea: prompt })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "AI अभी उपलब्ध नहीं है।");
      setStoryInfo(data);
      setStatus("चरण 2/5: " + (data.imagesCreated || 0) + "/10 2D तस्वीरें बनीं।");
      if (data.storyComplete !== true || !Array.isArray(data.scenes) || data.scenes.length !== 10) {
        throw new Error(data.warning || "10 पूरे दृश्य नहीं मिले।");
      }
      setStatus("चरण 3/5: फोन की हिंदी आवाज़ में डायलॉग तैयार हो रहे हैं…");
      const narration = await makeHindiNarration(data);
      if (!narration) throw new Error("इस APK में हिंदी आवाज़ की सुविधा उपलब्ध नहीं है। MP4 नहीं बनाई गई।");
      setStatus("चरण 4/5: 10 दृश्यों और हिंदी डायलॉग से MP4 बन रही है…");
      const renderResponse = await fetch("https://international-3d-cartoon-video-maker.onrender.com/api/render-mp4", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenes: data.scenes, narration })
      });
      if (!renderResponse.ok) {
        let detail = "सर्वर MP4 नहीं बना पाया।";
        try {
          const failure = await renderResponse.json();
          detail = failure.error || detail;
        } catch (_) {}
        throw new Error(detail);
      }
      const mp4 = await renderResponse.blob();
      if (mp4.size < 50000 || mp4.type !== "video/mp4") {
        throw new Error("सर्वर से सही MP4 फाइल नहीं मिली।");
      }
      const filename = "international-2d-comedy-" + Date.now() + ".mp4";
      setStatus("चरण 5/5: MP4 ऐप की निजी Library में सेव हो रही है…");
      await saveVideoToLibrary(mp4, filename, 600);
      await refreshSavedVideos();
      setStatus("10 मिनट की MP4 हिंदी आवाज़ सहित ऐप की Library में सेव हो गई है। Gallery में भेजने के लिए नीचे वाला बटन आप खुद दबाएँ।");
    } catch (error) {
      setStatus(error.message || "मुफ्त AI कहानी/2D तस्वीरें तैयार नहीं कर पाया।");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (autoStarted || !isOneClick) return;
    setAutoStarted(true);
    createWholeCartoon();
  }, [autoStarted]);

  return <div className="editor-app">
    {isOneClick ? <section style={{ padding: "32px 20px", textAlign: "center", maxWidth: 560, margin: "8vh auto" }}>
      <div style={{ fontSize: 48 }}>🎬</div>
      <h2>आपकी 2D वीडियो तैयार हो रही है</h2>
      <p style={{ color: "#ffe1a0", lineHeight: 1.7 }}>{busy ? "कृपया ऐप खुला रखें। " + status : status}</p>
      {!busy && <button onClick={createWholeCartoon} style={{ padding: "14px 22px", borderRadius: 12, fontWeight: 800 }}>🔄 दोबारा वीडियो बनाएं</button>}
      <p style={{ color: "#aebbd0", fontSize: 13 }}>वीडियो पहले ऐप की Library में सेव होगी। Gallery में केवल आपके बटन दबाने पर जाएगी।</p>
    </section> : <>
      <header className="editor-header">
        <a href="/" className="back-link">← मुख्य ऐप</a>
        <div><strong>😂 2D कॉमेडी कार्टून वीडियो मेकर</strong><small>हिंदी कहानी + डायलॉग + 2D दृश्य + MP4</small></div>
      </header>
      <section className="director-bar">
        <div className="director-actions">
          <a href="/3d-test.html" style={{ display:"inline-block", padding:"10px 13px", borderRadius:9, background:"#253b5b", color:"#fff", fontWeight:800, fontSize:13, textDecoration:"none" }}>🎭 3D कार्टून टेस्ट</a>
          <button onClick={createWholeCartoon} disabled={busy}>{busy ? "AI काम कर रहा है…" : "🎬 मेरी आज की 2D वीडियो तैयार करो"}</button>
        </div>
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: "pointer", color: "#cbd5e1" }}>विषय बदलना चाहें? (वैकल्पिक)</summary>
          <label htmlFor="story">वीडियो का विषय लिखें</label>
          <textarea id="story" value={idea} onChange={event => setIdea(event.target.value)} placeholder="खाली छोड़ें तो ऐप खुद नई हिंदी कॉमेडी कहानी चुनेगा…" />
        </details>
        <p className="editor-status">{status}</p>
        {storyInfo && <p className="editor-note">किरदार: {storyInfo.characterBible || "AI द्वारा तय"} · 2D तस्वीरें: {storyInfo.imagesCreated || 0}/10</p>}
        <p className="editor-note">यह चैट ऐप नहीं है। बटन दबाने पर उपलब्ध मुफ्त AI Director कहानी और संवाद तैयार करने की कोशिश करेगा। अभी वीडियो में 10 स्थिर 2D दृश्य और APK की Android हिंदी Text-to-Speech आवाज़ इस्तेमाल होती है; पूरी frame-by-frame animation और बैकग्राउंड संगीत शामिल नहीं हैं। मुफ्त AI इंजन की उपलब्धता की गारंटी नहीं है।</p>
      </section>
    </>}
    <section style={{ maxWidth: 900, margin: "18px auto", padding: 18, border: "1px solid #46536a", borderRadius: 14, background: "#111827" }}>
      <h3>📁 मेरे सेव किए वीडियो ({savedVideos.length})</h3>
      {savedVideos.length === 0 ? <p>अभी कोई तैयार MP4 नहीं है।</p> : savedVideos.map(item => <div key={item.id} style={{ padding: "12px 0", borderTop: "1px solid #374151" }}>
        <strong>{item.name}</strong>
        <small style={{ display: "block", opacity: 0.75 }}>{new Date(item.savedAt).toLocaleString("hi-IN")} · MP4</small>
        <video controls playsInline preload="metadata" src={URL.createObjectURL(item.blob)} style={{ display: "block", width: "100%", maxHeight: 260, marginTop: 8 }} />
        <button onClick={() => sendToGallery(item)}>📲 मेरी अनुमति से Gallery में भेजें</button>
        <button className="reset" onClick={() => downloadSavedVideo(item)}>⬇️ MP4 डाउनलोड करें</button>
        <button className="reset" onClick={async () => { await removeVideoFromLibrary(item.id); await refreshSavedVideos(); }}>हटाएँ</button>
      </div>)}
    </section>
  </div>;
}

createRoot(document.getElementById("root")).render(<App />);
