// 配線モード: 配線練習用 PLC の3Dモデル、ケーブル、回路計算、配線チェック
//
// 配線練習用 PLC（端子配列）は、通信する PLC とは別に選べる。
// 入力・出力は「何点目か」(0〜15) で扱い、通信先の入力先頭・出力先頭からの連番デバイスに対応する。
//
// 端子キー: 作業盤 'T:1'..'T:16' 'T:20'..'T:33' 'T:+1'..'T:+4' 'T:-1'..'T:-4'
//           PLC    'P:IN0'..'P:IN15'（入力）'P:INCOM'（入力コモン: S/S または COM）
//                  'P:OUT0'..'P:OUT15'（出力）'P:COM0'..（出力コモン。グループ番号順）
//                  'P:24V' 'P:0V'（サービス電源。ある機種のみ）
import * as THREE from 'three';
import { terminalLayout, terminalDetails } from './plc-models.js';
import { M, mat, box, cyl, label, tag } from './gfx.js';

import { PLC_MODELS, DEFAULT_MODEL, buildCircuit, evaluateCircuit, checkCircuit } from './wiring-circuit.js';
export { PLC_MODELS, DEFAULT_MODEL } from './wiring-circuit.js';
const range = n => Array.from({ length: n }, (_, i) => i);

// PLC の置き場所。配線端子の高さを作業盤側の端子に合わせる。
const PLC = { x: 0, z: -265 };
const COLORS = { plus: 0xd42a2a, minus: 0x2b2b2b, input: 0x2f6fd6, output: 0xe0c020 };

// 射出成形カバーの面取り。寸法はboxと同じで、正面は+Y。
function caseBox(parent,w,h,d,material,x,y,z,r=.6) {
  r=Math.min(r,w/4,h/4,d/4);
  const shape=new THREE.Shape(), a=w/2-r, b=d/2-r;
  shape.moveTo(-a,-b); shape.lineTo(a,-b); shape.lineTo(a,b); shape.lineTo(-a,b); shape.closePath();
  const geometry=new THREE.ExtrudeGeometry(shape,{depth:h-2*r,bevelEnabled:true,bevelThickness:r,bevelSize:r,bevelSegments:1,steps:1});
  geometry.rotateX(-Math.PI/2); geometry.translate(0,-h/2+r,0);
  const mesh=new THREE.Mesh(geometry,material);
  mesh.position.set(x,y,z); mesh.castShadow=true; mesh.receiveShadow=true;
  parent.add(mesh); return mesh;
}

export class Wiring {
  constructor(scene, tbPositions, modelId = DEFAULT_MODEL) {
    this.scene = scene;
    this.terms = new Map();      // key → { pos, mesh, ghost, label }
    this.wires = [];             // { a, b, mesh, tags }
    this.pending = null;         // 1本目の端子
    this.selected = null;        // 選択中のケーブル
    this.onChange = () => {};
    this.tbGroup = new THREE.Group();
    this.plcGroup = new THREE.Group();
    this.wireGroup = new THREE.Group();
    scene.add(this.tbGroup, this.plcGroup, this.wireGroup);

    for (const [key, p] of Object.entries(tbPositions)) this.#registerTerm(this.tbGroup, `T:${key}`, p.clone(), null, `TB${key}`);
    this.#buildPlc(PLC_MODELS[modelId] ? modelId : DEFAULT_MODEL);
    this.#rebuildNets();
  }

  get pickables() { return [...this.terms.values()].map(t => t.mesh); }
  get wirePickables() { return this.wires.map(w => w.mesh); }

  // ------------------------------------------------------------ 配線練習用 PLC の切替
  previewModelChange(id) {
    if (!Object.hasOwn(PLC_MODELS, id)) throw new Error(`未対応の型式: ${id}`);
    const model = PLC_MODELS[id];
    const keys = new Set([...model.terminals.input, ...model.terminals.output].filter(t => t.key).map(t => t.key));
    return this.wires.filter(w => [w.a, w.b].some(k => k.startsWith('P:') && !keys.has(k)));
  }

  terminalDescription(key) {
    const t = terminalDetails(this.model, key);
    return t ? `${this.model.title}\n端子 ${t.label}　端子番号 ${t.pin}\nコモン ${t.common}` : this.name(key);
  }

