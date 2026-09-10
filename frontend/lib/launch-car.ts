import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/** A disposable, click-only scene. All positions are CSS pixels around the live link. */
export function drive(link: HTMLAnchorElement, done: () => void, deadline = performance.now() + 950): () => void {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(240, 190);
  const canvas = renderer.domElement;
  canvas.className = 'lh-launch-car';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:fixed;left:0;top:0;width:240px;height:190px;pointer-events:none;z-index:1000;';
  // Cut the real button out of the overlay, so the car is visibly behind it.
  const layer = document.createElement('div');
  layer.className = 'lh-car-layer';
  layer.setAttribute('aria-hidden', 'true');
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:1000;overflow:hidden;';
  layer.append(canvas);
  document.body.append(layer);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 240 / 190, 0.1, 100);
  camera.position.set(0, 2.8, 7.6);
  camera.lookAt(0, 0.5, 0);
  scene.add(new THREE.HemisphereLight(0xfff8e7, 0x6d4d39, 3));
  const sun = new THREE.DirectionalLight(0xffffff, 4);
  sun.position.set(-3, 6, 5);
  scene.add(sun);
  const car = new THREE.Group();
  scene.add(car);
  const paint = new THREE.MeshStandardMaterial({ color: 0xec3522, roughness: 0.24, metalness: 0.16 });
  const cream = new THREE.MeshStandardMaterial({ color: 0xfff3d7, roughness: 0.5 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x263f47, roughness: 0.22, metalness: 0.35 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x232421, roughness: 0.9 });
  function box(w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material, radius = 0.12) {
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 8, radius), material);
    mesh.position.set(x, y, z);
    car.add(mesh);
    return mesh;
  }
  // A low, soft racing silhouette; the windshield is the face, not a separate head.
  box(2.9, 0.62, 1.42, 0, 0.56, 0, paint, 0.3);
  box(1.25, 0.25, 1.28, 0.65, 0.87, 0, paint, 0.12);
  function ellipsoid(x: number, y: number, z: number, sx: number, sy: number, sz: number, material: THREE.Material) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), material);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    car.add(mesh);
    return mesh;
  }
  ellipsoid(-0.3, 0.93, 0, 0.91, 0.62, 0.65, paint);
  // Curved dark side windows tucked into the red roof.
  for (const z of [-0.57, 0.57]) {
    ellipsoid(-0.37, 1.12, z, 0.52, 0.25, 0.055, glass);
    box(0.07, 0.39, 0.06, -0.4, 1.12, z * 1.06, paint, 0.025);
    ellipsoid(0.13, 0.97, z * 1.28, 0.17, 0.09, 0.1, paint);
  }
  const face = box(0.12, 0.48, 1.04, 0.39, 1.19, 0, cream, 0.055);
  face.rotation.z = 0.35;
  // Rear spoiler, sculpted fenders and tapered headlights.
  for (const z of [-0.49, 0.49]) box(0.1, 0.23, 0.09, -1.12, 0.98, z, paint, 0.04);
  box(0.37, 0.13, 1.56, -1.18, 1.11, 0, paint, 0.06);
  for (const x of [-0.92, 0.92]) for (const z of [-0.61, 0.61]) {
    ellipsoid(x, 0.64, z, 0.47, 0.35, 0.2, paint);
  }
  for (const z of [-0.46, 0.46]) {
    const lamp = box(0.055, 0.13, 0.32, 1.417, 0.73, z, cream, 0.025);
    lamp.rotation.x = z > 0 ? -0.16 : 0.16;
  }
  const wheels: THREE.Group[] = [];
  for (const x of [-0.92, 0.92]) for (const z of [-0.72, 0.72]) {
    const wheel = new THREE.Group();
    wheel.position.set(x, 0.32, z);
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.22, 40), rubber);
    tire.rotation.x = Math.PI / 2;
    wheel.add(tire);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.23, 16), cream);
    hub.rotation.x = Math.PI / 2;
    wheel.add(hub);
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.055, 0.24), paint);
    wheel.add(spoke);
    car.add(wheel);
    wheels.push(wheel);
  }
  const irisMaterial = new THREE.MeshStandardMaterial({ color: 0x39a1b9, roughness: 0.35 });
  const pupils: THREE.Mesh[] = [];
  for (const z of [-0.25, 0.25]) {
    ellipsoid(0.475, 1.18, z, 0.065, 0.19, 0.195, cream);
    ellipsoid(0.533, 1.17, z + 0.015, 0.04, 0.125, 0.115, irisMaterial);
    pupils.push(ellipsoid(0.57, 1.17, z + 0.025, 0.026, 0.084, 0.072, rubber));
    ellipsoid(0.595, 1.21, z + 0.048, 0.018, 0.032, 0.028, cream);
    const brow = box(0.11, 0.055, 0.4, 0.465, 1.4, z, paint, 0.025);
    brow.rotation.x = z > 0 ? -0.1 : 0.1;
  }
  // A broad recessed grin with a white tooth line, wrapped around the nose.
  const smileCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(1.425, 0.58, -0.38),
    new THREE.Vector3(1.469, 0.46, -0.18),
    new THREE.Vector3(1.478, 0.44, 0.04),
    new THREE.Vector3(1.425, 0.59, 0.38),
  ]);
  car.add(new THREE.Mesh(new THREE.TubeGeometry(smileCurve, 32, 0.055, 12, false), rubber));
  const teeth = new THREE.Mesh(new THREE.TubeGeometry(smileCurve, 32, 0.024, 10, false), cream);
  teeth.position.set(0.038, 0.02, 0);
  car.add(teeth);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({ color: 0x302419, transparent: true, opacity: 0.12, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.set(1.5, 0.72, 1);
  scene.add(shadow);
  // Screen-space smoke stays behind as the WebGL car drives away.
  const smoke = document.createElement('div');
  smoke.className = 'lh-car-smoke';
  smoke.setAttribute('aria-hidden', 'true');
  smoke.style.cssText = 'position:fixed;inset:0;overflow:hidden;pointer-events:none;z-index:999;';
  layer.append(smoke);
  const effects = new Set<Animation>();
  let puffIndex = 0;
  function puff(x: number, y: number, burst = false) {
    const cloud = document.createElement('i');
    const index = puffIndex++;
    const width = burst ? 85 : 60;
    cloud.style.cssText = `position:absolute;left:${x - width / 2}px;top:${y - 25}px;width:${width}px;height:${width * 0.7}px;border-radius:50%;background:radial-gradient(ellipse at 30% 60%,#fffdf8 0 28%,transparent 31%),radial-gradient(ellipse at 55% 35%,#fffdf8 0 34%,transparent 37%),radial-gradient(ellipse at 78% 62%,#e4dfd4 0 29%,transparent 32%),radial-gradient(ellipse at 48% 70%,#eee9df 0 42%,transparent 45%);filter:drop-shadow(0 3px 2px #62534818);`;
    smoke.append(cloud);
    const animation = cloud.animate([
      { opacity: 0, transform: 'translate(0,0) scale(.25)' },
      { opacity: .9, offset: .16, transform: 'translate(-4px,-4px) scale(.8)' },
      { opacity: 0, transform: `translate(${-25 - index % 4 * 9}px,${-38 - index % 3 * 12}px) scale(${burst ? 1.9 : 1.6})` },
    ], { duration: 320 + index % 3 * 45, easing: 'ease-out', fill: 'forwards' });
    effects.add(animation);
    animation.finished.then(() => { effects.delete(animation); cloud.remove(); }, () => {});
  }
  let frame = 0;
  let disposed = false;
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    effects.forEach(effect => effect.cancel());
    effects.clear();
    smoke.remove();
    window.removeEventListener('pagehide', cleanup);
    window.removeEventListener('resize', finish);
    preference.removeEventListener('change', finish);
    canvas.removeEventListener('webglcontextlost', finish);
    scene.traverse(object => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
    [paint, cream, glass, rubber, irisMaterial, shadow.material].forEach(material => material.dispose());
    renderer.dispose();
    layer.remove();
  };
  const finish = () => { cleanup(); done(); };
  window.addEventListener('pagehide', cleanup, { once: true });
  window.addEventListener('resize', finish, { once: true });
  preference.addEventListener('change', finish, { once: true });
  canvas.addEventListener('webglcontextlost', finish, { once: true });
  const start = performance.now();
  const duration = Math.min(880, deadline - start - 20);
  if (duration < 250) { finish(); return cleanup; }
  const anchor = link.getBoundingClientRect();
  const scrollStart = { x: scrollX, y: scrollY };
  let impacted = false;
  let lastPuff = 0;
  function tick(now: number) {
    if (disposed) return;
    const t = (now - start) / duration;
    if (t >= 1) { finish(); return; }
    const cy = anchor.top + anchor.height / 2 + scrollStart.y - scrollY;
    const right = anchor.right + scrollStart.x - scrollX;
    const size = Math.min(1, innerWidth / 500);
    // Track the actual shaking button, leaving its original content fully visible.
    const rect = link.getBoundingClientRect();
    layer.style.clipPath = `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${rect.left}px ${rect.top}px, ${rect.right}px ${rect.top}px, ${rect.right}px ${rect.bottom}px, ${rect.left}px ${rect.bottom}px, ${rect.left}px ${rect.top}px, 0 0)`;
    let x: number;
    const y = cy;
    car.scale.set(1, 1, 1);
    car.rotation.y = -0.18;
    car.rotation.z = 0;
    if (t < 0.12) {
      canvas.dataset.phase = 'appearance';
      x = right - (55 - t / 0.12 * 18) * size;
    } else if (t < 0.3) {
      canvas.dataset.phase = 'impact';
      const p = (t - 0.12) / 0.18;
      x = right - 37 * size - Math.sin(p * Math.PI) * 9;
      car.scale.set(1 - Math.sin(p * Math.PI) * 0.16, 1 + Math.sin(p * Math.PI) * 0.12, 1);
      if (!impacted) {
        impacted = true;
        const bump = link.animate([
          { translate: '0 0' },
          { translate: '10px -3px', offset: .2 },
          { translate: '-3px 0', offset: .6 },
          { translate: '0 0' },
        ], { duration: duration * .32, easing: 'ease-out' });
        effects.add(bump);
        bump.finished.then(() => effects.delete(bump), () => {});
        for (let i = 0; i < 4; i++) puff(right + i * 9, cy + 23 + i % 2 * 9, true);
      }
    } else {
      canvas.dataset.phase = 'departure';
      const p = Math.min((t - 0.3) / 0.58, 1);
      const from = right - 37 * size;
      x = from + (innerWidth + 150 - from) * p * p;
      car.rotation.z = -0.08 * Math.sin(p * Math.PI);
      if (t - lastPuff > 0.055 && p < .9) {
        lastPuff = t;
        puff(x - 45 * size, y + 30 * size, p < .35);
      }
    }
    canvas.style.transform = `translate(${x - 120}px,${y - 95}px) scale(${size})`;
    car.position.y = Math.sin(t * 38) * 0.02;
    pupils.forEach(pupil => { pupil.scale.y = t > .12 && t < .25 ? .045 : .084; });
    wheels.forEach(wheel => { wheel.rotation.z = -t * (t > .3 ? 45 : 12); });
    try { renderer.render(scene, camera); } catch { finish(); return; }
    frame = requestAnimationFrame(tick);
  }
  frame = requestAnimationFrame(tick);
  return cleanup;
}
