import Tag, { type TagTone } from "./Tag";
import { BearIcon, BullIcon } from "../shell/icons";

function tone(direction: string): TagTone {
  return direction === "bullish" ? "up" : direction === "bearish" ? "down" : "neutral";
}

function label(direction: string): string {
  return direction === "bullish" ? "Bullish" : direction === "bearish" ? "Bearish" : "Neutral";
}

/** Direction uses the shared tag; the mark carries the meaning visually. */
export default function DirectionTag({ direction }: { direction: string }) {
  const text = label(direction);
  const known = direction === "bullish" || direction === "bearish";

  return (
    <Tag tone={tone(direction)} title={text}>
      {direction === "bullish" && <BullIcon className="tag-icon" />}
      {direction === "bearish" && <BearIcon className="tag-icon" />}
      {known ? <span className="sr-only">{text}</span> : text}
    </Tag>
  );
}
