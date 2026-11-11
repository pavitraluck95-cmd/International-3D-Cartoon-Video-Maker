import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";

function ThreeCharacterTest() {
  const host = useRef(null);
  const sceneApi = useRef(null);
  const [mood, setMood] = useState("smile");
  const [walking, setWalking] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const [message, setMessage] = useState("3D किरदार तैयार है।");

  useEffect(() => {
    const mount = host.current;
    if (!mount) return;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch (error) {
      setMessage("इस फोन में WebGL 3D सुविधा उपलब्ध नहीं हो सकी।");
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x101a30);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x101a30);
    scene.fog = new THREE.Fog(0x101a30, 8, 18);
    const camera = new THREE.PerspectiveCamera(35, mount.clientWidth / mount.clientHeight, 0.1, 50);
    camera.position.set(0, 2.5, 8.5);
    camera.lookAt(0, 1.35, 0);
    scene.add(new THREE.HemisphereLight(0xdcecff, 0x39405c, 2.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.3);
    key.position.set(-3, 6, 5);
    key.castShadow = true;
    scene.add(key);

    const floor = new THREE.Mesh(new THREE.CircleGeometry(5, 48), new THREE.MeshStandardMaterial({ color: 0x273653, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.03;
    floor.receiveShadow = true;
    scene.add(floor);

    const character = new THREE.Group();
    scene.add(character);
    const mat = (color, roughness = 0.65) => new THREE.MeshStandardMaterial({ color, roughness });
    const skin = mat(0xf0b887);
    const shirt = mat(0x20a6a0);
    const pants = mat(0x263a68);
    const dark = mat(0x172033);
    const white = mat(0xffffff);
    const iris = mat(0x30251f);
    const mouthMat = mat(0x632b32);
    const makeMesh = (geo, material, parent, x, y, z) => {
      const m = new THREE.Mesh(geo, material);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };

    const body = makeMesh(new THREE.CapsuleGeometry(0.42, 0.72, 5, 12), shirt, character, 0, 1.25, 0);
    const head = new THREE.Group();
    head.position.set(0, 2.35, 0);
    character.add(head);
    makeMesh(new THREE.SphereGeometry(0.56, 24, 20), skin, head, 0, 0, 0);
    makeMesh(new THREE.SphereGeometry(0.58, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.48), dark, head, 0, 0.2, -0.015);
    const eyeL = makeMesh(new THREE.SphereGeometry(0.075, 12, 10), white, head, -0.2, 0.04, 0.49);
    const eyeR = makeMesh(new THREE.SphereGeometry(0.075, 12, 10), white, head, 0.2, 0.04, 0.49);
    makeMesh(new THREE.SphereGeometry(0.035, 10, 8), iris, head, -0.2, 0.035, 0.55);
    makeMesh(new THREE.SphereGeometry(0.035, 10, 8), iris, head, 0.2, 0.035, 0.55);
    const mouth = makeMesh(new THREE.SphereGeometry(0.13, 16, 12), mouthMat, head, 0, -0.22, 0.51);
    mouth.scale.set(0.75, 0.18, 0.25);
    const browL = makeMesh(new THREE.BoxGeometry(0.19, 0.035, 0.045), dark, head, -0.2, 0.2, 0.5);
    const browR = makeMesh(new THREE.BoxGeometry(0.19, 0.035, 0.045), dark, head, 0.2, 0.2, 0.5);

    const armL = new THREE.Group(); armL.position.set(-0.47, 1.7, 0); character.add(armL);
    makeMesh(new THREE.CapsuleGeometry(0.13, 0.52, 4, 8), shirt, armL, 0, -0.32, 0);
    makeMesh(new THREE.SphereGeometry(0.14, 12, 10), skin, armL, 0, -0.68, 0);
    const armR = new THREE.Group(); armR.position.set(0.47, 1.7, 0); character.add(armR);
    makeMesh(new THREE.CapsuleGeometry(0.13, 0.52, 4, 8), shirt, armR, 0, -0.32, 0);
    makeMesh(new THREE.SphereGeometry(0.14, 12, 10), skin, armR, 0, -0.68, 0);
    const legL = new THREE.Group(); legL.position.set(-0.2, 0.78, 0); character.add(legL);
    makeMesh(new THREE.CapsuleGeometry(0.16, 0.55, 4, 8), pants, legL, 0, -0.32, 0);
    makeMesh(new THREE.BoxGeometry(0.3, 0.16, 0.42), dark, legL, 0, -0.67, 0.1);
    const legR = new THREE.Group(); legR.position.set(0.2, 0.78, 0); character.add(legR);
    makeMesh(new THREE.CapsuleGeometry(0.16, 0.55, 4, 8), pants, legR, 0, -0.32, 0);
    makeMesh(new THREE.BoxGeometry(0.3, 0.16, 0.42), dark, legR, 0, -0.67, 0.1);

    sceneApi.current = { mouth, browL, browR, head, armL, armR, legL, legR, character };
    let frame = 0;
    let raf = 0;
    const animate = () => {
      frame += 0.035;
      const api = sceneApi.current;
      if (api) {
        const walkingNow = api.walking;
        api.character.position.y = walkingNow ? Math.abs(Math.sin(frame * 2)) * 0.07 : 0;
        api.legL.rotation.x = walkingNow ? Math.sin(frame * 2) * 0.55 : 0;
        api.legR.rotation.x = walkingNow ? -Math.sin(frame * 2) * 0.55 : 0;
        api.armL.rotation.x = walkingNow ? -Math.sin(frame * 2) * 0.48 : 0;
        api.armR.rotation.x = walkingNow ? Math.sin(frame * 2) * 0.48 : 0;
        api.head.rotation.z = walkingNow ? Math.sin(frame) * 0.035 : 0;
        api.mouth.scale.y = api.speaking ? 0.18 + Math.abs(Math.sin(frame * 8)) * 0.95 : (api.mood === "surprise" ? 0.8 : api.mood === "smile" ? 0.22 : 0.12);
        api.mouth.scale.x = api.mood === "smile" ? 0.9 : 0.65;
        api.browL.rotation.z = api.mood === "angry" ? 0.22 : api.mood === "surprise" ? -0.18 : 0;
        api.browR.rotation.z = api.mood === "angry" ? -0.22 : api.mood === "surprise" ? 0.18 : 0;
      }
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    animate();
    const resize = () => {
      if (!mount.clientWidth || !mount.clientHeight) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      scene.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach(m => m.dispose());
      });
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      sceneApi.current = null;
    };
  }, []);

  useEffect(() => {
    if (sceneApi.current) {
      sceneApi.current.walking = walking;
      sceneApi.current.speaking = speaking;
      sceneApi.current.mood = mood;
    }
  }, [walking, speaking, mood]);

  function speak() {
    const text = "नमस्ते दोस्तों! मैं आपका नया तीन डी कार्टून किरदार हूँ। देखिए, मैं चल सकता हूँ, बोल सकता हूँ और अलग-अलग भाव दिखा सकता हूँ।";
    if (!("speechSynthesis" in window)) {
      setMessage("इस फोन के ब्राउज़र में हिंदी बोलने की सुविधा नहीं मिली।");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "hi-IN";
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.onstart = () => { setSpeaking(true); setMessage("किरदार बोल रहा है…"); };
    utterance.onend = () => { setSpeaking(false); setMessage("बोलना पूरा हुआ।"); };
    utterance.onerror = () => { setSpeaking(false); setMessage("फोन की हिंदी आवाज़ उपलब्ध नहीं हुई।"); };
    setMood("smile");
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }

  return <main style={{ minHeight:"100vh", background:"#0b1020", color:"#fff", fontFamily:"system-ui", padding:"14px", maxWidth:760, margin:"auto" }}>
    <a href="/editor.html" style={{color:"#ffd36c",fontWeight:700,textDecoration:"none"}}>← पुराने वीडियो मेकर पर वापस</a>
    <h2 style={{margin:"12px 0 6px"}}>🎭 3D कार्टून टेस्ट</h2>
    <p style={{color:"#b9c6dc",fontSize:13,lineHeight:1.5}}>हल्का 3D किरदार: चलना, हाथ हिलाना, बोलते समय मुँह हिलाना और चेहरे के भाव।</p>
    <div ref={host} style={{height:"min(58vh,480px)",minHeight:300,borderRadius:18,overflow:"hidden",border:"1px solid #43516b"}} />
    <p aria-live="polite" style={{color:"#ffe1a0",fontSize:13}}>{message}</p>
    <div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:9}}>
      <button onClick={()=>setWalking(v=>!v)} style={btn}>{walking?"⏸️ चलना रोकें":"🚶 चलना शुरू करें"}</button>
      <button onClick={speak} style={btn}>🗣️ हिंदी में बुलवाएँ</button>
      <button onClick={()=>setMood("smile")} style={btn}>😊 खुश</button>
      <button onClick={()=>setMood("surprise")} style={btn}>😮 हैरान</button>
      <button onClick={()=>setMood("angry")} style={btn}>😠 गुस्सा</button>
      <button onClick={()=>{window.speechSynthesis?.cancel();setSpeaking(false);setMessage("आवाज़ रोक दी गई।");}} style={btn}>🔇 आवाज़ रोकें</button>
    </div>
    <p style={{color:"#91a0b8",fontSize:11,lineHeight:1.5}}>यह शुरुआती 3D तकनीकी परीक्षण है। मुँह की गति आवाज़ के साथ अनुमानित रूप से चलती है; अभी सटीक शब्द-अनुसार लिप-सिंक, पूरी कहानी के MP4 में 3D रेंडर और अलग-अलग किरदारों की एक्टिंग जुड़ी नहीं है।</p>
  </main>;
}
const btn={padding:"13px 8px",borderRadius:12,border:"1px solid #52627c",background:"#1b2942",color:"#fff",fontWeight:700,fontSize:13};
createRoot(document.getElementById("root")).render(<ThreeCharacterTest />);
