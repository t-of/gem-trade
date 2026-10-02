'use strict';

// localStorage はほかのアプリと共有される（同じ t-of.github.io のため）。
// キーは必ず 'gem-trade.' で始める。
const STORE = 'gem-trade.';

function load(key, fallback) {
  try {
    const v = localStorage.getItem(STORE + key);
    return v == null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(STORE + key, JSON.stringify(value)); } catch { /* 保存できなくても遊べる */ }
}

WebAppKit.init({ title: 'gem-trade', text: '5色のトークンで発展カードを買い、貴族を迎えて点を競うボードゲームの試作。' });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');
}

// ---- ここからアプリ本体 ----
// 身内用の試作（1 台を回して遊ぶホットシート）。ルールの判定は engine.js、CPU は cpu.js にある
// （どちらも画面・音・保存に触らない純粋な関数）。main.js は呼ぶだけで、見た目・音・保存をする。
import * as Engine from './engine.js';
import * as CPU from './cpu.js';

const CLR = Engine.COLORS;
const COLOR_LABEL = Engine.COLOR_LABEL;
const CARD_BY_ID = Engine.CARD_BY_ID;
const NOBLE_BY_ID = Engine.NOBLE_BY_ID;
const stage = document.getElementById('stage');

// 古い保存形式（v1 以前）は reserved がカードidの配列だった。v2 は { id, level, hidden }。
// hidden は分からないので「相手に見えない」側に倒す（伏せ予約だったことにする）。
function migrateState(s) {
  if (!s || s.v >= 2) return s;
  for (const p of s.players) {
    p.reserved = (p.reserved || []).map((r) => (typeof r === 'string' ? { id: r, level: CARD_BY_ID[r]?.level ?? 1, hidden: true } : r));
    p.nobles = p.nobles || [];
  }
  s.v = 2;
  return s;
}

let state = migrateState(load('state', null));

function persist() { save('state', state); render(); }
// 'home'（ホーム画面）か 'game'。開いたときはいつもホームから。保存はしない（遊び途中の state は残る）
let view = 'home';
document.getElementById('go-home').addEventListener('click', () => { view = 'home'; render(); });

// ---------- CPU の速さ ----------
const CPU_SPEEDS = [1400, 700, 250];
const CPU_SPEED_LABEL = { 1400: 'おそい', 700: 'ふつう', 250: 'はやい' };
let cpuSpeed = load('cpuSpeed', 700);
function setCpuSpeed(ms) { cpuSpeed = ms; save('cpuSpeed', ms); updateToolbar(); render(); }
function cycleCpuSpeed() { setCpuSpeed(CPU_SPEEDS[(CPU_SPEEDS.indexOf(cpuSpeed) + 1) % CPU_SPEEDS.length]); }

// ---------- 効果音（WebAudio で合成。ファイルは使わない） ----------
let muted = load('muted', false);
let actx = null;
// iPhone のマナーモードでも鳴らす（Safari 16.4 以降）。オフのときは 'auto' に戻し、ほかのアプリの音楽を止めない
function setAudioSession(soundOn) {
  try { if (navigator.audioSession) navigator.audioSession.type = soundOn ? 'playback' : 'auto'; } catch { /* 対応していない */ }
}
function ensureAudio() {
  setAudioSession(!muted);
  if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
  if (actx.state === 'suspended') actx.resume();
  return actx;
}
addEventListener('pointerdown', ensureAudio, { once: true });   // 最初のユーザー操作で AudioContext を作る
function beep(freq, dur = 0.12, type = 'sine', gain = 0.15) {
  if (muted) return;
  try {
    const ctx = ensureAudio();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + dur);
  } catch { /* 鳴らなくても遊べる */ }
}
const SOUND = {
  take: () => beep(660, 0.1, 'sine', 0.12),
  buy: () => beep(440, 0.18, 'triangle', 0.15),
  reserve: () => beep(330, 0.15, 'square', 0.08),
  noble: () => { beep(523, 0.15); setTimeout(() => beep(659, 0.2), 90); },
  end: () => { beep(392, 0.2); setTimeout(() => beep(523, 0.25), 150); setTimeout(() => beep(659, 0.35), 300); },
};

