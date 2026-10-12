import { z } from "zod";
import { flowSchema } from "./continuity";
export const text = z.string().trim().min(1).max(5000);
export const short = z.string().trim().min(1).max(240);
export const id = z.string().min(1).max(100);
export const iso = z.string().datetime({ offset: true });
export const kindSchema = z.enum([
  "task",
  "capture",
  "checkpoint",
  "memory",
  "person",
  "handoff",
  "pause",
  "appointment",
  "transition",
  "decision",
  "draft",
]);
export type Kind = z.infer<typeof kindSchema>;
export const statusSchema = z.enum([
  "active",
  "prepared",
  "submitted",
  "waiting",
  "blocked",
  "paused",
  "failed",
  "completed",
  "confirmed",
  "dropped",
  "proposed",
  "accepted",
]);
export type Status = z.infer<typeof statusSchema>;
export const taskData = z.object({
  workflow: z
    .enum(["general", "return", "appointment", "form"])
    .default("general"),
  nextAction: z.string().max(1000).default("Choose one small first step"),
  deadline: iso.nullable().default(null),
  dateKind: z.enum(["none", "real", "target"]).default("none"),
  priority: z.number().int().min(0).max(3).default(1),
  essential: z.boolean().default(false),
  effort: z.enum(["small", "medium", "large"]).default("small"),
  consequence: z.string().max(1000).default(""),
  dependencies: z.array(id).max(20).default([]),
  waitingOn: z.string().max(240).default(""),
  evidence: z.string().max(3000).default(""),
  references: z.string().max(4000).default(""),
  stage: z.string().max(100).default("Gather information"),
  obstacle: z.enum(["unclear", "big", "emotional", "low"]).optional(),
});
export const dataSchemas = {
  task: taskData,
  capture: z.object({
    body: text,
    category: z
      .enum(["thought", "link", "note", "object", "audio", "file"])
      .default("thought"),
    location: z.string().max(500).default(""),
    convertedTaskId: id.optional(),
  }),
  checkpoint: z.object({
    taskId: id.optional(),
    purpose: text,
    position: text,
    decisions: z.string().max(4000).default(""),
    references: z.string().max(4000).default(""),
    nextAction: text,
  }),
  memory: z.object({
    body: text,
    source: z.enum(["user", "suggestion", "inference"]).default("user"),
    sourceRef: z.string().max(1000).default("User entered"),
    confidence: z.number().min(0).max(1).nullable().default(null),
    reviewed: z.boolean().default(true),
    expiresAt: iso.nullable().default(null),
  }),
  person: z.object({
    context: z.string().max(3000).default(""),
    followUp: z.string().max(1000).default(""),
    followUpAt: iso.nullable().default(null),
    lastContact: iso.nullable().default(null),
    message: z.string().max(4000).default(""),
  }),
  handoff: z.object({
    outcome: text,
    owner: short,
    deadline: iso.nullable().default(null),
    information: z.string().max(4000).default(""),
    agreement: z.string().max(2000).default(""),
    evidence: z.string().max(2000).default(""),
  }),
  pause: z.object({
    type: z.enum(["purchase", "commitment", "reply"]),
    item: text,
    constraint: z.string().max(1000).default(""),
    reviewAt: iso,
    decision: z.string().max(2000).default(""),
    displaces: id.optional(),
  }),
  appointment: z.object({
    startsAt: iso,
    endsAt: iso,
    timezone: short,
    location: z.string().max(1000).default(""),
    notes: z.string().max(4000).default(""),
    calendarUid: z.string().max(300).optional(),
  }),
  transition: z.object({
    appointmentId: id.optional(),
    checkpointId: id,
    commitmentAt: iso,
    timezone: short,
    preparation: z.number().min(0).max(480),
    windDown: z.number().min(0).max(240),
    travel: z.number().min(0).max(1440),
    buffer: z.number().min(0).max(240),
    startAt: iso,
    leaveAt: iso,
    travelSource: z.literal("user estimate").default("user estimate"),
    evidence: z.string().max(1000).default(""),
  }),
  decision: z.object({
    question: text,
    choice: text,
    source: z.literal("user").default("user"),
  }),
  draft: z.object({
    body: text,
    taskId: id.optional(),
    personId: id.optional(),
    sent: z.literal(false).default(false),
  }),
} as const;
export interface RecordItem {
  id: string;
  profileId: string;
  kind: Kind;
  title: string;
  status: Status;
  data: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  version: number;
}
export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  source: "guided" | "ai" | "user";
  action?: string;
}
export const settingsSchema = z.object({
  name: z.string().max(60).default(""),
  timezone: z.string().default("America/New_York"),
  capacity: z.enum(["low", "steady", "room"]).default("steady"),
  tone: z.enum(["warm", "concise"]).default("warm"),
  mode: z.enum(["none", "plan", "api"]).default("none"),
  notificationBudget: z.number().int().min(0).max(8).default(3),
  quietStart: z.number().int().min(0).max(23).default(21),
  quietEnd: z.number().int().min(0).max(23).default(8),
  quietEnabled: z.boolean().default(true),
  urgencyExceptions: z.boolean().default(false),
  remindersEnabled: z.boolean().default(true),
  monitoring: z
    .array(z.enum(["task", "person", "pause", "transition", "appointment"]))
    .default(["task", "pause", "transition", "appointment"]),
  pausedUntil: iso.nullable().default(null),
  lastSeen: iso.nullable().default(null),
  preferredTaskId: id.nullable().default(null),
  apiDailyRequests: z.number().int().min(1).max(50).default(10),
  apiMaxOutput: z.number().int().min(128).max(2048).default(700),
  permissions: z
    .object({
      internal: z.boolean().default(true),
      ai: z.boolean().default(false),
    })
    .default({ internal: true, ai: false }),
});
export type Settings = z.infer<typeof settingsSchema>;
export const toolSchemas = {
  "conversation.begin": z.object({
    flow: flowSchema,
    recordId: id.optional(),
    title: short.optional(),
  }),
  "conversation.answer": z.object({
    id,
    version: z.number().int().positive(),
    value: z.string().trim().min(1).max(5000),
  }),
  "conversation.pause": z.object({ id, version: z.number().int().positive() }),
  "conversation.back": z.object({ id, version: z.number().int().positive() }),
  "conversation.resume": z.object({ id }),
  "proposal.apply": z.object({ id }),
  "proposal.dismiss": z.object({ id }),
  "record.create": z.object({
    kind: kindSchema,
    title: short,
    data: z.record(z.string(), z.unknown()),
    status: statusSchema.optional(),
  }),
  "record.update": z.object({
    id,
    version: z.number().int(),
    title: short.optional(),
    status: statusSchema.optional(),
    data: z.record(z.string(), z.unknown()).optional(),
    evidence: z.string().max(3000).optional(),
  }),
  "record.delete": z.object({ id, confirm: z.literal(true) }),
  "record.undo": z.object({ id }),
  "capture.toTask": z.object({ id, nextAction: text }),
  "start.help": z.object({
    taskId: id.optional(),
    title: short,
    obstacle: z.enum(["unclear", "big", "emotional", "low"]),
    helpful: z.boolean().optional(),
  }),
  "checkpoint.resume": z.object({ query: z.string().max(500).default("") }),
  "priority.next": z.object({
    overrideId: id.optional(),
    rest: z.boolean().optional(),
  }),
  "return.review": z.object({}),
  "people.draft": z.object({ id, delayed: z.boolean().default(false) }),
  "transition.plan": z.object({
    title: short,
    checkpointId: id,
    appointmentId: id.optional(),
    localTime: short,
    timezone: short,
    preparation: z.number().min(0).max(480),
    windDown: z.number().min(0).max(240),
    travel: z.number().min(0).max(1440),
    buffer: z.number().min(0).max(240),
  }),
  "workflow.draft": z.object({ id }),
  "capacity.set": z.object({ capacity: settingsSchema.shape.capacity }),
  "memory.search": z.object({ query: z.string().max(500) }),
  "reminder.schedule": z.object({
    recordId: id,
    at: iso,
    essential: z.boolean().default(false),
  }),
} as const;
export type ToolName = keyof typeof toolSchemas;
export interface ToolResult {
  message: string;
  records?: RecordItem[];
  recommendation?: RecordItem | null;
  details?: string[];
  action?: string;
}
const recordOutputSchema = z.object({
  id,
  profileId: id,
  kind: kindSchema,
  title: short,
  status: statusSchema,
  data: z.record(z.string(), z.unknown()),
  createdAt: iso,
  updatedAt: iso,
  version: z.number().int().positive(),
});
export const resultSchema = z.object({
  message: z.string().max(20000),
  records: z.array(recordOutputSchema).optional(),
  recommendation: recordOutputSchema.nullable().optional(),
  details: z.array(z.string()).optional(),
  action: z.string().max(240).optional(),
});
export const labels: Record<Kind, string> = {
  task: "Responsibility",
  capture: "Capture",
  checkpoint: "Saved place",
  memory: "Memory",
  person: "Person",
  handoff: "Handoff",
  pause: "Pause",
  appointment: "Appointment",
  transition: "Transition",
  decision: "Decision",
  draft: "Draft",
};
