'use strict';
// engine.js・cpu.js の自己チェック。フレームワークなし。node --test で動く。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from './engine.js';
import * as CPU from './cpu.js';

// ランダムな手はほとんど買い物をしないので15点には届きにくい。ここでは「何手打ってもassertが
// 落ちない・不変条件が崩れない」ことだけを見る（終局まで進むかは simpleMove のテストで見る）。
function fuzzGame(numPlayers, rng, steps) {
  let s = E.newGame(numPlayers, 0, rng);
  for (let i = 0; i < steps && !E.isOver(s); i++) {
    const moves = E.legalMoves(s);
    assert.ok(moves.length > 0, '合法手が0になった');
    s = E.apply(s, moves[Math.floor(rng() * moves.length)]);
    const total = E.COLORS.reduce((sum, c) => sum + s.bank[c] + s.players.reduce((t, p) => t + p.tokens[c], 0), 0);
    assert.equal(total, E.TOKEN_COUNT_BY_PLAYERS[numPlayers] * E.COLORS.length, 'トークンの総数が変わった');
  }
  return s;
}

test('カード90枚・貴族10枚', () => {
  assert.equal(E.CARDS.length, 90);
  assert.equal(E.NOBLES.length, 10);
});

test('ランダム対局（2〜4人）を重ねても不変条件が崩れない', () => {
  let rngState = 1;
  const rng = () => { rngState = (rngState * 1103515245 + 12345) & 0x7fffffff; return rngState / 0x7fffffff; };
  for (let i = 0; i < 200; i++) {
    const n = 2 + (i % 3);
    const s = fuzzGame(n, rng, 50);
    if (E.isOver(s)) assert.equal(s.result.length, n);
  }
});

test('simpleMove 同士なら最後まで終局する（2〜4人）', () => {
  let rngState = 11;
  const rng = () => { rngState = (rngState * 1103515245 + 12345) & 0x7fffffff; return rngState / 0x7fffffff; };
  for (const n of [2, 3, 4]) {
    let s = E.newGame(n, 0, rng);
    let steps = 0;
    while (!E.isOver(s) && steps < 300) { s = E.apply(s, CPU.simpleMove(s)); steps++; }
    assert.ok(E.isOver(s), `${n}人戦が${steps}手で終わらなかった`);
    assert.ok(s.players.some((p) => p.points >= 15));
  }
});

test('unseenCards: 90枚から見えたカードを引いた数 = 残り山札 + 相手の伏せ予約', () => {
  let rngState = 7;
  const rng = () => { rngState = (rngState * 1103515245 + 12345) & 0x7fffffff; return rngState / 0x7fffffff; };
  let s = E.newGame(2, 0, rng);
  for (let i = 0; i < 30 && !E.isOver(s); i++) {
    const moves = E.legalMoves(s);
    s = E.apply(s, moves[Math.floor(rng() * moves.length)]);
  }
  for (const viewer of [0, 1]) {
    const unseen = E.unseenCards(s, viewer);
    const deckTotal = [1, 2, 3].reduce((sum, lv) => sum + s.decks[lv].length, 0);
    const hiddenOpponentReserved = s.players[1 - viewer].reserved.filter((r) => r.hidden).length;
    assert.equal(unseen.length, deckTotal + hiddenOpponentReserved);
    assert.equal(new Set(unseen).size, unseen.length, '重複がある');
  }
});

test('determinize: 山札の枚数は変わらず、見えているカードの中身も変わらない', () => {
  const rng = () => 0.37;
  let s = E.newGame(2, 0, Math.random);
  s = E.apply(s, { type: 'reserve', level: 1, cardId: null }); // 手番0が伏せて予約（相手には見えない）
  const d = E.determinize(s, 1, rng); // プレイヤー1視点
  for (const lv of [1, 2, 3]) assert.equal(d.decks[lv].length, s.decks[lv].length);
  for (const lv of [1, 2, 3]) assert.deepEqual(d.board[lv], s.board[lv]);
  assert.notEqual(d.players[0].reserved[0].id, undefined);
});

test('simpleMove・evaluate・ismctsMove が例外を投げずに合法手を返す', () => {
  let rngState = 3;
  const rng = () => { rngState = (rngState * 1103515245 + 12345) & 0x7fffffff; return rngState / 0x7fffffff; };
  let s = E.newGame(2, 0, rng);
  for (let i = 0; i < 20 && !E.isOver(s); i++) {
    const simple = CPU.simpleMove(s);
    const moves = E.legalMoves(s);
    assert.ok(moves.some((m) => JSON.stringify(m) === JSON.stringify(simple)), 'simpleMoveが非合法手を返した');
    assert.equal(typeof CPU.evaluate(s, s.current), 'number');
    const ism = CPU.ismctsMove(s, s.current, { maxIters: 20 });
    assert.ok(moves.some((m) => JSON.stringify(m) === JSON.stringify(ism)), 'ismctsMoveが非合法手を返した');
    s = E.apply(s, simple);
  }
});
