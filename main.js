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
// 身内用の試作: 設定・効果音・共有演出は入れない（1 台を回して遊ぶホットシート。テスト用の雑な CPU あり）。
// data.js も素の <script>（同じトップレベルのスコープ）を使うので、同じ名前の const を
// 二重に宣言できない（COLORS・CARDS・NOBLES は data.js 側の名前）。別名で受け取る。
const GT = window.GEM_TRADE_DATA;
const CLR = GT.COLORS;
const CARD_LIST = GT.CARDS;
const NOBLE_LIST = GT.NOBLES;
const TOKENS_PER_PLAYER_COUNT = GT.TOKEN_COUNT_BY_PLAYERS;
const CARD_BY_ID = Object.fromEntries(CARD_LIST.map((c) => [c.id, c]));
const NOBLE_BY_ID = Object.fromEntries(NOBLE_LIST.map((n) => [n.id, n]));
const stage = document.getElementById('stage');

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function emptyTokens() { return { white: 0, blue: 0, green: 0, red: 0, black: 0, gold: 0 }; }
function sumTokens(t) { return CLR.reduce((s, c) => s + t[c], 0) + t.gold; }

function newGame(numPlayers, numCpu = 0) {
  const perColor = TOKENS_PER_PLAYER_COUNT[numPlayers];
  const bank = emptyTokens();
  for (const c of CLR) bank[c] = perColor;
  bank.gold = 5;

  const decks = { 1: [], 2: [], 3: [] };
  for (const level of [1, 2, 3]) decks[level] = shuffle(CARDS.filter((c) => c.level === level).map((c) => c.id));
  const board = { 1: [], 2: [], 3: [] };
  for (const level of [1, 2, 3]) for (let i = 0; i < 4; i++) board[level].push(decks[level].pop());

  const nobles = shuffle(NOBLES.map((n) => n.id)).slice(0, numPlayers + 1);

  const players = Array.from({ length: numPlayers }, (_, i) => ({
    cpu: i >= numPlayers - numCpu,
    name: i >= numPlayers - numCpu ? `CPU${i - (numPlayers - numCpu) + 1}` : `プレイヤー${i + 1}`,
    tokens: emptyTokens(),
    bonuses: emptyTokens(),
    reserved: [],
    bought: [],
    points: 0,
  }));

  return {
    v: 1,
    numPlayers,
    players,
    current: 0,
    bank,
    decks,
    board,
    nobles,
    endAfter: null,     // 誰かが15点に届いたら 0（最初の人）。その回の最後の人まで回して終える
    winner: null,
    result: null,
    pendingDiscard: null,  // { need: 戻す枚数 }
    pendingNoble: null,    // 選べる貴族が2枚以上のときの候補 id 一覧
    selection: { take: [], reserveTop: null }, // 選択中のトークン・予約操作
  };
}

let state = load('state', null);

function persist() { save('state', state); render(); }
// 'home'（ホーム画面）か 'game'。開いたときはいつもホームから。保存はしない（遊び途中の state は残る）
let view = 'home';
document.getElementById('go-home').addEventListener('click', () => { view = 'home'; render(); });

// ---------- ルールの判定 ----------

function effectiveCost(card, player) {
  const cost = {};
  for (const c of CLR) cost[c] = Math.max(0, (card.cost[c] || 0) - player.bonuses[c]);
  return cost;
}
function canAfford(card, player) {
  const cost = effectiveCost(card, player);
  let goldNeed = 0;
  for (const c of CLR) goldNeed += Math.max(0, cost[c] - player.tokens[c]);
  return goldNeed <= player.tokens.gold;
}
function payFor(card, player) {
  const cost = effectiveCost(card, player);
  const paid = emptyTokens();
  let goldNeed = 0;
  for (const c of CLR) {
    const pay = Math.min(cost[c], player.tokens[c]);
    paid[c] = pay;
    goldNeed += cost[c] - pay;
  }
  paid.gold = goldNeed;
  return paid;
}
function refillBoard(level) {
  while (state.board[level].length < 4 && state.decks[level].length) state.board[level].push(state.decks[level].pop());
}
function qualifyingNobles(player) {
  return state.nobles.filter((id) => {
    const n = NOBLE_BY_ID[id];
    return Object.entries(n.req).every(([c, need]) => player.bonuses[c] >= need);
  });
}

