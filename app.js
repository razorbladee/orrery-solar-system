import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const $ = (id) => document.getElementById(id);
const fallback = {
  bodies: [
    ['Mercury','.39','.206','7','87.97','#a59c91'],['Venus','.72','.007','3.4','224.7','#dca96b'],['Earth','1','.017','0','365.25','#56a6b8'],['Mars','1.52','.093','1.85','686.98','#cb654c'],['Jupiter','5.2','.049','1.3','4332.6','#c89466'],['Saturn','9.54','.057','2.5','10759','#cbb27c'],['Uranus','19.19','.046','.77','30687','#8cc9c6'],['Neptune','30.06','.01','1.77','60190','#5574ba']
  ].map(([name,a,e,i,period,color], index) => ({id:name.toLowerCase(),name,a:+a,e:+e,i:+i,period:+period,color,type:'planet',radiusKm:6000,massEarth:1,composition:'Rock and ice',temperature:'Unknown',gravity:'Unknown',day:'Unknown',missions:'Unknown',fact:'Solar system body.',moons:[],phase:THREE.MathUtils.degToRad(index * 137.5),index})),
  satellites: [],
  events: [],
  tour: []
};

const defaults = {selected:3,speed:2,paused:false,trails:true,labels:true,asteroids:true,kuiper:true,realistic:false,date:'2026-07-26'};
let state = {...defaults};
try { state = {...state, ...JSON.parse(localStorage.getItem('orrery-v3') || '{}')}; } catch {}
const save = () => { try { localStorage.setItem('orrery-v3', JSON.stringify(state)); } catch {} };

let data = fallback;
let planets = fallback.bodies;
let satellites = fallback.satellites;
let scene, camera, renderer, controls, clock;
let simDays = 0;
let baseDate = Date.parse(state.date + 'T00:00:00Z');
let focus = null;
let mode = 'orbit';
let tourIndex = 0;
const meshes = new Map();
const trails = [];
const labels = [];
const satelliteMeshes = [];
const tmp = new THREE.Vector3();
const canvas = $('space');
const host = canvas?.parentElement;

function showInitError(error) {
  const panel = $('webgl-error');
  const detail = $('webgl-error-detail');
  if (panel) panel.hidden = false;
  if (detail) detail.textContent = `${error?.name || 'Error'}: ${error?.message || String(error)}`;
  console.error('[ORRERY init]', error);
}

async function loadData() {
  try {
    const response = await fetch(new URL('./data.json', import.meta.url), {cache:'no-store'});
    if (!response.ok) throw new Error(`data.json HTTP ${response.status}`);
    const loaded = await response.json();
    if (!Array.isArray(loaded.bodies) || loaded.bodies.length !== 8) throw new Error('data.json has an invalid bodies array');
    data = loaded;
    planets = loaded.bodies.map((body,index) => ({...body, index, phase: THREE.MathUtils.degToRad(index * 137.5)}));
    satellites = Array.isArray(loaded.satellites) ? loaded.satellites : [];
  } catch (error) {
    console.warn('[ORRERY data] Using built-in fallback:', error);
  }
}

function renderSelection(body) {
  if (!body) return;
  $('body-name').textContent = body.name;
  $('body-type').textContent = body.type;
  $('body-fact').textContent = body.fact;
  $('body-composition').textContent = body.composition;
  $('body-temp').textContent = body.temperature;
  $('body-gravity').textContent = body.gravity;
  $('body-day').textContent = body.day;
  $('body-missions').textContent = body.missions;
  $('body-moons').textContent = body.moons.length;
  $('readout-body').textContent = body.name.toUpperCase();
  $('planet-orb').style.background = `radial-gradient(circle at 35% 30%,${body.color},#322528 70%)`;
  $('nearby-count').textContent = `${body.moons.length} active`;
  $('orbiter-list').innerHTML = body.moons.length ? body.moons.map(name => `<button class="orbiter-chip">${name}</button>`).join('') : '<span class="muted">No major satellites in model</span>';
}

function select(index, move = true) {
  const body = planets[index];
  if (!body) return;
  state.selected = index;
  renderSelection(body);
  if (move && meshes.has(body.id)) { focus = meshes.get(body.id); setMode('follow'); }
  save();
}

