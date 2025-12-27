const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(100, 80, 150);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const dir = new THREE.DirectionalLight(0xffffff, 1.5);
dir.position.set(50, 100, 50);
scene.add(dir);

const grid = new THREE.GridHelper(400, 40, 0x394056, 0x22283a);
grid.position.y = -20;
scene.add(grid);

// Parameters (mutable via UI)
const baseDistance = 35;
const radius = 3.5;
const repulsionStrength = 80;
const repulsionLength = radius * 4;
const minRepulsionDistance = radius * 1.5;
const boundaryRadius = baseDistance * 3;
const lineBaseColor = new THREE.Color(0x4aa3ff);
const lineMaxColor = new THREE.Color(0xff5555);

const simParams = {
  bondKXY: 10,
  jahnTellerDelta: 0.25,
  damping: 0.04,
  nodeMass: 12
};
class Node {
  constructor(index, { pos, color, fixed = false, showVisual = true }) {
    this.index = index;
    this.pos = pos.clone();
    this.vel = new THREE.Vector3();
    this.acc = new THREE.Vector3();
    this.mass = simParams.nodeMass;
    this.radius = radius;
    this.baseColor = new THREE.Color(color);
    this.adjacency = [];
    this.fixed = fixed;
    this.showVisual = showVisual;
    const geometry = new THREE.SphereGeometry(1, 32, 32);
    const material = new THREE.MeshStandardMaterial({ color: this.baseColor, metalness: 0.1, roughness: 0.4 });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.scale.setScalar(this.radius);
    this.mesh.visible = this.showVisual;
    this.mesh.position.copy(this.pos);
    scene.add(this.mesh);
    const dirVec = this.vel.clone().normalize();
    const length = Math.max(this.vel.length() * 0.5, 0.1);
    this.arrow = new THREE.ArrowHelper(dirVec, this.pos.clone(), length, 0xffff00);
    this.arrow.visible = false;
    scene.add(this.arrow);
    this.trailPoints = [];
    this.trailLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x9aa4c2, transparent: true, opacity: 0.6 })
    );
    this.trailLine.visible = this.showVisual;
    scene.add(this.trailLine);
  }
  resetForces() {
    this.acc.set(0, 0, 0);
    this.currentStrain = 0;
  }
  addBond(targetIndex, restLength, stiffness) {
    this.adjacency.push({ targetIndex, restLength, stiffness });
  }
  applyForce(force) {
     if (this.fixed) return;
    this.acc.addScaledVector(force, 1 / this.mass);
  }
  integrate(dt) {
    if (this.fixed) return;
    this.vel.addScaledVector(this.acc, dt);
    this.vel.multiplyScalar(1 - simParams.damping * dt);
    this.pos.addScaledVector(this.vel, dt);
@@ -105,99 +106,105 @@ class Node {
    } else {
      this.arrow.visible = false;
    }
    this.trailPoints.push(this.pos.clone());
    if (this.trailPoints.length > 600) this.trailPoints.shift();
    const positions = new Float32Array(this.trailPoints.length * 3);
    for (let i = 0; i < this.trailPoints.length; i++) {
      positions[3 * i] = this.trailPoints[i].x;
      positions[3 * i + 1] = this.trailPoints[i].y;
      positions[3 * i + 2] = this.trailPoints[i].z;
    }
    this.trailLine.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.trailLine.geometry.computeBoundingSphere();
  }
  kineticEnergy() {
    return 0.5 * this.mass * this.vel.lengthSq();
  }
}
let nodes = [];
let bonds = [];
let bondLines;
let paused = false;
let showVel = false;
let showStress = true;
let bondedPairs = new Set();
let frameCounter = 0;
const analysisCapture = {
  enabled: false,
  interval: 30,
  maxFrames: 2000,
  data: []
};
function clearScene() {
  nodes.forEach((node) => {
    scene.remove(node.mesh, node.arrow, node.trailLine);
  });
  if (bondLines) scene.remove(bondLines);
  nodes = [];
  bonds = [];
  bondedPairs.clear();
}
function addBond(aIndex, bIndex, stiffness, role = 'xy') {
  const a = nodes[aIndex];
  const b = nodes[bIndex];
  const restLength = a.pos.distanceTo(b.pos);
  bonds.push({ aIndex, bIndex, restLength, stiffness, strain: 0, role });
  a.addBond(bIndex, restLength, stiffness);
  b.addBond(aIndex, restLength, stiffness);
  const key = `${Math.min(aIndex, bIndex)}-${Math.max(aIndex, bIndex)}`;
  bondedPairs.add(key);
}
function buildBondLines() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bonds.length * 2 * 3), 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(bonds.length * 2 * 3), 3));
  const material = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 });
  bondLines = new THREE.LineSegments(geometry, material);
  scene.add(bondLines);
}
function updateBondLines() {
  if (!bondLines) return;
  const positions = bondLines.geometry.getAttribute('position');
  const colors = bondLines.geometry.getAttribute('color');
  bonds.forEach((bond, i) => {
    const a = nodes[bond.aIndex].pos;
    const b = nodes[bond.bIndex].pos;
    positions.setXYZ(i * 2, a.x, a.y, a.z);
    positions.setXYZ(i * 2 + 1, b.x, b.y, b.z);
    const t = showStress ? THREE.MathUtils.clamp(Math.abs(bond.strain) * 5, 0, 1) : 0;
    const colorA = lineBaseColor.clone().lerp(lineMaxColor, t);
    const colorB = colorA;
    colors.setXYZ(i * 2, colorA.r, colorA.g, colorA.b);
    colors.setXYZ(i * 2 + 1, colorB.r, colorB.g, colorB.b);
  });
  positions.needsUpdate = true;
  colors.needsUpdate = true;
}
function reset() {
  clearScene();
  frameCounter = 0;
  const center = new Node(0, { pos: new THREE.Vector3(0, 0, 0), color: 0x4aa3ff });
  const xPlus = new Node(1, { pos: new THREE.Vector3(baseDistance, 0, 0), color: 0xffa500 });
  const xMinus = new Node(2, { pos: new THREE.Vector3(-baseDistance, 0, 0), color: 0xffa500 });
  const yPlus = new Node(3, { pos: new THREE.Vector3(0, baseDistance, 0), color: 0x8aff80 });
  const yMinus = new Node(4, { pos: new THREE.Vector3(0, -baseDistance, 0), color: 0x8aff80 });
  const zPlus = new Node(5, { pos: new THREE.Vector3(0, 0, baseDistance), color: 0xff7ad1 });
  const zMinus = new Node(6, { pos: new THREE.Vector3(0, 0, -baseDistance), color: 0xff7ad1 });
  nodes = [center, xPlus, xMinus, yPlus, yMinus, zPlus, zMinus];
  const kZMinus = simParams.bondKXY * (1 - simParams.jahnTellerDelta);
  const kZPlus = simParams.bondKXY * (1 + simParams.jahnTellerDelta);
  addBond(0, 1, simParams.bondKXY, 'xy');
  addBond(0, 2, simParams.bondKXY, 'xy');
  addBond(0, 3, simParams.bondKXY, 'xy');
  addBond(0, 4, simParams.bondKXY, 'xy');
  addBond(0, 5, kZPlus, 'z+');
  addBond(0, 6, kZMinus, 'z-');
  buildBondLines();
  const boundaryPositions = [];
  [-boundaryRadius, 0, boundaryRadius].forEach((x) => {
    [-boundaryRadius, 0, boundaryRadius].forEach((y) => {
      [-boundaryRadius, 0, boundaryRadius].forEach((z) => {
        if (x === 0 && y === 0 && z === 0) return;
        boundaryPositions.push(new THREE.Vector3(x, y, z));
      });
    });
@@ -218,217 +225,321 @@ function applyBondForces() {
  bonds.forEach((bond) => {
    const a = nodes[bond.aIndex];
    const b = nodes[bond.bIndex];
    const delta = b.pos.clone().sub(a.pos);
    const dist = Math.max(delta.length(), 1e-5);
    const dir = delta.multiplyScalar(1 / dist);
    const extension = dist - bond.restLength;
    const forceMag = -bond.stiffness * extension;
    const relVel = b.vel.clone().sub(a.vel).dot(dir);
    const dampingForce = -relVel * 0.6;
    const force = dir.multiplyScalar(forceMag + dampingForce);
    a.applyForce(force);
    b.applyForce(force.clone().multiplyScalar(-1));
    bond.strain = extension / bond.restLength;
  });
}
function applyRepulsion() {
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const key = `${i}-${j}`;
      if (bondedPairs.has(key)) continue;
      const a = nodes[i];
      const b = nodes[j];
      const delta = b.pos.clone().sub(a.pos);
      const dist = Math.max(delta.length(), 1e-5);
      const dir = delta.multiplyScalar(1 / dist);
      if (dist >= repulsionLength) continue;
      if (dist < minRepulsionDistance) {
        const penetration = minRepulsionDistance - dist;
        const forceMag = repulsionStrength * (penetration / minRepulsionDistance);
        const force = dir.clone().multiplyScalar(forceMag);
        a.applyForce(force.clone().multiplyScalar(-1));
        b.applyForce(force);
        const relativeVel = b.vel.clone().sub(a.vel);
        const closingSpeed = relativeVel.dot(dir);
        if (closingSpeed < 0) {
          const impulse = dir.clone().multiplyScalar(closingSpeed * 0.6);
          if (!a.fixed) a.vel.add(impulse);
          if (!b.fixed) b.vel.add(impulse.clone().multiplyScalar(-1));
          if (!a.fixed) a.vel.multiplyScalar(0.85);
          if (!b.fixed) b.vel.multiplyScalar(0.85);
        }
        continue;
      }
      const strength = repulsionStrength * (1 - dist / repulsionLength);
      const force = dir.multiplyScalar(strength);
      a.applyForce(force.clone().multiplyScalar(-1));
      b.applyForce(force);
    }
  }
}
function integrate(dt) {
  nodes.forEach((node) => {
    node.resetForces();
  });
  applyBondForces();
  applyRepulsion();
  bonds.forEach((bond) => {
    nodes[bond.aIndex].currentStrain = Math.max(nodes[bond.aIndex].currentStrain || 0, Math.abs(bond.strain));
    nodes[bond.bIndex].currentStrain = Math.max(nodes[bond.bIndex].currentStrain || 0, Math.abs(bond.strain));
  });
  nodes.forEach((node) => node.integrate(dt));
  updateBondLines();
}

function applyParameterChanges() {
  nodes.forEach((node) => {
    node.mass = simParams.nodeMass;
  });

  bonds.forEach((bond) => {
    switch (bond.role) {
      case 'z+':
        bond.stiffness = simParams.bondKXY * (1 + simParams.jahnTellerDelta);
        break;
      case 'z-':
        bond.stiffness = simParams.bondKXY * (1 - simParams.jahnTellerDelta);
        break;
      default:
        bond.stiffness = simParams.bondKXY;
        break;
    }
  });
}
function energySummary() {
  const kinetic = nodes.reduce((sum, n) => sum + n.kineticEnergy(), 0);
  const elastic = bonds.reduce((sum, bond) => {
    return sum + 0.5 * bond.stiffness * Math.pow(bond.restLength * bond.strain, 2);
  }, 0);
  return { kinetic, elastic, total: kinetic + elastic };
}

function strainSummary() {
  if (bonds.length === 0) return { average: 0, max: 0 };
  let total = 0;
  let max = 0;
  bonds.forEach((bond) => {
    const absStrain = Math.abs(bond.strain);
    total += absStrain;
    if (absStrain > max) max = absStrain;
  });
  return { average: total / bonds.length, max };
}

function recordAnalysisFrame(frame) {
  if (!analysisCapture.enabled) return;
  const visibleNodes = nodes.filter((node) => node.showVisual);
  const snapshot = {
    frame,
    nodes: visibleNodes.map((node) => ({
      index: node.index,
      pos: { x: node.pos.x, y: node.pos.y, z: node.pos.z }
    })),
    bonds: bonds.map((bond) => {
      const a = nodes[bond.aIndex].pos;
      const b = nodes[bond.bIndex].pos;
      return {
        aIndex: bond.aIndex,
        bIndex: bond.bIndex,
        length: a.distanceTo(b),
        restLength: bond.restLength,
        strain: bond.strain
      };
    })
  };

  analysisCapture.data.push(snapshot);
  if (analysisCapture.data.length >= analysisCapture.maxFrames) {
    stopAndExportAnalysis();
  }
  updateAnalysisStatus();
}

function stopAndExportAnalysis() {
  if (analysisCapture.data.length > 0) {
    console.log(JSON.stringify(analysisCapture.data));
  }
  analysisCapture.enabled = false;
  analysisCapture.data = [];
  updateAnalysisStatus();
}

function updateAnalysisStatus() {
  const statusEl = document.getElementById('analysis-status');
  if (!statusEl) return;
  if (!analysisCapture.enabled) {
    statusEl.textContent = '離線紀錄：未啟動';
    return;
  }
  statusEl.textContent = `離線紀錄中：${analysisCapture.data.length} 筆（每 ${analysisCapture.interval} 幀）`;
}
reset();
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.03);
  if (!paused) {
    const steps = 4;
    for (let i = 0; i < steps; i++) {
      integrate(dt / steps);
    }
    frameCounter += 1;
    nodes.forEach((node) => node.updateVisuals(showVel, showStress));
    const energy = energySummary();
    const strain = strainSummary();
    const energyDiv = document.getElementById('energy');
    const strainDiv = document.getElementById('strain');
    if (energyDiv) {
      energyDiv.innerText = `Kinetic: ${energy.kinetic.toFixed(2)} | Spring: ${energy.elastic.toFixed(2)} | Total: ${energy.total.toFixed(2)}`;
    }
    if (strainDiv) {
      strainDiv.innerText = `Δr/r₀ 平均: ${strain.average.toFixed(4)} | 最大: ${strain.max.toFixed(4)}`;
    }
    if (analysisCapture.enabled && frameCounter % analysisCapture.interval === 0) {
      recordAnalysisFrame(frameCounter);
    }
  }
  controls.update();
  renderer.render(scene, camera);
}
animate();

