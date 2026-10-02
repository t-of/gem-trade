#!/usr/bin/env node
'use strict';
// gem-trade の CPU 同士を戦わせる対戦場（2人戦）。席を入れ替えて N 局し、勝率と95%信頼区間を出す。
//
// 使い方:
//   node tools/arena.mjs <CPU-A> <CPU-B> <局数> [--ms=2000 | --iters=400] [--wa='{"points":5}'] [--wb='{...}']
//   CPU の名前: simple（今までの雑なCPU）/ eval（評価関数の1手読み）/ ismcts（評価関数+決定化の探索）
//   --ms / --iters は ismcts の思考時間・反復回数の上限（どちらか一方）。既定は --ms=2000
//   --wa / --wb は A・B の評価関数の重み（DEFAULT_WEIGHTS への上書き分だけのJSON）。eval・ismcts に効く
//
// 例: node tools/arena.mjs simple eval 200
//     node tools/arena.mjs eval eval 200 --wa='{"points":5}'
//     node tools/arena.mjs eval ismcts 60 --iters=300

import { newGame, apply, isOver, legalMoves } from '../engine.js';
import { simpleMove, ismctsMove, evaluate, DEFAULT_WEIGHTS } from '../cpu.js';

function evalMove(s, W) {
  const moves = legalMoves(s);
  if (moves.length === 1) return moves[0];
  let best = -Infinity, bestM = moves[0];
  for (const m of moves) {
    const sc = evaluate(apply(s, m), s.current, W);
    if (sc > best) { best = sc; bestM = m; }
  }
  return bestM;
}

function makePolicy(name, ismctsOpts, W) {
  if (name === 'simple') return simpleMove;
  if (name === 'eval') return (s) => evalMove(s, W);
  if (name === 'ismcts') return (s) => ismctsMove(s, s.current, { ...ismctsOpts, weights: W });
  throw new Error(`未知のCPU: ${name}（simple / eval / ismcts）`);
}

// 山札・貴族の割り当てを固定したrngで配ると、同じ手（デュプリケート戦）を先後入れ替えて戦える。
// 「どちらの山が来たか」の運を消せるぶん、少ない局数でも強さの差が見えやすい。
function makeDealRng(seed) {
  let x = seed >>> 0;
  return () => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff; };
}
function playGame(fnFirst, fnSecond, dealRng, maxSteps = 400) {
  let s = newGame(2, 0, dealRng);
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
  const [nameA, nameB, gamesArg] = process.argv.slice(2);
  if (!nameA || !nameB) {
    console.log('使い方: node tools/arena.mjs <CPU-A> <CPU-B> <局数> [--ms=2000 | --iters=400]');
    process.exit(1);
  }
  const games = Number(gamesArg || 100);
  let ismctsOpts = { timeLimitMs: 2000 };
  const rest = process.argv.slice(5);
  for (const arg of rest) {
    const m = arg.match(/^--(ms|iters)=(\d+)$/);
    if (m) ismctsOpts = m[1] === 'ms' ? { timeLimitMs: Number(m[2]) } : { maxIters: Number(m[2]) };
  }
  const weightsFor = (flag) => {
    const arg = rest.find((a) => a.startsWith(`--${flag}=`));
    if (!arg) return DEFAULT_WEIGHTS;
    return { ...DEFAULT_WEIGHTS, ...JSON.parse(arg.slice(flag.length + 3)) };
  };
  const wA = weightsFor('wa');
  const wB = weightsFor('wb');

  const policyA = makePolicy(nameA, ismctsOpts, wA);
  const policyB = makePolicy(nameB, ismctsOpts, wB);

  let winsA = 0, winsB = 0, unresolved = 0;
  const start = Date.now();
  // 1組 = 同じ山札(seed)でA先手/B先手を1回ずつ（デュプリケート）。運と先手有利の両方を打ち消す。
  for (let i = 0; i < games; i += 2) {
    const seed = 10000 + i * 7919;
    const sA = playGame(policyA, policyB, makeDealRng(seed));
    if (!isOver(sA)) unresolved++; else (sA.winner === 0 ? winsA++ : winsB++);
    if (i + 1 >= games) continue;
    const sB = playGame(policyB, policyA, makeDealRng(seed));
    if (!isOver(sB)) unresolved++; else (sB.winner === 0 ? winsB++ : winsA++);
  }
  const n = winsA + winsB;
  const [lo, hi] = wilson95(winsA, n);
  const sec = ((Date.now() - start) / 1000).toFixed(1);
  const label = (name) => (name === 'ismcts' ? `${name}${JSON.stringify(ismctsOpts)}` : name);
  console.log(`${label(nameA)} vs ${label(nameB)}: ${games}局 (${sec}秒)`);
  console.log(`  ${nameA} 勝ち ${winsA} / ${nameB} 勝ち ${winsB} / 未決着 ${unresolved}`);
  console.log(`  ${nameA} の勝率 ${(100 * winsA / n).toFixed(1)}%（95%信頼区間 ${(100 * lo).toFixed(1)}–${(100 * hi).toFixed(1)}%）`);
}

main();
