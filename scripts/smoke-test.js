const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function read(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

function ensureFileExists(file) {
  assert(fs.existsSync(path.join(__dirname, '..', file)), `${file} should exist`);
}

function run() {
  ensureFileExists('index.html');
  ensureFileExists('main.js');
  ensureFileExists('style.css');

  const index = read('index.html');
  assert(index.includes('Gravity Simulation 3D'), 'index.html should show the HUD title');
  assert(index.includes('script type="module" src="./main.js"'), 'index.html should load main.js as module');
  assert(index.includes('importmap'), 'index.html should include an import map for three.js');

  const main = read('main.js');
  assert(main.includes("import * as THREE"), 'main.js should import three.js');
  assert(main.includes('new THREE.WebGLRenderer'), 'main.js should set up the renderer');
  assert(main.includes('OrbitControls'), 'main.js should include orbit controls');

  const style = read('style.css');
  assert(style.trim().length > 0, 'style.css should not be empty');

  console.log('Smoke test passed: core files exist and include expected content.');
}

run();
