/* ─────────────────────────────────────────────────────────────────────────
   Statelia — Calc column formula engine
   A small, dependency-free expression parser:
     C1 * 2 + 1, (C2 - MEAN(C2)) / STDEV(C2), SQRT(C1), ROUND(C3, 2), …
   Aggregate functions collapse the expression to a single stored value.
   ───────────────────────────────────────────────────────────────────────── */

import type { Worksheet } from '../types';

type Node =
  | { type: 'num'; value: number }
  | { type: 'col'; ref: string }
  | { type: 'neg'; node: Node }
  | { type: 'bin'; op: '+' | '-' | '*' | '/' | '^'; left: Node; right: Node }
  | { type: 'call'; name: string; args: Node[]; aggregate: boolean };

const AGGREGATES = new Set(['MEAN', 'AVG', 'STDEV', 'SSTDEV', 'SUM', 'MIN', 'MAX', 'MEDIAN', 'COUNT', 'N']);

interface Token { kind: 'num' | 'id' | 'op' | 'lparen' | 'rparen' | 'comma'; text: string; pos: number }

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) { i += 1; continue; }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < input.length && /[0-9.]/.test(input[j])) j += 1;
      if (j < input.length && /[eE]/.test(input[j])) {
        j += 1;
        if (j < input.length && /[+-]/.test(input[j])) j += 1;
        while (j < input.length && /[0-9]/.test(input[j])) j += 1;
      }
      tokens.push({ kind: 'num', text: input.slice(i, j), pos: i });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < input.length && /[A-Za-z0-9_]/.test(input[j])) j += 1;
      tokens.push({ kind: 'id', text: input.slice(i, j), pos: i });
      i = j;
      continue;
    }
    if ('+-*/^'.includes(ch)) { tokens.push({ kind: 'op', text: ch, pos: i }); i += 1; continue; }
    if (ch === '(') { tokens.push({ kind: 'lparen', text: ch, pos: i }); i += 1; continue; }
    if (ch === ')') { tokens.push({ kind: 'rparen', text: ch, pos: i }); i += 1; continue; }
    if (ch === ',') { tokens.push({ kind: 'comma', text: ch, pos: i }); i += 1; continue; }
    throw new Error('formula.badToken');
  }
  return tokens;
}

class Parser {
  private tokens: Token[];
  private index = 0;
  constructor(tokens: Token[]) { this.tokens = tokens; }

  private peek(): Token | undefined { return this.tokens[this.index]; }

  private take(): Token {
    const token = this.tokens[this.index];
    if (!token) throw new Error('formula.unexpectedEnd');
    this.index += 1;
    return token;
  }

  parse(): Node {
    if (!this.tokens.length) throw new Error('formula.empty');
    const node = this.expression();
    if (this.index < this.tokens.length) throw new Error('formula.trailing');
    return node;
  }

  private expression(): Node {
    let left = this.term();
    while (this.peek()?.kind === 'op' && ['+', '-'].includes(this.peek()!.text)) {
      const op = this.take().text as '+' | '-';
      left = { type: 'bin', op, left, right: this.term() };
    }
    return left;
  }

  private term(): Node {
    let left = this.factor();
    while (this.peek()?.kind === 'op' && ['*', '/'].includes(this.peek()!.text)) {
      const op = this.take().text as '*' | '/';
      left = { type: 'bin', op, left, right: this.factor() };
    }
    return left;
  }

  private factor(): Node {
    const base = this.unary();
    if (this.peek()?.kind === 'op' && this.peek()!.text === '^') {
      this.take();
      return { type: 'bin', op: '^', left: base, right: this.factor() };
    }
    return base;
  }

  private unary(): Node {
    if (this.peek()?.kind === 'op' && this.peek()!.text === '-') {
      this.take();
      return { type: 'neg', node: this.unary() };
    }
    if (this.peek()?.kind === 'op' && this.peek()!.text === '+') {
      this.take();
      return this.unary();
    }
    return this.primary();
  }

  private primary(): Node {
    const token = this.take();
    if (token.kind === 'num') {
      const value = Number(token.text);
      if (!isFinite(value)) throw new Error('formula.badNumber');
      return { type: 'num', value };
    }
    if (token.kind === 'lparen') {
      const inner = this.expression();
      if (this.take().kind !== 'rparen') throw new Error('formula.missingParen');
      return inner;
    }
    if (token.kind === 'id') {
      const upper = token.text.toUpperCase();
      if (upper === 'PI') return { type: 'num', value: Math.PI };
      if (this.peek()?.kind === 'lparen') {
        this.take();
        const args: Node[] = [];
        if (this.peek()?.kind !== 'rparen') {
          for (;;) {
            args.push(this.expression());
            const next = this.peek();
            if (next?.kind === 'comma') { this.take(); continue; }
            break;
          }
        }
        if (this.take().kind !== 'rparen') throw new Error('formula.missingParen');
        return { type: 'call', name: upper, args, aggregate: AGGREGATES.has(upper) };
      }
      if (/^C\d+$/i.test(token.text) || /^[A-Za-z_][A-Za-z0-9_]*$/.test(token.text)) {
        return { type: 'col', ref: token.text };
      }
      throw new Error('formula.badIdentifier');
    }
    throw new Error('formula.unexpectedToken');
  }
}

