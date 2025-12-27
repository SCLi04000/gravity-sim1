import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Setup scene, camera, renderer
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

// Lighting
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const dir = new THREE.DirectionalLight(0xffffff, 1.5);
dir.position.set(50, 100, 50);
scene.add(dir);

// Ground grid
const grid = new THREE.GridHelper(400, 40, 0x394056, 0x22283a);
grid.position.y = -20;
scene.add(grid);

// Bond parameters
const bondStiffness = { kXY: 10, kZ: 20 };
const bondDamping = 0.01; // small damping for stability

// Repulsion parameters (simplified Lennard-Jones)
const epsilon = 200;
const sigma = 5;

class Node {
  constructor({ mass, radius, color, pos, vel }) {
    this.mass = mass;
    this.radius = radius;
    this.baseColor = new THREE.Color(color);
    this.pos = pos.clone();
    this.vel = vel.clone();
    this.adjacency = [];
    this.strainMetric = 0;

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

  addBond(target, restLength, stiffness) {
    this.adjacency.push({ target, restLength, stiffness, strain: 0 });
  }

  recordStrain(value) {
    this.strainMetric = Math.max(this.strainMetric, value);
  }

  updatePosition(dt) {
    this.pos.addScaledVector(this.vel, dt);
    this.mesh.position.copy(this.pos);
  }

  updateVisuals(showVel) {
    const stressColor = new THREE.Color(0xff5555);
    const factor = THREE.MathUtils.clamp(this.strainMetric * 4, 0, 1);
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
    if (this.trailPoints.length > 800) this.trailPoints.shift();
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
let paused = false;
let showVel = false;

function clearScene() {
  nodes.forEach((node) => {
    scene.remove(node.mesh, node.arrow, node.trailLine);
  });
  nodes = [];
  bonds = [];
}

function linkNodes(a, b) {
  const delta = b.pos.clone().sub(a.pos);
  const restLength = delta.length();
  const radial = Math.hypot(delta.x, delta.y);
  const stiffness = Math.abs(delta.z) > radial ? bondStiffness.kZ : bondStiffness.kXY;
  const bond = { a, b, restLength, stiffness, strain: 0 };
  bonds.push(bond);
  a.addBond(b, restLength, stiffness);
  b.addBond(a, restLength, stiffness);
}

function reset() {
  clearScene();

  const nodeA = new Node({
    mass: 40,
    radius: 6,
    color: 0x4aa3ff,
    pos: new THREE.Vector3(0, 0, 0),
    vel: new THREE.Vector3(0, 0, 0)
  });

  const nodeB = new Node({
    mass: 10,
    radius: 3.5,
    color: 0xffa500,
    pos: new THREE.Vector3(45, 0, 0),
    vel: new THREE.Vector3(0, 0, 1.5)
  });

  const nodeC = new Node({
    mass: 12,
    radius: 4,
    color: 0x8aff80,
    pos: new THREE.Vector3(0, 50, 0),
    vel: new THREE.Vector3(-1, 0, 0)
  });

  const nodeD = new Node({
    mass: 12,
    radius: 4,
    color: 0xff7ad1,
    pos: new THREE.Vector3(0, 0, 55),
    vel: new THREE.Vector3(0.5, 0.5, 0)
  });

  nodes = [nodeA, nodeB, nodeC, nodeD];

  linkNodes(nodeA, nodeB);
  linkNodes(nodeA, nodeC);
  linkNodes(nodeA, nodeD);
  linkNodes(nodeB, nodeC);
  linkNodes(nodeB, nodeD);
  linkNodes(nodeC, nodeD);

  paused = false;
}

function applyBondForces(dt) {
  nodes.forEach((n) => {
    n.strainMetric = 0;
  });

  bonds.forEach((bond) => {
    const delta = bond.b.pos.clone().sub(bond.a.pos);
    const dist = Math.max(delta.length(), 1e-5);
    const dir = delta.clone().multiplyScalar(1 / dist);
    const extension = dist - bond.restLength;
    const forceMag = -bond.stiffness * extension;
    const damping = delta.clone().normalize().dot(bond.b.vel.clone().sub(bond.a.vel)) * bondDamping;
    const force = dir.multiplyScalar(forceMag - damping);

    bond.a.vel.addScaledVector(force, dt / bond.a.mass);
    bond.b.vel.addScaledVector(force, -dt / bond.b.mass);

    const strainFraction = Math.abs(extension) / bond.restLength;
    bond.strain = strainFraction;
    bond.a.recordStrain(strainFraction);
    bond.b.recordStrain(strainFraction);
  });
}

function applyRepulsion(dt) {
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const delta = nodes[j].pos.clone().sub(nodes[i].pos);
      const dist = Math.max(delta.length(), 1e-4);
      const invR = 1 / dist;
      const sr = sigma * invR;
      const sr6 = Math.pow(sr, 6);
      const forceMag = 24 * epsilon * invR * sr6 * (2 * sr6 - 1);
      if (forceMag <= 0) continue;
      const dir = delta.multiplyScalar(1 / dist);
      const force = dir.multiplyScalar(forceMag);
      nodes[i].vel.addScaledVector(force, dt / nodes[i].mass);
      nodes[j].vel.addScaledVector(force, -dt / nodes[j].mass);
    }
  }
}

function updatePositions(dt) {
  nodes.forEach((node) => node.updatePosition(dt));
}

function springEnergy() {
  return bonds.reduce((sum, bond) => {
    const dist = bond.a.pos.distanceTo(bond.b.pos);
    const extension = dist - bond.restLength;
    return sum + 0.5 * bond.stiffness * extension * extension;
  }, 0);
}

function repulsionEnergy() {
  let energy = 0;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dist = Math.max(nodes[i].pos.distanceTo(nodes[j].pos), 1e-4);
      const sr = sigma / dist;
      const sr6 = Math.pow(sr, 6);
      const lj = 4 * epsilon * (sr6 * sr6 - sr6);
      energy += Math.max(lj, 0); // only count repulsive portion
    }
  }
  return energy;
}

reset();

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.03);
  if (!paused) {
    const substeps = 4;
    const subdt = dt / substeps;
    for (let i = 0; i < substeps; i++) {
      applyBondForces(subdt);
      applyRepulsion(subdt);
      updatePositions(subdt);
    }
    nodes.forEach((node) => node.updateVisuals(showVel));

    const kinetic = nodes.reduce((sum, node) => sum + node.kineticEnergy(), 0);
    const elastic = springEnergy();
    const repulse = repulsionEnergy();
    const total = kinetic + elastic + repulse;
    const energyDiv = document.getElementById('energy');
    if (energyDiv) {
      energyDiv.innerText = `Kinetic: ${kinetic.toFixed(2)} | Spring: ${elastic.toFixed(2)} | Repulsion: ${repulse.toFixed(2)} | Total: ${total.toFixed(2)}`;
    }
  }
  controls.update();
  renderer.render(scene, camera);
}

animate();

// Resize handler
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Keyboard shortcuts
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    paused = !paused;
  } else if (e.key.toLowerCase() === 'r') {
    reset();
  } else if (e.key.toLowerCase() === 'v') {
    showVel = !showVel;
    nodes.forEach((node) => node.arrow.visible = showVel);
  }
});
