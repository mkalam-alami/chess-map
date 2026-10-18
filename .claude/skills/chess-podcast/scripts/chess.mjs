#!/usr/bin/env node
// Outils de vérification pour le skill chess-podcast (voir ../SKILL.md).
// Usage : node .claude/skills/chess-podcast/scripts/chess.mjs <tree|line|piece> …
import { readFileSync } from 'node:fs';
import { Chess } from 'chess.js';

const NAMES = { k: 'roi', q: 'dame', r: 'tour', b: 'fou', n: 'cavalier', p: 'pion' };
const VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
const SAN_PIECES = { K: 'Roi', Q: 'Dame', R: 'Tour', B: 'Fou', N: 'Cavalier' };
const BRUSHES = { green: 'verte', red: 'rouge', blue: 'bleue', yellow: 'jaune' };
const SIDES = { w: 'blancs', b: 'noirs' };
const DIRECTIONS = { r: [[1, 0], [-1, 0], [0, 1], [0, -1]], b: [[1, 1], [1, -1], [-1, 1], [-1, -1]] };
DIRECTIONS.q = [...DIRECTIONS.r, ...DIRECTIONS.b];
const FILES = 'abcdefgh';

const USAGE = `Usage :
  chess.mjs tree <carte.chessmap.json>
      Arbre du répertoire : id court, coups numérotés, notes, flèches/cercles.
  chess.mjs line <coups SAN…>
  chess.mjs line --map <carte.json> --node <id> [--played <n>]
      Rejoue une ligne (erreur au premier coup illégal) et, pour chaque demi-coup :
      notation TTS, prise, échec, nouvelles attaques, clouages, pièces en prise.
  chess.mjs piece <case> <coups SAN…>   (ou --map/--node/--played)
      Après la ligne : chaque coup légal de la pièce sur <case>, avec les
      attaquants et défenseurs de la case d'arrivée (dame piégée, fuite sûre…).`;

/** `e4` → `E_4`, la forme lue correctement par le TTS. */
const tts = (square) => `${square[0].toUpperCase()}_${square[1]}`;
const label = (piece, square) => `${NAMES[piece.type]} ${tts(square)}`;
const other = (color) => (color === 'w' ? 'b' : 'w');

/** Notation française pour le TTS : « Cavalier prend F_6, échec », « E prend D_5 ». */
function speak(move) {
  let text;
  if (move.san.startsWith('O-O-O')) text = 'Grand roque';
  else if (move.san.startsWith('O-O')) text = 'Petit roque';
  else {
    const piece = SAN_PIECES[move.san[0]];
    const ambiguous = piece && /^[KQRBN][a-h1-8]x?[a-h][1-8]/.test(move.san);
    const origin = ambiguous ? ` ${tts(move.from)}` : '';
    const action = move.captured ? ' prend ' : ambiguous ? ' en ' : piece ? ' ' : '';
    const mover = piece ? `${piece}${origin}` : move.captured ? move.from[0].toUpperCase() : '';
    text = `${mover}${action}${tts(move.to)}`.trim();
    if (move.promotion) text += `, promotion en ${NAMES[move.promotion]}`;
  }
  if (move.san.endsWith('#')) return `${text}, mat`;
  return move.san.endsWith('+') ? `${text}, échec` : text;
}

function pieces(chess, color) {
  return chess.board().flat().filter((p) => p && p.color === color);
}

/** Cases des pièces `color` attaquées par l'adversaire, avec leurs attaquants. */
function attacked(chess, color) {
  const result = new Map();
  for (const p of pieces(chess, color)) {
    const by = chess.attackers(p.square, other(color));
    if (by.length) result.set(p.square, by);
  }
  return result;
}

/** « attaquants : fou G_5 ; défenseurs : 1 » (neutre en genre, pour toutes les pièces). */
function guards(chess, by, defenders) {
  return `attaquants : ${by.map((s) => label(chess.get(s), s)).join(', ') || 'aucun'} ; défenseurs : ${defenders.length}`;
}

/** En prise : non défendue, ou attaquée par une pièce de moindre valeur. */
function hanging(chess, color) {
  const out = [];
  for (const [square, by] of attacked(chess, color)) {
    const piece = chess.get(square);
    if (piece.type === 'k') continue;
    const defenders = chess.attackers(square, color);
    const cheapest = Math.min(...by.map((s) => VALUES[chess.get(s).type]));
    if (!defenders.length || cheapest < VALUES[piece.type]) {
      out.push(`${label(piece, square)} (${guards(chess, by, defenders)})`);
    }
  }
  return out;
}

/** Clouages des pièces longues de `color` : pièce adverse devant le roi, ou devant une pièce plus précieuse que la cloueuse. */
function pins(chess, color) {
  const out = [];
  for (const p of pieces(chess, color)) {
    for (const [df, dr] of DIRECTIONS[p.type] ?? []) {
      const hits = [];
      let f = FILES.indexOf(p.square[0]) + df;
      let r = Number(p.square[1]) + dr;
      while (f >= 0 && f < 8 && r >= 1 && r <= 8 && hits.length < 2) {
        const square = `${FILES[f]}${r}`;
        const piece = chess.get(square);
        if (piece) hits.push({ square, piece });
        f += df;
        r += dr;
      }
      const [front, back] = hits;
      if (front && back && front.piece.color !== color && back.piece.color !== color
        && VALUES[back.piece.type] > VALUES[front.piece.type] && VALUES[back.piece.type] > VALUES[p.type]) {
        out.push(`${label(p, p.square)} cloue ${label(front.piece, front.square)} sur ${label(back.piece, back.square)}`);
      }
    }
  }
  return out;
}

function loadMaps(file) {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  if (data.map) return [data.map];
  if (data.maps) return Object.values(data.maps);
  return [data];
}