  // 端子キーは機種共通なので、切替先にも存在する端子の配線は残る。消えた本数を返す
  setModel(id) {
    if (!PLC_MODELS[id] || id === this.modelId) return 0;
    const list = this.toJSON();
    for (const w of this.wires) this.#disposeWire(w);
    this.wires = [];
    this.selected = null;
    this.pending = null;
    for (const k of [...this.terms.keys()]) if (k.startsWith('P:')) this.terms.delete(k);
    this.plcGroup.traverse(o => { o.geometry?.dispose(); o.material?.map?.dispose(); });
    this.plcGroup.clear();
    this.#buildPlc(id);
    let dropped = 0;
    for (const [a, b] of list) {
      if (this.terms.has(a) && this.terms.has(b)) this.#pushWire(a, b); else dropped++;
    }
    this.#rebuildNets();
    this.onChange();
    return dropped;
  }

  // ------------------------------------------------------------ PLC モデル
  #buildPlc(id) {
    this.modelId = id;
    this.model = PLC_MODELS[id];
    this.leds = { x: [], y: [] };
    if (this.model.layout === 'modules') this.#buildModules();
    else this.#buildCompact();
    const lift = (this.terms.get('T:1')?.pos.y ?? 20) - this.terms.get('P:IN0').pos.y;
    for (const part of this.plcGroup.children) part.position.y += lift;
    for (const [key, term] of this.terms) if (key.startsWith('P:')) term.pos.y += lift;
    const bottom = (this.model.layout === 'modules' ? -125 : -this.model.depth) + lift;
    box(this.plcGroup, 170, bottom + 145, 120, mat(0x8a9099), PLC.x, (bottom - 145) / 2, PLC.z);
  }

  #ledMat() { return mat(0x1d3a22, { emissive: 0x000000 }); }

  // 正面図を上向きに置く。上下左右・端子配列はメーカー正面図に合わせる。
  #buildCompact() {
    const g = this.plcGroup, m = this.model, w = m.width, h = m.depth;
    const slim = m.layout === 'slim', mxf = m.layout === 'mxf', fx5s = m.series === 'FX5S';
    const shell = mat(mxf ? 0x50535f : 0xd4d6d5), face = mat(mxf ? 0x434650 : 0xe6e7e5);
    caseBox(g, w, h, 90, shell, PLC.x, -h / 2, PLC.z,1.2);
    caseBox(g, w - 2, 3, 88, face, PLC.x, .5, PLC.z);
    // 側面の放熱スリットとDINレール側の爪。
    for (let i = 0; i < 12; i++) {
      box(g, .6, h * .6, 1, M.dark, PLC.x + w / 2 + .1, -h * .55, PLC.z - 31 + i * 5);
      box(g, w - 8, .6, 1, M.dark, PLC.x, -h + 2, PLC.z - 31 + i * 5);
    }
    for (const z of [-44,44]) box(g, w - 9, 2, 3, M.dark, PLC.x, -h + 2, PLC.z + z);
    const dark = mat(0x171b20);
    if (mxf) {
      box(g, w * .36, 3, 84, dark, PLC.x - w * .31, 3, PLC.z);
      box(g, w * .58, 3, 30, dark, PLC.x - w * .20, 3, PLC.z - 28);
      this.#ethernet(PLC.x - w * .12, PLC.z + 5, 'P2');
      this.#ethernet(PLC.x - w * .12, PLC.z + 28, 'P1');
      this.#auxTerminal(PLC.x + 11, PLC.z + 31, ['+24V','24G','⏚'], 0x62ad46);
      this.#terminalGrid(terminalLayout(m,'input'), PLC.x + w / 2 - 15, PLC.z - 36, 19, 32, true);
      this.#terminalGrid(terminalLayout(m,'output'), PLC.x + w / 2 - 15, PLC.z + 3, 19, 32, true);
    } else if (slim) {
      box(g, 20, 3, 37, dark, PLC.x - w / 2 + 11, 3, PLC.z - 23);
      this.#ethernet(PLC.x - w / 2 + 12, PLC.z + 3, 'Ethernet');
      this.#auxTerminal(PLC.x - w / 2 + 10, PLC.z + 29, ['RDA','RDB','SDA','SDB','SG'], 0x323737);
      const bankWidth = m.outputType === 'relay' ? 35 : 17;
      const bankX = PLC.x + w / 2 - bankWidth / 2 - 4;
      this.#terminalGrid(terminalLayout(m,'input'),bankX,PLC.z - 35,bankWidth,32,true);
      this.#terminalGrid(terminalLayout(m,'output'),bankX,PLC.z + 4,bankWidth,32,true);
    } else {
      const coverW = fx5s ? w*.33 : w*.70, coverX=PLC.x+(fx5s?-w*.12:w*.065);
      const leftW=fx5s?w*.205:w*.225, leftX=PLC.x-w/2+leftW/2+1;
      // 左の周辺機器カバー、中央の増設ボードカバー、右の表示面を分ける。
      box(g,leftW+1,1,51,mat(0x9b9e9c),leftX,2,PLC.z);
      caseBox(g,leftW,3.2,50,face,leftX,3,PLC.z);
      caseBox(g,coverW,3.6,50,dark,coverX,3.3,PLC.z);
      if(fx5s) caseBox(g,w*.43,3.6,50,face,PLC.x+w*.285,3.3,PLC.z);
      const seamX=fx5s?coverX:PLC.x-w*.08;
      if(!fx5s) {
        box(g,.5,.3,48,mat(0x727874),seamX,5.2,PLC.z);
        box(g,.5,.3,48,mat(0x727874),PLC.x+w*.18,5.2,PLC.z);
        caseBox(g,9,3,49,face,PLC.x+w/2-6,3,PLC.z);
        for(const [i,text] of ['CARD','RD','SD','SD/RD'].entries()) {
          label(g,text,PLC.x-w*.23,PLC.z-18+i*3.1,{size:1.55,color:'#eee',y:5.3});
          box(g,1.1,.25,1.3,this.#ledMat(),PLC.x-w*.16,5.3,PLC.z-18+i*3.1);
        }
      }
      label(g,'PULL ▾',leftX,PLC.z+21,{size:1.6,color:'#565c59',y:4.8});
      for(const tz of [-22,20]) box(g,3,.6,1,mat(0x8e9590),PLC.x-w/2+2,4.7,PLC.z+tz);
      this.#ethernet(PLC.x-w*(fx5s?.385:.205),PLC.z+(fx5s?-16:15),'Ethernet');
      // FX5Uは左カバーの右側に端子列がある。配線練習では保護カバーを開いた状態。
      const terminalW=fx5s?w-9:w*.75, terminalX=PLC.x+(fx5s?0:w*.10);
      for(const tz of [-44,44]) {
        caseBox(g,terminalW+3,4,3,face,terminalX,3,PLC.z+tz);
        for(const side of [-1,1]) box(g,2,5,16,face,terminalX+side*(terminalW/2+1.5),2,PLC.z+(tz<0?-35:35));
      }
      this.#terminalGrid(terminalLayout(m,'input'),terminalX,PLC.z-42,terminalW,14,false,true);
      this.#terminalGrid(terminalLayout(m,'output'),terminalX,PLC.z+27,terminalW,14,false,true);
    }
    // 入出力LEDは実機と同じ側に置く。状態は既存シミュレーションに連動。
    const ledX = slim || mxf ? PLC.x+w/2-1.6 : PLC.x+w*(fx5s?.12:.235);
    const ink=slim||mxf||!fx5s?'#e8e9e7':'#343b37';
    if(!slim&&!mxf) for(const [tz,name] of [[-20,'IN'],[16,'OUT']])
      label(g,name,ledX-3,PLC.z+tz,{size:1.5,color:ink,y:5.4});
    for (let k=0;k<16;k++) {
      const x = slim || mxf ? ledX : ledX+(k%8)*2.7;
      const z = slim || mxf ? PLC.z-34+k*1.8 : PLC.z-21+Math.floor(k/8)*4.8;
      this.leds.x.push(box(g,.75,.35,1.1,this.#ledMat(),x,5.5,z));
      if(k<m.outputCount) this.leds.y.push(box(g,.75,.35,1.1,this.#ledMat(),x,5.5,z+(slim||mxf?39:38)));
      if(!slim&&!mxf) {
        label(g,k.toString(8),x,z+1.8,{size:1.35,color:ink,y:5.7});
        if(k<m.outputCount) label(g,k.toString(8),x,z+39.8,{size:1.35,color:ink,y:5.7});
      }
    }
    const sx = slim || mxf ? PLC.x-w/2+4 : PLC.x+w*(fx5s?.35:.26);
    const sz = slim || mxf ? PLC.z-32 : PLC.z-5;
    for(const [i,text] of ['PWR','ERR','P.RUN'].entries()) {
      const led=cyl(g,.8,.5,i===2?this.#ledMat():mat(i===0?0x299958:0x4a2427),sx,5,sz+i*4,8);
      if(i===2)this.runLed=led;
      label(g,text,sx-6,sz+i*4,{size:1.6,color:ink,y:5.7});
    }
    if(!slim&&!mxf) label(g,m.title,PLC.x+w*(fx5s?.24:.29),PLC.z+10,{size:fx5s?1.9:1.65,color:ink,y:5.7});
    label(g,m.title,PLC.x,PLC.z-56,{size:3.3,y:8,bold:true,color:'#fff'});
  }

  #ethernet(x,z,name) {
    const g=this.plcGroup;
    caseBox(g,14,2,17,mat(0x454b4c),x,4.8,z);
    box(g,11.6,.4,14.5,M.black,x,5.9,z);
    for(const side of [-1,1]) {
      box(g,.7,2.6,15.2,M.alu,x+side*6,6.7,z);
      box(g,12.7,2.6,.7,M.alu,x,6.7,z+side*7.3);
      box(g,1.5,.5,2.2,M.metal,x+side*5.2,7.7,z-3.5);
    }
    box(g,3.7,.6,2.5,mat(0x454b4c),x,6.5,z-6.2);
    for(let i=0;i<8;i++) box(g,.35,.35,3.7,mat(0xc8a551),x-3+i*.85,6.3,z+3.8);
    if(name) label(g,name,x,z+10,{size:1.55,color:this.model.series==='FX5S'?'#333':'#ddd',y:5.4});
  }

  #auxTerminal(x,z,names,color) {
    const g=this.plcGroup, pitch=3.3;
    box(g,8,5,names.length*pitch+3,mat(color),x,5,z);
    names.forEach((name,i)=>{
      const tz=z+(i-(names.length-1)/2)*pitch;
      cyl(g,1,1,M.black,x,8,tz,10);
      label(g,name,x+(this.model.series==='MX-F'?-8:8),tz,{size:1.5,color:this.model.series==='MX-F'?'#fff':'#333',y:3});
    });
  }

  #terminalGrid(rows,x,z,width,depth,spring=false,stagger=false) {
    const g=this.plcGroup, columns=Math.max(...rows.map(row=>row.length));
    const dx=width/(columns+(stagger?.5:0)), dz=depth/rows.length;
    const orange=mat(0xf79a18), plastic=mat(0x353a3d);
    const housingWidth=width+(spring?6:2);
    caseBox(g,housingWidth,4,depth+2,plastic,x,5,z+depth/2,.45);
    for(const side of [-1,1]) box(g,.6,1.7,depth+1,M.dark,x+side*(housingWidth/2-.5),7.3,z+depth/2);
    if(spring) for(let col=0;col<columns;col+=2) {
      const cx=x-width/2+dx*(col+1);
      for(const tz of [z-1,z+depth+1]) {
        caseBox(g,dx*1.5,2.4,2.6,orange,cx,8,tz,.3);
        for(let i=-1;i<=1;i++)box(g,dx*.95,.2,.18,mat(0xb36d17),cx,9.3,tz+i*.5);
      }
    }
    rows.forEach((row,ri)=>row.forEach((t,ci)=>{
      const tx=x-width/2+dx*(ci+.5+(stagger&&ri===0?.5:0)),tz=z+dz*(ri+.5);
      let mesh;
      if(spring) {
        // オレンジの解除ボタン、黒い電線挿入口、白い表示帯。
        box(g,dx*.56,.6,dz*.83,mat(0x121717),tx,7.3,tz);
        mesh=cyl(g,Math.min(1.15,dz*.29),.4,M.black,tx,7.7,tz,12);
        const direction=ci%2===0?-1:1;
        caseBox(g,.95,1.2,dz*.58,orange,tx+direction*dx*.33,8,tz,.18);
        // FX5UCリレー形の同名2接点は、接点間の共通表示帯にまとめる。
        const shared=columns===4, labelX=shared?tx+dx*.5:tx+direction*dx*.68;
        if(!shared||ci%2===0) {
          box(g,dx*.50,.4,dz*.94,M.white,labelX,7.6,tz);
          label(g,t.label,labelX,tz,{size:Math.min(1.7,dx*.45/Math.max(t.label.length*.6,1)),color:'#171c20',y:7.9});
        }
      } else if(columns===1) {
        const sx=tx-width*.26+(ri%2?1:-1);
        box(g,7,.5,dz*.96,M.black,sx,7,tz);
        box(g,3.4,.45,dz*.72,M.metal,sx,7.4,tz);
        box(g,8,1.5,.35,plastic,sx,7.9,tz-dz/2);
        mesh=cyl(g,1.15,1,M.metal,sx,8,tz,12);
        box(g,1.5,.15,.3,M.black,sx,8.6,tz);
        box(g,.3,.15,1.5,M.black,sx,8.6,tz);
        box(g,width*.42,.3,dz*.94,M.white,tx+width*.24,8,tz);
        label(g,t.label,tx+width*.24,tz,{size:1.8,color:'#171c20',y:8.3});
      } else {
        const r=Math.min(1.8,dx*.26);
        cyl(g,r+.6,.4,M.black,tx,7.3,tz-1,12);
        box(g,r*2.2,.35,r*2.2,M.metal,tx,7.55,tz-1);
        box(g,.45,2,dz-.5,plastic,tx-dx/2,7.5,tz);
        mesh=cyl(g,r,1,M.metal,tx,8,tz-1,16);
        box(g,Math.min(2.5,dx*.5),.15,.35,M.black,tx,8.6,tz-1);
        box(g,.35,.15,Math.min(2.5,dx*.5),M.black,tx,8.6,tz-1);
        box(g,dx*.96,.3,2.6,M.white,tx,7.9,tz+2.1);
        label(g,t.label,tx,tz+2.1,{size:Math.min(1.9,dx/Math.max(t.label.length*.65,2)),color:'#171c20',y:8.2});
      }
      if(t.key) this.#registerTerm(g,t.key,mesh.position.clone().add(new THREE.Vector3(0,.8,0)),mesh,t.pin?`${t.label} (${t.pin})`:t.label);
    }));
  }

  #buildModules() {
    const g=this.plcGroup,m=this.model,isR=m.series==='iQ-R';
    const color=isR?0x30333d:0x62616f, height=isR?106:98;
    const unit=(x,w,name,depth=90,shellColor=color,header=true)=>{
      const plastic=mat(shellColor,{roughness:.78});
      caseBox(g,w,depth,height,plastic,x,-depth/2,PLC.z,.9);
      caseBox(g,w-1,2,height-2,plastic,x,1,PLC.z,.4);
      if(header) caseBox(g,w-2,2,20,mat(0x101718),x,3,PLC.z-height/2+12,.4);
      if(header) label(g,name,x,PLC.z-height/2+5,{size:2.2,color:'#fff',y:4.2,bold:true});
      for(let i=0;i<8;i++) {
        box(g,.3,depth*.60,1.2,M.dark,x+w/2+.05,-depth*.55,PLC.z-34+i*9);
        box(g,w*.65,1.4,.3,M.dark,x,-10-i*7,PLC.z-height/2-.05);
      }
      caseBox(g,w*.48,8,2,plastic,x,-depth+9,PLC.z-height/2-1,.4);
      box(g,w-4,.35,1,mat(0x1d2026),x,2.15,PLC.z+height/2-4);
    };
    box(g,160,10,height+6,mat(0xa3aaad),PLC.x,-120,PLC.z);
    // Q61P/R61P: 赤い筐体、黒い表示・端子カバー、金属色の側板。
    const powerX=PLC.x-47, powerW=isR?54.6:55.2, powerD=isR?110:90;
    unit(powerX,powerW,m.displayPower,powerD,isR?0xc72e27:0xee302c,false);
    for(const side of [-1,1]) box(g,.5,powerD-7,height-8,mat(0xa8aaa5),powerX+side*powerW/2,-powerD/2,PLC.z);
    if(isR) {
      // R61Pは上半分が連続した黒い面。表示面と端子カバーの間に赤い帯はない。
      caseBox(g,powerW-2,2,55,mat(0x16191b),powerX,3,PLC.z-23.5,.4);
      label(g,m.displayPower,powerX-18,PLC.z-37,{size:2.5,color:'#fff',y:4.2,bold:true});
      label(g,'POWER',powerX+15,PLC.z-41,{size:2.2,color:'#fff',y:4.2,bold:true});
      cyl(g,1.25,.4,mat(0x183129),powerX+15,4.4,PLC.z-36,10);
      for(const [i,text] of ['INPUT 100-240VAC','50/60Hz 130VA','OUTPUT 5VDC 6.5A'].entries())
        label(g,text,powerX-10,PLC.z-30+i*2,{size:1.3,color:'#fff',y:4.2});
      caseBox(g,powerW-5,3.2,24.5,M.black,powerX,4.2,PLC.z-8.75,.8);
      box(g,powerW-8,1,1.1,M.metal,powerX,5.8,PLC.z-20.5);
      for(const side of [-1,1]) box(g,1,3,24,mat(0x24272a),powerX+side*(powerW/2-2),4.2,PLC.z-8.75);
      // 赤い下カバーの段差と上面の放熱スリット。
      caseBox(g,powerW-1,2,41,mat(0xc72e27,{roughness:.72}),powerX,1.9,PLC.z+30.5,.5);
    } else {
      caseBox(g,powerW-2,2,14,mat(0x151819),powerX,3,PLC.z-height/2+8,.4);
      label(g,m.displayPower,powerX-18,PLC.z-height/2+6,{size:2.3,color:'#fff',y:4.2,bold:true});
      cyl(g,1.1,.4,mat(0x183129),powerX+15,4.3,PLC.z-height/2+10,10);
      label(g,'POWER',powerX+15,PLC.z-height/2+6,{size:1.8,color:'#fff',y:4.3});
      caseBox(g,powerW-2,1.8,81,mat(0xee302c,{roughness:.7}),powerX,1.8,PLC.z+8,.5);
    }
    for(const side of [-1,1]) for(let i=0;i<9;i++)
      box(g,powerW*.36,1,.3,mat(isR?0x792822:0xa92424),powerX+side*powerW*.25,-10-i*8,PLC.z-height/2-.1);
    label(g,isR?'▼PULL':'◂ PULL',powerX+(isR?17:-19),PLC.z+height/2-(isR?4:8),{size:1.8,color:'#fff',y:3.1});
    // CPUはカバーを閉じた外観。USBは小カバー、Ethernetは正面下部。
    const cpuX=PLC.x-4, cpuW=isR?27.8:27.4;
    unit(cpuX,cpuW,m.displayCpu,isR?110:115,color,false);
    caseBox(g,cpuW-2,2.4,isR?65:63,mat(isR?0x252a33:color,{roughness:.72}),cpuX,2.6,PLC.z-height/2+33,.55);
    label(g,m.displayCpu,cpuX,PLC.z-height/2+5,{size:2.2,color:'#fff',y:4.1,bold:true});
    const statuses=isR?['READY','ERROR','P.RUN','USER','BATTERY','CARD RDY','CARD ACS','FUNCTION']:['MODE','RUN','ERR','USER','BAT.','BOOT'];
    statuses.forEach((name,i)=>{
      const z=PLC.z-height/2+12+i*3.1;
      box(g,2.3,.3,2,M.black,cpuX+8,3.95,z);
      const led=box(g,1.5,.35,1.2,this.#ledMat(),cpuX+8,4.2,z);
      if(name===(isR?'P.RUN':'RUN')) this.runLed=led;
      label(g,name,cpuX-1,z,{size:1.9,color:'#fff',y:4.1});
    });
    label(g,'▼ PULL',cpuX-5,PLC.z+10,{size:1.65,color:'#fff',y:4.1});
    caseBox(g,cpuW-2,2.5,12,mat(isR?0x3e424d:0x5d5f6d),cpuX,3.5,PLC.z+21,.5);
    for(const tz of [17,25])box(g,3,.7,.6,M.dark,cpuX+cpuW/2-4,4.9,PLC.z+tz);
    box(g,2,2,8,mat(color),cpuX-cpuW/2+2,4,PLC.z+21);
    label(g,'USB',cpuX-1,PLC.z+21,{size:2.3,color:'#fff',y:5});
    label(g,'▾',cpuX-7,PLC.z+24.5,{size:1.5,color:'#fff',y:5});
    caseBox(g,cpuW-3,1.5,22,mat(isR?0x434953:0x737480),cpuX,2.8,PLC.z+height/2-13,.4);
    this.#ethernet(cpuX,PLC.z+height/2-12,'');
    label(g,'10BASE-T/100BASE-TX',cpuX,PLC.z+height/2-1.8,{size:1.15,color:'#fff',y:4});
    for(const [side,x,name,leds] of [
      ['input',PLC.x+25,m.modules[0],this.leds.x],['output',PLC.x+54,m.modules[1],this.leds.y],
    ]) {
      unit(x,27.8,name);
      for(let k=0;k<16;k++) {
        const lx=x-9+k%8*2.5, lz=PLC.z-height/2+12+Math.floor(k/8)*4.5;
        leds.push(box(g,.75,.35,1.1,this.#ledMat(),lx,4.5,lz));
        label(g,k.toString(16).toUpperCase(),lx,lz-1.6,{size:1.5,color:'#eee',y:4.8});
      }
      const spring=name.endsWith('-TS');
      // 16点TS端子台は正面下半分の2列。ねじ式は縦18点。
      this.#terminalGrid(terminalLayout(m,side),x,PLC.z+(spring?5:-height/2+25),spring?11:22,spring?37:height-32,spring);
    }
    label(g,m.title,PLC.x,PLC.z-height/2-11,{size:3,y:8,bold:true,color:'#fff'});
  }

  #registerTerm(parent, key, pos, mesh, text) {
    const ghost = !mesh; // 盤側端子は透明の当たり判定だけ作る
    if (!mesh) {
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 1.5, 12), new THREE.MeshBasicMaterial({ visible: false }));
      mesh.position.copy(pos).add(new THREE.Vector3(0, -0.5, 0));
      parent.add(mesh);
    } else {
      mesh.material = mesh.material.clone();
    }
    mesh.userData.action = { type: 'term', key };
    this.terms.set(key, { pos, mesh, ghost, label: text });
  }

  // ------------------------------------------------------------ 操作
  clickTerm(key) {
    if (!this.pending) { this.pending = key; this.#highlight(); return `${this.name(key)} を選択 → 接続先をクリック`; }
    const a = this.pending;
    this.pending = null;
    this.#highlight();
    if (a === key) return '選択を解除しました';
    if (this.wires.some(w => (w.a === a && w.b === key) || (w.a === key && w.b === a))) return '同じ配線が既にあります';
    const n = this.#countAt(a), m = this.#countAt(key);
    this.addWire(a, key);
    return (n >= 2 || m >= 2) ? '⚠ 1つの端子に3本以上つながっています' : `${this.name(a)} ─ ${this.name(key)} を配線`;
  }
  cancel() { this.pending = null; this.#highlight(); }

  #pushWire(a, b) {
    const w = { a, b };
    this.wires.push(w);
    this.#buildWireMesh(w);
    return w;
  }
  addWire(a, b) {
    const w = this.#pushWire(a, b);
    this.#rebuildNets();
    this.onChange();
    return w;
  }
  removeWire(w) {
    this.wires = this.wires.filter(x => x !== w);
    this.#disposeWire(w);
    if (this.selected === w) this.selected = null;
    this.#rebuildNets();
    this.onChange();
  }
  clear() {
    for (const w of this.wires) this.#disposeWire(w);
    this.wires = [];
    this.selected = null;
    this.#rebuildNets();
    this.onChange();
  }
  select(w) {
    if (this.selected) this.selected.mesh.material.emissive.setHex(0);
    this.selected = w;
    if (w) w.mesh.material.emissive.setHex(0x335577);
  }

  // 標準割付どおりの配線（TB1〜16 → 入力 1〜16 点目、TB20〜33 → 出力 1〜14 点目）
  autoStandard() {
    this.clear();
    this.model.inputCommons.forEach((g, i) => this.#pushWire(`T:+${i + 1}`, g.key));                         // 入力コモン: 作業盤 +24V（シンク入力）
    for (let i = 1; i <= 16; i++) this.#pushWire(`T:${i}`, `P:IN${i - 1}`);
    this.model.groups.forEach((_, gi) => this.#pushWire(`T:-${(gi % 4) + 1}`, `P:COM${gi}`)); // 出力コモン → 0V
    this.model.outputPower.forEach((p, i) => this.#pushWire(`T:+${this.model.inputCommons.length + i + 1}`, p.key));
    for (let j = 0; j < 14; j++) this.#pushWire(`T:${20 + j}`, `P:OUT${j}`);
    this.#rebuildNets();
    this.onChange();
  }

  toJSON() { return this.wires.map(w => [w.a, w.b]); }
  load(list) {
    this.clear();
    for (let [a, b] of list ?? []) {
      [a, b] = [a, b].map(migrateKey);
      if (this.terms.has(a) && this.terms.has(b)) this.#pushWire(a, b);
    }
    this.#rebuildNets();
    this.onChange();
  }

  name(key) {
    const t = this.terms.get(key);
    return key.startsWith('T:') ? `TB${key.slice(2)}` : `PLC ${t?.label ?? key.slice(2)}`;
  }
  #countAt(key) { return this.wires.filter(w => w.a === key || w.b === key).length; }

  #highlight() {
    for (const [k, t] of this.terms) {
      const m = t.mesh.material;
      if (t.ghost) { // 選択時だけ見せる
        m.visible = k === this.pending;
        m.color.setHex(0x44ff88); m.transparent = true; m.opacity = 0.6;
      } else {
        m.emissive.setHex(k === this.pending ? 0x22aa55 : 0x000000);
      }
    }
  }

  // ------------------------------------------------------------ ケーブル描画
  #colorFor(w) {
    const ks = [w.a, w.b];
    if (ks.some(k => /^T:\+|^P:24V|^P:VPLUS|^P:INCOM/.test(k))) return COLORS.plus;
    if (ks.some(k => /^T:-|^P:0V|^P:COM/.test(k))) return COLORS.minus;
    if (ks.some(k => /^P:OUT|^T:(2\d|3[0-3])$/.test(k))) return COLORS.output;
    return COLORS.input;
  }
  #buildWireMesh(w) {
    const a = this.terms.get(w.a).pos, b = this.terms.get(w.b).pos;
    const idxA = this.#countAt(w.a) - 1, idxB = this.#countAt(w.b) - 1; // 同じ端子の2本目は少しずらす
    const up = (p, i) => p.clone().add(new THREE.Vector3(i * 1.2, 14 + i * 3, 0));
    const pa = up(a, idxA), pb = up(b, idxB);
    const mid = pa.clone().lerp(pb, 0.5);
    mid.y = Math.max(pa.y, pb.y) + 12 + a.distanceTo(b) * 0.08;
    const curve = new THREE.CatmullRomCurve3([a.clone(), pa, mid, pb, b.clone()], false, 'catmullrom', 0.3);
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.9, 6, false),
      new THREE.MeshStandardMaterial({ color: this.#colorFor(w), roughness: 0.5 }));
    mesh.castShadow = true;
    mesh.userData.action = { type: 'wire', wire: w };
    this.wireGroup.add(mesh);
    w.mesh = mesh;
    // マークチューブ（盤側の端子番号）
    const tb = [w.a, w.b].find(k => k.startsWith('T:'))?.slice(2) ?? '';
    w.tags = [];
    if (tb) {
      for (const p of [pa, pb]) {
        const t = tag(`${tb}.`, { size: 3.2 });
        t.position.copy(p).add(new THREE.Vector3(0, -4, 0));
        this.wireGroup.add(t);
        w.tags.push(t);
      }
    }
  }
  #disposeWire(w) {
    for (const o of [w.mesh, ...(w.tags ?? [])]) {
      this.wireGroup.remove(o);
      o.geometry?.dispose();
      o.material?.map?.dispose();
      o.material?.dispose();
    }
  }

  // ------------------------------------------------------------ 回路計算
  // 電源: 作業盤 DC24V (TB+ / TB-) と PLC サービス電源 (24V / 0V、ある機種のみ)
  #rebuildNets() { Object.assign(this, buildCircuit(this.model, this.wires)); }

  evaluate(panelClosed, plcY) { return evaluateCircuit(this, panelClosed, plcY); }

  check() { return checkCircuit(this, this.terms.keys(), key => this.name(key)); }

  // I/O モニタ用: 入力 k / 出力 k の端子名と、つながっている盤の機器
  termX(k) { return this.model.x(k); }
  termY(k) { return k < this.model.outputCount ? this.model.y(k) : '—'; }
  describeX(k, inputNames) { return this.xSources[k].map(i => `TB${i + 1} ${inputNames[i]}`).join(', '); }
  describeY(k, outputNames) {
    return this.outSources.map((ks, j) => ks.includes(k) ? `TB${20 + j} ${outputNames[j]}` : null).filter(Boolean).join(', ');
  }

  updateLeds(x, y, running) {
    const on = (mesh, v) => { mesh.material.emissive.setHex(v ? 0x22ff55 : 0); mesh.material.color.setHex(v ? 0x66ff88 : 0x1d3a22); };
    this.leds.x.forEach((mesh, k) => on(mesh, x[k]));
    this.leds.y.forEach((mesh, k) => on(mesh, y[k]));
    on(this.runLed, running);
  }
}

// 旧形式（FX5 固定時代）の端子キーを変換: 'P:S/S' 'P:X17' 'P:Y5' など
function migrateKey(k) {
  if (k === 'P:S/S') return 'P:INCOM';
  const mx = /^P:X([0-7]+)$/.exec(k);
  if (mx) return `P:IN${parseInt(mx[1], 8)}`;
  const my = /^P:Y([0-7]+)$/.exec(k);
  if (my) return `P:OUT${parseInt(my[1], 8)}`;
  return k;
}