// ---------- 手番の進行 ----------

function afterAction() {
  const player = state.players[state.current];
  if (sumTokens(player.tokens) > 10) {
    state.pendingDiscard = { need: sumTokens(player.tokens) - 10 };
    persist();
    return;
  }
  resolveNobleThenAdvance();
}
function resolveNobleThenAdvance() {
  const player = state.players[state.current];
  const q = qualifyingNobles(player);
  if (q.length === 1) {
    player.points += NOBLE_BY_ID[q[0]].points;
    state.nobles = state.nobles.filter((id) => id !== q[0]);
  } else if (q.length > 1) {
    state.pendingNoble = q;
    persist();
    return;
  }
  checkEndCondition();
  advanceTurn();
  persist();
}
function chooseNoble(id) {
  const player = state.players[state.current];
  player.points += NOBLE_BY_ID[id].points;
  state.nobles = state.nobles.filter((n) => n !== id);
  state.pendingNoble = null;
  checkEndCondition();
  advanceTurn();
  persist();
}
function checkEndCondition() {
  const player = state.players[state.current];
  if (player.points >= 15 && state.endAfter === null) state.endAfter = 0;   // 全員の手番の数をそろえる
}
function advanceTurn() {
  const next = (state.current + 1) % state.numPlayers;
  if (state.endAfter !== null && next === state.endAfter) {
    endGame();
    return;
  }
  state.current = next;
  state.selection = { take: [], reserveTop: null };
}
function endGame() {
  const ranked = state.players
    .map((p, i) => ({ i, p }))
    .sort((a, b) => b.p.points - a.p.points || a.p.bought.length - b.p.bought.length);
  state.result = ranked.map((r) => r.i);
  state.winner = state.result[0];
}

// ---------- 操作 ----------

function doTake() {
  const sel = state.selection.take;
  const player = state.players[state.current];
  for (const c of sel) { player.tokens[c]++; state.bank[c]--; }
  state.selection = { take: [], reserveTop: null };
  afterAction();
}
function doReserve(cardId, fromLevel) {
  const player = state.players[state.current];
  if (player.reserved.length >= 3) return;
  if (cardId) {
    const idx = state.board[fromLevel].indexOf(cardId);
    state.board[fromLevel].splice(idx, 1);
    refillBoard(fromLevel);
  } else {
    cardId = state.decks[fromLevel].pop();
  }
  player.reserved.push(cardId);
  if (state.bank.gold > 0) { player.tokens.gold++; state.bank.gold--; }
  afterAction();
}
function doBuy(cardId, fromBoardLevel) {
  const player = state.players[state.current];
  const card = CARD_BY_ID[cardId];
  if (!canAfford(card, player)) return;
  const paid = payFor(card, player);
  for (const c of CLR) { player.tokens[c] -= paid[c]; state.bank[c] += paid[c]; }
  player.tokens.gold -= paid.gold; state.bank.gold += paid.gold;
  player.bonuses[card.bonus]++;
  player.bought.push(cardId);
  player.points += card.points;
  if (fromBoardLevel) {
    const idx = state.board[fromBoardLevel].indexOf(cardId);
    state.board[fromBoardLevel].splice(idx, 1);
    refillBoard(fromBoardLevel);
  } else {
    player.reserved = player.reserved.filter((id) => id !== cardId);
  }
  afterAction();
}
function doDiscard(color) {
  const player = state.players[state.current];
  if (player.tokens[color] <= 0) return;
  player.tokens[color]--; state.bank[color]++;
  state.pendingDiscard.need--;
  if (state.pendingDiscard.need <= 0) {
    state.pendingDiscard = null;
    resolveNobleThenAdvance();
  } else {
    persist();
  }
}

// ---------- 取る操作の選択状態 ----------