function renderCatalog() {
  const target = $('catalog-grid');
  if (!target) return;
  target.innerHTML = planets.map(body => `<article class="catalog-item"><div class="catalog-item-head"><span class="catalog-dot" style="--planet:${body.color}"></span><span class="kicker">${body.type}</span></div><div><h3>${body.name}</h3><p>${body.fact}</p></div><div class="catalog-footer"><span>${Number(body.radiusKm).toLocaleString()} km · ${body.moons.length} moons</span><button class="catalog-focus" data-focus="${body.id}">FOCUS ↗</button></div></article>`).join('');
}

function renderEvents() {
  const target = $('event-list');
  if (!target) return;
  target.innerHTML = (data.events || []).map(event => `<div class="event-row"><time>${event.date}</time><div><b>${event.title}</b><p>${event.copy}</p></div><button class="event-jump" data-offset="${event.offset}">JUMP →</button></div>`).join('');
}

function renderCompare() {
  const first = $('compare-a');
  const second = $('compare-b');
  if (!first || !second) return;
  first.innerHTML = second.innerHTML = planets.map(body => `<option value="${body.id}">${body.name}</option>`).join('');
  first.value = 'earth'; second.value = 'mars';
  const update = () => {
    const a = planets.find(body => body.id === first.value) || planets[0];
    const b = planets.find(body => body.id === second.value) || planets[1];
    if (!a || !b) return;
    [['a',a],['b',b]].forEach(([key,body]) => { $('compare-name-'+key).textContent = body.name; $('compare-radius-'+key).textContent = `${Number(body.radiusKm).toLocaleString()} km radius`; $('compare-orb-'+key).style.background = `radial-gradient(circle at 35% 30%,${body.color},#322528 70%)`; });
    const maxRadius = Math.max(a.radiusKm,b.radiusKm), maxMass = Math.max(a.massEarth,b.massEarth);
    $('bar-radius-a').style.width = `${a.radiusKm / maxRadius * 100}%`; $('bar-radius-b').style.width = `${b.radiusKm / maxRadius * 100}%`;
    $('bar-mass-a').style.width = `${a.massEarth / maxMass * 100}%`; $('bar-mass-b').style.width = `${b.massEarth / maxMass * 100}%`;
  };
  first.onchange = second.onchange = update;
  update();
}

function sprite(text) {
  const surface = document.createElement('canvas');
  const context = surface.getContext('2d');
  context.font = '600 40px ui-monospace, monospace';
  surface.width = context.measureText(text).width + 24;
  surface.height = 60;
  context.font = '600 40px ui-monospace, monospace';
  context.fillStyle = '#cfe9e6';
  context.fillText(text, 12, 42);
  const label = new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(surface),transparent:true,depthTest:false}));
  label.scale.set(surface.width / 64 * .35, .35, 1);
  return label;
}

function orbitLine(body) {
  const curve = new THREE.EllipseCurve(-body.a * body.e, 0, body.a, body.a * Math.sqrt(1 - body.e * body.e), 0, Math.PI * 2);
  const points = curve.getPoints(256).map(point => new THREE.Vector3(point.x, 0, point.y));
  return new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({color:0x315d63,transparent:true,opacity:.55}));
}

function radius(body) {
  return state.realistic ? THREE.MathUtils.clamp(body.radiusKm / 69911 * .48, .02, .52) : (body.id === 'jupiter' ? .34 : body.id === 'saturn' ? .29 : body.id === 'uranus' || body.id === 'neptune' ? .22 : .09);
}

function position(body, days, output) {
  const angle = body.phase + days / body.period * Math.PI * 2;
  const semiMinor = body.a * Math.sqrt(1 - body.e * body.e);
  return output.set(body.a * Math.cos(angle) - body.a * body.e, 0, semiMinor * Math.sin(angle));
}

function buildBelts() {
  const make = (count,min,max,color,key) => {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    for (let index=0; index<count; index++) { const r=min+Math.random()*(max-min), angle=Math.random()*Math.PI*2; positions[index*3]=r*Math.cos(angle); positions[index*3+1]=(Math.random()-.5)*.18; positions[index*3+2]=r*Math.sin(angle); }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions,3));
    const points = new THREE.Points(geometry,new THREE.PointsMaterial({color,size:key==='kuiper'?.07:.045,transparent:true,opacity:.55}));
    points.userData.key = key;
    scene.add(points);
  };
  make(2200,2.1,3.2,0xb08761,'asteroids');
  make(1400,35,43,0x708db0,'kuiper');
}

