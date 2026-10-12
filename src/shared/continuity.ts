import { z } from "zod";
export const flowSchema = z.enum([
  "start",
  "capture",
  "checkpoint",
  "return",
  "appointment",
  "form",
  "person",
  "handoff",
  "pause",
  "transition",
  "followup",
]);
export type Flow = z.infer<typeof flowSchema>;
export interface Question {
  key: string;
  prompt: string;
  type?: "text" | "datetime-local" | "number";
  choices?: { value: string; label: string }[];
  optional?: boolean;
  hint?: string;
  maxLength?: number;
}
export interface Thread {
  id: string;
  flow: Flow;
  step: number;
  version: number;
  data: Record<string, string>;
  status: "active" | "paused" | "finished";
  recordId: string | null;
  createdAt: string;
  updatedAt: string;
  question: Question | null;
}
export const flowLabels: Record<Flow, string> = {
  start: "Find a way in",
  capture: "Hold a thought",
  checkpoint: "Save your place",
  return: "Carry a return through",
  appointment: "Arrange an appointment",
  form: "Carry an application through",
  person: "Remember someone",
  handoff: "Share a responsibility",
  pause: "Make room for a pause",
  transition: "Make the next transition",
  followup: "Pick up the thread",
};
