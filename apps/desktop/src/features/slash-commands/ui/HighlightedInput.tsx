/**
 * Capture input with colored `/command` tokens.
 *
 * An <input> can't style sub-strings, so this is the classic overlay: a
 * transparent input sits over a mirror <div> that re-renders the same text with
 * recognized `/command` tokens painted yellow. The input keeps a visible caret
 * (`caret-*`) and owns IME/selection; the mirror is pointer-inert and
 * aria-hidden. Both share the exact text box-model so glyphs line up, and the
 * mirror's horizontal scroll is synced to the input so long text stays aligned.
 */

import { useEffect, useRef } from "react";
import type {
  ChangeEvent,
  KeyboardEvent,
  ReactNode,
  RefObject,
  SyntheticEvent,
} from "react";

import { SLASH_COMMAND_NAMES } from "../model/commands";

// Text box-model shared by the input and its mirror — must stay identical.
const TEXT_CLASS =
  "w-full bg-transparent text-base font-medium leading-tight tracking-tight";

export function HighlightedInput({
  inputRef,
  onChange,
  onKeyDown,
  onSelect,
  placeholder,
  value,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onSelect: (event: SyntheticEvent<HTMLInputElement>) => void;
  placeholder: string;
  value: string;
}) {
  const mirrorRef = useRef<HTMLDivElement>(null);

  // Keep the mirror scrolled to match the input after the value changes.
  useEffect(() => {
    if (mirrorRef.current && inputRef.current) {
      mirrorRef.current.scrollLeft = inputRef.current.scrollLeft;
    }
  }, [value, inputRef]);

  return (
    <div className="relative w-full">
      <div
        aria-hidden
        className={`${TEXT_CLASS} pointer-events-none absolute inset-0 overflow-hidden whitespace-pre text-[var(--lin-text)]`}
        ref={mirrorRef}
      >
        {renderSegments(value)}
      </div>
      <input
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        autoFocus
        className={`${TEXT_CLASS} relative text-transparent caret-[var(--lin-text)] outline-none placeholder:text-[var(--lin-text-mute)]`}
        id="quick-capture-input"
        onChange={onChange}
        onKeyDown={onKeyDown}
        onScroll={(event) => {
          if (mirrorRef.current) {
            mirrorRef.current.scrollLeft = event.currentTarget.scrollLeft;
          }
        }}
        onSelect={onSelect}
        placeholder={placeholder}
        ref={inputRef}
        spellCheck={false}
        value={value}
      />
    </div>
  );
}

/**
 * Split `value` into plain runs and yellow `/command` spans. A token is colored
 * when it's a standalone `/word` (space/edge on both sides) whose name is the
 * prefix of a registered command — so it lights up while being typed.
 */
function renderSegments(value: string): ReactNode[] {
  const segments: ReactNode[] = [];
  const slashWord = /\/[a-z]+/gi;
  let last = 0;
  let key = 0;
  let match: RegExpExecArray | null;

  while ((match = slashWord.exec(value)) !== null) {
    const [text] = match;
    const name = text.slice(1).toLowerCase();
    const startIdx = match.index;
    const endIdx = startIdx + text.length;
    const boundedLeft = startIdx === 0 || /\s/.test(value[startIdx - 1] ?? "");
    const boundedRight = endIdx === value.length || /\s/.test(value[endIdx] ?? "");
    const isCommandish = Array.from(SLASH_COMMAND_NAMES).some((n) =>
      n.startsWith(name),
    );

    if (startIdx > last) segments.push(value.slice(last, startIdx));
    if (boundedLeft && boundedRight && isCommandish) {
      segments.push(
        <span className="text-yellow-400" key={key++}>
          {text}
        </span>,
      );
    } else {
      segments.push(text);
    }
    last = endIdx;
  }

  if (last < value.length) segments.push(value.slice(last));
  return segments;
}