// ---------- 移動演出（FLIP 風）----------
// render() は innerHTML で全部描き直すので、動かす前に移動元の位置を取っておき、
// 描き直した後に複製（.fly）を position:fixed で置いて Web Animations API で動かして消す。
function reducedMotion() { return matchMedia('(prefers-reduced-motion: reduce)').matches; }
function flyGhost(fromRect, toRect, innerHtml) {
  if (!fromRect || !toRect || reducedMotion()) return;
  const ghost = document.createElement('div');
  ghost.className = 'fly';
  ghost.innerHTML = innerHtml;
  ghost.style.left = fromRect.left + 'px';
  ghost.style.top = fromRect.top + 'px';
  ghost.style.width = fromRect.width + 'px';
  ghost.style.height = fromRect.height + 'px';
  document.body.appendChild(ghost);
  const dx = toRect.left + toRect.width / 2 - (fromRect.left + fromRect.width / 2);
  const dy = toRect.top + toRect.height / 2 - (fromRect.top + fromRect.height / 2);
  const anim = ghost.animate(
    [{ transform: 'translate(0,0)', opacity: 1 }, { transform: `translate(${dx}px, ${dy}px)`, opacity: 0.2 }],
    { duration: 420, easing: 'ease-in-out' },
  );
  anim.onfinish = () => ghost.remove();
}
function playerRect(idx) {
  const el = document.querySelector(`.players [data-player="${idx}"]`);
  return el ? el.getBoundingClientRect() : null;
}
function bankCoinRect(color) {
  const el = stage.querySelector(`[data-take="${color}"]`);
  return el ? el.getBoundingClientRect() : null;
}

// ヘッダーの小さなボタン（速さの切り替え・ミュート）。render() の外（header は書き直さない）なので手で更新する
const speedBtn = document.getElementById('speed-toggle');
const muteBtn = document.getElementById('mute-toggle');
function updateToolbar() {
  speedBtn.textContent = CPU_SPEED_LABEL[cpuSpeed];
  muteBtn.textContent = muted ? '🔇' : '🔊';
  muteBtn.setAttribute('aria-label', muted ? '音を出す（今は消えている）' : '音を消す');
}
speedBtn.addEventListener('click', cycleCpuSpeed);
muteBtn.addEventListener('click', () => { muted = !muted; save('muted', muted); setAudioSession(!muted); updateToolbar(); });
updateToolbar();

// ---------- 手を1つ進める ----------
// 人の操作もCPUの手も、ここを通して engine.apply() に渡す。アニメーションに要る「動かす前の位置」は
// 書き換える前に取っておき、書き換えたあとに飛ばす。
let takeSel = [];   // 「取る」で選択中の色（画面だけの状態。engine の state には持たせない）

