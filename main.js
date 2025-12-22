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

// Scaled gravitational constant for demonstration
const G = 18.0;

// Body class for physics and rendering
class Body {
  constructor({ mass, radius, color, pos, vel }) {
    this.mass = mass;
    this.radius = radius;
    this.color = color;
    this.pos = pos.clone();
    this.vel = vel.clone();
    // Sphere mesh
    const geometry = new THREE.SphereGeometry(1, 32, 32);
    const material = new THREE.MeshStandardMaterial({ color: this.color, metalness: 0.1, roughness: 0.4 });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.scale.setScalar(this.radius);
    this.mesh.position.copy(this.pos);
    scene.add(this.mesh);
    // Velocity arrow helper (hidden by default)
    const dirVec = this.vel.clone().normalize();
    const length = Math.max(this.vel.length() * 0.5, 0.1);
    this.arrow = new THREE.ArrowHelper(dirVec, this.pos.clone(), length, 0xffff00);
    this.arrow.visible = false;
    scene.add(this.arrow);
    // Trail for path
    this.trailPoints = [];
    this.trailLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x9aa4c2, transparent: true, opacity: 0.6 }));
    scene.add(this.trailLine);
  }
  // Update physics relative to another body
  updatePhysics(dt, other) {
    const rVec = this.pos.clone().sub(other.pos);
    const dist = Math.max(rVec.length(), 1e-5);
    const accel = rVec.clone().normalize().multiplyScalar(-G * other.mass / (dist * dist));
    this.vel.addScaledVector(accel, dt);
    this.pos.addScaledVector(this.vel, dt);
    this.mesh.position.copy(this.pos);
  }
  // Update visuals: arrow and trail
  updateVisuals() {
    if (this.arrow.visible) {
      const dirVec = this.vel.clone().normalize();
      const length = Math.max(this.vel.length() * 0.5, 0.1);
      this.arrow.setDirection(dirVec);
      this.arrow.setLength(length);
      this.arrow.position.copy(this.pos);
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

// Global state
let bodyA;
let bodyB;
let paused = false;
let showVel = false;

function reset() {
  if (bodyA) {
    scene.remove(bodyA.mesh, bodyA.arrow, bodyA.trailLine);
  }
  if (bodyB) {
    scene.remove(bodyB.mesh, bodyB.arrow, bodyB.trailLine);
  }
  bodyA = new Body({
    mass: 4000,
    radius: 8,
    color: 0x4aa3ff,
    pos: new THREE.Vector3(0, 0, 0),
    vel: new THREE.Vector3(0, 0, 0)
  });
  bodyB = new Body({
    mass: 20,
    radius: 3,
    color: 0xffa500,
    pos: new THREE.Vector3(60, 0, 0),
    vel: new THREE.Vector3(0, 0, Math.sqrt(G * bodyA.mass / 60))
  });
  paused = false;
  bodyA.arrow.visible = showVel;
  bodyB.arrow.visible = showVel;
}

function potentialEnergy(a, b) {
  const dist = a.pos.distanceTo(b.pos);
  return -G * a.mass * b.mass / dist;
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
      bodyB.updatePhysics(subdt, bodyA);
      // Uncomment below line if you wish bodyA to move due to bodyB
      // bodyA.updatePhysics(subdt, bodyB);
    }
    bodyA.updateVisuals();
    bodyB.updateVisuals();
    const ke = bodyB.kineticEnergy();
    const pe = potentialEnergy(bodyA, bodyB);
    const total = ke + pe;
    const energyDiv = document.getElementById('energy');
    if (energyDiv) {
      energyDiv.innerText = `Kinetic: ${ke.toFixed(2)} | Potential: ${pe.toFixed(2)} | Total: ${total.toFixed(2)}`;
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
    bodyA.arrow.visible = showVel;
    bodyB.arrow.visible = showVel;
  }
});