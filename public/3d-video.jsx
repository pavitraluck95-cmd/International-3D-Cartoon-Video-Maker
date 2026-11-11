import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";

const API = "https://international-3d-cartoon-video-maker.onrender.com";
const params = new URLSearchParams(window.location.search);
const IDEA = (params.get("idea") || "मोहन और शरारती बकरी").trim().slice(0, 140);
const SCRIPT = `नमस्ते दोस्तों! आज की कहानी है ${IDEA}। मोहन गाँव में निकला तो उसे एक मजेदार परेशानी मिली। उसने हिम्मत और समझदारी से उसका हल निकाला। आखिर में सभी दोस्त बन गए और पूरा गाँव हँसने लगा।`;
function wait(ms){return new Promise(r=>setTimeout(r,ms));}
async function makeVoice(){
  if(!window.AndroidTTS?.synthesize) throw new Error("इस APK में हिंदी आवाज़ की सुविधा उपलब्ध नहीं है।");
  for(let i=0;i<80&&!window.AndroidTTS.isReady();i++) await wait(250);
  if(!window.AndroidTTS.isReady()) throw new Error("फोन की हिंदी आवाज़ तैयार नहीं हुई।");
  const id="tts3d"+Date.now();
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{delete window.__tts3d[id];reject(new Error("हिंदी आवाज़ बनने में समय लग गया।"));},120000);
    window.__tts3d=window.__tts3d||{};
    window.__tts3d[id]={parts:[],resolve:v=>{clearTimeout(timer);resolve("data:audio/wav;base64,"+v);},reject};
    window.onNativeTtsChunk=(key,chunk,last)=>{
      const e=window.__tts3d?.[key]; if(!e)return; e.parts.push(chunk);
      if(last){delete window.__tts3d[key];e.resolve(e.parts.join("")); }
    };
    window.onNativeTtsError=(key,msg)=>{const e=window.__tts3d?.[key];if(e){delete window.__tts3d[key];clearTimeout(timer);e.reject(new Error(msg));}};
    if(!window.AndroidTTS.synthesize(SCRIPT,id)){delete window.__tts3d[id];clearTimeout(timer);reject(new Error("हिंदी आवाज़ शुरू नहीं हुई।"));}
  });
}
function buildScene(mount){
  const renderer=new THREE.WebGLRenderer({antialias:false,alpha:false,preserveDrawingBuffer:false});
  renderer.setPixelRatio(1); renderer.setSize(360,640,false); renderer.setClearColor(0x9bd6f2); mount.appendChild(renderer.domElement);
  const scene=new THREE.Scene(); scene.background=new THREE.Color(0x9bd6f2); scene.fog=new THREE.Fog(0x9bd6f2,12,28);
  const camera=new THREE.PerspectiveCamera(38,360/640,.1,60);camera.position.set(0,3.1,9.2);camera.lookAt(0,1.5,0);
  scene.add(new THREE.HemisphereLight(0xffffff,0x63734c,2));
  const sun=new THREE.DirectionalLight(0xffffff,2);sun.position.set(-4,7,5);scene.add(sun);
  const mat=c=>new THREE.MeshStandardMaterial({color:c,roughness:.78});
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(30,30),mat(0x78b86b));ground.rotation.x=-Math.PI/2;ground.position.y=-.06;scene.add(ground);
  // Stylized village environment with depth and layered scenery.
  const path=new THREE.Mesh(new THREE.PlaneGeometry(2.1,18),mat(0xc9a878));path.rotation.x=-Math.PI/2;path.position.set(.2,.005,-3);scene.add(path);
  const treeMat=mat(0x397c4c),trunkMat=mat(0x805238);
  for(const [x,z] of [[-5,-1],[5,-2],[-5,-6],[5,-7]]){
    const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.12,.18,1.4,7),trunkMat);trunk.position.set(x,.7,z);scene.add(trunk);
    for(let j=0;j<3;j++){const crown=new THREE.Mesh(new THREE.SphereGeometry(.72-j*.08,10,8),treeMat);crown.position.set(x+(j-1)*.3,1.55+j*.22,z);scene.add(crown);}
  }
  const cloudMat=new THREE.MeshBasicMaterial({color:0xffffff});
  for(const [x,y,z] of [[-3,5,-5],[2,5.8,-7],[5,4.7,-8]])for(let j=0;j<3;j++){
    const cloud=new THREE.Mesh(new THREE.SphereGeometry(.42,10,8),cloudMat);cloud.scale.set(1.2,.65,.7);cloud.position.set(x+(j-1)*.42,y+(j===1?.12:0),z);scene.add(cloud);
  }
  const sunBall=new THREE.Mesh(new THREE.SphereGeometry(.62,16,12),new THREE.MeshBasicMaterial({color:0xffdf8a}));sunBall.position.set(4.8,5.5,-9);scene.add(sunBall);
  const house=new THREE.Mesh(new THREE.BoxGeometry(2.4,1.8,1.8),mat(0xf0c98a));house.position.set(-3, .9,-2);scene.add(house);
  const roof=new THREE.Mesh(new THREE.ConeGeometry(1.9,.9,4),mat(0xb94e3f));roof.position.set(-3,2.25,-2);roof.rotation.y=Math.PI/4;scene.add(roof);
  const character=new THREE.Group();scene.add(character);
  const mesh=(g,m,p,x,y,z)=>{const o=new THREE.Mesh(g,m);o.position.set(x,y,z);p.add(o);return o;};
  const skin=mat(0xf2bd91),shirt=mat(0x17a69a),pants=mat(0x283c72),dark=mat(0x28222a),white=mat(0xffffff);
  mesh(new THREE.CapsuleGeometry(.43,.7,4,8),shirt,character,0,1.18,0);
  const head=new THREE.Group();head.position.set(0,2.25,0);character.add(head);
  mesh(new THREE.SphereGeometry(.55,22,18),skin,head,0,0,0);
  mesh(new THREE.SphereGeometry(.56,22,14,0,Math.PI*2,0,Math.PI*.48),dark,head,0,.18,-.02);
  for(const x of [-.19,.19]){
    mesh(new THREE.SphereGeometry(.105,12,10),skin,head,x,-.02,.43);
    mesh(new THREE.SphereGeometry(.09,12,10),white,head,x,.045,.49);
    mesh(new THREE.SphereGeometry(.043,10,8),mat(0x34241d),head,x,.04,.555);
    mesh(new THREE.SphereGeometry(.016,8,6),white,head,x-.012,.06,.585);
  }
  const nose=mesh(new THREE.SphereGeometry(.075,12,10),mat(0xe6a17f),head,0,-.105,.52);nose.scale.set(1,.65,.65);
  const mouth=mesh(new THREE.SphereGeometry(.12,14,10),mat(0x682e36),head,0,-.25,.49);mouth.scale.set(.8,.18,.25);
  const brow1=mesh(new THREE.BoxGeometry(.2,.045,.055),dark,head,-.2,.2,.5);
  const brow2=mesh(new THREE.BoxGeometry(.2,.045,.055),dark,head,.2,.2,.5);
  const hairTuft=mesh(new THREE.SphereGeometry(.22,12,8),dark,head,0,.48,.02);hairTuft.scale.set(1.25,.65,1);
  const arms=[],legs=[];
  for(const side of [-1,1]){
    const a=new THREE.Group();a.position.set(side*.47,1.62,0);character.add(a);mesh(new THREE.CapsuleGeometry(.12,.48,3,7),shirt,a,0,-.28,0);mesh(new THREE.SphereGeometry(.13,10,8),skin,a,0,-.58,.02);arms.push(a);
    const l=new THREE.Group();l.position.set(side*.2,.72,0);character.add(l);mesh(new THREE.CapsuleGeometry(.15,.52,3,7),pants,l,0,-.29,0);mesh(new THREE.BoxGeometry(.29,.15,.4),dark,l,0,-.59,.1);legs.push(l);
  }
  const goat=new THREE.Group();scene.add(goat);goat.position.set(2,0,-.5);
  const fur=mat(0xf4eee1),horn=mat(0x66584b),goatDark=mat(0x40372f);
  mesh(new THREE.SphereGeometry(.48,18,14),fur,goat,-.08,.65,0).scale.set(1.35,.85,.8);
  mesh(new THREE.SphereGeometry(.29,16,12),fur,goat,.38,.88,.02);
  mesh(new THREE.SphereGeometry(.19,14,10),fur,goat,.52,.78,.2);
  for(const x of [-.15,.15]){
    mesh(new THREE.ConeGeometry(.07,.35,8),horn,goat,x,.98,-.03);
    mesh(new THREE.SphereGeometry(.045,10,8),white,goat,.48+x*.45,.91,.265);
    mesh(new THREE.SphereGeometry(.02,8,6),goatDark,goat,.49+x*.45,.91,.3);
  }
  const goatTail=mesh(new THREE.ConeGeometry(.09,.28,8),fur,goat,-.67,.78,0);goatTail.rotation.z=-1.1;
  const goatLegs=[];for(const x of [-.28,.28])for(const z of [-.16,.16]){const leg=mesh(new THREE.CylinderGeometry(.05,.06,.42,8),horn,goat,x,.25,z);goatLegs.push(leg);}
  let raf=0,start=0,recording=false;
  const animate=now=>{
    if(!start)start=now;const t=(now-start)/1000;
    const running=t<17||t>23;
    character.position.x=t<17?Math.sin(t*.42)*.7:t<23?1.0:Math.cos((t-23)*.5)*.6;
    character.position.y=running?Math.abs(Math.sin(t*8))*.07:0;
    legs[0].rotation.x=running?Math.sin(t*8)*.65:0;legs[1].rotation.x=running?-Math.sin(t*8)*.65:0;
    arms[0].rotation.x=running?-Math.sin(t*8)*.45:Math.sin(t*2)*.25;arms[1].rotation.x=running?Math.sin(t*8)*.45:-.3;
    head.rotation.z=Math.sin(t*2)*.035;
    mouth.scale.y=.18+Math.abs(Math.sin(t*9))*.7;
    brow1.rotation.z=t>18&&t<23?.2:0;brow2.rotation.z=t>18&&t<23?-.2:0;
    goat.position.x=t<12?2:t<19?2-(t-12)*.22:-.0;
    goat.rotation.y=t>12&&t<19?-.25:Math.sin(t*2)*.08;
    goatLegs.forEach((l,i)=>l.rotation.x=t>12&&t<19?Math.sin(t*12+i)*.45:0);
    renderer.render(scene,camera);raf=requestAnimationFrame(animate);
  };
  raf=requestAnimationFrame(animate);
  return {renderer,canvas:renderer.domElement,stop(){cancelAnimationFrame(raf);renderer.dispose();scene.traverse(o=>{o.geometry?.dispose();if(o.material)(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose());});}};
}
function App(){
 const host=useRef(null),scene=useRef(null),[busy,setBusy]=useState(false),[sceneReady,setSceneReady]=useState(false),[status,setStatus]=useState("30 सेकंड का 3D वीडियो टेस्ट तैयार है।");
 useEffect(()=>{try{if(host.current){scene.current=buildScene(host.current);setSceneReady(true);setStatus("3D किरदार तैयार हैं। वीडियो बनाना शुरू हो सकता है।");}}catch(e){setStatus("फोन में 3D WebGL उपलब्ध नहीं: "+e.message);}return()=>scene.current?.stop();},[]);
 useEffect(()=>{if(sceneReady&&new URLSearchParams(window.location.search).get("embedded")==="1"&&!busy){create();}},[sceneReady]);
 async function create(){
  if(!scene.current)return;
  setBusy(true);
  try{
   setStatus("चरण 1/3: 3D किरदारों की 30 सेकंड रिकॉर्डिंग…");
   const stream=scene.current.canvas.captureStream(24);
   const mime=MediaRecorder.isTypeSupported("video/webm;codecs=vp8")?"video/webm;codecs=vp8":"video/webm";
   const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:1200000});
   const chunks=[];recorder.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data);};
   const stopped=new Promise((resolve,reject)=>{recorder.onstop=resolve;recorder.onerror=()=>reject(new Error("3D रिकॉर्डिंग रुक गई।"));});
   recorder.start(1000);await wait(30000);recorder.stop();await stopped;stream.getTracks().forEach(t=>t.stop());
   const webm=new Blob(chunks,{type:"video/webm"});
   if(webm.size<20000)throw new Error("फोन से 3D रिकॉर्डिंग नहीं मिली।");
   setStatus("चरण 2/3: साफ हिंदी आवाज़ तैयार हो रही है…");
   const voice=await makeVoice();
   setStatus("चरण 3/3: 3D वीडियो और हिंदी आवाज़ से MP4 बन रही है…");
   const videoData="data:video/webm;base64,"+await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(",")[1]);r.onerror=reject;r.readAsDataURL(webm);});
   const response=await fetch(API+"/api/render-3d-mp4",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({video:videoData,narration:voice})});
   if(!response.ok){let d={};try{d=await response.json();}catch{}throw new Error(d.error||"सर्वर MP4 नहीं बना पाया।");}
   const mp4=await response.blob();if(mp4.size<50000||mp4.type!=="video/mp4")throw new Error("सही MP4 फ़ाइल नहीं मिली।");
   if(window.parent && window.parent !== window){ window.parent.postMessage({type:"international-3d-mp4",blob:mp4},window.location.origin); setStatus("🎉 3D MP4 मुख्य ऐप को भेज दी गई है। Library में सेव हो रही है…"); }
   else { const url=URL.createObjectURL(mp4);const a=document.createElement("a");a.href=url;a.download="international-3d-cartoon-test.mp4";a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);setStatus("🎉 30 सेकंड की 3D हिंदी MP4 तैयार है और डाउनलोड शुरू हो गया है।"); }
  }catch(e){setStatus("वीडियो नहीं बन पाई: "+(e.message||"अज्ञात समस्या"));}
  finally{setBusy(false);}
 }
 return <main style={{maxWidth:760,margin:"auto",padding:16,color:"#fff",fontFamily:"system-ui"}}>
 <a href="/editor.html" style={{color:"#ffd36c"}}>← मुख्य वीडियो मेकर</a><h2>🎭 असली 3D MP4 टेस्ट</h2>
 <p style={{color:"#b9c6dc"}}>इसमें 3D मोहन और बकरी चलेंगे, हाथ-पैर हिलाएँगे और चेहरे के भाव बदलेंगे। यह 30 सेकंड का परीक्षण है।</p>
 <div ref={host} style={{width:"100%",aspectRatio:"9/16",maxWidth:360,margin:"0 auto",borderRadius:14,overflow:"hidden",border:"1px solid #43516b"}}/>
 <p style={{color:"#ffe1a0",lineHeight:1.6}}>{status}</p>
 <button disabled={busy||!scene.current} onClick={create} style={{width:"100%",padding:15,borderRadius:12,border:0,background:busy?"#596579":"#16a085",color:"#fff",fontSize:16,fontWeight:800}}>{busy?"कृपया प्रतीक्षा करें…":"🎬 3D हिंदी MP4 बनाएं (30 सेकंड)"}</button>
 <p style={{fontSize:12,color:"#9eacc3"}}>वीडियो 360×640 (9:16) में बनता है। यह हल्का 3D एनीमेशन टेस्ट है; अभी असली AI वीडियो जनरेशन और शब्द-अनुसार सटीक लिप-सिंक उपलब्ध नहीं है।</p>
 </main>;
}
createRoot(document.getElementById("root")).render(<App/>);