function applyMove(move) {
  const buyerIdx = state.current;
  const wasOver = !!state.result;
  const prevNobleCount = state.players[buyerIdx].nobles.length;
  // 1枚だけ条件を満たす貴族は自動で迎える（engine.apply の中で起きる）ので、飛ばす先を先に控えておく
  const nobleRectBefore = {};
  for (const id of state.nobles) nobleRectBefore[id] = stage.querySelector(`[data-noble="${id}"]`)?.getBoundingClientRect();

  let afterFly = () => {};
  if (move.type === 'take') {
    const fromRects = move.colors.map((c) => bankCoinRect(c));
    state = Engine.apply(state, move);
    SOUND.take();
    const toRect = playerRect(buyerIdx);
    afterFly = () => move.colors.forEach((c, i) => flyGhost(fromRects[i], toRect, coinHtml(c, '')));
  } else if (move.type === 'reserve') {
    const fromCardRect = (move.cardId ? stage.querySelector(`[data-card="${move.cardId}"]`) : stage.querySelector(`[data-reserve-top="${move.level}"]`))?.getBoundingClientRect();
    const goldFromRect = state.bank.gold > 0 ? bankCoinRect('gold') : null;
    state = Engine.apply(state, move);
    SOUND.reserve();
    const toRect = playerRect(buyerIdx);
    afterFly = () => { flyGhost(fromCardRect, toRect, '<div class="card card--back card--small"></div>'); flyGhost(goldFromRect, toRect, coinHtml('gold', '')); };
  } else if (move.type === 'buy') {
    const card = CARD_BY_ID[move.cardId];
    const cardFromRect = stage.querySelector(`[data-card="${move.cardId}"]`)?.getBoundingClientRect();
    const paid = Engine.payFor(card, state.players[buyerIdx]);
    const payFromRects = {};
    for (const c of [...CLR, 'gold']) if (paid[c] > 0) payFromRects[c] = stage.querySelector(`.players [data-player="${buyerIdx}"] .coin--${c}`)?.getBoundingClientRect();
    state = Engine.apply(state, move);
    SOUND.buy();
    afterFly = () => { flyGhost(cardFromRect, playerRect(buyerIdx), cardHtml(card, { clickable: false })); for (const c of Object.keys(payFromRects)) flyGhost(payFromRects[c], bankCoinRect(c), coinHtml(c, '')); };
  } else if (move.type === 'noble') {
    const fromRect = stage.querySelector(`[data-noble="${move.id}"]`)?.getBoundingClientRect();
    state = Engine.apply(state, move);
    SOUND.noble();
    afterFly = () => flyGhost(fromRect, playerRect(buyerIdx), nobleHtml(move.id));
  } else {
    state = Engine.apply(state, move);   // discard / pass: 動きはない
  }

  const actor = state.players[buyerIdx];
  if (move.type !== 'noble' && actor && actor.nobles.length > prevNobleCount) {
    const gainedId = actor.nobles[actor.nobles.length - 1];
    SOUND.noble();
    const fromRect = nobleRectBefore[gainedId];
    const prevAfterFly = afterFly;
    afterFly = () => { prevAfterFly(); flyGhost(fromRect, playerRect(buyerIdx), nobleHtml(gainedId)); };
  }
  if (!wasOver && state.result) SOUND.end();

  takeSel = [];
  persist();
  afterFly();
}

// ---------- 取る操作の選択状態 ----------

// 選択は色の配列。同じ色だけが2つなら「同じ色を2枚」、違う色が並べば「違う色を3枚」とみなす。
function toggleTakeColor(color) {
  if (takeSel.length && takeSel.every((c) => c === color)) {
    // 同じ色を積み増す（2枚まで。4枚以上あるときだけ）
    if (takeSel.length < 2 && state.bank[color] >= 4) takeSel.push(color);
    else takeSel = [];   // これ以上は積めない → 選び直し
  } else if (takeSel.includes(color)) {
    takeSel = takeSel.filter((c) => c !== color);   // 選択を外す
  } else {
    if (takeSel.length === 2 && takeSel[0] === takeSel[1]) return;   // 同じ色2枚の途中に別の色は足せない
    if (takeSel.length >= 3) return;
    takeSel.push(color);
  }
  render();
}
function selectionIsValid() {
  if (takeSel.length === 0) return false;
  const uniq = new Set(takeSel);
  if (uniq.size === 1) return takeSel.length === 2 && state.bank[takeSel[0]] >= 4;
  const availableColors = CLR.filter((c) => state.bank[c] > 0).length;
  return takeSel.length === Math.min(3, availableColors) && uniq.size === takeSel.length;
}

// ---------- 画面 ----------