function resize() {
  if (!renderer || !host) return;
  const width = host.clientWidth, height = host.clientHeight;
  if (width < 2 || height < 2) return;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width,height,false);
}

function setMode(next) {
  mode = next;
  document.querySelectorAll('.tool').forEach(button => button.classList.toggle('active', button.id === `mode-${next}`));
  if (next === 'orbit') focus = null;
  if (next === 'cinematic' && planets.length) focus = meshes.get(planets[(state.selected + 1) % planets.length].id) || null;
}

function pick(event) {
  const rect = canvas.getBoundingClientRect();
  const point = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(point,camera);
  const hit = ray.intersectObjects([...meshes.values()],false)[0];
  if (hit) select(planets.findIndex(body => body.id === hit.object.userData.id));
}

function animate() {
  requestAnimationFrame(animate);
  try {
    const delta = Math.min(clock.getDelta(), .1);
    if (!state.paused) simDays += delta * state.speed;
    planets.forEach(body => { const mesh=meshes.get(body.id); position(body,simDays,mesh.position); const label=labels[body.index]; label.position.copy(mesh.position); label.position.y += radius(body) + .2; label.visible=state.labels; trails[body.index].visible=state.trails; });
    satelliteMeshes.forEach(({mesh,body,phase}) => { const parent=meshes.get(body.parent); if (!parent) return; parent.getWorldPosition(tmp); const angle=phase+simDays/body.period*Math.PI*2; mesh.position.set(tmp.x+body.a*Math.cos(angle),tmp.y,tmp.z+body.a*Math.sin(angle)); });
    scene.traverse(object => { if (object.userData.key) object.visible = Boolean(state[object.userData.key]); });
    if (mode === 'cinematic') scene.rotation.y += delta * .018;
    if (focus) { focus.getWorldPosition(tmp); controls.target.lerp(tmp,.1); if (mode === 'follow') camera.position.lerp(tmp.clone().add(new THREE.Vector3(2,1,2)),.08); }
    controls.update();
    const date = new Date(baseDate + simDays * 86400000);
    const label = date.toISOString().slice(0,10).toUpperCase();
    $('sim-date').textContent = label; $('timeline-label').textContent = `${label} · 14:32 UTC`; $('deck-date').textContent = label; $('readout-zoom').textContent = `${(15 / Math.max(camera.position.distanceTo(controls.target),.01)).toFixed(1)}×`; $('readout-speed').textContent = `${state.speed} d/s`;
    if (host.clientWidth > 1) renderer.render(scene,camera);
  } catch (error) { showInitError(error); }
}

function init3D() {
  try {
    if (!canvas) throw new Error('Canvas #space not found');
    if (!window.WebGLRenderingContext) throw new Error('WebGLRenderingContext is unavailable');
    renderer = new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45,1,.01,500);
    camera.position.set(0,8,15);
    controls = new OrbitControls(camera,canvas);
    controls.enableDamping = true; controls.dampingFactor = .06; controls.minDistance = 1; controls.maxDistance = 100;
    clock = new THREE.Clock();
    scene.add(new THREE.AmbientLight(0x6b8d8d,.3));
    scene.add(new THREE.PointLight(0xffbf7a,3,0,0));
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(.5,48,24),new THREE.MeshBasicMaterial({color:0xffb55f})));
    const starGeometry = new THREE.BufferGeometry(), starPositions = new Float32Array(8500*3);
    for (let index=0; index<starPositions.length; index++) starPositions[index]=(Math.random()-.5)*220;
    starGeometry.setAttribute('position',new THREE.BufferAttribute(starPositions,3));
    scene.add(new THREE.Points(starGeometry,new THREE.PointsMaterial({color:0xbdd9d7,size:.075})));
    planets.forEach(body => { const pivot=new THREE.Group(); pivot.rotation.x=THREE.MathUtils.degToRad(body.i); scene.add(pivot); const line=orbitLine(body); pivot.add(line); trails.push(line); const mesh=new THREE.Mesh(new THREE.SphereGeometry(1,48,24),new THREE.MeshStandardMaterial({color:body.color,roughness:.78})); mesh.scale.setScalar(radius(body)); mesh.userData.id=body.id; pivot.add(mesh); meshes.set(body.id,mesh); const label=sprite(body.name); pivot.add(label); labels.push(label); if(body.id==='saturn'){const ring=new THREE.Mesh(new THREE.RingGeometry(.42,.78,96),new THREE.MeshBasicMaterial({color:0xb8a47b,side:THREE.DoubleSide,transparent:true,opacity:.68})); ring.rotation.x=Math.PI/2+THREE.MathUtils.degToRad(26.7); mesh.add(ring);} });
    satellites.forEach((body,index) => { const mesh=new THREE.Mesh(new THREE.SphereGeometry(body.radius,16,10),new THREE.MeshStandardMaterial({color:body.color,roughness:1})); scene.add(mesh); satelliteMeshes.push({mesh,body,phase:index}); });
    buildBelts();
    new ResizeObserver(resize).observe(host); resize();
    let down = {x:0,y:0};
    canvas.addEventListener('pointerdown',event => { down={x:event.clientX,y:event.clientY}; });
    canvas.addEventListener('pointerup',event => { if (Math.hypot(event.clientX-down.x,event.clientY-down.y) <= 6) pick(event); });
    animate();
  } catch (error) { showInitError(error); }
}

