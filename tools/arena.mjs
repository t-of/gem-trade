#!/usr/bin/env node
'use strict';
// gem-trade の CPU 同士を戦わせる対戦場（2人戦）。席を入れ替えて N 局し、勝率と95%信頼区間を出す。
//
// 使い方:
//   node tools/arena.mjs <CPU-A> <CPU-B> <局数> [--ms=2000 | --iters=400]
//   CPU の名前: simple（今までの雑なCPU）/ eval（評価関数の1手読み）/ ismcts（評価関数+決定化の探索）
//   --ms / --iters は ismcts の思考時間・反復回数の上限（どちらか一方）。既定は --ms=2000
//
// 例: node tools/arena.mjs simple eval 200
//     node tools/arena.mjs eval ismcts 60 --iters=300

import { newGame, apply, isOver, legalMoves } from '../engine.js';
import { simpleMove, ismctsMove, evaluate } from '../cpu.js';

function evalMove(s) {
  const moves = legalMoves(s);
  if (moves.length === 1) return moves[0];
  let best = -Infinity, bestM = moves[0];
  for (const m of moves) {
    const sc = evaluate(apply(s, m), s.current);
    if (sc > best) { best = sc; bestM = m; }
  }
  return bestM;
}

function makePolicy(name, ismctsOpts) {
  if (name === 'simple') return simpleMove;
  if (name === 'eval') return evalMove;
  if (name === 'ismcts') return (s) => ismctsMove(s, s.current, ismctsOpts);
  throw new Error(`未知のCPU: ${name}（simple / eval / ismcts）`);
}

function playGame(fnFirst, fnSecond, maxSteps = 400) {
  let s = newGame(2, 0, Math.random);
  let steps = 0;
  while (!isOver(s) && steps < maxSteps) {
    const fn = s.current === 0 ? fnFirst : fnSecond;
    s = apply(s, fn(s));
    steps++;
  }
  return s;
}

function wilson95(wins, n) {
  if (n === 0) return [0, 0];
  const p = wins / n, z = 1.96;
  const denom = 1 + z * z / n;
  const center = p + z * z / (2 * n);
  const margin = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [(center - margin) / denom, (center + margin) / denom];
}

function main() {
  const [nameA, nameB, gamesArg, optArg] = process.argv.slice(2);
  if (!nameA || !nameB) {
    console.log('使い方: node tools/arena.mjs <CPU-A> <CPU-B> <局数> [--ms=2000 | --iters=400]');
    process.exit(1);
  }
  const games = Number(gamesArg || 100);
  let ismctsOpts = { timeLimitMs: 2000 };
  const m = optArg && optArg.match(/^--(ms|iters)=(\d+)$/);
  if (m) ismctsOpts = m[1] === 'ms' ? { timeLimitMs: Number(m[2]) } : { maxIters: Number(m[2]) };

  const policyA = makePolicy(nameA, ismctsOpts);
  const policyB = makePolicy(nameB, ismctsOpts);

  let winsA = 0, winsB = 0, unresolved = 0;
  const start = Date.now();
  for (let i = 0; i < games; i++) {
    const aIsFirst = i % 2 === 0;   // 席を入れ替えて先手有利を打ち消す
    const s = aIsFirst ? playGame(policyA, policyB) : playGame(policyB, policyA);
    if (!isOver(s)) { unresolved++; continue; }
    const winnerIsA = aIsFirst ? s.winner === 0 : s.winner === 1;
    if (winnerIsA) winsA++; else winsB++;
  }
  const n = winsA + winsB;
  const [lo, hi] = wilson95(winsA, n);
  const sec = ((Date.now() - start) / 1000).toFixed(1);
  const label = (name) => (name === 'ismcts' ? `ismcts${JSON.stringify(ismctsOpts)}` : name);
  console.log(`${label(nameA)} vs ${label(nameB)}: ${games}局 (${sec}秒)`);
  console.log(`  ${nameA} 勝ち ${winsA} / ${nameB} 勝ち ${winsB} / 未決着 ${unresolved}`);
  console.log(`  ${nameA} の勝率 ${(100 * winsA / n).toFixed(1)}%（95%信頼区間 ${(100 * lo).toFixed(1)}–${(100 * hi).toFixed(1)}%）`);
}

main();