function columnValues(ref: string, sheet: Worksheet): (number | null)[] {
  const byId = sheet.columns.find((c) => c.id.toLowerCase() === ref.toLowerCase());
  const col = byId ?? sheet.columns.find((c) => c.name.toLowerCase() === ref.toLowerCase());
  if (!col) throw new Error('formula.unknownColumn');
  return col.values.map((v) => (typeof v === 'number' && isFinite(v) ? v : null));
}

function toNumbers(values: (number | null)[]): number[] {
  return values.filter((v): v is number => typeof v === 'number');
}

export interface CalcOutcome {
  values: (number | null)[];
  constant: boolean;
  errors: number;
  rows: number;
}

function evalNode(node: Node, row: number | null, sheet: Worksheet): number {
  switch (node.type) {
    case 'num':
      return node.value;
    case 'neg':
      return -evalNode(node.node, row, sheet);
    case 'bin': {
      const a = evalNode(node.left, row, sheet);
      const b = evalNode(node.right, row, sheet);
      switch (node.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return b === 0 ? NaN : a / b;
        case '^': return Math.pow(a, b);
      }
      return NaN;
    }
    case 'col': {
      if (row === null) throw new Error('formula.columnOutsideRow');
      const values = columnValues(node.ref, sheet);
      const v = values[row];
      return typeof v === 'number' ? v : NaN;
    }
    case 'call': {
      if (node.aggregate) {
        if (!node.args.length || node.args[0].type !== 'col') throw new Error('formula.aggregateNeedsColumn');
        const values = toNumbers(columnValues((node.args[0] as { ref: string }).ref, sheet));
        switch (node.name) {
          case 'MEAN': case 'AVG':
            return values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN;
          case 'SUM': return values.reduce((a, b) => a + b, 0);
          case 'MIN': return values.length ? Math.min(...values) : NaN;
          case 'MAX': return values.length ? Math.max(...values) : NaN;
          case 'COUNT': case 'N': return values.length;
          case 'MEDIAN': {
            if (!values.length) return NaN;
            const sorted = [...values].sort((a, b) => a - b);
            const mid = Math.floor(sorted.length / 2);
            return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
          }
          case 'STDEV': case 'SSTDEV': {
            if (values.length < 2) return NaN;
            const m = values.reduce((a, b) => a + b, 0) / values.length;
            return Math.sqrt(values.reduce((a, b) => a + (b - m) ** 2, 0) / (values.length - 1));
          }
        }
        throw new Error('formula.unknownFunction');
      }
      const args = node.args.map((arg) => evalNode(arg, row, sheet));
      switch (node.name) {
        case 'SQRT': return Math.sqrt(args[0]);
        case 'ABS': return Math.abs(args[0]);
        case 'LN': return Math.log(args[0]);
        case 'LOG': case 'LOG10': return Math.log10(args[0]);
        case 'EXP': return Math.exp(args[0]);
        case 'ROUND': {
          const digits = args.length > 1 ? Math.round(args[1]) : 0;
          const factor = Math.pow(10, digits);
          return Math.round(args[0] * factor) / factor;
        }
        case 'FLOOR': return Math.floor(args[0]);
        case 'CEILING': case 'CEIL': return Math.ceil(args[0]);
        case 'MOD': return args[1] === 0 ? NaN : args[0] % args[1];
        case 'POWER': return Math.pow(args[0], args[1]);
        case 'SIN': return Math.sin(args[0]);
        case 'COS': return Math.cos(args[0]);
        case 'TAN': return Math.tan(args[0]);
        default: throw new Error('formula.unknownFunction');
      }
    }
    default:
      return NaN;
  }
}

export function evaluateFormula(formula: string, sheet: Worksheet): CalcOutcome {
  const ast = new Parser(tokenize(formula)).parse();
  const rows = Math.max(...sheet.columns.map((c) => c.values.length), 0);
  const constant = !hasColumnRefOutsideAggregate(ast);
  if (constant) {
    const value = evalNode(ast, null, sheet);
    if (!isFinite(value)) throw new Error('formula.notFinite');
    return { values: new Array(rows).fill(value), constant: true, errors: 0, rows };
  }
  const values: (number | null)[] = [];
  let errors = 0;
  for (let row = 0; row < rows; row += 1) {
    const value = evalNode(ast, row, sheet);
    if (!isFinite(value)) {
      errors += 1;
      values.push(null);
    } else {
      values.push(value);
    }
  }
  return { values, constant: false, errors, rows };
}

function hasColumnRefOutsideAggregate(node: Node): boolean {
  if (node.type === 'col') return true;
  if (node.type === 'neg') return hasColumnRefOutsideAggregate(node.node);
  if (node.type === 'bin') return hasColumnRefOutsideAggregate(node.left) || hasColumnRefOutsideAggregate(node.right);
  if (node.type === 'call') {
    if (node.aggregate) return false;
    return node.args.some(hasColumnRefOutsideAggregate);
  }
  return false;
}

export function formulaColumns(formula: string, sheet: Worksheet): string[] {
  const ast = new Parser(tokenize(formula)).parse();
  const found = new Set<string>();
  const walk = (node: Node): void => {
    if (node.type === 'col') found.add(node.ref.toUpperCase());
    else if (node.type === 'neg') walk(node.node);
    else if (node.type === 'bin') { walk(node.left); walk(node.right); }
    else if (node.type === 'call') node.args.forEach(walk);
  };
  walk(ast);
  const ids = sheet.columns.map((c) => c.id.toUpperCase());
  return [...found].filter((ref) => ids.includes(ref));
}
