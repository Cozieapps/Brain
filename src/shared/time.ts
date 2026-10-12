import { Temporal } from "@js-temporal/polyfill";
export function validTimezone(zone: string) {
  try {
    Temporal.Now.zonedDateTimeISO(zone);
    return true;
  } catch {
    return false;
  }
}
export function localToInstant(local: string, zone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(local))
    throw new Error(
      "Choose an exact date and time. Relative or ambiguous dates need clarification.",
    );
  try {
    return Temporal.PlainDateTime.from(local)
      .toZonedDateTime(zone, { disambiguation: "reject" })
      .toInstant()
      .toString();
  } catch {
    throw new Error(
      "This local time is missing or repeated because of a daylight-saving change, or the time zone is invalid. Choose an unambiguous time.",
    );
  }
}
export function subtractMinutes(instant: string, minutes: number) {
  return Temporal.Instant.from(instant).subtract({ minutes }).toString();
}
export function dateInZone(instant: string, zone: string) {
  return Temporal.Instant.from(instant)
    .toZonedDateTimeISO(zone)
    .toPlainDate()
    .toString();
}
export function hourInZone(instant: string, zone: string) {
  return Temporal.Instant.from(instant).toZonedDateTimeISO(zone).hour;
}
export function quietAt(
  instant: string,
  zone: string,
  start: number,
  end: number,
) {
  const h = hourInZone(instant, zone);
  return start === end
    ? false
    : start < end
      ? h >= start && h < end
      : h >= start || h < end;
}
export function nextQuietEnd(instant: string, zone: string, end: number) {
  let d = Temporal.Instant.from(instant).toZonedDateTimeISO(zone);
  let target = d.with(
    { hour: end, minute: 0, second: 0, millisecond: 0 },
    { disambiguation: "compatible" },
  );
  if (Temporal.ZonedDateTime.compare(target, d) <= 0)
    target = target.add({ days: 1 });
  return target.toInstant().toString();
}
