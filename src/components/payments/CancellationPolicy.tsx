import { policyLines } from "@/lib/cancellation/policy";

/**
 * The cancellation policy in plain sentences — with what each tier comes to
 * when the screen is about one round at one price, and as shares when it isn't.
 * The lines come from the same tiers the cancel routes charge by.
 */
export default function CancellationPolicy({ price }: { price?: number }) {
  return (
    <ul className="space-y-1.5">
      {policyLines(price).map((line) => (
        <li
          key={line}
          className="text-sm flex items-start gap-2"
          style={{ color: "rgba(0,38,105,0.6)" }}
        >
          <span
            aria-hidden
            className="mt-2 w-1 h-1 rounded-full flex-shrink-0"
            style={{ background: "rgba(0,38,105,0.35)" }}
          />
          {line}
        </li>
      ))}
    </ul>
  );
}
