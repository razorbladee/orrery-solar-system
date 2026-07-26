/* ============================================================
 * ORRERY — интерактивная модель Солнечной системы (Three.js r160)
 *
 * Структура файла:
 *   1. Данные и константы
 *   2. Состояние (localStorage)
 *   3. DOM-утилиты
 *   4. Роутер
 *   5. Рендер панели и каталога
 *   6. 3D-сцена
 *   7. Обработчики UI
 *   8. Загрузка
 * ============================================================ */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ------------------------------------------------------------
 * 1. Данные и константы
 * ---------------------------------------------------------- */

/** a — большая полуось (а.е.), e — эксцентриситет, inc — наклон (°), period — период (сут). */
const PLANETS = [
  { name: 'Mercury', color: '#aaa49d', a: 0.39,  e: 0.206, inc: 7.00, period: 87.97,    type: 'terrestrial planet', diameter: 4879,   moons: 0,   size: 4  },
  { name: 'Venus',   color: '#e5ad68', a: 0.72,  e: 0.007, inc: 3.40, period: 224.70,   type: 'terrestrial planet', diameter: 12104,  moons: 0,   size: 6  },
  { name: 'Earth',   color: '#4eafd1', a: 1.00,  e: 0.017, inc: 0.00, period: 365.25,   type: 'terrestrial planet', diameter: 12742,  moons: 1,   size: 7  },
  { name: 'Mars',    color: '#d87858', a: 1.52,  e: 0.093, inc: 1.85, period: 686.98,   type: 'terrestrial planet', diameter: 6779,   moons: 2,   size: 6  },
  { name: 'Jupiter', color: '#d3ae8a', a: 5.20,  e: 0.049, inc: 1.30, period: 4332.60,  type: 'gas giant',          diameter: 139820, moons: 95,  size: 14 },
  { name: 'Saturn',  color: '#d8c18f', a: 9.54,  e: 0.057, inc: 2.50, period: 10759.00, type: 'gas giant',          diameter: 116460, moons: 146, size: 12 },
  { name: 'Uranus',  color: '#9bd6d8', a: 19.19, e: 0.046, inc: 0.77, period: 30687.00, type: 'ice giant',          diameter: 50724,  moons: 28,  size: 10 },
  { name: 'Neptune', color: '#647ed5', a: 30.06, e: 0.010, inc: 1.77, period: 60190.00, type: 'ice giant',          diameter: 49244,  moons: 16,  size: 10 }
].map((body, index) => ({
  ...body,
  i: index,
  // Стартовые фазы разводим по золотому углу, иначе планеты выстраиваются в линию.
  phase: THREE.MathUtils.degToRad(index * 137.5)
}));

/** Скорости времени: сколько модельных суток проходит за секунду реального времени. */
const TIME_SCALES = [
  { daysPerSecond: 0.5, label: '0.5 d / s' },
  { daysPerSecond: 2,   label: '2 d / s'   },
  { daysPerSecond: 10,  label: '10 d / s'  },
  { daysPerSecond: 60,  label: '60 d / s'  },
  { daysPerSecond: 365, label: '365 d / s' }
];

const STORAGE_KEY = 'orrery-state';
const MS_PER_DAY = 86400000;
const BASE_CAMERA_DISTANCE = 15;

const DEFAULT_STATE = {
  selected: 3,
  paused: false,
  trails: true,
  labels: true,
  rotate: false,
  realistic: false,
  speed: 2,
  date: '2026-07-26'
};

/* ------------------------------------------------------------
 * 2. Состояние
 * ---------------------------------------------------------- */

/**
 * Читает состояние из localStorage и валидирует его.
 * Битые данные раньше роняли всё приложение — теперь просто откатываемся к дефолту.
 */
function loadState() {
  let stored = {};

  try {
    stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {};
  } catch {
    stored = {};
  }

  const next = { ...DEFAULT_STATE, ...stored };

  if (!Number.isInteger(next.selected) || next.selected < 0 || next.selected >= PLANETS.length) {
    next.selected = DEFAULT_STATE.selected;
  }
  if (!Number.isInteger(next.speed) || next.speed < 1 || next.speed > TIME_SCALES.length) {
    next.speed = DEFAULT_STATE.speed;
  }
  if (Number.isNaN(Date.parse(next.date + 'T00:00:00Z'))) {
    next.date = DEFAULT_STATE.date;
  }
  for (const key of ['paused', 'trails', 'labels', 'rotate', 'realistic']) {
    next[key] = Boolean(next[key]);
  }

  return next;
}

const state = loadState();

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* приватный режим — просто не сохраняем */
  }
}

