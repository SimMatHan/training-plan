// JSON Patch (RFC 6902) og JSON Pointer (RFC 6901). Egen lille implementering, så
// input fra MCP aldrig når en bibliotekskode med prototype-fælder: dokumentet klones
// først, og nøglerne __proto__, constructor og prototype afvises.
import { z } from 'zod';

const Pointer = z.string().max(500).regex(/^(\/[^/]*)*$/, 'Stien skal være en JSON Pointer, fx /sessions/0/name');

export const PatchOperation = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add'), path: Pointer, value: z.unknown() }),
  z.object({ op: z.literal('remove'), path: Pointer }),
  z.object({ op: z.literal('replace'), path: Pointer, value: z.unknown() }),
  z.object({ op: z.literal('move'), from: Pointer, path: Pointer }),
  z.object({ op: z.literal('copy'), from: Pointer, path: Pointer }),
  z.object({ op: z.literal('test'), path: Pointer, value: z.unknown() }),
]);
export type PatchOperation = z.infer<typeof PatchOperation>;

export const JsonPatch = z.array(PatchOperation).min(1).max(200);
export type JsonPatch = z.infer<typeof JsonPatch>;

export class PatchError extends Error {}

const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

export function parsePointer(pointer: string): string[] {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) throw new PatchError(`Ugyldig sti: ${pointer}`);
  return pointer
    .slice(1)
    .split('/')
    .map((s) => {
      const key = s.replace(/~1/g, '/').replace(/~0/g, '~');
      if (FORBIDDEN.has(key)) throw new PatchError(`Ugyldig nøgle i stien: ${key}`);
      return key;
    });
}

type Container = Record<string, unknown> | unknown[];

const isContainer = (v: unknown): v is Container => typeof v === 'object' && v !== null;
const isObject = (v: unknown): v is Record<string, unknown> => isContainer(v) && !Array.isArray(v);

const own = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k);

function arrayIndex(arr: unknown[], key: string, forAdd: boolean, pointer: string): number {
  if (forAdd && key === '-') return arr.length;
  if (!/^(0|[1-9]\d*)$/.test(key)) throw new PatchError(`Ugyldigt indeks "${key}" i ${pointer}`);
  const i = Number(key);
  if (i > arr.length || (!forAdd && i === arr.length)) throw new PatchError(`Indeks ${i} findes ikke i ${pointer}`);
  return i;
}

/** Forælderen og sidste nøgle for en sti. */
function locate(doc: unknown, pointer: string): { parent: Container; key: string } {
  const keys = parsePointer(pointer);
  if (!keys.length) throw new PatchError('Hele dokumentet kan ikke ændres med én operation');
  let node: unknown = doc;
  for (const k of keys.slice(0, -1)) {
    if (Array.isArray(node)) node = node[arrayIndex(node, k, false, pointer)];
    else if (isObject(node) && own(node, k)) node = node[k];
    else throw new PatchError(`Stien findes ikke: ${pointer}`);
  }
  if (!isContainer(node)) throw new PatchError(`Stien findes ikke: ${pointer}`);
  return { parent: node, key: keys.at(-1)! };
}

export function getAt(doc: unknown, pointer: string): unknown {
  let node: unknown = doc;
  for (const k of parsePointer(pointer)) {
    if (Array.isArray(node)) node = node[arrayIndex(node, k, false, pointer)];
    else if (isObject(node) && own(node, k)) node = node[k];
    else throw new PatchError(`Stien findes ikke: ${pointer}`);
  }
  return node;
}

function add(doc: unknown, pointer: string, value: unknown) {
  const { parent, key } = locate(doc, pointer);
  if (Array.isArray(parent)) parent.splice(arrayIndex(parent, key, true, pointer), 0, value);
  else parent[key] = value;
}

function remove(doc: unknown, pointer: string): unknown {
  const { parent, key } = locate(doc, pointer);
  if (Array.isArray(parent)) return parent.splice(arrayIndex(parent, key, false, pointer), 1)[0];
  if (!own(parent, key)) throw new PatchError(`Stien findes ikke: ${pointer}`);
  const old = parent[key];
  delete parent[key];
  return old;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  if (isContainer(a) && isContainer(b) && !Array.isArray(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => own(b as Record<string, unknown>, k) && deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

/** Kloner via JSON, så værdier fra patchen aldrig deler referencer eller har prototype-nøgler. */
function cloneJson<T>(v: T): T {
  return JSON.parse(JSON.stringify(v), (k, val) => {
    if (FORBIDDEN.has(k)) throw new PatchError(`Ugyldig nøgle i værdi: ${k}`);
    return val;
  }) as T;
}

/** Anvender patchen på en kopi af dokumentet. Kaster PatchError ved første operation der fejler. */
export function applyPatch<T>(doc: T, patch: JsonPatch): T {
  const out = cloneJson(doc);
  patch.forEach((op, i) => {
    try {
      switch (op.op) {
        case 'add':
          add(out, op.path, cloneJson(op.value));
          break;
        case 'remove':
          remove(out, op.path);
          break;
        case 'replace':
          remove(out, op.path);
          add(out, op.path, cloneJson(op.value));
          break;
        case 'move':
          if (op.path.startsWith(op.from + '/')) throw new PatchError('Kan ikke flytte en sti ind i sig selv');
          add(out, op.path, remove(out, op.from));
          break;
        case 'copy':
          add(out, op.path, cloneJson(getAt(out, op.from)));
          break;
        case 'test':
          if (!deepEqual(getAt(out, op.path), op.value)) throw new PatchError(`test fejlede for ${op.path}`);
          break;
      }
    } catch (e) {
      if (e instanceof PatchError) throw new PatchError(`Operation ${i + 1} (${op.op} ${op.path}): ${e.message}`);
      throw e;
    }
  });
  return out;
}
