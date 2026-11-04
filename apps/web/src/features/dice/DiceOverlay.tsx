import { useEffect, useRef, useState } from "react";
import { cx } from "../../components/ui";
import type { RollEntry } from "../../lib/types";
import { useAuth } from "../../stores/auth";
import { HOLD_MS, TUMBLE_MS, diceToShow, dieShape, playRattle, shouldAnimate, type ShownDie } from "./diceFx";

const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Brief 2D dice animation for each new roll that reaches this client: the dice tumble
 * through random faces, then land on the server's real values and show the total.
 * Purely visual: the result is already decided by the server. Respects the profile's
 * animation/sound settings and the OS "reduce motion" preference. Doesn't block clicks.
 */
export function DiceOverlay({ roll }: { roll: RollEntry | null }) {
  const settings = useAuth((s) => s.user?.settings);
  const [shown, setShown] = useState<RollEntry | null>(null);
  const [phase, setPhase] = useState<"tumble" | "landed">("landed");
  const [faces, setFaces] = useState<number[]>([]);
  const seen = useRef<string | null>(null);

  useEffect(() => {
    if (!roll || roll.id === seen.current) return;
    seen.current = roll.id;
    if (!shouldAnimate(settings?.diceAnimation, reducedMotion())) return;
    const { dice } = diceToShow(roll.result);
    setShown(roll);
    setPhase("tumble");
    if (settings?.diceSound !== false && !roll.redacted) playRattle(dice.length || 1);
    const spin = setInterval(() => setFaces(dice.map((d) => 1 + Math.floor(Math.random() * d.sides))), 70);
    const land = setTimeout(() => {
      clearInterval(spin);
      setPhase("landed");
    }, TUMBLE_MS);
    const hide = setTimeout(() => setShown(null), TUMBLE_MS + HOLD_MS);
    return () => {
      clearInterval(spin);
      clearTimeout(land);
      clearTimeout(hide);
    };
  }, [roll, settings?.diceAnimation, settings?.diceSound]);

  if (!shown) return null;
  const { dice, hidden } = diceToShow(shown.result);
  const landed = phase === "landed";
  const crit = landed && shown.result?.critical;
  const fumble = landed && shown.result?.fumble;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-30 flex justify-center px-4" aria-live="polite" data-testid="dice-overlay" data-phase={phase}>
      <div
        className={cx(
          "max-w-full rounded-xl border bg-ink-900/90 px-4 py-3 shadow-2xl backdrop-blur",
          crit ? "border-gold-400" : fumble ? "border-blood-500" : "border-ink-600",
        )}
      >
        <p className="mb-2 max-w-[80vw] truncate text-center text-xs text-parchment-400">
          {/* Token rolls already start with the creature's name. */}
          {shown.label.startsWith(shown.characterName ?? shown.userName) ? shown.label : [shown.characterName ?? shown.userName, shown.label].filter(Boolean).join(" · ")}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {shown.redacted || dice.length === 0 ? (
            <Die die={{ sides: 20, value: 0, dropped: false, tone: "normal" }} face="?" tumbling={!landed} />
          ) : (
            dice.map((d, i) => <Die key={i} die={d} face={landed ? String(d.value) : String(faces[i] ?? "")} tumbling={!landed} />)
          )}
          {hidden > 0 && <span className="text-sm text-parchment-400">+{hidden}</span>}
          <span
            className={cx(
              "ml-2 min-w-[2ch] font-display text-3xl transition-opacity duration-200",
              landed ? "opacity-100" : "opacity-0",
              crit ? "text-gold-300" : fumble ? "text-blood-400" : "text-parchment-50",
            )}
            data-testid="dice-overlay-total"
          >
            {shown.redacted ? "?" : shown.total}
          </span>
        </div>
        {crit && <p className="mt-1 text-center text-xs font-semibold uppercase tracking-wider text-gold-300">Critical!</p>}
        {fumble && <p className="mt-1 text-center text-xs font-semibold uppercase tracking-wider text-blood-400">Natural 1</p>}
      </div>
    </div>
  );
}

function Die({ die, face, tumbling }: { die: ShownDie; face: string; tumbling: boolean }) {
  const color = die.tone === "crit" ? "#d9b14f" : die.tone === "fumble" ? "#c2463a" : "#3a322a";
  return (
    <svg
      viewBox="0 0 100 100"
      width={44}
      height={44}
      className={cx(tumbling && "animate-[dice-tumble_0.35s_linear_infinite]", die.dropped && "opacity-35")}
      aria-label={`d${die.sides}: ${face}`}
    >
      <polygon points={dieShape(die.sides)} fill={color} stroke="#d9b14f" strokeWidth={3} strokeLinejoin="round" />
      <text x="50" y="53" textAnchor="middle" dominantBaseline="middle" fontSize={face.length > 2 ? 26 : 34} fontWeight="700" fill="#f6efe0" fontFamily="ui-monospace, monospace">
        {face}
      </text>
      {die.dropped && <line x1="15" y1="85" x2="85" y2="15" stroke="#f6efe0" strokeWidth={4} opacity={0.7} />}
    </svg>
  );
}