/* ------------------------------------------------------------
 * 3. DOM-утилиты
 * ---------------------------------------------------------- */

const $ = (id) => document.getElementById(id);

const formatKm = (km) => km.toLocaleString('en-US') + ' km';
const formatMoons = (n) => n + (n === 1 ? ' body' : ' bodies');

let toastTimer = 0;

function toast(message) {
  const el = $('toast');
  if (!el) return;

  el.textContent = message;
  el.classList.add('show');

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1400);
}

/* ------------------------------------------------------------
 * 4. Роутер (hash-based)
 * ---------------------------------------------------------- */

const VIEWS = ['system', 'catalog', 'observe', 'settings'];

function currentView() {
  const view = location.hash.replace('#/', '');
  return VIEWS.includes(view) ? view : 'system';
}

function route() {
  const view = currentView();

  document.querySelectorAll('.page').forEach((page) => {
    page.classList.toggle('is-active', page.dataset.view === view);
  });
  document.querySelectorAll('.nav').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.page === view);
  });

  $('route').textContent = '#/' + view;
  $('observeBody').textContent = PLANETS[state.selected].name;
  $('observeState').textContent = state.paused ? 'PAUSED' : 'RUNNING';

  if (view === 'catalog') renderCatalog();
  // Сцена скрыта через display:none, её размеры равны нулю — пересчитываем при возврате.
  if (view === 'system') requestAnimationFrame(resizeRenderer);
}

/* ------------------------------------------------------------
 * 5. Рендер панели и каталога
 * ---------------------------------------------------------- */

function renderPlanetList() {
  $('list').innerHTML = PLANETS.map((p) => `
    <button class="planet" type="button" data-i="${p.i}">
      <i class="dot" style="--c:${p.color}"></i>
      <span>${p.name}</span>
      <span class="code">${p.name.slice(0, 4).toUpperCase()}</span>
    </button>`).join('');

  highlightSelected();
}

function renderCatalog() {
  $('catalog').innerHTML = PLANETS.map((p) => `
    <div class="catalog-row">
      <i class="catalog-dot" style="--c:${p.color}"></i>
      <div>
        <b>${p.name}</b>
        <small>${p.type} · ${p.a.toFixed(2)} AU · ${p.period} days</small>
      </div>
      <button class="focus-btn" type="button" data-focus="${p.i}">Фокус</button>
    </div>`).join('');
}

function highlightSelected() {
  document.querySelectorAll('.planet').forEach((btn) => {
    btn.classList.toggle('is-selected', Number(btn.dataset.i) === state.selected);
  });
}

/** Обновляет карточку выбранного тела. */
function renderSelection() {
  const p = PLANETS[state.selected];

  $('selTitle').textContent = p.name;
  $('selName').textContent = p.name;
  $('selType').textContent = p.type;
  $('dist').textContent = p.a.toFixed(2) + ' AU';
  $('period').textContent = p.period + ' days';
  $('diam').textContent = formatKm(p.diameter);
  $('moons').textContent = formatMoons(p.moons);
  $('selOrb').style.background = `radial-gradient(circle at 35% 30%, ${p.color}, #553f39 68%)`;
  $('observeBody').textContent = p.name;

  highlightSelected();
}

function select(index, moveCamera = true) {
  state.selected = index;
  renderSelection();
  saveState();

  if (moveCamera) focusOnBody(index);
  toast('Фокус: ' + PLANETS[index].name);
}

/* ------------------------------------------------------------
 * 6. 3D-сцена
 * ---------------------------------------------------------- */

const canvas = $('space');
const host = $('host');

let renderer;
let scene;
let camera;
let controls;
let clock;
let running = false;

const meshes = [];  // сферы планет
const pivots = [];  // группы, задающие наклон орбиты
const trails = [];  // линии орбит
const labels = [];  // спрайты с подписями

let simDays = 0;              // сколько модельных суток прошло с базовой даты
let baseDateMs = 0;           // базовая дата в мс (UTC)
let focusTarget = null;       // на какое тело летит камера
let focusUntil = 0;
let lastReadoutAt = 0;

const tmpVec = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

/** Радиус тела в единицах сцены (1 = 1 а.е.). */
function bodyRadius(p) {
  return state.realistic
    ? THREE.MathUtils.clamp((p.diameter / 139820) * 0.55, 0.025, 0.6)
    : p.size / 30;
}

/** Позиция на эллипсе с Солнцем в фокусе. */
function orbitPosition(p, days, out) {
  const theta = p.phase + (days / p.period) * Math.PI * 2;
  const b = p.a * Math.sqrt(1 - p.e * p.e);
  return out.set(p.a * Math.cos(theta) - p.a * p.e, 0, b * Math.sin(theta));
}

