// Everything is stored in this browser's IndexedDB. Nothing is sent anywhere.

import type { ParsedAction } from "./text";

export interface ActionResult {
  tool: string;
  ok: boolean;
  summary: string;
  /** Record touched, so the action can be undone. */
  undo?: { store: StoreName; id: string; previous?: unknown };
  undone?: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  at: string;
  actions?: ActionResult[];
  stats?: { tokens: number; tokensPerSecond: number; firstTokenMs: number };
  error?: string;
}

export interface Chat {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

export interface Task {
  id: string;
  title: string;
  steps: { text: string; done: boolean }[];
  done: boolean;
  createdAt: string;
  doneAt?: string;
  when?: string;
  pinned?: boolean;
}

export interface Reminder {
  id: string;
  text: string;
  at: string;
  fired: boolean;
  createdAt: string;
}

export interface Note {
  id: string;
  text: string;
  createdAt: string;
}

export interface CheckIn {
  id: string;
  at: string;
  energy: 1 | 2 | 3 | 4 | 5;
  mood?: string;
  cycle?: "period" | "follicular" | "ovulation" | "luteal" | "unsure";
}

export interface Stores {
  chats: Chat;
  tasks: Task;
  reminders: Reminder;
  notes: Note;
  checkins: CheckIn;
}
export type StoreName = keyof Stores;

const STORE_NAMES: StoreName[] = [
  "chats",
  "tasks",
  "reminders",
  "notes",
  "checkins",
];

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open("beside-offline", 1);
    req.onupgradeneeded = () => {
      for (const name of STORE_NAMES)
        if (!req.result.objectStoreNames.contains(name))
          req.result.createObjectStore(name, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return opening;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function all<K extends StoreName>(name: K): Promise<Stores[K][]> {
  const db = await open();
  return wrap(db.transaction(name).objectStore(name).getAll());
}

export async function get<K extends StoreName>(
  name: K,
  id: string,
): Promise<Stores[K] | undefined> {
  const db = await open();
  return wrap(db.transaction(name).objectStore(name).get(id));
}

export async function put<K extends StoreName>(
  name: K,
  value: Stores[K],
): Promise<void> {
  const db = await open();
  await wrap(db.transaction(name, "readwrite").objectStore(name).put(value));
}

export async function remove(name: StoreName, id: string): Promise<void> {
  const db = await open();
  await wrap(db.transaction(name, "readwrite").objectStore(name).delete(id));
}

export async function clearAll(): Promise<void> {
  const db = await open();
  const tx = db.transaction(STORE_NAMES, "readwrite");
  for (const name of STORE_NAMES) tx.objectStore(name).clear();
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function exportAll(): Promise<Record<StoreName, unknown[]>> {
  const out = {} as Record<StoreName, unknown[]>;
  for (const name of STORE_NAMES) out[name] = await all(name);
  return out;
}

export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();

export type { ParsedAction };