function updateToggleLabels() {
  const stressBtn = document.getElementById('toggle-stress');
  const velBtn = document.getElementById('toggle-vel');
  if (stressBtn) {
    stressBtn.textContent = showStress ? '隱藏鍵色應力圖' : '顯示鍵色應力圖';
  }
  if (velBtn) {
    velBtn.textContent = showVel ? '隱藏節點速度箭頭' : '顯示節點速度箭頭';
  }
}

function bindInputPair(rangeEl, numberEl, key, formatter = (v) => v.toFixed(2)) {
  const updateBoth = (value) => {
    if (Number.isNaN(value)) return;
    simParams[key] = value;
    rangeEl.value = value;
    numberEl.value = value;
    const label = rangeEl.closest('.control-row')?.querySelector('.value');
    if (label) label.textContent = formatter(value);
    applyParameterChanges();
    nodes.forEach((node) => node.updateVisuals(showVel, showStress));
    updateBondLines();
  };

  rangeEl.addEventListener('input', (e) => updateBoth(parseFloat(e.target.value)));
  numberEl.addEventListener('change', (e) => updateBoth(parseFloat(e.target.value)));
}

function bindCaptureInterval(rangeEl, numberEl) {
  const updateBoth = (value) => {
    if (Number.isNaN(value)) return;
    const clamped = Math.max(1, Math.min(120, Math.round(value)));
    analysisCapture.interval = clamped;
    rangeEl.value = clamped;
    numberEl.value = clamped;
    const label = rangeEl.closest('.control-row')?.querySelector('.value');
    if (label) label.textContent = clamped.toString();
    updateAnalysisStatus();
  };

  rangeEl.addEventListener('input', (e) => updateBoth(parseFloat(e.target.value)));
  numberEl.addEventListener('change', (e) => updateBoth(parseFloat(e.target.value)));
}

