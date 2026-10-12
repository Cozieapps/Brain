import ICAL from "ical.js";
import { Store } from "./store";
import { executeTool } from "./tools";
import { localToInstant } from "../shared/time";
export function importCalendar(store: Store, source: string) {
  if (source.length > 500000)
    throw new Error("Calendar files must be smaller than 500 KB.");
  const root = new ICAL.Component(ICAL.parse(source));
  if (root.name !== "vcalendar")
    throw new Error("Choose a valid .ics calendar.");
  const events = root.getAllSubcomponents("vevent");
  if (events.length > 100)
    throw new Error("Import at most 100 appointments at a time.");
  const drafts = events.map((c) => {
    if (c.hasProperty("rrule") || c.hasProperty("recurrence-id"))
      throw new Error(
        "Recurring calendars need individual occurrences. Export single appointments; no partial import was saved.",
      );
    const e = new ICAL.Event(c);
    if (!e.startDate || !e.endDate)
      throw new Error("Each appointment needs a start and end.");
    if (e.startDate.isDate)
      throw new Error(
        "All-day events have no transition time. Add a timed appointment instead.",
      );
    const startZone = c.getFirstProperty("dtstart")?.getParameter("tzid");
    const endZone = c.getFirstProperty("dtend")?.getParameter("tzid");
    const zone =
      typeof startZone === "string" ? startZone : e.startDate.zone.tzid;
    function instant(t: ICAL.Time, parameterZone?: unknown) {
      if (typeof parameterZone === "string")
        return localToInstant(t.toString().replace(/Z$/, ""), parameterZone);
      if (t.zone.tzid === "floating")
        return localToInstant(t.toString(), store.settings().timezone);
      if (t.zone.tzid === "UTC") return t.toJSDate().toISOString();
      try {
        return localToInstant(t.toString().replace(/Z$/, ""), t.zone.tzid);
      } catch {
        throw new Error(
          "A calendar time zone or daylight-saving time is unsupported. Import a UTC version.",
        );
      }
    }
    return {
      kind: "appointment" as const,
      title: e.summary || "Appointment",
      data: {
        startsAt: instant(e.startDate, startZone),
        endsAt: instant(e.endDate, endZone),
        timezone:
          zone === "floating"
            ? store.settings().timezone
            : zone === "UTC"
              ? "UTC"
              : zone,
        location: e.location || "",
        notes: e.description || "",
        calendarUid: e.uid || undefined,
      },
    };
  });
  return store.db.transaction(() => {
    const records = [];
    let skipped = 0;
    for (const d of drafts) {
      if (
        d.data.calendarUid &&
        store
          .list("appointment")
          .some((r) => r.data.calendarUid === d.data.calendarUid)
      ) {
        skipped++;
        continue;
      }
      records.push(...(executeTool(store, "record.create", d).records ?? []));
    }
    return {
      message: `Imported ${records.length} appointments. ${skipped} previously imported appointments skipped.`,
      records,
    };
  });
}
function escape(s: string) {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}
function stamp(s: string) {
  return new Date(s)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z/, "Z");
}
export function exportCalendar(store: Store) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Beside//Personal Companion//EN",
    "CALSCALE:GREGORIAN",
  ];
  for (const a of store
    .list("appointment")
    .filter((r) => r.status !== "dropped"))
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escape(a.data.calendarUid || a.id + "@beside.local")}`,
      `DTSTAMP:${stamp(a.updatedAt)}`,
      `DTSTART:${stamp(a.data.startsAt)}`,
      `DTEND:${stamp(a.data.endsAt)}`,
      `SUMMARY:${escape(a.title)}`,
      `LOCATION:${escape(a.data.location)}`,
      `DESCRIPTION:${escape(a.data.notes)}`,
      "END:VEVENT",
    );
  lines.push("END:VCALENDAR");
  return (
    lines
      .map((line) => {
        let out = "",
          chunk = "";
        for (const char of line) {
          if (new TextEncoder().encode(chunk + char).length > 73) {
            out += chunk + "\r\n ";
            chunk = "";
          }
          chunk += char;
        }
        return out + chunk;
      })
      .join("\r\n") + "\r\n"
  );
}