function makeLabelSprite(text) {
  const canvasEl = document.createElement('canvas');
  const ctx = canvasEl.getContext('2d');
  const font = '600 44px ui-monospace, monospace';

  ctx.font = font;
  canvasEl.width = Math.ceil(ctx.measureText(text).width) + 24;
  canvasEl.height = 64;

  ctx.font = font;
  ctx.fillStyle = '#cfe9e6';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 12, 34);

  const texture = new THREE.CanvasTexture(canvasEl);
  texture.colorSpace = THREE.SRGBColorSpace;

  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false
  }));

  sprite.scale.set((canvasEl.width / 64) * 0.45, 0.45, 1);
  sprite.renderOrder = 2;
  return sprite;
}

function buildStarfield() {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(4500 * 3);

  for (let i = 0; i < positions.length; i++) {
    positions[i] = (Math.random() - 0.5) * 220;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  scene.add(new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xbfdad9, size: 0.09 })));
}

function buildSun() {
  scene.add(new THREE.Mesh(
    new THREE.SphereGeometry(0.45, 32, 20),
    new THREE.MeshBasicMaterial({ color: 0xffbc68 })
  ));

  // decay = 0: без затухания, иначе на 30 а.е. Нептун был бы полностью чёрным.
  scene.add(new THREE.PointLight(0xffc27a, 2.4, 0, 0));
  scene.add(new THREE.AmbientLight(0x293941, 0.35));
}

function buildPlanets() {
  const sphere = new THREE.SphereGeometry(1, 32, 20);

  PLANETS.forEach((p) => {
    const pivot = new THREE.Group();
    pivot.rotation.x = THREE.MathUtils.degToRad(p.inc);
    scene.add(pivot);
    pivots.push(pivot);

    // Орбита: эллипс, смещённый так, чтобы Солнце было в фокусе.
    const curve = new THREE.EllipseCurve(-p.a * p.e, 0, p.a, p.a * Math.sqrt(1 - p.e * p.e), 0, Math.PI * 2);
    const points = curve.getPoints(256).map((v) => new THREE.Vector3(v.x, 0, v.y));
    const trail = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: 0x31565d, transparent: true, opacity: 0.5 })
    );
    pivot.add(trail);
    trails.push(trail);

    const mesh = new THREE.Mesh(sphere, new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.78 }));
    mesh.scale.setScalar(bodyRadius(p));
    mesh.userData.index = p.i;
    pivot.add(mesh);
    meshes.push(mesh);

    const label = makeLabelSprite(p.name);
    pivot.add(label);
    labels.push(label);
  });

  applyBodyScale();
}

function applyBodyScale() {
  PLANETS.forEach((p) => meshes[p.i].scale.setScalar(bodyRadius(p)));
}

function resizeRenderer() {
  if (!renderer) return;

  const width = host.clientWidth;
  const height = host.clientHeight;

  // Пока страница скрыта, размеры нулевые — деление дало бы NaN в матрице камеры.
  if (width < 2 || height < 2) return;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

function focusOnBody(index) {
  if (!controls || !meshes[index]) return;
  focusTarget = meshes[index];
  focusUntil = performance.now() + 900;
}

function onPointerPick(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );

  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(meshes, false);
  if (hits.length) select(hits[0].object.userData.index);
}

function showError(error) {
  running = false;
  $('errorText').textContent = String((error && error.stack) || error);
  $('error').classList.add('show');
}

function updateReadouts(now) {
  if (now - lastReadoutAt < 200) return;
  lastReadoutAt = now;

  const date = new Date(baseDateMs + simDays * MS_PER_DAY);
  if (!Number.isNaN(date.getTime())) {
    state.date = date.toISOString().slice(0, 10);
    $('date').textContent = state.date;
  }

  const distance = camera.position.distanceTo(controls.target);
  $('zoom').textContent = (BASE_CAMERA_DISTANCE / Math.max(distance, 0.001)).toFixed(1) + '×';
  $('observeState').textContent = state.paused ? 'PAUSED' : 'RUNNING';
}

