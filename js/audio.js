// 群島聲音：全部 Web Audio 程式合成，不載入任何音檔。
// 預設靜音；第一次點喇叭才建立 AudioContext（瀏覽器自動播放規定）。
// 對外四個方法：audio.toggle()、audio.focus(islandId|null)、audio.sfx(name)、audio.tick({ droneDist })。
//
// 調音量、改音階：只改下面 CONFIG。

const CONFIG = {
  // ---- 音量（以實測輸出為準：海浪平均約 -26 dBFS、旋律峰值約 -12 dBFS） ----
  // 2026-10-26 實測校準：-18 dB 時海浪平均 -38.8 dBFS → 加 12.8 dB；旋律 -24 dB 時峰值 -22 dBFS → 加 10 dB
  OCEAN_DB: -5.2,           // 海浪匯流排增益 → 輸出平均約 -26 dBFS
  OCEAN_REDUCED_DELTA_DB: -8, // prefers-reduced-motion：只留海浪，再降這麼多
  MELODY_DB: -8.2,          // 旋律匯流排增益 → 輸出峰值約 -12 dBFS（水晶音樂版實測校準）
  ISLAND_DB: -10,           // 各島環境音匯流排增益
  SFX_DB: -14,              // 操作音效匯流排增益（不受主音量淡入淡出影響）
  FADE_S: 0.5,              // 開關聲音的淡入淡出秒數
  CROSSFADE_S: 1,           // 各島環境音交叉淡化秒數
  OCEAN_FOCUS_DB: { port: 4, lib: -6 }, // 聚焦這些島時海浪加大／減小（港口大一級、圖書館安靜）
  // ---- 海浪 ----
  WAVE_PERIOD_S: [6, 9],
  WAVE_PEAK: [0.3, 0.6],
  WAVE_LOWPASS_HZ: [600, 1200],
  // ---- 旋律（水晶音樂）：C 大調，C5～E6；和弦 C → Am → F → G，每 2 句換一個 ----
  BPM: 66,                               // 八分音符 ≈ 0.45 秒
  SCALE_SEMI: [0, 2, 4, 5, 7, 9, 11, 12, 14, 16], // 相對 C5 的半音：C D E F G A B C D E
  CHORD_PC: [[0, 4, 7], [9, 0, 4], [5, 9, 0], [7, 11, 2]], // 和弦音（pitch class）：C、Am、F、G
  PAD_HZ: [[130.81, 196.0], [164.81, 220.0], [130.81, 174.61], [146.83, 196.0]], // 墊底：根音＋五度，C3～A3
  PAD_DB: -32.6,                         // 墊底增益 → 輸出平均約 -34 dBFS（實測校準）
  PAD_XFADE_S: 2.5,                      // 換和弦時墊底交叉淡化
  PHRASE_EVERY_S: [8, 16],
  PHRASE_NOTES: [4, 8],
  NOTE_ATTACK_S: [0.005, 0.01],
  NOTE_RELEASE_S: [3, 5],
  BELL_PARTIALS: [[1, 1, 1], [2.76, 0.5, 0.6], [5.4, 0.25, 0.35], [8.93, 0.12, 0.2]], // [倍頻, 音量, 衰減長度比例]
  DETUNE_CENTS: 3,                       // 兩顆振盪器 ±3 cents
  TREMOLO: [4.5, 0.05],                  // 顫音 Hz、深度
  REVERB_S: 3.5, REVERB_WET: 0.4, PREDELAY_S: 0.03,
  PINGPONG_BEATS: 3 / 8, PINGPONG_FB: 0.3, PINGPONG_LEVEL: 0.3,
  HUMAN_TIME_S: 0.015, HUMAN_VEL: 0.15,  // 人味：時間 ±15 ms、力道 ±15%
  ECHO_CHANCE: 0.25, ECHO_DB: -8,        // 句尾高八度回聲
  FIRST_PHRASE_S: [2, 4],                // 開聲後第一句提早出現
  // ---- FPV 無人機：距離（世界單位）→ 嗡聲音高 ----
  DRONE_DIST: [13.5, 19],    // 近 → 遠（實測：聚焦 FPV 島時無人機繞圈距離約 14.4～18.2）
  DRONE_HZ: [260, 180],      // 近高遠低
  // ---- 其他 ----
  MAX_VOICES: 12,            // 同時存在的 Oscillator / BufferSource 上限
  STORE_KEY: 'islands_audio',
};

const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const dbToGain = (db) => 10 ** (db / 20);
const clamp01 = (x) => Math.min(1, Math.max(0, x));

