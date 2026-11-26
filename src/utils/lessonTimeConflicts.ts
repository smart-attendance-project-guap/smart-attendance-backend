import type { Prisma } from "../generated/prisma/client.js";

/**
 * A lesson occupies resources only until its effective end time:
 * min(endsAt, finishedAt) when explicitly finished, otherwise endsAt.
 *
 * The requested interval and the existing interval must overlap strictly:
 * existing.startsAt < requestedEnd AND effectiveEnd > requestedStart.
 * Adjacent lessons (effectiveEnd === requestedStart) do not conflict.
 *
 * Combine this filter with an OR of classroom/group/teacher resource matches.
 */
export function lessonOverlapsWindow(
  requestedStart: Date,
  requestedEnd: Date,
): Prisma.LessonWhereInput {
  return {
    startsAt: { lt: requestedEnd },
    endsAt: { gt: requestedStart },
    AND: [
      {
        OR: [
          { finishedAt: null },
          { finishedAt: { gt: requestedStart } },
        ],
      },
    ],
  };
}
