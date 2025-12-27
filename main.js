diff --git a/main.js b/main.js
index f12f93cff8bb50614349d71e4f77531e8eb28d44..0b063df20021915dba2900943746a3ed3ecb3c81 100644
--- a/main.js
+++ b/main.js
@@ -5,175 +5,300 @@ import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
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
 
-// Scaled gravitational constant for demonstration
-const G = 18.0;
+// Bond parameters
+const bondStiffness = { kXY: 10, kZ: 20 };
+const bondDamping = 0.01; // small damping for stability
 
-// Body class for physics and rendering
-class Body {
+// Repulsion parameters (simplified Lennard-Jones)
+const epsilon = 200;
+const sigma = 5;
+
+class Node {
   constructor({ mass, radius, color, pos, vel }) {
     this.mass = mass;
     this.radius = radius;
-    this.color = color;
+    this.baseColor = new THREE.Color(color);
     this.pos = pos.clone();
     this.vel = vel.clone();
-    // Sphere mesh
+    this.adjacency = [];
+    this.strainMetric = 0;
+
     const geometry = new THREE.SphereGeometry(1, 32, 32);
-    const material = new THREE.MeshStandardMaterial({ color: this.color, metalness: 0.1, roughness: 0.4 });
+    const material = new THREE.MeshStandardMaterial({ color: this.baseColor, metalness: 0.1, roughness: 0.4 });
     this.mesh = new THREE.Mesh(geometry, material);
     this.mesh.scale.setScalar(this.radius);
     this.mesh.position.copy(this.pos);
     scene.add(this.mesh);
-    // Velocity arrow helper (hidden by default)
+
     const dirVec = this.vel.clone().normalize();
     const length = Math.max(this.vel.length() * 0.5, 0.1);
     this.arrow = new THREE.ArrowHelper(dirVec, this.pos.clone(), length, 0xffff00);
     this.arrow.visible = false;
     scene.add(this.arrow);
-    // Trail for path
+
     this.trailPoints = [];
-    this.trailLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x9aa4c2, transparent: true, opacity: 0.6 }));
+    this.trailLine = new THREE.Line(
+      new THREE.BufferGeometry(),
+      new THREE.LineBasicMaterial({ color: 0x9aa4c2, transparent: true, opacity: 0.6 })
+    );
     scene.add(this.trailLine);
   }