function readStored() {
  try { return localStorage.getItem(CONFIG.STORE_KEY) === '1'; } catch (e) { return false; }
}
function writeStored(on) {
  try { localStorage.setItem(CONFIG.STORE_KEY, on ? '1' : '0'); } catch (e) { /* 無痕或被封鎖時略過 */ }
}

// 0.1 秒 8 kHz 8-bit 無聲 WAV（iOS 靜音開關：用 <audio> 播放讓音訊類別切到 playback）
function silentWavDataURI() {
  const n = 800;
  const bytes = new Uint8Array(44 + n);
  const v = new DataView(bytes.buffer);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  str(36, 'data'); v.setUint32(40, n, true);
  bytes.fill(128, 44);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return `data:audio/wav;base64,${btoa(bin)}`;
}

export function createAudio({ reducedMotion, getVisual = () => ({}), onChange = () => {}, debug = false } = {}) {
  let ctx = null;
  let master = null;
  let oceanBus = null;
  let oceanFocus = null;
  let melodyBus = null;
  let padBus = null;
  let pad = null;              // 目前的墊底（oscs、g）
  let bellBuf = null;          // 預先合成的鐘聲樣本（C5）
  let chordIdx = 0;
  let phraseCount = 0;
  let lastIdx = null;          // 上一句結尾在音階上的位置
  let islandBus = null;
  let sfxBus = null;
  let noiseBuf = null;
  let silentEl = null;
  let playing = false;
  let focused = null;
  let ambient = null;          // 目前的島環境音
  let tickTimer = null;
  let phraseTimer = null;
  let suspendTimer = null;
  const layers = [];
  let active = 0;               // 活躍的 Oscillator / BufferSource 數
  let notesPlayed = 0;
  const drone = { dist: null, prev: null, falling: false, lastWhoosh: 0 };
  let collecting = null;        // 建島環境音時，收集它的持續音 source，停止時一起 stop

  const reduced = () => Boolean(reducedMotion && reducedMotion.matches);
  const live = () => ctx && ctx.state === 'running' && !document.hidden;

  // ---------- 節點管理：每個 source 都經過這裡，結束時減一並斷線 ----------
  function track(src, ...chain) {
    active += 1;
    src.onended = () => {
      active -= 1;
      src.disconnect();
      for (const n of chain) n.disconnect();
    };
    return src;
  }
  const hasRoom = (n = 1) => active + n <= CONFIG.MAX_VOICES;

  // ---------- iOS 靜音開關：把音訊類別切到 playback ----------
  // 兩條路同時做（iOS 26 實測只設 audioSession 不夠）：
  //  1. navigator.audioSession.type = 'playback'（在建立 AudioContext 之前設）
  //  2. 播一段程式產生的無聲 WAV（<audio loop playsinline>），只能在使用者手勢裡呼叫
  function setAudioSession() {
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* 不支援就略過 */ }
  }
  function playSilent() {
    if (!silentEl) {
      silentEl = document.createElement('audio');
      silentEl.setAttribute('playsinline', '');
      silentEl.loop = true;
      silentEl.preload = 'auto';
      silentEl.src = silentWavDataURI();
    }
    const p = silentEl.play();
    if (p && p.catch) p.catch(() => {});
  }
  function unlockPlayback() {
    setAudioSession();
    playSilent();
  }
  function releasePlayback() {
    if (silentEl) silentEl.pause();
  }

  // ---------- 建立音訊圖（只在使用者手勢裡呼叫，且同步） ----------
  function ensureContext() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    setAudioSession();
    ctx = new AC();
    ctx.onstatechange = onStateChange;
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    oceanFocus = ctx.createGain();
    oceanFocus.connect(master);
    oceanBus = ctx.createGain();
    oceanBus.gain.value = dbToGain(CONFIG.OCEAN_DB + (reduced() ? CONFIG.OCEAN_REDUCED_DELTA_DB : 0));
    oceanBus.connect(oceanFocus);

    // 旋律：melodyBus → 乾聲 ＋ (pre-delay → 殘響) ＋ ping-pong 延遲 → master
    melodyBus = ctx.createGain();
    melodyBus.gain.value = dbToGain(CONFIG.MELODY_DB);
    const dry = ctx.createGain();
    dry.gain.value = 1 - CONFIG.REVERB_WET;
    melodyBus.connect(dry).connect(master);
    const pre = ctx.createDelay(0.1);
    pre.delayTime.value = CONFIG.PREDELAY_S;
    const reverb = ctx.createConvolver();
    reverb.buffer = makeImpulse(CONFIG.REVERB_S);
    const wet = ctx.createGain();
    wet.gain.value = CONFIG.REVERB_WET;
    melodyBus.connect(pre).connect(reverb).connect(wet).connect(master);
    const beat = 60 / CONFIG.BPM;
    const ppIn = ctx.createGain();
    ppIn.gain.value = CONFIG.PINGPONG_LEVEL;
    const dL = ctx.createDelay(2);
    const dR = ctx.createDelay(2);
    dL.delayTime.value = dR.delayTime.value = beat * CONFIG.PINGPONG_BEATS;
    const fbL = ctx.createGain();
    const fbR = ctx.createGain();
    fbL.gain.value = fbR.gain.value = CONFIG.PINGPONG_FB;
    const panL = ctx.createStereoPanner();
    const panR = ctx.createStereoPanner();
    panL.pan.value = -0.8;
    panR.pan.value = 0.8;
    melodyBus.connect(ppIn).connect(dL);
    dL.connect(panL).connect(master);
    dL.connect(fbL).connect(dR);
    dR.connect(panR).connect(master);
    dR.connect(fbR).connect(dL);

    padBus = ctx.createGain();
    padBus.gain.value = dbToGain(CONFIG.PAD_DB);
    padBus.connect(master);

    renderBell().then((b) => { bellBuf = b; }).catch(() => {});

    islandBus = ctx.createGain();
    islandBus.gain.value = dbToGain(CONFIG.ISLAND_DB);
    islandBus.connect(master);

    sfxBus = ctx.createGain();
    sfxBus.gain.value = dbToGain(CONFIG.SFX_DB);
    sfxBus.connect(ctx.destination);   // 不經 master：關喇叭的音效不會被淡出吃掉

    noiseBuf = makePinkNoise(2);

    if (debug) {
      const tag = document.createElement('div');
      tag.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99;padding:4px 8px;border-radius:6px;background:rgba(0,0,0,.7);color:#fff;font:11px/1.4 monospace;pointer-events:none;white-space:pre';
      document.body.appendChild(tag);
      setInterval(() => {
        const as = navigator.audioSession ? navigator.audioSession.type : '無';
        const se = silentEl ? (silentEl.paused ? '停' : `播 ${silentEl.currentTime.toFixed(1)}s`) : '無';
        tag.textContent = `audioSession:${as}  ctx:${ctx.state}  無聲音訊:${se}\n開關:${playing ? '開' : '關'}  節點:${active}  hidden:${document.hidden}`;
      }, 500);
      window.__audio = {
        get ctx() { return ctx; },
        get master() { return master; },
        get buses() { return { ocean: oceanFocus, melody: melodyBus, island: islandBus, sfx: sfxBus }; },
        get active() { return active; },
        get notesPlayed() { return notesPlayed; },
        get droneDist() { return drone.dist; },
        playPhrase: () => playPhrase(),
        get chord() { return ['C', 'Am', 'F', 'G'][chordIdx]; },
        get phrases() { return phraseCount; },
        get bellReady() { return Boolean(bellBuf); },
        get buses2() { return { pad: padBus }; },
        sfxAll: (name) => sfx(name, true),
      };
    }
    return true;
  }

  // 2 秒粉紅噪音（Paul Kellet 濾波），迴圈使用，不重複產生
  function makePinkNoise(seconds) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;    b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;    b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    const fade = Math.floor(ctx.sampleRate * 0.02);   // 頭尾交叉淡化，迴圈接縫不喀聲
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      d[i] = d[i] * k + d[len - fade + i] * (1 - k);
    }
    let peak = 0;                                     // 正規化到峰值 0.9
    for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
    if (peak > 0) for (let i = 0; i < len; i++) d[i] *= 0.9 / peak;
    return buf;
  }

  function makeImpulse(seconds) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-6.9 * i / len); // 結尾 -60 dB
    }
    return buf;
  }

  // ---------- 合成小工具 ----------
  // 單一音：type 波形、f0→f1 滑音、peak 峰值、dur 長度（指數衰減）
  function tone(dest, { type = 'sine', f0, f1 = f0, t, dur, peak, attack = 0.005 }) {
    if (!hasRoom()) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    osc.connect(g).connect(dest);
    track(osc, g);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // 噪音短音：經濾波器，可做掃頻
  function noise(dest, { t, dur, peak, filter = 'bandpass', f0 = 2000, f1 = f0, q = 1, attack = 0.003 }) {
    if (!hasRoom()) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const flt = ctx.createBiquadFilter();
    flt.type = filter;
    flt.Q.value = q;
    flt.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) flt.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    src.connect(flt).connect(g).connect(dest);
    track(src, flt, g);
    src.start(t, rand(0, 1.5));
    src.stop(t + dur + 0.02);
  }

  // 持續音（環境底噪），回傳可調整的節點
  function drone_(dest, { type, freq, gain, lowpass }) {
    if (!hasRoom()) return null;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = gain;
    let out = osc;
    const chain = [g];
    if (lowpass) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = lowpass;
      osc.connect(lp);
      out = lp;
      chain.push(lp);
    }
    out.connect(g).connect(dest);
    track(osc, ...chain);
    osc.start();
    if (collecting) collecting.push(osc);
    return { osc, g };
  }

  // ---------- 海浪：兩層錯開，共用一個迴圈噪音 buffer ----------
  function startOcean() {
    if (layers.length) return;
    const now = ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = CONFIG.WAVE_LOWPASS_HZ[0];
      lp.Q.value = 0.4;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(lp).connect(g).connect(oceanBus);
      track(src, lp, g);
      src.start(now, i * 0.97);
      layers.push({ src, lp, g, nextT: now + 0.05 + i * rand(2.5, 4) });
    }
  }

  function scheduleWave(layer) {
    const t = layer.nextT;
    const period = rand(...CONFIG.WAVE_PERIOD_S);
    const peak = rand(...CONFIG.WAVE_PEAK);
    const [lo, hi] = CONFIG.WAVE_LOWPASS_HZ;
    const crestHz = lo + (hi - lo) * ((peak - CONFIG.WAVE_PEAK[0]) / (CONFIG.WAVE_PEAK[1] - CONFIG.WAVE_PEAK[0]));
    const rise = period * rand(0.35, 0.45);
    const g = layer.g.gain;
    const f = layer.lp.frequency;
    g.setValueAtTime(Math.max(g.value, 0.06), t);
    g.linearRampToValueAtTime(peak, t + rise);
    g.linearRampToValueAtTime(0.08, t + period);
    f.setValueAtTime(lo, t);
    f.exponentialRampToValueAtTime(Math.max(lo, crestHz), t + rise);
    f.exponentialRampToValueAtTime(lo, t + period);
    layer.nextT = t + period;
  }

  function tick() {
    if (!live()) return;
    for (const layer of layers) {
      if (layer.nextT < ctx.currentTime) layer.nextT = ctx.currentTime + 0.05;
      while (layer.nextT < ctx.currentTime + 3) scheduleWave(layer);
    }
  }

  // ---------- 旋律：水晶音樂 ----------
  const C5 = 523.25;
  const semiHz = (semi) => C5 * 2 ** (semi / 12);
  const eighth = () => 60 / CONFIG.BPM / 2;

  // 鐘聲樣本：加成合成（4 個泛音 × ±3 cents 兩顆振盪器）＋ 顫音，離線算一次，之後每個音變速播放
  async function renderBell() {
    const sr = ctx.sampleRate;
    const dur = CONFIG.NOTE_RELEASE_S[1] + 0.5;
    const off = new OfflineAudioContext(1, Math.ceil(sr * dur), sr);
    const trem = off.createGain();
    trem.gain.value = 1 - CONFIG.TREMOLO[1];
    const lfo = off.createOscillator();
    lfo.frequency.value = CONFIG.TREMOLO[0];
    const lfoG = off.createGain();
    lfoG.gain.value = CONFIG.TREMOLO[1];
    lfo.connect(lfoG).connect(trem.gain);
    lfo.start();
    trem.connect(off.destination);
    const attack = rand(...CONFIG.NOTE_ATTACK_S);
    for (const [ratio, amp, decay] of CONFIG.BELL_PARTIALS) {
      for (const cents of [-CONFIG.DETUNE_CENTS, CONFIG.DETUNE_CENTS]) {
        const osc = off.createOscillator();
        osc.frequency.value = C5 * ratio;
        osc.detune.value = cents;
        const g = off.createGain();
        g.gain.setValueAtTime(0, 0);
        g.gain.linearRampToValueAtTime(amp * 0.5, attack);
        g.gain.exponentialRampToValueAtTime(0.0003, attack + CONFIG.NOTE_RELEASE_S[1] * decay);
        osc.connect(g).connect(trem);
        osc.start(0);
        osc.stop(dur);
      }
    }
    const buf = await off.startRendering();
    const d = buf.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    if (peak > 0) for (let i = 0; i < d.length; i++) d[i] *= 0.9 / peak;
    return buf;
  }

  // 墊底：和弦根音＋五度，換和弦時交叉淡化
  function setPad(idx) {
    if (!padBus || reduced()) return;
    const now = ctx.currentTime;
    const old = pad;
    if (old && old.idx === idx) return;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(1, now + CONFIG.PAD_XFADE_S);
    g.connect(padBus);
    const oscs = [];
    for (const f of CONFIG.PAD_HZ[idx]) {
      if (!hasRoom()) break;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 420;
      o.connect(lp).connect(g);
      track(o, lp, g);
      o.start(now);
      oscs.push(o);
    }
    pad = { idx, oscs, g };
    stopPad(old, CONFIG.PAD_XFADE_S);
  }
  function stopPad(p, fadeS) {
    if (!p) return;
    const now = ctx.currentTime;
    p.g.gain.cancelScheduledValues(now);
    p.g.gain.setValueAtTime(p.g.gain.value, now);
    p.g.gain.linearRampToValueAtTime(0, now + fadeS);
    for (const o of p.oscs) o.stop(now + fadeS + 0.05);
    if (pad === p) pad = null;
  }

  // 作曲：一句 4～8 個音，大多走 1～2 級，偶爾跳三度；句尾落在和弦音並拉長；中段稍強、結尾漸弱
  function composePhrase() {
    const scale = CONFIG.SCALE_SEMI;
    const chord = CONFIG.CHORD_PC[chordIdx];
    const n = randInt(...CONFIG.PHRASE_NOTES);
    const e = eighth();
    let idx = lastIdx === null ? randInt(2, 6) : lastIdx;
    const notes = [];
    let t = 0.05;
    let dir = Math.random() < 0.5 ? -1 : 1;
    for (let i = 0; i < n; i++) {
      const r = Math.random();
      let step = r < 0.55 ? 1 : r < 0.85 ? 2 : 3;         // 1 級 55%、2 級 30%、三度 15%
      if (Math.random() < 0.3) dir = -dir;                // 大致保持方向，偶爾轉折
      let next = idx + dir * step;
      if (next < 0 || next >= scale.length) { dir = -dir; next = idx + dir * step; }
      idx = Math.min(scale.length - 1, Math.max(0, next));
      if (i === n - 1) {                                  // 句尾：最近的和弦音
        let best = idx, bestD = 99;
        for (let k = 0; k < scale.length; k++) {
          if (!chord.includes(scale[k] % 12)) continue;
          const d = Math.abs(k - idx);
          if (d < bestD) { bestD = d; best = k; }
        }
        idx = best;
      }
      const arc = Math.sin(Math.PI * i / Math.max(1, n - 1));
      let vel = (0.6 + 0.3 * arc) * (1 + rand(-CONFIG.HUMAN_VEL, CONFIG.HUMAN_VEL));
      if (i === n - 1) vel *= 0.75;
      const last = i === n - 1;
      notes.push({
        freq: semiHz(scale[idx]),
        t: t + rand(-CONFIG.HUMAN_TIME_S, CONFIG.HUMAN_TIME_S),
        vel: Math.min(1, vel),
        release: last ? CONFIG.NOTE_RELEASE_S[1] : rand(...CONFIG.NOTE_RELEASE_S),
      });
      t += last ? e * 2 : (Math.random() < 0.15 ? e * 2 : e);
    }
    if (Math.random() < CONFIG.ECHO_CHANCE) {
      const lastNote = notes[notes.length - 1];
      notes.push({ freq: lastNote.freq * 2, t: t + e, vel: lastNote.vel * dbToGain(CONFIG.ECHO_DB), release: 4 });
      t += e;
    }
    lastIdx = idx;
    return { notes, end: t + CONFIG.NOTE_RELEASE_S[1] + 0.3 };
  }

  // 整句離線算成一個 buffer，正式播放只佔 1 個節點
  async function renderPhrase(phrase) {
    const sr = ctx.sampleRate;
    const off = new OfflineAudioContext(1, Math.ceil(sr * phrase.end), sr);
    for (const nt of phrase.notes) {
      const src = off.createBufferSource();
      src.buffer = bellBuf;
      src.playbackRate.value = nt.freq / C5;
      const g = off.createGain();
      g.gain.setValueAtTime(nt.vel, nt.t);
      if (nt.release < CONFIG.NOTE_RELEASE_S[1]) g.gain.exponentialRampToValueAtTime(nt.vel * 0.01, nt.t + nt.release);
      src.connect(g).connect(off.destination);
      src.start(nt.t);
    }
    return off.startRendering();
  }

  async function playPhrase() {
    if (!bellBuf || !hasRoom()) return null;
    if (phraseCount > 0 && phraseCount % 2 === 0) {
      chordIdx = (chordIdx + 1) % CONFIG.CHORD_PC.length;
      setPad(chordIdx);
    }
    phraseCount += 1;
    const phrase = composePhrase();
    const buf = await renderPhrase(phrase);
    if (!playing || !live()) return null;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(melodyBus);
    track(src);
    notesPlayed += phrase.notes.length;
    src.start(ctx.currentTime + 0.02);
    return phrase;
  }

  function scheduleNextPhrase(delayS) {
    clearTimeout(phraseTimer);
    phraseTimer = setTimeout(() => {
      if (playing && !reduced() && live()) playPhrase().catch(() => {});
      if (playing) scheduleNextPhrase(rand(...CONFIG.PHRASE_EVERY_S));
    }, delayS * 1000);
  }

  // ---------- 各島環境音 ----------
  // 每島：持續音（可無）＋定時事件；全部接到該島自己的 bus，切換時交叉淡化
  const ISLANDS = {
    brand: (bus, every) => {   // 街機機台待機：方波短音每 2 秒＋高頻微弱哼聲
      drone_(bus, { type: 'sine', freq: 2637, gain: 0.02 });
      every([2, 2], (t) => {
        const f = [262, 330, 392, 330][randInt(0, 3)];
        tone(bus, { type: 'square', f0: f, t, dur: 0.09, peak: 0.4 });
      });
    },
    ai: (bus, every) => {      // 工廠：低頻咚每 0.8 秒＋蒸汽嘶聲每 4 秒；沒人在跑只剩哼聲
      drone_(bus, { type: 'sine', freq: 98, gain: 0.05 });
      const running = Number(getVisual('ai').running_sessions) || 0;
      if (running <= 0) return;
      every([0.8, 0.8], (t) => tone(bus, { type: 'sine', f0: 72, f1: 48, t, dur: 0.22, peak: 0.55 }));
      every([4, 4], (t) => noise(bus, { t, dur: 0.7, peak: 0.12, filter: 'highpass', f0: 3500, attack: 0.04 }));
    },
    port: (bus, every) => {    // 港口：海浪加大（OCEAN_FOCUS_DB）＋海鷗＋船鈴
      every([5, 10], (t) => {
        tone(bus, { f0: 1900, f1: 1250, t, dur: 0.28, peak: 0.32, attack: 0.03 });
        tone(bus, { f0: 1750, f1: 1100, t: t + 0.36, dur: 0.34, peak: 0.26, attack: 0.03 });
      });
      every([12, 12], (t) => {
        for (const dt of [0, 0.42]) {
          tone(bus, { f0: 1318.5, t: t + dt, dur: 1.4, peak: 0.35, attack: 0.002 });
          tone(bus, { f0: 1975.5, t: t + dt, dur: 0.9, peak: 0.15, attack: 0.002 });
        }
      });
    },
    lib: (bus, every) => {     // 圖書館：極安靜（海浪也降），偶爾翻頁
      every([6, 12], (t) => noise(bus, { t, dur: 0.05, peak: 3.0, filter: 'bandpass', f0: 2600, q: 0.7, attack: 0.004 }));
    },
    box: (bus, every) => {     // 擂台：跳繩每 0.5 秒＋沙包悶響每 1～2 秒
      every([0.5, 0.5], (t) => noise(bus, { t, dur: 0.03, peak: 0.12, filter: 'highpass', f0: 4200, attack: 0.002 }));
      every([1, 2], (t) => tone(bus, { f0: 80, f1: 62, t, dur: 0.2, peak: 0.6, attack: 0.004 }));
    },
    fpv: (bus) => {            // 飛行：四旋翼嗡嗡（音高跟無人機距離連動，見 tick），穿越時「咻」
      const d = drone_(bus, { type: 'sawtooth', freq: 220, gain: 0.12, lowpass: 1400 });
      return { droneOsc: d && d.osc, droneGain: d && d.g };
    },
    bridge: (bus, every) => {  // 工地：吊車馬達低鳴＋偶爾金屬敲擊
      drone_(bus, { type: 'sawtooth', freq: 60, gain: 0.11, lowpass: 320 });
      every([3, 6], (t) => {
        tone(bus, { type: 'square', f0: 2200, t, dur: 0.16, peak: 0.18, attack: 0.001 });
        tone(bus, { type: 'square', f0: 3150, t, dur: 0.1, peak: 0.1, attack: 0.001 });
      });
    },
  };

  function startAmbient(id) {
    const build = ISLANDS[id];
    if (!build || reduced()) return null;
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0, ctx.currentTime);
    bus.gain.linearRampToValueAtTime(1, ctx.currentTime + CONFIG.CROSSFADE_S);
    bus.connect(islandBus);
    const timers = [];
    const amb = { id, bus, timers, sources: [], extra: null };
    // every：每 [a,b] 秒觸發一次（暫停中不排，回來不會一次補一堆）
    const every = ([a, b], fn) => {
      const loop = () => {
        if (live()) fn(ctx.currentTime + 0.03);
        timers.push(setTimeout(loop, rand(a, b) * 1000));
      };
      timers.push(setTimeout(loop, rand(0.1, Math.min(a, 1)) * 1000));
    };
    collecting = amb.sources;
    amb.extra = build(bus, every) || null;
    collecting = null;
    return amb;
  }

  function stopAmbient(amb) {
    if (!amb) return;
    amb.stopping = true;
    for (const t of amb.timers) clearTimeout(t);
    amb.timers.length = 0;
    const now = ctx.currentTime;
    amb.bus.gain.cancelScheduledValues(now);
    amb.bus.gain.setValueAtTime(amb.bus.gain.value, now);
    amb.bus.gain.linearRampToValueAtTime(0, now + CONFIG.CROSSFADE_S);
    // 淡出後停掉這個島所有還在的 source、斷線
    setTimeout(() => {
      for (const s of amb.sources) { try { s.stop(); } catch (e) { /* 已停 */ } }
      amb.bus.disconnect();
    }, (CONFIG.CROSSFADE_S + 0.1) * 1000);
  }

  function setOceanFocus(id) {
    if (!oceanFocus) return;
    const db = (id && CONFIG.OCEAN_FOCUS_DB[id]) || 0;
    const now = ctx.currentTime;
    oceanFocus.gain.cancelScheduledValues(now);
    oceanFocus.gain.setValueAtTime(oceanFocus.gain.value, now);
    oceanFocus.gain.linearRampToValueAtTime(dbToGain(db), now + CONFIG.CROSSFADE_S);
  }

  function applyFocus() {
    if (!ctx || !playing) return;
    if (ambient && ambient.id === focused) return;
    stopAmbient(ambient);
    ambient = focused ? startAmbient(focused) : null;
    setOceanFocus(reduced() ? null : focused);
  }

  // ---------- 操作音效 ----------
  function sfx(name, force = false) {
    if (!ctx || (!playing && !force && name !== 'off')) return;
    if (!live()) return;
    const t = ctx.currentTime + 0.01;
    switch (name) {
      case 'focus':    tone(sfxBus, { f0: 880, f1: 1320, t, dur: 0.08, peak: 0.5, attack: 0.003 }); break;
      case 'overview': tone(sfxBus, { f0: 660, f1: 330, t, dur: 0.15, peak: 0.5, attack: 0.003 }); break;
      case 'on':
        [523.25, 659.25, 783.99].forEach((f, i) => tone(sfxBus, { f0: f, t: t + i * 0.08, dur: 0.14, peak: 0.45 }));
        break;
      case 'off':      tone(sfxBus, { f0: 261.63, t, dur: 0.22, peak: 0.5 }); break;
      default: break;
    }
  }

  // ---------- 恢復：iOS 切回前景後 AudioContext 常卡在 interrupted，resume 要靠下一次手勢 ----------
  function restartTick() {
    tick();
    clearInterval(tickTimer);
    tickTimer = setInterval(tick, 500);
  }
  function tryResume() {
    if (!ctx || !playing) return;
    const p = ctx.resume();
    if (p && p.catch) p.catch(() => {});
    playSilent();
    setTimeout(() => {
      if (!playing || document.hidden) return;
      if (ctx.state === 'running') restartTick();
      else armAutoStart();                 // 沒跑起來 → 等使用者下一次點畫面
    }, 600);
  }
  function onStateChange() {
    if (!ctx || !playing) return;
    if (ctx.state === 'running') {
      restartTick();
      if (armAutoStart.cleanup) armAutoStart.cleanup();
    } else if (!document.hidden) {
      armAutoStart();                      // 被來電、Siri、切 App 中斷
    }
  }

  // ---------- 開關 ----------
  function fadeMaster(to) {
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(to, now + CONFIG.FADE_S);
  }

  function start() {
    setAudioSession();
    if (!ensureContext()) return false;
    playSilent();                        // 手勢內同步呼叫
    clearTimeout(suspendTimer);
    const p = ctx.resume();
    if (p && p.catch) p.catch(() => {});
    startOcean();
    playing = true;
    restartTick();
    fadeMaster(1);
    setPad(chordIdx);
    scheduleNextPhrase(rand(...CONFIG.FIRST_PHRASE_S));
    applyFocus();
    return true;
  }

  function stop() {
    playing = false;
    clearTimeout(phraseTimer);
    if (!ctx) return;
    stopAmbient(ambient);
    ambient = null;
    stopPad(pad, CONFIG.FADE_S);
    fadeMaster(0);
    clearTimeout(suspendTimer);
    suspendTimer = setTimeout(() => {
      if (!playing) { clearInterval(tickTimer); ctx.suspend(); releasePlayback(); }
    }, (CONFIG.FADE_S + 0.3) * 1000);
  }

  // ---------- 記住開關：上次是開的 → 第一次任何點擊時自動開聲 ----------
  function armAutoStart() {
    const handler = (e) => {
      if (e.target && e.target.closest && e.target.closest('.audio-btn')) return;
      cleanup();
      if (!playing && start()) onChange(true);
      else if (playing && ctx) { unlockPlayback(); const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); restartTick(); }
    };
    const cleanup = () => {
      document.removeEventListener('click', handler, true);
      document.removeEventListener('touchend', handler, true);
    };
    document.addEventListener('click', handler, true);
    document.addEventListener('touchend', handler, true);
    armAutoStart.cleanup = cleanup;
  }
  armAutoStart.cleanup = null;
  if (readStored()) armAutoStart();

  // ---------- 分頁切到背景暫停，回來恢復 ----------
  document.addEventListener('visibilitychange', () => {
    if (!ctx || !playing) return;
    if (document.hidden) {
      clearInterval(tickTimer);
      ctx.suspend();
      releasePlayback();
    } else {
      tryResume();
    }
  });

  // ---------- reduced-motion：只留海浪，音量再降 ----------
  if (reducedMotion && reducedMotion.addEventListener) {
    reducedMotion.addEventListener('change', () => {
      if (!oceanBus) return;
      oceanBus.gain.setTargetAtTime(dbToGain(CONFIG.OCEAN_DB + (reduced() ? CONFIG.OCEAN_REDUCED_DELTA_DB : 0)), ctx.currentTime, 0.3);
      stopAmbient(ambient);
      ambient = null;
      applyFocus();
      if (reduced()) stopPad(pad, 1); else if (playing) setPad(chordIdx);
    });
  }

  return {
    // 切換開關；回傳切換後是否出聲
    toggle() {
      if (armAutoStart.cleanup) armAutoStart.cleanup();
      if (playing && ctx && ctx.state !== 'running') {   // 卡住了（iOS 切回來）→ 這一下是恢復
        unlockPlayback();
        const p = ctx.resume();
        if (p && p.catch) p.catch(() => {});
        restartTick();
        onChange(true);
        return true;
      }
      if (playing) {
        sfx('off');
        stop();
        writeStored(false);
      } else if (start()) {
        writeStored(true);
        sfx('on');
      }
      onChange(playing);
      return playing;
    },
    // 聚焦某島（null = 全景）：該島環境音交叉淡入，前一島淡出
    focus(islandId) {
      focused = islandId || null;
      applyFocus();
      if (debug && ctx) {
        // 節點數監控：交叉淡化結束後印出活躍的 Oscillator／BufferSource 數
        setTimeout(() => console.log(`[audio] focus=${focused || 'overview'} active=${active}`), (CONFIG.CROSSFADE_S + 0.3) * 1000);
      }
    },
    // 操作音效：'focus' | 'overview'（'on' / 'off' 由 toggle 自己播）
    sfx(name) { sfx(name); },
    // 每幀呼叫：state = { droneDist }（無人機到鏡頭距離）
    tick(state) {
      const d = state && Number.isFinite(state.droneDist) ? state.droneDist : null;
      if (d === null) return;
      if (ambient && ambient.id === 'fpv' && ambient.extra && ambient.extra.droneOsc && live()) {
        const [near, far] = CONFIG.DRONE_DIST;
        const k = clamp01((d - near) / (far - near));
        const hz = CONFIG.DRONE_HZ[0] + (CONFIG.DRONE_HZ[1] - CONFIG.DRONE_HZ[0]) * k;
        ambient.extra.droneOsc.frequency.setTargetAtTime(hz, ctx.currentTime, 0.05);
        ambient.extra.droneGain.gain.setTargetAtTime(0.075 + 0.1 * (1 - k), ctx.currentTime, 0.05);
        // 無人機飛過最近點（距離由減轉增）→ 短「咻」
        if (drone.prev !== null) {
          const falling = d < drone.prev;
          if (drone.falling && !falling && ctx.currentTime - drone.lastWhoosh > 1.5) {
            noise(ambient.bus, { t: ctx.currentTime + 0.01, dur: 0.28, peak: 1.0, filter: 'bandpass', f0: 900, f1: 3200, q: 1.2, attack: 0.05 });
            drone.lastWhoosh = ctx.currentTime;
          }
          drone.falling = falling;
        }
      }
      drone.prev = d;
      drone.dist = d;
    },
  };
}
