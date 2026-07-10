export const VR_CHART_COLORS = [
  "#58a6ff",
  "#3fb950",
  "#f2cc60",
  "#ff7b72",
  "#39c5cf",
  "#f0883e",
  "#8ddb8c",
  "#ff9da7",
  "#b8db6f",
  "#a5d6ff",
] as const;

export const VR_CHART_SHAPES = [
  "circle",
  "square",
  "diamond",
  "triangleUp",
  "triangleDown",
  "pentagon",
  "hexagon",
  "star",
  "plus",
  "cross",
] as const;

export type VrChartShape = (typeof VR_CHART_SHAPES)[number];

export type VrChartStyle = {
  color: (typeof VR_CHART_COLORS)[number];
  shape: VrChartShape;
  dashArray: "" | "8 4" | "2 3";
};

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function dashArrayForRank(rank: number): VrChartStyle["dashArray"] {
  if (rank === 1) return "";
  if (rank === 2) return "8 4";
  return "2 3";
}

function styleFromIndexes(
  colorIndex: number,
  shapeIndex: number,
  rank: number,
): VrChartStyle {
  return {
    color: VR_CHART_COLORS[colorIndex]!,
    shape: VR_CHART_SHAPES[shapeIndex]!,
    dashArray: dashArrayForRank(rank),
  };
}

export function assignVrChartStyle(stableId: string, rank: number): VrChartStyle {
  const colorIndex = hashString(stableId) % VR_CHART_COLORS.length;
  let shapeIndex = hashString(`${stableId}:shape`) % VR_CHART_SHAPES.length;
  if (VR_CHART_COLORS.length > 1 && colorIndex === shapeIndex) {
    shapeIndex = (shapeIndex + 1) % VR_CHART_SHAPES.length;
  }
  return styleFromIndexes(colorIndex, shapeIndex, rank);
}

export function assignVrChartStyles(
  ids: string[],
  ranks: ReadonlyMap<string, number>,
): Map<string, VrChartStyle> {
  const used = new Set<string>();
  const styles = new Map<string, VrChartStyle>();

  ids.forEach((id, index) => {
    const rank = ranks.get(id) ?? index + 1;
    const colorStart = hashString(id) % VR_CHART_COLORS.length;
    const shapeStart = hashString(`${id}:shape`) % VR_CHART_SHAPES.length;

    let colorIndex = colorStart;
    let shapeIndex =
      colorStart === shapeStart && VR_CHART_SHAPES.length > 1
        ? (shapeStart + 1) % VR_CHART_SHAPES.length
        : shapeStart;

    for (let offset = 0; offset < VR_CHART_COLORS.length * VR_CHART_SHAPES.length; offset++) {
      const nextColor = (colorStart + Math.floor(offset / VR_CHART_SHAPES.length)) % VR_CHART_COLORS.length;
      const nextShape = (shapeStart + offset) % VR_CHART_SHAPES.length;
      if (nextColor === nextShape && VR_CHART_COLORS.length > 1) continue;

      const key = `${nextColor}:${nextShape}`;
      if (!used.has(key)) {
        colorIndex = nextColor;
        shapeIndex = nextShape;
        break;
      }
    }

    used.add(`${colorIndex}:${shapeIndex}`);
    styles.set(id, styleFromIndexes(colorIndex, shapeIndex, rank));
  });

  return styles;
}

function polygonPath(
  cx: number,
  cy: number,
  radius: number,
  sides: number,
  rotation = -Math.PI / 2,
): string {
  return Array.from({ length: sides }, (_, index) => {
    const angle = rotation + (index / sides) * Math.PI * 2;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ") + " Z";
}

export function svgPathForVrChartShape(
  shape: VrChartShape,
  cx: number,
  cy: number,
  size: number,
): string {
  const r = size / 2;
  const inner = r * 0.45;

  switch (shape) {
    case "circle":
      return `M${cx} ${cy - r} A${r} ${r} 0 1 1 ${cx} ${cy + r} A${r} ${r} 0 1 1 ${cx} ${cy - r} Z`;
    case "square":
      return `M${cx - r} ${cy - r} H${cx + r} V${cy + r} H${cx - r} Z`;
    case "diamond":
      return `M${cx} ${cy - r} L${cx + r} ${cy} L${cx} ${cy + r} L${cx - r} ${cy} Z`;
    case "triangleUp":
      return polygonPath(cx, cy + r * 0.1, r, 3, -Math.PI / 2);
    case "triangleDown":
      return polygonPath(cx, cy - r * 0.1, r, 3, Math.PI / 2);
    case "pentagon":
      return polygonPath(cx, cy, r, 5);
    case "hexagon":
      return polygonPath(cx, cy, r, 6, Math.PI / 6);
    case "star":
      return Array.from({ length: 10 }, (_, index) => {
        const angle = -Math.PI / 2 + (index / 10) * Math.PI * 2;
        const radius = index % 2 === 0 ? r : inner;
        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius;
        return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
      }).join(" ") + " Z";
    case "plus": {
      const arm = r * 0.38;
      return `M${cx - arm} ${cy - r} H${cx + arm} V${cy - arm} H${cx + r} V${cy + arm} H${cx + arm} V${cy + r} H${cx - arm} V${cy + arm} H${cx - r} V${cy - arm} H${cx - arm} Z`;
    }
    case "cross": {
      const arm = r * 0.34;
      return `M${cx - r} ${cy - r + arm} L${cx - r + arm} ${cy - r} L${cx} ${cy - arm} L${cx + r - arm} ${cy - r} L${cx + r} ${cy - r + arm} L${cx + arm} ${cy} L${cx + r} ${cy + r - arm} L${cx + r - arm} ${cy + r} L${cx} ${cy + arm} L${cx - r + arm} ${cy + r} L${cx - r} ${cy + r - arm} L${cx - arm} ${cy} Z`;
    }
  }
}