/** Coups SAN depuis la racine jusqu'au nœud (id ou préfixe d'id), `played` coups de son segment. */
function pathTo(file, prefix, played) {
  for (const map of loadMaps(file)) {
    const node = Object.values(map.nodes).find((n) => n.id.startsWith(prefix));
    if (!node) continue;
    const segments = [node.moves.slice(0, played ?? node.moves.length)];
    for (let n = map.nodes[node.parentId]; n; n = map.nodes[n.parentId]) segments.unshift(n.moves);
    return segments.flat();
  }
  throw new Error(`Nœud introuvable : ${prefix}`);
}

function parseLine(args) {
  const option = (name) => {
    const i = args.indexOf(name);
    return i < 0 ? undefined : args.splice(i, 2)[1];
  };
  const file = option('--map');
  const node = option('--node');
  const played = option('--played');
  if (file && node) return pathTo(file, node, played === undefined ? undefined : Number(played));
  return args.flatMap((a) => a.split(/\s+/)).filter((a) => a && !/^\d+\.+$/.test(a)).map((a) => a.replace(/^\d+\.+/, ''));
}

/** Rejoue la ligne ; arrête le processus au premier coup illégal. */
function replay(moves, onMove = () => {}) {
  const chess = new Chess();
  moves.forEach((san, i) => {
    const before = new Chess(chess.fen());
    let move;
    try {
      move = chess.move(san);
    } catch {
      console.error(`ILLÉGAL : demi-coup ${i + 1} (${Math.floor(i / 2) + 1}${i % 2 ? '...' : '.'} ${san}) dans ${before.fen()}`);
      process.exit(1);
    }
    onMove(move, before, chess, i);
  });
  return chess;
}

function line(args) {
  const moves = parseLine(args);
  const chess = replay(moves, (move, before, after, i) => {
    const mover = move.color;
    const facts = [];
    if (move.captured) facts.push(`prend ${NAMES[move.captured]} ${tts(move.to)}`);
    const was = attacked(before, other(mover));
    for (const [square, by] of attacked(after, other(mover))) {
      const byMoved = by.includes(move.to);
      if (!byMoved && was.has(square)) continue;
      const piece = after.get(square);
      const defended = after.attackers(square, other(mover)).length;
      const how = byMoved ? '' : ' (à la découverte)';
      facts.push(`attaque ${label(piece, square)}${how}${piece.type === 'k' ? '' : ` (défenseurs : ${defended})`}`);
    }
    const newPins = pins(after, mover).filter((p) => !pins(before, mover).includes(p));
    facts.push(...newPins);
    const mine = hanging(after, mover);
    if (mine.length) facts.push(`en prise chez les ${SIDES[mover]} : ${mine.join(' ; ')}`);
    const number = `${Math.floor(i / 2) + 1}${mover === 'w' ? '.' : '...'}`;
    console.log(`${number} ${move.san} — ${speak(move)}`);
    for (const fact of facts) console.log(`    ${fact}`);
  });
  console.log(`FEN : ${chess.fen()}`);
  if (chess.isCheckmate()) console.log('Mat.');
}

function piece(args) {
  const square = args.shift();
  const chess = replay(parseLine(args));
  const target = chess.get(square);
  if (!target) throw new Error(`Aucune pièce en ${square}`);
  if (target.color !== chess.turn()) console.log(`Attention : c'est aux ${SIDES[chess.turn()]} de jouer, pas à cette pièce.`);
  const probe = new Chess(chess.fen().replace(/ [wb] /, ` ${target.color} `).replace(/ [a-h][36] /, ' - '));
  const now = probe.attackers(square, other(target.color));
  console.log(`${label(target, square)} : ${guards(probe, now, probe.attackers(square, target.color))}`);
  for (const move of probe.moves({ square, verbose: true })) {
    const after = new Chess(probe.fen());
    after.move(move.san);
    const by = after.attackers(move.to, other(target.color));
    const defenders = after.attackers(move.to, target.color);
    const verdict = by.length ? guards(after, by, defenders) : 'sûre';
    console.log(`  ${move.san} (${speak(move)}) : ${verdict}`);
  }
}

function tree(args) {
  for (const map of loadMaps(args[0])) {
    console.log(`# ${map.name} (${map.orientation === 'black' ? 'noirs' : 'blancs'})`);
    const visit = (id, ply, depth) => {
      const node = map.nodes[id];
      const indent = '  '.repeat(depth);
      if (node.moves.length) {
        const text = node.moves.map((san, k) => {
          const p = ply + k;
          return p % 2 === 0 ? `${p / 2 + 1}. ${san}` : k === 0 ? `${(p + 1) / 2}... ${san}` : san;
        }).join(' ');
        console.log(`${indent}[${id.slice(0, 8)}] ${text}`);
      }
      if (node.note) console.log(`${indent}    note : ${node.note.replace(/\n/g, ' / ')}`);
      for (const [played, shapes] of Object.entries(node.shapes ?? {})) {
        const after = node.moves[Number(played) - 1] ?? 'position de départ du nœud';
        const drawn = shapes.map((s) => (s.dest ? `flèche ${tts(s.orig)}→${tts(s.dest)}` : `cercle ${tts(s.orig)}`) + ` ${BRUSHES[s.brush] ?? s.brush}`);
        console.log(`${indent}    après ${after} : ${drawn.join(', ')}`);
      }
      for (const child of node.children) visit(child, ply + node.moves.length, depth + (node.moves.length ? 1 : 0));
    };
    visit(map.rootId, 0, 0);
  }
}

const [command, ...rest] = process.argv.slice(2);
const commands = { tree, line, piece };
if (!commands[command]) {
  console.log(USAGE);
  process.exit(command ? 1 : 0);
}
commands[command](rest);