function setupControls() {
  const deltaRange = document.getElementById('delta');
  const deltaInput = document.getElementById('deltaInput');
  const kxyRange = document.getElementById('kxy');
  const kxyInput = document.getElementById('kxyInput');
  const massRange = document.getElementById('mass');
  const massInput = document.getElementById('massInput');
  const dampingRange = document.getElementById('damping');
  const dampingInput = document.getElementById('dampingInput');
  const captureRange = document.getElementById('captureInterval');
  const captureInput = document.getElementById('captureIntervalInput');

  if (
    deltaRange &&
    deltaInput &&
    kxyRange &&
    kxyInput &&
    massRange &&
    massInput &&
    dampingRange &&
    dampingInput &&
    captureRange &&
    captureInput
  ) {
    bindInputPair(deltaRange, deltaInput, 'jahnTellerDelta');
    bindInputPair(kxyRange, kxyInput, 'bondKXY', (v) => v.toFixed(1));
    bindInputPair(massRange, massInput, 'nodeMass', (v) => v.toFixed(1));
    bindInputPair(dampingRange, dampingInput, 'damping', (v) => v.toFixed(3));
    bindCaptureInterval(captureRange, captureInput);
  }

  const resetBtn = document.getElementById('reset-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => reset());
  }

  const stressBtn = document.getElementById('toggle-stress');
  if (stressBtn) {
    stressBtn.addEventListener('click', () => {
      showStress = !showStress;
      nodes.forEach((node) => node.updateVisuals(showVel, showStress));
      updateBondLines();
      updateToggleLabels();
    });
  }

  const velBtn = document.getElementById('toggle-vel');
  if (velBtn) {
    velBtn.addEventListener('click', () => {
      showVel = !showVel;
      nodes.forEach((node) => node.updateVisuals(showVel, showStress));
      updateToggleLabels();
    });
  }

  const startCaptureBtn = document.getElementById('start-capture');
  if (startCaptureBtn) {
    startCaptureBtn.addEventListener('click', () => {
      analysisCapture.enabled = true;
      analysisCapture.data = [];
      updateAnalysisStatus();
    });
  }

  const stopCaptureBtn = document.getElementById('stop-capture');
  if (stopCaptureBtn) {
    stopCaptureBtn.addEventListener('click', () => stopAndExportAnalysis());
  }

  updateToggleLabels();
  updateAnalysisStatus();
}

setupControls();
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    paused = !paused;
  } else if (e.key.toLowerCase() === 'r') {
    reset();
  } else if (e.key.toLowerCase() === 'v') {
    showVel = !showVel;
    nodes.forEach((node) => node.updateVisuals(showVel, showStress));
    updateToggleLabels();
  } else if (e.key.toLowerCase() === 'c') {
    showStress = !showStress;
    nodes.forEach((node) => node.updateVisuals(showVel, showStress));
    updateBondLines();
    updateToggleLabels();
  }
});