function animate() {
  if (!running) return;
  requestAnimationFrame(animate);

  try {
    // Ограничиваем dt: после возврата на вкладку иначе прилетает огромный скачок.
    const dt = Math.min(clock.getDelta(), 0.1);
    const now = performance.now();

    if (!state.paused) {
      simDays += dt * TIME_SCALES[state.speed - 1].daysPerSecond;
    }

    PLANETS.forEach((p) => {
      orbitPosition(p, simDays, meshes[p.i].position);
      labels[p.i].position.copy(meshes[p.i].position);
      labels[p.i].position.y += bodyRadius(p) + 0.28;
      labels[p.i].visible = state.labels;
      trails[p.i].visible = state.trails;
    });

    if (state.rotate) scene.rotation.y += dt * 0.035;

    if (focusTarget) {
      focusTarget.getWorldPosition(tmpVec);
      controls.target.lerp(tmpVec, 0.12);
      camera.position.lerp(tmpVec.clone().add(new THREE.Vector3(2, 1.4, 2)), 0.12);
      if (now >= focusUntil) focusTarget = null;
    }

    controls.update();
    updateReadouts(now);

    if (host.clientWidth > 1 && host.clientHeight > 1) {
      renderer.render(scene, camera);
    }
  } catch (error) {
    // Раньше исключение здесь повторялось каждый кадр и заваливало консоль.
    showError(error);
  }
}

function initScene() {
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, 1, 0.01, 800);
    camera.position.set(0, 8, BASE_CAMERA_DISTANCE);

    controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = 1;
    controls.maxDistance = 200;

    clock = new THREE.Clock();

    buildStarfield();
    buildSun();
    buildPlanets();

    baseDateMs = Date.parse(state.date + 'T00:00:00Z');
    simDays = 0;

    new ResizeObserver(resizeRenderer).observe(host);
    resizeRenderer();

    // Отличаем клик от вращения камеры.
    let downAt = { x: 0, y: 0 };
    canvas.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY }; });
    canvas.addEventListener('pointerup', (e) => {
      if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6) return;
      onPointerPick(e);
    });

    running = true;
    animate();
  } catch (error) {
    showError(error);
  }
}

/* ------------------------------------------------------------
 * 7. Обработчики UI
 * ---------------------------------------------------------- */

function bindUI() {
  // Навигация
  addEventListener('hashchange', route);
  document.addEventListener('click', (e) => {
    const navBtn = e.target.closest('[data-page]');
    if (navBtn) location.hash = '/' + navBtn.dataset.page;
  });

  // Выбор тела в списке и в каталоге (делегирование — списки перерисовываются)
  $('list').addEventListener('click', (e) => {
    const btn = e.target.closest('.planet');
    if (btn) select(Number(btn.dataset.i));
  });

  $('catalog').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-focus]');
    if (!btn) return;
    select(Number(btn.dataset.focus));
    location.hash = '/system';
  });

  // Переключатели
  document.querySelectorAll('[data-key]').forEach((btn) => {
    const key = btn.dataset.key;
    btn.classList.toggle('on', Boolean(state[key]));
    btn.setAttribute('aria-pressed', String(Boolean(state[key])));

    btn.addEventListener('click', () => {
      state[key] = !state[key];
      btn.classList.toggle('on', state[key]);
      btn.setAttribute('aria-pressed', String(state[key]));

      // Масштаб применяем сразу, а не только после перезагрузки.
      if (key === 'realistic' && meshes.length) applyBodyScale();

      saveState();
      toast(key + ': ' + (state[key] ? 'вкл' : 'выкл'));
    });
  });

  // Скорость времени
  const speed = $('speed');
  speed.max = String(TIME_SCALES.length);
  speed.value = String(state.speed);
  $('speedText').textContent = TIME_SCALES[state.speed - 1].label;

  speed.addEventListener('input', (e) => {
    state.speed = Number(e.target.value);
    $('speedText').textContent = TIME_SCALES[state.speed - 1].label;
    saveState();
  });

  // Пауза
  const pause = $('pause');
  const syncPause = () => { pause.textContent = state.paused ? '▶ Play' : 'Ⅱ Pause'; };
  syncPause();

  pause.addEventListener('click', () => {
    state.paused = !state.paused;
    syncPause();
    saveState();
    toast(state.paused ? 'Пауза' : 'Продолжено');
  });

  // Сброс
  const reset = () => {
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  };
  $('reset').addEventListener('click', reset);
  $('clear').addEventListener('click', reset);

  // Режим наблюдения
  $('observe').addEventListener('click', () => {
    state.rotate = true;
    const toggle = document.querySelector('[data-key="rotate"]');
    toggle.classList.add('on');
    toggle.setAttribute('aria-pressed', 'true');
    saveState();
    location.hash = '/system';
    toast('Режим наблюдения запущен');
  });

  // Сохраняем дату симуляции при уходе со страницы
  addEventListener('pagehide', saveState);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveState();
  });
}

/* ------------------------------------------------------------
 * 8. Загрузка
 * ---------------------------------------------------------- */

function boot() {
  renderPlanetList();
  renderCatalog();
  renderSelection();
  bindUI();
  route();
  initScene();
}

boot();
