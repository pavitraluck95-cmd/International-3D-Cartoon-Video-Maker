import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

const VIDEO_DB_NAME = "international-2d-video-library";
const API_BASE = "https://international-3d-cartoon-video-maker.onrender.com";

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
  const [voiceText, setVoiceText] = useState("");
  const [voiceId, setVoiceId] = useState("hm_omega");
  const [audioBusy, setAudioBusy] = useState(false);
  const [audioUrl, setAudioUrl] = useState("");

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


  async function generateAiVoice() {
    if (audioBusy) return;
    if (!voiceText.trim()) {
      setStatus("पहले AI आवाज़ के लिए हिंदी संवाद लिखें।");
      return;
    }
    setAudioBusy(true);
    setStatus("Kokoro AI हिंदी आवाज़ तैयार कर रहा है…");
    try {
      const response = await fetch(API_BASE + "/api/ai-audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: voiceText.trim(), voice: voiceId, speed: 1, lang: "hi" })
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail.error || "AI आवाज़ नहीं बन पाई।");
      }
      const blob = await response.blob();
      if (!blob.size || !blob.type.includes("audio")) throw new Error("AI सेवा से वैध ऑडियो नहीं मिला।");
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
      setStatus("🎙️ AI हिंदी आवाज़ तैयार है। सुनें या MP3 डाउनलोड करें।");
    } catch (error) {
      setStatus("AI आवाज़ नहीं बन पाई: " + (error.message || "सेवा अस्थायी रूप से व्यस्त है।"));
    } finally {
      setAudioBusy(false);
    }
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
      // Generate four sequential 2-second AI scenes and join them into one ~8-second MP4.
      const safeIdea = (idea || "").trim().slice(0, 700) || "दो दोस्तों के बीच मजेदार गलतफहमी और हँसी वाला छोटा दृश्य";
      const characterLock = "Cinematic 3D animated family comedy, vertical portrait 9:16. The two main original characters in EVERY scene and EVERY video are Bagadbillaa, a large expressive grey cat with white muzzle, chest and paws, and Mooshak, a tiny clever brown mouse with tan muzzle and belly, large round ears and a long thin tail. Keep their names, identities, colors, facial features, body proportions and relative scale exactly consistent in every clip. Both Bagadbillaa (cat) and Mooshak (mouse) must be clearly visible together in every scene, acting out the story with expressive faces, playful hero-style reactions and family-friendly slapstick comedy. Hindi dialogue will be added as a separate voiceover during editing; do not generate text, subtitles or logos. Detailed high-quality 3D animated models, natural motion, cinematic lighting. No humans, no Tom and Jerry names, no 2D or slideshow.";
      const beats = [
        "SCENE 1 — OPENING: Show Bagadbillaa the cat and Mooshak the mouse together. Establish the setting and begin this story situation: " + safeIdea + ". Start their funny argument or challenge.",
        "SCENE 2 — BUILD-UP: Continue the same story with identical character designs. Both characters speak in Hindi with hero-style comic dialogue. Show the first funny trick and reaction: " + safeIdea + ".",
        "SCENE 3 — TWIST: Continue naturally from the previous scene. Keep Bagadbillaa and Mooshak together and visually consistent; show a clever surprise, chase or harmless slapstick gag: " + safeIdea + ".",
        "SCENE 4 — CLIMAX: Both characters remain on screen and speak their own short Hindi lines. Show the funniest action and a strong comic reaction: " + safeIdea + ".",
        "SCENE 5 — ENDING: Keep Bagadbillaa the cat and Mooshak the mouse together and visually consistent. End with a clear funny punchline, hero-style final dialogue and playful reaction. Story: " + safeIdea + "."
      ];
      const videoUrls = [];
      const dialogueStory = {
        scenes: [
          { dialogue: "बागड़बिल्ला: मूषक, आज हमारी कहानी है " + safeIdea + "। चलो, मैं हीरो बनकर दिखाता हूँ!" },
          { dialogue: "मूषक: रुक जाओ बागड़बिल्ले! पहले सोचो, फिर कोई चाल चलना।" },
          { dialogue: "बागड़बिल्ला: अरे, मेरी ज़बरदस्त योजना तैयार है! अब देखना कमाल।" },
          { dialogue: "मूषक: हा हा! तुम्हारी योजना तो उलटी पड़ गई। अब मेरी बारी!" },
          { dialogue: "बागड़बिल्ला: मान गया मूषक, आज तुम जीते। लेकिन अगली कहानी में फिर मुकाबला होगा!" }
        ]
      };
      setStatus("फोन की हिंदी आवाज़ तैयार हो रही है…");
      const narration = await makeHindiNarration(dialogueStory);
      if (!narration) throw new Error("हिंदी आवाज़ के लिए Android APK की Text-to-Speech सुविधा उपलब्ध नहीं है।");
      for (let i = 0; i < beats.length; i++) {
        setStatus("AI कहानी का दृश्य " + (i + 1) + "/5 बन रहा है… हर दृश्य लगभग 7 सेकंड का होगा।");
        const generated = await fetch(API_BASE + "/api/generate", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: characterLock + " " + beats[i] })
        });
        const data = await generated.json().catch(() => ({}));
        if (!generated.ok || !data.videoUrl) throw new Error("दृश्य " + (i + 1) + ": " + (data.error || "AI इंजन वीडियो नहीं बना पाया।"));
        videoUrls.push(data.videoUrl);
      }
      setStatus("पाँचों AI दृश्य बन गए। अब लगभग 30 सेकंड की 9:16 Shorts MP4 जोड़ी जा रही है…");
      const joined = await fetch(API_BASE + "/api/stitch-ai-videos", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoUrls, narration })
      });
      if (!joined.ok) {
        const detail = await joined.json().catch(() => ({}));
        throw new Error(detail.error || "तीनों AI दृश्यों को एक MP4 में नहीं जोड़ा जा सका।");
      }
      const blob = await joined.blob();
      if (blob.size < 20000 || !blob.type.includes("video")) throw new Error("जुड़ी हुई AI वीडियो वैध MP4 नहीं है।");
      const filename = "international-ai-3d-story-" + Date.now() + ".mp4";
      await saveVideoToLibrary(blob, filename, 30);
      await refreshSavedVideos();
      setStatus("🎉 पाँच AI दृश्यों को जोड़कर लगभग 30 सेकंड की 9:16 Shorts MP4 Library में सेव हो गई है।");
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
      
      
      {!busy && <button onClick={createWholeCartoon} style={{ padding: "14px 22px", borderRadius: 12, fontWeight: 800 }}>🔄 दोबारा वीडियो बनाएं</button>}
      <p style={{ color: "#aebbd0", fontSize: 13 }}>वीडियो पहले ऐप की Library में सेव होगी। Gallery में केवल आपके बटन दबाने पर जाएगी।</p>
    </section> : <>
      <header className="editor-header">
        <a href="/" className="back-link">← मुख्य ऐप</a>
        <div><strong>🎭 AI कार्टून वीडियो मेकर</strong><small>एक आदेश → AI कहानी + वीडियो + हिंदी आवाज़ → MP4</small></div>
      </header>
      <section className="director-bar" id="ai-video-studio">
        <div className="director-actions">
          
          
          <button onClick={createWholeCartoon} disabled={busy}>{busy ? "AI काम कर रहा है…" : "🎬 मेरी आज की 3D वीडियो तैयार करो"}</button>
        </div>
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: "pointer", color: "#cbd5e1" }}>विषय बदलना चाहें? (वैकल्पिक)</summary>
          <label htmlFor="story">वीडियो का विषय लिखें</label>
          <textarea id="story" value={idea} onChange={event => setIdea(event.target.value)} placeholder="खाली छोड़ें तो ऐप खुद नई हिंदी कॉमेडी कहानी चुनेगा…" />
        </details>
        <p className="editor-status">{status}</p>
        {storyInfo && <p className="editor-note">किरदार: {storyInfo.characterBible || "AI द्वारा तय"}</p>}
        <p className="editor-note">एक ही मुख्य बटन से कहानी, AI वीडियो और हिंदी आवाज़ की प्रक्रिया चलाने का लक्ष्य है। अभी उपलब्ध वीडियो इंजन लगभग 3 सेकंड की क्लिप तक सीमित है; 10 मिनट का वास्तविक AI वीडियो अभी सत्यापित नहीं है।</p>
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