-  // Update physics relative to another body
-  updatePhysics(dt, other) {
-    const rVec = this.pos.clone().sub(other.pos);
-    const dist = Math.max(rVec.length(), 1e-5);
-    const accel = rVec.clone().normalize().multiplyScalar(-G * other.mass / (dist * dist));
-    this.vel.addScaledVector(accel, dt);
+
+  addBond(target, restLength, stiffness) {
+    this.adjacency.push({ target, restLength, stiffness, strain: 0 });
+  }
+
+  recordStrain(value) {
+    this.strainMetric = Math.max(this.strainMetric, value);
+  }
+
+  updatePosition(dt) {
     this.pos.addScaledVector(this.vel, dt);
     this.mesh.position.copy(this.pos);
   }
-  // Update visuals: arrow and trail
-  updateVisuals() {
-    if (this.arrow.visible) {
+
+  updateVisuals(showVel) {
+    const stressColor = new THREE.Color(0xff5555);
+    const factor = THREE.MathUtils.clamp(this.strainMetric * 4, 0, 1);
+    const blended = this.baseColor.clone().lerp(stressColor, factor);
+    this.mesh.material.color.copy(blended);
+
+    if (showVel) {
       const dirVec = this.vel.clone().normalize();
-      const length = Math.max(this.vel.length() * 0.5, 0.1);
+      const length = Math.max(this.vel.length() * 0.5 * (1 + factor), 0.1);
+      this.arrow.visible = true;
       this.arrow.setDirection(dirVec);
       this.arrow.setLength(length);
       this.arrow.position.copy(this.pos);
+    } else {
+      this.arrow.visible = false;
     }
+
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
+
   kineticEnergy() {
     return 0.5 * this.mass * this.vel.lengthSq();
   }
 }
 
-// Global state
-let bodyA;
-let bodyB;
+let nodes = [];
+let bonds = [];
 let paused = false;
 let showVel = false;
 
+function clearScene() {
+  nodes.forEach((node) => {
+    scene.remove(node.mesh, node.arrow, node.trailLine);
+  });
+  nodes = [];
+  bonds = [];
+}
+
+function linkNodes(a, b) {
+  const delta = b.pos.clone().sub(a.pos);
+  const restLength = delta.length();
+  const radial = Math.hypot(delta.x, delta.y);
+  const stiffness = Math.abs(delta.z) > radial ? bondStiffness.kZ : bondStiffness.kXY;
+  const bond = { a, b, restLength, stiffness, strain: 0 };
+  bonds.push(bond);
+  a.addBond(b, restLength, stiffness);
+  b.addBond(a, restLength, stiffness);
+}
+
 function reset() {
-  if (bodyA) {
-    scene.remove(bodyA.mesh, bodyA.arrow, bodyA.trailLine);
-  }
-  if (bodyB) {
-    scene.remove(bodyB.mesh, bodyB.arrow, bodyB.trailLine);
-  }
-  bodyA = new Body({
-    mass: 4000,
-    radius: 8,
+  clearScene();
+
+  const nodeA = new Node({
+    mass: 40,
+    radius: 6,
     color: 0x4aa3ff,
     pos: new THREE.Vector3(0, 0, 0),
     vel: new THREE.Vector3(0, 0, 0)
   });
-  bodyB = new Body({
-    mass: 20,
-    radius: 3,
+
+  const nodeB = new Node({
+    mass: 10,
+    radius: 3.5,
     color: 0xffa500,
-    pos: new THREE.Vector3(60, 0, 0),
-    vel: new THREE.Vector3(0, 0, Math.sqrt(G * bodyA.mass / 60))
+    pos: new THREE.Vector3(45, 0, 0),
+    vel: new THREE.Vector3(0, 0, 1.5)
+  });
+
+  const nodeC = new Node({
+    mass: 12,
+    radius: 4,
+    color: 0x8aff80,
+    pos: new THREE.Vector3(0, 50, 0),
+    vel: new THREE.Vector3(-1, 0, 0)
   });
+
+  const nodeD = new Node({
+    mass: 12,
+    radius: 4,
+    color: 0xff7ad1,
+    pos: new THREE.Vector3(0, 0, 55),
+    vel: new THREE.Vector3(0.5, 0.5, 0)
+  });
+
+  nodes = [nodeA, nodeB, nodeC, nodeD];
+
+  linkNodes(nodeA, nodeB);
+  linkNodes(nodeA, nodeC);
+  linkNodes(nodeA, nodeD);
+  linkNodes(nodeB, nodeC);
+  linkNodes(nodeB, nodeD);
+  linkNodes(nodeC, nodeD);
+
   paused = false;
-  bodyA.arrow.visible = showVel;
-  bodyB.arrow.visible = showVel;
 }
 
-function potentialEnergy(a, b) {
-  const dist = a.pos.distanceTo(b.pos);
-  return -G * a.mass * b.mass / dist;
+function applyBondForces(dt) {
+  nodes.forEach((n) => {
+    n.strainMetric = 0;
+  });
+
+  bonds.forEach((bond) => {
+    const delta = bond.b.pos.clone().sub(bond.a.pos);
+    const dist = Math.max(delta.length(), 1e-5);
+    const dir = delta.clone().multiplyScalar(1 / dist);
+    const extension = dist - bond.restLength;
+    const forceMag = -bond.stiffness * extension;
+    const damping = delta.clone().normalize().dot(bond.b.vel.clone().sub(bond.a.vel)) * bondDamping;
+    const force = dir.multiplyScalar(forceMag - damping);
+
+    bond.a.vel.addScaledVector(force, dt / bond.a.mass);
+    bond.b.vel.addScaledVector(force, -dt / bond.b.mass);
+
+    const strainFraction = Math.abs(extension) / bond.restLength;
+    bond.strain = strainFraction;
+    bond.a.recordStrain(strainFraction);
+    bond.b.recordStrain(strainFraction);
+  });
+}
+
+function applyRepulsion(dt) {
+  for (let i = 0; i < nodes.length; i++) {
+    for (let j = i + 1; j < nodes.length; j++) {
+      const delta = nodes[j].pos.clone().sub(nodes[i].pos);
+      const dist = Math.max(delta.length(), 1e-4);
+      const invR = 1 / dist;
+      const sr = sigma * invR;
+      const sr6 = Math.pow(sr, 6);
+      const forceMag = 24 * epsilon * invR * sr6 * (2 * sr6 - 1);
+      if (forceMag <= 0) continue;
+      const dir = delta.multiplyScalar(1 / dist);
+      const force = dir.multiplyScalar(forceMag);
+      nodes[i].vel.addScaledVector(force, dt / nodes[i].mass);
+      nodes[j].vel.addScaledVector(force, -dt / nodes[j].mass);
+    }
+  }
+}
+
+function updatePositions(dt) {
+  nodes.forEach((node) => node.updatePosition(dt));
+}
+
+function springEnergy() {
+  return bonds.reduce((sum, bond) => {
+    const dist = bond.a.pos.distanceTo(bond.b.pos);
+    const extension = dist - bond.restLength;
+    return sum + 0.5 * bond.stiffness * extension * extension;
+  }, 0);
+}
+
+function repulsionEnergy() {
+  let energy = 0;
+  for (let i = 0; i < nodes.length; i++) {
+    for (let j = i + 1; j < nodes.length; j++) {
+      const dist = Math.max(nodes[i].pos.distanceTo(nodes[j].pos), 1e-4);
+      const sr = sigma / dist;
+      const sr6 = Math.pow(sr, 6);
+      const lj = 4 * epsilon * (sr6 * sr6 - sr6);
+      energy += Math.max(lj, 0); // only count repulsive portion
+    }
+  }
+  return energy;
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
-      bodyB.updatePhysics(subdt, bodyA);
-      // Uncomment below line if you wish bodyA to move due to bodyB
-      // bodyA.updatePhysics(subdt, bodyB);
+      applyBondForces(subdt);
+      applyRepulsion(subdt);
+      updatePositions(subdt);
     }
-    bodyA.updateVisuals();
-    bodyB.updateVisuals();
-    const ke = bodyB.kineticEnergy();
-    const pe = potentialEnergy(bodyA, bodyB);
-    const total = ke + pe;
+    nodes.forEach((node) => node.updateVisuals(showVel));
+
+    const kinetic = nodes.reduce((sum, node) => sum + node.kineticEnergy(), 0);
+    const elastic = springEnergy();
+    const repulse = repulsionEnergy();
+    const total = kinetic + elastic + repulse;
     const energyDiv = document.getElementById('energy');
     if (energyDiv) {
-      energyDiv.innerText = `Kinetic: ${ke.toFixed(2)} | Potential: ${pe.toFixed(2)} | Total: ${total.toFixed(2)}`;
+      energyDiv.innerText = `Kinetic: ${kinetic.toFixed(2)} | Spring: ${elastic.toFixed(2)} | Repulsion: ${repulse.toFixed(2)} | Total: ${total.toFixed(2)}`;
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
-    bodyA.arrow.visible = showVel;
-    bodyB.arrow.visible = showVel;
+    nodes.forEach((node) => node.arrow.visible = showVel);
   }
-});
\ No newline at end of file
+});
