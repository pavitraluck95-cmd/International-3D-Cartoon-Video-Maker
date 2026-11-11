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

function openVoiceSettings() {
  if (window.AndroidTTS && typeof window.AndroidTTS.openTtsSettings === "function") {
    window.AndroidTTS.openTtsSettings();
  } else {
    window.alert("यह विकल्प केवल Android APK में उपलब्ध है।");
  }
}

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
  const [status, setStatus] = useState("एक क्लिक: 3D किरदार + हिंदी आवाज़ → MP4 → ऐप की Library।");
  const [storyInfo, setStoryInfo] = useState(null);
  const [savedVideos, setSavedVideos] = useState([]);
  const [show3d, setShow3d] = useState(false);

  useEffect(() => {
    const receive3d = async (event) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "international-3d-error") {
        setBusy(false);
        setStatus("वीडियो नहीं बन पाई: " + (event.data.message || "अज्ञात समस्या"));
        return;
      }
      if (event.data?.type !== "international-3d-mp4" || !(event.data.blob instanceof Blob)) return;
      try {
        setStatus("3D MP4 ऐप की Library में सेव हो रही है…");
        const filename = "international-3d-cartoon-" + Date.now() + ".mp4";
        await saveVideoToLibrary(event.data.blob, filename, 30);
        await refreshSavedVideos();
        setStatus("🎉 3D हिंदी MP4 ऐप की Library में सेव हो गई है। Gallery में भेजने के लिए अपना बटन दबाएँ।");
        setShow3d(false);
      } catch (error) {
        setStatus("3D वीडियो Library में सेव नहीं हुई: " + error.message);
      } finally {
        setBusy(false);
      }
    };
    window.addEventListener("message", receive3d);
    return () => window.removeEventListener("message", receive3d);
  }, []);

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
    if (busy) return;
    setBusy(true);
    setShow3d(false);
    setStatus("मुफ़्त AI इंजन से असली 3D वीडियो क्लिप बन रही है… GPU की कतार में समय लग सकता है।");
    try {
      const prompt = [
        "Create a polished high-quality cinematic 3D animated family comedy scene, vertical 9:16.",
        "Two original fictional adult Indian village friends, expressive faces, detailed stylized 3D character models, natural body movement, clear gestures, expressive acting, believable eye and mouth movement, colorful detailed village street, cinematic lighting, smooth camera motion.",
        "Hindi comedy scene: " + (idea.trim() || "दो दोस्तों के बीच मजेदार गलतफहमी और हँसी वाला छोटा दृश्य"),
        "No 2D drawings, no still slideshow, no text, no subtitles, no logos, no celebrity likeness, original fictional characters only."
      ].join(" ");
      const generated = await fetch(API + "/api/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt })
      });
      const data = await generated.json().catch(() => ({}));
      if (!generated.ok || !data.videoUrl) throw new Error(data.error || "AI इंजन वीडियो नहीं बना पाया।");
      setStatus("AI क्लिप बन गई है। अब MP4 ऐप की Library में सेव हो रही है…");
      const fileResponse = await fetch(API + "/api/download-ai-video", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoUrl: data.videoUrl })
      });
      if (!fileResponse.ok) {
        const detail = await fileResponse.json().catch(() => ({}));
        throw new Error(detail.error || "AI वीडियो डाउनलोड नहीं हो पाई।");
      }
      const blob = await fileResponse.blob();
      if (blob.size < 20000 || !blob.type.includes("video")) throw new Error("AI इंजन से वैध वीडियो फ़ाइल नहीं मिली।");
      const filename = "international-ai-3d-" + Date.now() + ".mp4";
      await saveVideoToLibrary(blob, filename, Number(data.durationSeconds) || 3);
      await refreshSavedVideos();
      setStatus("🎉 असली AI से बनी छोटी 3D MP4 क्लिप Library में सेव हो गई है। अभी इंजन लगभग 3 सेकंड की क्लिप देता है; पूरी 30 सेकंड/1–3 मिनट कहानी अभी उपलब्ध नहीं है।");
    } catch (error) {
      setStatus("AI वीडियो नहीं बन पाई: " + (error.message || "मुफ़्त साझा GPU व्यस्त हो सकता है।"));
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
      <h2>आपकी 3D वीडियो तैयार हो रही है</h2>
      <p style={{ color: "#ffe1a0", lineHeight: 1.7 }}>{busy ? "कृपया ऐप खुला रखें। " + status : status}</p>
      <button type="button" onClick={openVoiceSettings} style={{ padding: "12px 16px", borderRadius: 10, background: "#3b4d70", color: "#fff", fontWeight: 800 }}>🎙️ AI हिंदी आवाज़ सेट करें</button>
      <p style={{ color: "#aebbd0", fontSize: 12 }}>VoxSherpa को डिफ़ॉल्ट TTS चुनने और हिंदी Piper मॉडल डाउनलोड करने के बाद ऐप बंद करके दोबारा खोलें।</p>
      {!busy && <button onClick={createWholeCartoon} style={{ padding: "14px 22px", borderRadius: 12, fontWeight: 800 }}>🔄 दोबारा वीडियो बनाएं</button>}
      <p style={{ color: "#aebbd0", fontSize: 13 }}>वीडियो पहले ऐप की Library में सेव होगी। Gallery में केवल आपके बटन दबाने पर जाएगी।</p>
    </section> : <>
      <header className="editor-header">
        <a href="/" className="back-link">← मुख्य ऐप</a>
        <div><strong>🎭 3D कॉमेडी कार्टून वीडियो मेकर</strong><small>चलते 3D किरदार + हिंदी आवाज़ + MP4</small></div>
      </header>
      <section className="director-bar">
        <div className="director-actions">
          <button type="button" onClick={openVoiceSettings} style={{ padding: "10px 13px", borderRadius: 9, background: "#3b4d70", color: "#fff", fontWeight: 800, fontSize: 13 }}>🎙️ AI हिंदी आवाज़ सेट करें</button>
          <a href="/3d-video.html" style="display:inline-block; padding:10px 13px; border-radius:9px; background:#176b58; color:#fff; font-weight:800; font-size:13px; text-decoration:none">🎬 3D MP4 टेस्ट (30 सेकंड)</a><a href="/3d-test.html" style={{ display:"inline-block", padding:"10px 13px", borderRadius:9, background:"#253b5b", color:"#fff", fontWeight:800, fontSize:13, textDecoration:"none" }}>🎭 3D कार्टून टेस्ट</a>
          <button onClick={createWholeCartoon} disabled={busy}>{busy ? "AI काम कर रहा है…" : "🎬 मेरी आज की 3D वीडियो तैयार करो"}</button>
        </div>
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: "pointer", color: "#cbd5e1" }}>विषय बदलना चाहें? (वैकल्पिक)</summary>
          <label htmlFor="story">वीडियो का विषय लिखें</label>
          <textarea id="story" value={idea} onChange={event => setIdea(event.target.value)} placeholder="खाली छोड़ें तो ऐप खुद नई हिंदी कॉमेडी कहानी चुनेगा…" />
        </details>
        <p className="editor-status">{status}</p>
        {storyInfo && <p className="editor-note">किरदार: {storyInfo.characterBible || "AI द्वारा तय"}</p>}
        <p className="editor-note">मुख्य बटन अब मुफ्त AI इंजन से वास्तविक AI वीडियो क्लिप बनाने की कोशिश करता है और MP4 को Library में सेव करता है। मुफ्त साझा GPU की उपलब्धता निश्चित नहीं है; अभी इंजन केवल लगभग 3 सेकंड की क्लिप देता है, पूरी लंबी कहानी नहीं।</p>
      </section>
    </>}
    {show3d && <section style={{ maxWidth: 900, margin: "18px auto", padding: 12, border: "1px solid #16a085", borderRadius: 14, background: "#111827" }}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 6px"}}><strong>🎭 3D वीडियो निर्माण</strong><button onClick={() => setShow3d(false)}>बंद करें</button></div><iframe title="3D MP4 निर्माता" src={`/3d-video.html?embedded=1&idea=${encodeURIComponent(idea || "मोहन और शरारती बकरी")}`} style={{width:"100%",height:680,border:0,borderRadius:10,background:"#0b1020"}} allow="autoplay" /></section>}
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