// コイン（宝石トークン）。金縁の丸いトークンの中にその宝石を描く。数は右下の小さな丸に出す。
function coinHtml(color, n) {
  return `<span class="coin coin--${color}">${gemSvg(color)}<span class="coin__n">${n}</span></span>`;
}
// 獲得したカード（ボーナス）。縦長の小さなカードに宝石と枚数を描く。
function tokenDot(color, n) {
  return `<span class="tok tok--${color}">${gemSvg(color)}<span class="tok__n">${n}</span></span>`;
}
// 宝石の絵。index.html の <symbol id="gem-xxx"> を <use> で呼ぶだけ（中身は共通化して軽くする）。
function gemSvg(color) {
  return `<svg class="gem" viewBox="0 0 100 100" aria-hidden="true"><use href="#gem-${color}"></use></svg>`;
}
const ROMAN_BY_LEVEL = { 1: 'I', 2: 'II', 3: 'III' };
function cardHtml(card, { clickable = true } = {}) {
  if (!card) return '<div class="card card--back"></div>';
  const cost = CLR.filter((c) => card.cost[c] > 0).map((c) => `
    <span class="card__cost-item"><span class="gem-box gem-box--${c}">${gemSvg(c)}</span><span class="card__cost-n">${card.cost[c]}</span></span>`).join('');
  const label = `${COLOR_LABEL[card.bonus]}の宝石、${card.points}点。値段 ${CLR.filter((c) => card.cost[c] > 0).map((c) => COLOR_LABEL[c] + card.cost[c]).join('・')}`;
  return `
    <div class="card card--lv${card.level} card--bonus-${card.bonus}" data-card="${card.id}" ${clickable ? '' : 'data-noclick'} aria-label="${label}">
      ${card.points ? `<span class="card__pts">${card.points}</span>` : ''}
      <span class="card__bonus">${gemSvg(card.bonus)}</span>
      <div class="card__cost">${cost}</div>
    </div>`;
}
// 山札（裏面）。レベルをローマ数字で出す。中身は見せない
function deckHtml(level, count) {
  return `<div class="deck deck--lv${level}" data-reserve-top="${level}">
    <span class="deck__numeral">${ROMAN_BY_LEVEL[level]}</span>
    <span class="deck__count">${count}</span>
  </div>`;
}
function nobleHtml(id) {
  const n = NOBLE_BY_ID[id];
  // 条件はカードのシルエットに枚数を書いて並べる（貴族は買ったカードのボーナスで来るため）
  const req = CLR.filter((c) => n.req[c]).map((c) => `<span class="noble__card noble__card--${c}">${n.req[c]}</span>`).join('');
  const label = `貴族、${n.points}点。条件 ${CLR.filter((c) => n.req[c]).map((c) => COLOR_LABEL[c] + n.req[c] + '枚').join('・')}`;
  return `<div class="noble" data-noble="${id}" aria-label="${label}">
    <svg class="noble__crest" viewBox="0 0 100 100" aria-hidden="true"><use href="#crest"></use></svg>
    <div class="noble__pts">${n.points}</div>
    <div class="noble__req">${req}</div>
  </div>`;
}

function render() {
  document.getElementById('go-home').hidden = view === 'home';
  if (view === 'game' && state && !state.result && state.players[state.current].cpu && !cpuTimer) {
    cpuTimer = setTimeout(() => { cpuTimer = null; if (view === 'game') cpuStep(); }, cpuSpeed);
  }
  if (view === 'home' || !state) { renderHome(); return; }
  if (state.result) { renderResult(); return; }
  if (state.pendingNoble) { renderNobleChoice(); return; }
  if (state.pendingDiscard) { renderDiscard(); return; }
  renderBoard();
  fitBoard();
}

