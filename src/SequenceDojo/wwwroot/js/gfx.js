// 3D 形状・文字の共通ヘルパ（1 = 1mm）
import * as THREE from 'three';

export const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05, ...o });

export const M = {
  panel: mat(0xe9e5da, { roughness: 0.85 }),
  dark: mat(0x22252a),
  black: mat(0x111111, { roughness: 0.4 }),
  metal: mat(0xb8bcc2, { metalness: 0.8, roughness: 0.35 }),
  alu: mat(0xd5d8dc, { metalness: 0.6, roughness: 0.4 }),
  white: mat(0xf4f4f2),
  red: mat(0xd01818, { roughness: 0.35 }),
  tbBase: mat(0x2c2f33),
};

export function box(parent, w, h, d, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

export function cyl(parent, r, h, material, x = 0, y = 0, z = 0, seg = 24) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

function textCanvas(text, { color = '#222', bold = false, bg = null, px = 64 } = {}) {
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d');
  const font = `${bold ? '700 ' : ''}${px}px "Yu Gothic UI","Meiryo",sans-serif`;
  ctx.font = font;
  cv.width = Math.ceil(ctx.measureText(text).width) + (bg ? 24 : 8);
  cv.height = px + 16;
  ctx.font = font;
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, cv.width, cv.height); }
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, cv.width / 2, cv.height / 2 + 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, aspect: cv.width / cv.height, hRatio: cv.height / px };
}

// 面に寝かせた文字。x,z は文字の中心。
export function label(parent, text, x, z, { size = 5, color = '#222', y = 0.15, bold = false } = {}) {
  const { tex, aspect, hRatio } = textCanvas(text, { color, bold });
  const h = size * hRatio;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(h * aspect, h),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

// 常にカメラを向く札（マークチューブ表示など）
export function tag(text, { size = 5, color = '#111', bg = '#fff' } = {}) {
  const { tex, aspect } = textCanvas(text, { color, bg, bold: true });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true }));
  s.scale.set(size * aspect, size, 1);
  return s;
}
