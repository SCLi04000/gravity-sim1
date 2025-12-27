import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x0b0f1a, 50, 500);

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
const lineBaseColor = new THREE.Color(0x4aa3ff);
const lineMaxColor = new THREE.Color(0xff5555);

const simParams = {
  bondKXY: 10,
  jahnTellerDelta: 0.25,
  damping: 0.04,
  nodeMass: 12
};
class Node {
  constructor(index, { pos, color }) {
    this.index = index;
    this.pos = pos.clone();
    this.vel = new THREE.Vector3();
    this.acc = new THREE.Vector3();
    this.mass = simParams.nodeMass;
    this.radius = radius;
    this.baseColor = new THREE.Color(color);
    this.adjacency = [];
    const geometry = new THREE.SphereGeometry(1, 32, 32);
    const material = new THREE.MeshStandardMaterial({ color: this.baseColor, metalness: 0.1, roughness: 0.4 });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.scale.setScalar(this.radius);
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
    this.acc.addScaledVector(force, 1 / this.mass);
  }
  integrate(dt) {
    this.vel.addScaledVector(this.acc, dt);
    this.vel.multiplyScalar(1 - simParams.damping * dt);
    this.pos.addScaledVector(this.vel, dt);
    this.mesh.position.copy(this.pos);
  }
  updateVisuals(showVel, showStress) {
    const stressColor = lineMaxColor;
    const factor = showStress ? THREE.MathUtils.clamp(this.currentStrain * 3, 0, 1) : 0;
    const blended = this.baseColor.clone().lerp(stressColor, factor);
    this.mesh.material.color.copy(blended);
    if (showVel) {
      const dirVec = this.vel.clone().normalize();
      const length = Math.max(this.vel.length() * 0.5 * (1 + factor), 0.1);
      this.arrow.visible = true;
      this.arrow.setDirection(dirVec);
      this.arrow.setLength(length);
      this.arrow.position.copy(this.pos);
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
  paused = false;
}
function applyBondForces() {
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
      if (dist >= repulsionLength) continue;
      const dir = delta.multiplyScalar(1 / dist);
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
    nodes.forEach((node) => node.updateVisuals(showVel, showStress));
    const energy = energySummary();
    const energyDiv = document.getElementById('energy');
    if (energyDiv) {
      energyDiv.innerText = `Kinetic: ${energy.kinetic.toFixed(2)} | Spring: ${energy.elastic.toFixed(2)} | Total: ${energy.total.toFixed(2)}`;
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

function setupControls() {
  const deltaRange = document.getElementById('delta');
  const deltaInput = document.getElementById('deltaInput');
  const kxyRange = document.getElementById('kxy');
  const kxyInput = document.getElementById('kxyInput');
  const massRange = document.getElementById('mass');
  const massInput = document.getElementById('massInput');
  const dampingRange = document.getElementById('damping');
  const dampingInput = document.getElementById('dampingInput');

  if (
    deltaRange &&
    deltaInput &&
    kxyRange &&
    kxyInput &&
    massRange &&
    massInput &&
    dampingRange &&
    dampingInput
  ) {
    bindInputPair(deltaRange, deltaInput, 'jahnTellerDelta');
    bindInputPair(kxyRange, kxyInput, 'bondKXY', (v) => v.toFixed(1));
    bindInputPair(massRange, massInput, 'nodeMass', (v) => v.toFixed(1));
    bindInputPair(dampingRange, dampingInput, 'damping', (v) => v.toFixed(3));
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

  updateToggleLabels();
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