// 盤面を画面いっぱいまで拡大する。横は幅に、縦は画面に収まるところまで（スマホ幅は下に積むプレイヤーを除く）
function fitBoard() {
  const board = stage.querySelector('.board');
  if (!board) return;
  board.style.zoom = 1;
  const b = board.getBoundingClientRect();
  const m = board.querySelector('.board__main').getBoundingClientRect();
  const below = document.querySelector('.credit').offsetHeight + 16;
  const h = matchMedia('(min-width: 640px)').matches ? b.height : m.height;  // 広い画面はプレイヤーも横に並ぶ
  const k = Math.min(stage.clientWidth / b.width, (innerHeight - m.top - below) / h);
  board.style.zoom = Math.max(1, k);
}
addEventListener('resize', fitBoard);

function renderHome() {
  const playing = state && !state.result;
  stage.innerHTML = `
    <div class="home">
      <div class="home__gems">${['white', 'blue', 'green', 'red', 'black'].map((c) => `<span class="gem-box gem-box--${c}">${gemSvg(c)}</span>`).join('')}</div>
      <h2 class="home__title">gem-trade</h2>
      <p class="home__hint">宝石を集めてカードを買い、先に15点をめざす。1 台を回して遊ぶ。</p>
      ${playing ? `<button class="pill pill--big" id="resume">つづきから（${state.numPlayers} 人）</button>` : ''}
      <p class="home__label">${playing ? '新しく始める' : '人数を選んで始める'}</p>
      <div class="setup__players">
        ${[2, 3, 4].map((n) => `<button class="pill pill--big" data-new="${n}">${n} 人</button>`).join('')}
      </div>
      <p class="home__label">CPU と遊ぶ</p>
      <div class="setup__players">
        ${[1, 2, 3].map((n) => `<button class="pill pill--big" data-new="${n + 1}" data-cpu="${n}">CPU ${n}</button>`).join('')}
        <button class="pill pill--big" data-new="4" data-cpu="4">CPU だけ</button>
      </div>
      <p class="home__label">CPU の速さ</p>
      <div class="setup__players">
        ${CPU_SPEEDS.map((ms) => `<button class="pill ${ms === cpuSpeed ? 'pill--sel' : ''}" data-speed="${ms}">${CPU_SPEED_LABEL[ms]}</button>`).join('')}
      </div>
    </div>`;
  if (playing) document.getElementById('resume').addEventListener('click', () => { view = 'game'; render(); });
  stage.querySelectorAll('[data-new]').forEach((b) => b.addEventListener('click', () => {
    if (playing && !confirm('遊んでいる途中のゲームは消えます。新しく始めますか？')) return;
    state = Engine.newGame(Number(b.dataset.new), Number(b.dataset.cpu || 0));
    view = 'game';
    persist();
  }));
  stage.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => setCpuSpeed(Number(b.dataset.speed))));
}
function renderResult() {
  const names = state.result.map((i) => state.players[i]);
  stage.innerHTML = `
    <div class="result">
      <h2>ゲーム終了</h2>
      <ol class="result__list">
        ${names.map((p, rank) => `<li>${rank === 0 ? '🏆 ' : ''}${p.name} — ${p.points} 点（カード ${p.bought.length} 枚）</li>`).join('')}
      </ol>
      <button class="pill pill--big" id="again">もう一度遊ぶ</button>
    </div>`;
  document.getElementById('again').addEventListener('click', () => { state = null; view = 'home'; persist(); });
}

function renderNobleChoice() {
  stage.innerHTML = `
    <div class="modal">
      <h3>迎える貴族を選ぶ</h3>
      <div class="modal__nobles">${state.pendingNoble.map(nobleHtml).join('')}</div>
    </div>`;
  stage.querySelectorAll('[data-noble]').forEach((el) => el.addEventListener('click', () => applyMove({ type: 'noble', id: el.dataset.noble })));
}

