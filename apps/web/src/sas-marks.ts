/**
 * The 32 marks the second SAS factor is drawn with.
 *
 * These replace emoji, and not for taste. An emoji is a code point, not a
 * picture: the same code point is drawn differently by Apple, Google, Samsung
 * and every font vendor. A comparison code whose whole job is to look identical
 * on the two devices being compared cannot be built out of glyphs the two
 * devices disagree about. These are drawn by us, so both screens show the same
 * strokes regardless of platform.
 *
 * Design constraints, in order:
 *  1. Distinguishable at a glance, at small size, side by side. Three earlier
 *     candidates were cut for colliding with a neighbour once actually drawn:
 *     a second triangle, a second wave, and a mirror of the corner.
 *  2. No colour dependency: a colour-blind user compares the same shapes.
 *  3. Strokes only, no fills, so they survive a low-brightness screen.
 *
 * What is deliberately NOT a constraint: rotation invariance. The four arrows
 * are rotations of each other and that is fine, because the comparison is
 * positional — five numbered slots, two screens held the same way up. Demanding
 * rotation invariance would cost the most legible marks in the set to defend
 * against someone reading one phone while holding it upside down.
 *
 * The entropy is unchanged: 32 marks is 5 bits each, five marks is 25 bits, the
 * same as the emoji set it replaces.
 */

/** Path data on a 24×24 grid, stroked. Index is the value the session emits. */
const MARKS: readonly string[] = [
  "M4 20 L12 4 L20 20 Z",                       // 00 triangle
  "M5 5 H19 V19 H5 Z",                          // 01 square
  "M12 3 A9 9 0 1 0 12.01 3 Z",                 // 02 circle
  "M12 3 L21 12 L12 21 L3 12 Z",                // 03 diamond
  "M4 12 H20 M12 4 V20",                        // 04 plus
  "M5 5 L19 19 M19 5 L5 19",                    // 05 cross
  "M4 6 H20 M4 12 H20 M4 18 H20",               // 06 three bars
  "M6 4 V20 M12 4 V20 M18 4 V20",               // 07 three columns
  "M4 18 L10 8 L14 14 L20 5",                   // 08 zigzag line
  "M4 12 Q8 4 12 12 T20 12",                    // 09 wave
  "M12 3 V21 M12 3 L7 8 M12 3 L17 8",           // 10 up arrow
  "M12 21 V3 M12 21 L7 16 M12 21 L17 16",       // 11 down arrow
  "M3 12 H21 M3 12 L8 7 M3 12 L8 17",           // 12 left arrow
  "M21 12 H3 M21 12 L16 7 M21 12 L16 17",       // 13 right arrow
  "M12 4 L14.7 9.5 L21 10.4 L16.5 14.7 L17.5 21 L12 18 L6.5 21 L7.5 14.7 L3 10.4 L9.3 9.5 Z", // 14 star
  "M12 5 L18 8.5 V15.5 L12 19 L6 15.5 V8.5 Z",  // 15 hexagon
  "M12 4 L20 18 H4 Z M12 10 V14",               // 16 triangle with stem
  "M6 6 H18 V18 H6 Z M6 6 L18 18",              // 17 square with diagonal
  "M12 4 A8 8 0 0 1 12 20 A8 8 0 0 1 12 4 M12 4 V20", // 18 split circle
  "M5 19 L12 5 L19 19 M8 14 H16",               // 19 letter A
  "M6 5 V19 M6 5 H15 A4 4 0 0 1 15 12 H6",      // 20 letter P
  "M6 5 H18 M12 5 V19",                         // 21 letter T
  "M6 5 V13 A6 6 0 0 0 18 13 V5",               // 22 letter U
  "M5 5 L12 19 L19 5",                          // 23 letter V
  "M7 5 H17 L7 19 H17",                         // 24 letter Z
  "M4 16 H8 V20 H4 Z M10 10 H14 V14 H10 Z M16 4 H20 V8 H16 Z", // 25 stair of squares
  "M4 4 H10 V10 H4 Z M14 14 H20 V20 H14 Z",     // 26 two squares
  "M12 4 V12 H20",                              // 27 corner
  "M12 4 A8 8 0 1 0 12.01 4 Z M12 9 A3 3 0 1 0 12.01 9 Z", // 28 concentric circles
  "M8 4 A6 6 0 0 0 8 16 M16 8 A6 6 0 0 1 16 20", // 29 linked arcs
  "M4 4 H20 V20 H4 Z M9 9 H15 V15 H9 Z",        // 30 nested squares
  "M15 4 A8 8 0 1 0 15 20 A6 6 0 1 1 15 4 Z",   // 31 crescent
];

export const SAS_MARK_TOTAL = MARKS.length;

/** Screen-reader and telephone-readable names, in the same order. */
const NAMES: readonly string[] = [
  "triangle", "square", "circle", "diamond", "plus", "cross", "three horizontal lines",
  "three vertical lines", "zigzag", "wave", "up arrow", "down arrow", "left arrow",
  "right arrow", "star", "hexagon", "triangle with stem", "square with diagonal", "split circle",
  "letter A", "letter P", "letter T", "letter U", "letter V", "letter Z",
  "stairs", "two squares", "corner", "nested circles", "linked arcs", "nested squares", "crescent",
];

export function sasMarkName(index: number): string {
  return NAMES[index] ?? "unknown";
}

/**
 * The marks as a spoken sentence.
 *
 * Not decoration: comparing SAS is a visual act, which makes the whole product
 * unusable for a blind operator. A read-aloud form is the minimum that turns
 * "cannot use this" into "can use this with help". See TODO objection İ-7.
 */
export function sasMarksSpoken(marks: readonly number[]): string {
  return marks.map((mark, index) => `${index + 1}. ${sasMarkName(mark)}`).join(", ");
}

/** One mark as an inline SVG element. */
export function renderSasMark(index: number, size = 34): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", sasMarkName(index));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", MARKS[index] ?? "M6 6 L18 18 M18 6 L6 18");
  svg.append(path);
  return svg;
}

/** The five marks as one labelled row, ready to drop into the SAS panel. */
export function renderSasMarks(marks: readonly number[]): HTMLElement {
  const row = document.createElement("span");
  row.className = "sas-marks";
  row.setAttribute("role", "img");
  row.setAttribute("aria-label", `Sembol karşılaştırması: ${sasMarksSpoken(marks)}`);
  for (const mark of marks) {
    const cell = document.createElement("span");
    cell.className = "sas-mark";
    cell.setAttribute("aria-hidden", "true");
    cell.append(renderSasMark(mark));
    row.append(cell);
  }
  return row;
}
