import type {
  ActiveBlockChangedEffectContext,
  DocumintEffects,
  ListItemInsertedEffectContext,
  TextDeletedEffectContext,
  TextInsertedEffectContext,
} from "documint";

const activeBlockRuleWidth = 8;
const deletedTextFlyAwayX = 8;
const deletedTextFlyAwayY = -22;
const deletedTextFlyAwayScale = 0.18;
const listItemFlashPaddingX = 7;
const listItemFlashPaddingY = 4;
const listItemFlashRadius = 7;
const insertedTextGlowLineWidth = 5;
const insertedTextGlowBlur = 24;

export const effects: DocumintEffects = {
  activeBlockChanged: paintActiveBlockChangedOutline,
  listItemInserted: {
    compose: "before",
    paint: paintListItemInsertedFlash,
  },
  textDeleted: paintDeletedTextFlyAway,
  textInserted: {
    compose: "after",
    paint: paintInsertedTextGlow,
  },
};

function paintDeletedTextFlyAway({
  color,
  contentKind,
  context,
  font,
  left,
  progress,
  text,
  textBaseline,
}: TextDeletedEffectContext) {
  if (contentKind === "code") {
    return;
  }

  const easedProgress = easeOutCubic(progress);
  const scale = 1 - deletedTextFlyAwayScale * easedProgress;

  context.save();
  context.font = font;
  const centerX = left + context.measureText(text).width / 2;
  context.fillStyle = color;
  context.globalAlpha *= 1 - progress;
  context.translate(deletedTextFlyAwayX * easedProgress, deletedTextFlyAwayY * easedProgress);
  context.translate(centerX, textBaseline);
  context.scale(scale, scale);
  context.translate(-centerX, -textBaseline);
  context.fillText(text, left, textBaseline);
  context.restore();
}

function easeOutCubic(progress: number) {
  return 1 - (1 - progress) * (1 - progress) * (1 - progress);
}

function paintActiveBlockChangedOutline({
  context,
  progress,
  rect,
  theme,
}: ActiveBlockChangedEffectContext) {
  const flash = 1 - easeOutCubic(progress);

  context.globalAlpha *= Math.min(1, flash * 1.1);
  context.fillStyle = theme.accent;
  context.fillRect(rect.left, rect.top, activeBlockRuleWidth, rect.height);
  context.fillRect(
    rect.left + rect.width - activeBlockRuleWidth,
    rect.top,
    activeBlockRuleWidth,
    rect.height,
  );
}

function paintListItemInsertedFlash({
  context,
  marker,
  progress,
  theme,
}: ListItemInsertedEffectContext) {
  const flash = 1 - easeOutCubic(progress);
  const rect = marker.rect;

  context.fillStyle = theme.inlineCodeBackground;
  context.globalAlpha *= Math.min(1, flash * 1.2);
  context.beginPath();
  context.roundRect(
    rect.left - listItemFlashPaddingX,
    rect.top - listItemFlashPaddingY,
    rect.width + listItemFlashPaddingX * 2,
    rect.height + listItemFlashPaddingY * 2,
    listItemFlashRadius,
  );
  context.fill();
}

function paintInsertedTextGlow({
  contentKind,
  context,
  progress,
  theme,
  viewport,
}: TextInsertedEffectContext) {
  const flash = 1 - easeOutCubic(progress);
  const inset = insertedTextGlowLineWidth / 2;
  const color =
    contentKind === "code" ? theme.commentHighlightResolved : theme.insertHighlightText;

  context.save();
  context.globalAlpha *= Math.min(1, flash * 1.35);
  context.lineWidth = insertedTextGlowLineWidth;
  context.shadowBlur = insertedTextGlowBlur;
  context.shadowColor = color;
  context.strokeStyle = color;
  context.strokeRect(
    viewport.left + inset,
    viewport.top + inset,
    viewport.width - insertedTextGlowLineWidth,
    viewport.height - insertedTextGlowLineWidth,
  );
  context.restore();
}