function renderDiscard() {
  const player = state.players[state.current];
  stage.innerHTML = `
    <div class="modal">
      <h3>${player.name}: トークンを ${state.pendingDiscard.need} 枚戻す</h3>
      <div class="modal__tokens">
        ${[...CLR, 'gold'].filter((c) => player.tokens[c] > 0).map((c) => `<button class="tok-btn" data-discard="${c}">${coinHtml(c, player.tokens[c])}</button>`).join('')}
      </div>
    </div>`;
  stage.querySelectorAll('[data-discard]').forEach((el) => el.addEventListener('click', () => applyMove({ type: 'discard', color: el.dataset.discard })));
}

function playerSummary(p, idx, { isCurrent }) {
  const bonusHtml = CLR.filter((c) => p.bonuses[c] > 0).map((c) => tokenDot(c, p.bonuses[c])).join('')
    + p.nobles.map((id) => nobleHtml(id).replace('class="noble"', 'class="noble noble--mini"')).join('');
  const tokenHtml = [...CLR, 'gold'].filter((c) => p.tokens[c] > 0).map((c) => coinHtml(c, p.tokens[c])).join('');
  return `
    <div class="player ${isCurrent ? 'player--current' : ''}" data-player="${idx}">
      <div class="player__head"><strong>${p.name}</strong><span class="player__pts">${p.points} 点</span></div>
      <div class="player__row">${bonusHtml || '<span class="muted">ボーナスなし</span>'}</div>
      <div class="player__row">${tokenHtml || '<span class="muted">トークンなし</span>'}</div>
      ${isCurrent
        ? `<div class="player__reserved">${p.reserved.length ? p.reserved.map((r) => cardHtml(CARD_BY_ID[r.id])).join('') : '<span class="muted">予約なし</span>'}</div>`
        : `<div class="player__reserved player__reserved--back">${p.reserved.map(() => '<div class="card card--back card--small"></div>').join('')}</div>`}
    </div>`;
}

function renderBoard() {
  const player = state.players[state.current];
  const availableColors = CLR.filter((c) => state.bank[c] > 0);
  const takeValid = selectionIsValid();

  stage.innerHTML = `
    <div class="board">
      <div class="board__main">
      <div class="nobles">${state.nobles.map(nobleHtml).join('')}</div>

      ${[3, 2, 1].map((level) => `
        <div class="level">
          ${deckHtml(level, state.decks[level].length)}
          <div class="level__cards">${state.board[level].map((id) => cardHtml(CARD_BY_ID[id])).join('')}</div>
        </div>`).join('')}

      <div class="tokens">
        ${[...CLR, 'gold'].map((c) => `
          <button class="tok-btn ${c === 'gold' ? 'tok-btn--gold' : ''} ${takeSel.includes(c) ? 'tok-btn--sel' : ''}" data-take="${c}" ${c === 'gold' || state.bank[c] === 0 ? 'disabled' : ''}>
            ${coinHtml(c, state.bank[c])}
            ${takeSel.filter((x) => x === c).length === 2 ? '<span class="tok-btn__x2">×2</span>' : ''}
          </button>`).join('')}
      </div>
      <div class="take-bar">
        <span class="muted">${availableColors.length < 3 ? '場に残る色が少ないので、取れる分だけ選べる' : '違う色を3枚、または同じ色を2枚（4枚以上あるとき）選ぶ'}</span>
        <button class="pill" id="take-go" ${takeValid ? '' : 'disabled'}>取る</button>
      </div>
      </div>

      <div class="players">
        ${state.players.map((p, i) => playerSummary(p, i, { isCurrent: i === state.current })).join('')}
      </div>
    </div>

    <div class="sheet" id="card-sheet" hidden></div>`;

  stage.querySelectorAll('[data-take]').forEach((b) => !b.disabled && b.addEventListener('click', () => toggleTakeColor(b.dataset.take)));
  document.getElementById('take-go').addEventListener('click', () => applyMove({ type: 'take', colors: takeSel.slice() }));
  stage.querySelectorAll('[data-reserve-top]').forEach((b) => b.addEventListener('click', () => {
    const level = Number(b.dataset.reserveTop);
    if (state.decks[level].length === 0 || player.reserved.length >= 3) return;
    openCardSheet(null, level, true);
  }));
  stage.querySelectorAll('.card[data-card]').forEach((el) => el.addEventListener('click', () => {
    const id = el.dataset.card;
    const level = CARD_BY_ID[id].level;
    const onBoard = state.board[level].includes(id);
    openCardSheet(id, level, false, onBoard);
  }));
}