function bind() {
  document.querySelectorAll('.rail-btn').forEach(button => button.onclick = () => { document.querySelectorAll('.page').forEach(page => page.classList.toggle('active',page.dataset.page===button.dataset.view)); document.querySelectorAll('.rail-btn').forEach(item => item.classList.toggle('active',item===button)); if(button.dataset.view==='system') requestAnimationFrame(resize); });
  document.querySelectorAll('[data-setting]').forEach(input => { input.checked=Boolean(state[input.dataset.setting]); input.onchange=()=>{state[input.dataset.setting]=input.checked;save();}; });
  document.querySelectorAll('.tool').forEach(button => button.onclick=()=>setMode(button.id.replace('mode-','')));
  $('compare-btn').onclick=()=>$('compare-dialog').showModal(); $('close-compare').onclick=()=>$('compare-dialog').close();
  $('tour-btn').onclick=()=>tour(true); $('observe-tour').onclick=()=>tour(true); $('tour-close').onclick=()=>tour(false); $('tour-skip').onclick=()=>tour(false); $('tour-next').onclick=()=>{tourIndex=(tourIndex+1)%data.tour.length;tour(true);};
  $('clear-selection').onclick=()=>{focus=null;setMode('orbit');}; $('reset-settings').onclick=()=>{localStorage.removeItem('orrery-v3');location.reload();};
  $('catalog-grid').onclick=event=>{const button=event.target.closest('[data-focus]');if(!button)return;select(planets.findIndex(body=>body.id===button.dataset.focus));document.querySelector('.rail-btn[data-view="system"]').click();};
  document.querySelectorAll('[data-event]').forEach(button=>button.onclick=()=>{const event=data.events.find(item=>item.title.toLowerCase().includes(button.dataset.event.split('-')[0]));if(event){$('timeline').value=event.offset;simDays=Number(event.offset);}});
  document.querySelectorAll('.event-jump').forEach(button=>button.onclick=()=>{simDays=Number(button.dataset.offset);$('timeline').value=button.dataset.offset;});
  $('today-btn').onclick=()=>{simDays=0;$('timeline').value=0;}; $('timeline').oninput=event=>{simDays=Number(event.target.value);};
  document.addEventListener('keydown',event=>{if(event.code==='Space'){event.preventDefault();state.paused=!state.paused;save();} if(event.key.toLowerCase()==='r')$('today-btn').click(); if(/^[1-8]$/.test(event.key))select(Number(event.key)-1);});
}

function tour(show) {
  $('tour-overlay').hidden = !show;
  if (!show || !data.tour[tourIndex]) return;
  const stop=data.tour[tourIndex]; $('tour-step').textContent=String(tourIndex+1).padStart(2,'0'); $('tour-title').textContent=stop.title; $('tour-description').textContent=stop.copy;
  if (meshes.has(stop.body)) { focus=meshes.get(stop.body); setMode('follow'); }
}

async function boot() {
  try {
    await loadData();
    renderCatalog(); renderEvents(); renderCompare(); select(Math.min(Number(state.selected)||0,planets.length-1),false); bind(); init3D();
  } catch (error) { showInitError(error); }
}

boot();