// 選択は色の配列。同じ色だけが2つなら「同じ色を2枚」、違う色が並べば「違う色を3枚」とみなす。
function toggleTakeColor(color) {
  const sel = state.selection.take;
  if (sel.length && sel.every((c) => c === color)) {
    // 同じ色を積み増す（2枚まで。4枚以上あるときだけ）
    if (sel.length < 2 && state.bank[color] >= 4) sel.push(color);
    else state.selection.take = [];   // これ以上は積めない → 選び直し
  } else if (sel.includes(color)) {
    state.selection.take = sel.filter((c) => c !== color);   // 選択を外す
  } else {
    if (sel.length === 2 && sel[0] === sel[1]) return;   // 同じ色2枚の途中に別の色は足せない
    if (sel.length >= 3) return;
    sel.push(color);
  }
  render();
}
function selectionIsValid() {
  const sel = state.selection.take;
  if (sel.length === 0) return false;
  const uniq = new Set(sel);
  if (uniq.size === 1) return sel.length === 2 && state.bank[sel[0]] >= 4;
  const availableColors = CLR.filter((c) => state.bank[c] > 0).length;
  return sel.length === Math.min(3, availableColors) && uniq.size === sel.length;
}

// ---------- 画面 ----------

// コイン（宝石トークン）。金縁の丸いトークンの中にその宝石を描く。数は右下の小さな丸に出す。
function coinHtml(color, n) {
  return `<span class="coin coin--${color}">${gemSvg(color)}<span class="coin__n">${n}</span></span>`;
}
function tokenDot(color, n) {
  return `<span class="tok tok--${color}"><span class="tok__n">${n}</span></span>`;
}
// 宝石の絵。index.html の <symbol id="gem-xxx"> を <use> で呼ぶだけ（中身は共通化して軽くする）。
function gemSvg(color) {
  return `<svg class="gem" viewBox="0 0 100 100" aria-hidden="true"><use href="#gem-${color}"></use></svg>`;
}
const ROMAN_BY_LEVEL = { 1: 'I', 2: 'II', 3: 'III' };
function cardHtml(card, { clickable = true } = {}) {
  if (!card) return '<div class="card card--back"></div>';
  const cost = CLR.filter((c) => card.cost[c] > 0).map((c) => `
    <span class="card__cost-item"><span class="gem-box gem-box--${c}">${gemSvg(c)}</span>${card.cost[c]}</span>`).join('');
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
    cpuTimer = setTimeout(() => { cpuTimer = null; if (view === 'game') cpuStep(); }, 700);
  }
  if (view === 'home' || !state) { renderHome(); return; }
  if (state.result) { renderResult(); return; }
  if (state.pendingNoble) { renderNobleChoice(); return; }
  if (state.pendingDiscard) { renderDiscard(); return; }
  renderBoard();
}

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
      <p class="home__label">CPU と遊ぶ（テスト用）</p>
      <div class="setup__players">
        ${[1, 2, 3].map((n) => `<button class="pill pill--big" data-new="${n + 1}" data-cpu="${n}">CPU ${n}</button>`).join('')}
        <button class="pill pill--big" data-new="4" data-cpu="4">CPU だけ</button>
      </div>
    </div>`;
  if (playing) document.getElementById('resume').addEventListener('click', () => { view = 'game'; render(); });
  stage.querySelectorAll('[data-new]').forEach((b) => b.addEventListener('click', () => {
    if (playing && !confirm('遊んでいる途中のゲームは消えます。新しく始めますか？')) return;
    state = newGame(Number(b.dataset.new), Number(b.dataset.cpu || 0));
    view = 'game';
    persist();
  }));
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
  stage.querySelectorAll('[data-noble]').forEach((el) => el.addEventListener('click', () => chooseNoble(el.dataset.noble)));
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
  stage.querySelectorAll('[data-discard]').forEach((el) => el.addEventListener('click', () => doDiscard(el.dataset.discard)));
}

function playerSummary(p, idx, { isCurrent }) {
  const bonusHtml = CLR.filter((c) => p.bonuses[c] > 0).map((c) => tokenDot(c, p.bonuses[c])).join('');
  const tokenHtml = [...CLR, 'gold'].filter((c) => p.tokens[c] > 0).map((c) => coinHtml(c, p.tokens[c])).join('');
  return `
    <div class="player ${isCurrent ? 'player--current' : ''}">
      <div class="player__head"><strong>${p.name}</strong><span class="player__pts">${p.points} 点</span></div>
      <div class="player__row">${bonusHtml || '<span class="muted">ボーナスなし</span>'}</div>
      <div class="player__row">${tokenHtml || '<span class="muted">トークンなし</span>'}</div>
      ${isCurrent
        ? `<div class="player__reserved">${p.reserved.length ? p.reserved.map((id) => cardHtml(CARD_BY_ID[id])).join('') : '<span class="muted">予約なし</span>'}</div>`
        : `<div class="player__reserved player__reserved--back">${p.reserved.map(() => '<div class="card card--back card--small"></div>').join('')}</div>`}
    </div>`;
}

function renderBoard() {
  const player = state.players[state.current];
  const availableColors = CLR.filter((c) => state.bank[c] > 0);
  const sel = state.selection.take;
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
          <button class="tok-btn ${c === 'gold' ? 'tok-btn--gold' : ''} ${sel.includes(c) ? 'tok-btn--sel' : ''}" data-take="${c}" ${c === 'gold' || state.bank[c] === 0 ? 'disabled' : ''}>
            ${coinHtml(c, state.bank[c])}
            ${sel.filter((x) => x === c).length === 2 ? '<span class="tok-btn__x2">×2</span>' : ''}
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
  document.getElementById('take-go').addEventListener('click', doTake);
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
  const canBuy = card && canAfford(card, player);
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
  if (buyBtn) buyBtn.addEventListener('click', () => { closeSheet(); doBuy(cardId, fromBoard ? level : null); });
  const reserveBtn = document.getElementById('sheet-reserve');
  if (reserveBtn) reserveBtn.addEventListener('click', () => { closeSheet(); doReserve(fromBoard ? cardId : null, level); });
}
function closeSheet() {
  const sheet = document.getElementById('card-sheet');
  if (sheet) sheet.hidden = true;
}

// ---------- CPU（テスト用の雑な CPU） ----------
// ponytail: 先読みなし。買えるなら一番点の高いカード、無理なら一番近いカードに要る色を取る。
// 強くしたくなったら、貴族や相手の邪魔も点に入れる。
let cpuTimer = null;

function cpuMissing(card, p) {
  const cost = effectiveCost(card, p);
  return CLR.reduce((s, c) => s + Math.max(0, cost[c] - p.tokens[c]), 0) - p.tokens.gold;
}
function cpuCandidates(p) {
  const board = [1, 2, 3].flatMap((lv) => state.board[lv].map((id) => ({ id, lv })));
  return [...board, ...p.reserved.map((id) => ({ id, lv: null }))];
}
function cpuTarget(p) {
  const score = (x) => cpuMissing(CARD_BY_ID[x.id], p) - CARD_BY_ID[x.id].points;
  return cpuCandidates(p).sort((a, b) => score(a) - score(b))[0];
}
function cpuStep() {
  const p = state.players[state.current];
  if (state.pendingNoble) { chooseNoble(state.pendingNoble[0]); return; }
  if (state.pendingDiscard) {
    // 狙いのカードに要らない色から、多く持っている色から戻す
    const t = cpuTarget(p);
    const cost = t ? effectiveCost(CARD_BY_ID[t.id], p) : emptyTokens();
    const spare = (c) => p.tokens[c] - (cost[c] || 0);
    const c = CLR.filter((x) => p.tokens[x] > 0).sort((a, b) => spare(b) - spare(a))[0] || 'gold';
    doDiscard(c);
    return;
  }
  const buyable = cpuCandidates(p).filter((x) => canAfford(CARD_BY_ID[x.id], p));
  if (buyable.length) {
    const best = buyable.sort((a, b) => CARD_BY_ID[b.id].points - CARD_BY_ID[a.id].points)[0];
    doBuy(best.id, best.lv);
    return;
  }
  const t = cpuTarget(p);
  const avail = CLR.filter((c) => state.bank[c] > 0);
  // トークンがいっぱいで取れないときは予約して金をもらう
  if ((sumTokens(p.tokens) >= 9 || !avail.length) && p.reserved.length < 3 && t && t.lv) { doReserve(t.id, t.lv); return; }
  if (avail.length) {
    const cost = t ? effectiveCost(CARD_BY_ID[t.id], p) : emptyTokens();
    const need = (c) => cost[c] - p.tokens[c];
    state.selection.take = avail.sort((a, b) => need(b) - need(a)).slice(0, 3);
    doTake();
    return;
  }
  // 何もできない: 手番を飛ばす
  advanceTurn();
  persist();
}

render();