function openCardSheet(cardId, level, isDeckTop, onBoard) {
  const player = state.players[state.current];
  const card = cardId ? CARD_BY_ID[cardId] : null;
  const sheet = document.getElementById('card-sheet');
  const fromBoard = onBoard === true;
  const canBuy = card && Engine.canAfford(card, player);
  const canReserve = player.reserved.length < 3 && (isDeckTop || fromBoard);
  sheet.hidden = false;
  sheet.innerHTML = `
    <div class="sheet__inner">
      ${card ? cardHtml(card, { clickable: false }) : '<div class="card card--back">山札の一番上</div>'}
      <div class="sheet__buttons">
        ${card ? `<button class="pill" id="sheet-buy" ${canBuy ? '' : 'disabled'}>買う</button>` : ''}
        ${!fromBoard && card ? '' : `<button class="pill" id="sheet-reserve" ${canReserve ? '' : 'disabled'}>予約</button>`}
        <button class="pill pill--ghost" id="sheet-close">とじる</button>
      </div>
    </div>`;
  document.getElementById('sheet-close').addEventListener('click', closeSheet);
  const buyBtn = document.getElementById('sheet-buy');
  if (buyBtn) buyBtn.addEventListener('click', () => { closeSheet(); applyMove({ type: 'buy', cardId, fromBoard: fromBoard ? level : null }); });
  const reserveBtn = document.getElementById('sheet-reserve');
  if (reserveBtn) reserveBtn.addEventListener('click', () => { closeSheet(); applyMove({ type: 'reserve', level, cardId: fromBoard ? cardId : null }); });
}
function closeSheet() {
  const sheet = document.getElementById('card-sheet');
  if (sheet) sheet.hidden = true;
}

// ---------- CPU ----------
// 人1 + CPU1 の2人戦は、思考に2秒かける ISMCTS（別スレッド）を使う。それ以外（3〜4人戦・CPUだけの
// モード）は先読みなしの雑なCPU（cpu.js の simpleMove）のまま。今までの対戦相手として残している。
let cpuTimer = null;
let ismctsWorker = null;
let ismctsReqId = 0;

function isIsmctsGame(s) {
  return s.numPlayers === 2 && s.players.filter((p) => p.cpu).length === 1;
}
function requestIsmctsMove(s, viewerIdx, done) {
  try {
    if (!ismctsWorker && typeof Worker !== 'undefined') ismctsWorker = new Worker('./worker.js', { type: 'module' });
  } catch { ismctsWorker = null; }
  if (!ismctsWorker) { done(CPU.ismctsMove(s, viewerIdx, { timeLimitMs: 2000 })); return; }
  const id = ++ismctsReqId;
  const onMsg = (e) => {
    if (e.data.id !== id) return;
    ismctsWorker.removeEventListener('message', onMsg);
    done(e.data.move || CPU.simpleMove(s));
  };
  ismctsWorker.addEventListener('message', onMsg);
  ismctsWorker.addEventListener('error', () => { ismctsWorker = null; done(CPU.simpleMove(s)); }, { once: true });
  ismctsWorker.postMessage({ id, state: s, viewerIdx, opts: { timeLimitMs: 2000 } });
}
function cpuStep() {
  const g = state;
  if (isIsmctsGame(g) && !g.pendingDiscard && !g.pendingNoble) {
    requestIsmctsMove(g, g.current, (move) => { if (state === g) applyMove(move); });
    return;
  }
  applyMove(CPU.simpleMove(g));
}

render();
