/**
 * useZoneDrag — Zone box drag-and-drop positioning hook.
 *
 * Handles dragging zone boxes within the SVG diagram. Tracks drag offsets
 * per zone and distinguishes between click (toggle) and drag gestures.
 */

import { useState, useCallback, useRef } from "preact/hooks";
import type { RefObject } from "preact";
import type { ViewBox } from "./use-pan-zoom.js";

export interface ZoneDragState {
  /** Per-zone position offsets from drag operations */
  dragOffsets: Map<string, { dx: number; dy: number }>;
  /** Whether a zone drag is currently active */
  isDragging: () => boolean;
  /** Start a zone drag from mousedown on a zone box */
  startDrag: (zoneId: string, e: MouseEvent) => void;
  /** Continue a zone drag during mousemove */
  moveDrag: (e: MouseEvent) => void;
  /** End a zone drag on mouseup, returning the zone ID if it was a click (not drag) */
  endDrag: () => string | null;
}

interface DragRef {
  zoneId: string;
  startX: number;
  startY: number;
  origDx: number;
  origDy: number;
  moved: boolean;
}

/**
 * Hook that manages zone box dragging within the SVG diagram.
 *
 * @param svgRef - Ref to the SVG element for coordinate conversion
 * @param viewBox - Current viewBox for screen-to-SVG coordinate scaling
 */
export function useZoneDrag(
  svgRef: RefObject<SVGSVGElement>,
  viewBox: ViewBox,
): ZoneDragState {
  const [dragOffsets, setDragOffsets] = useState<Map<string, { dx: number; dy: number }>>(new Map());
  const zoneDrag = useRef<DragRef | null>(null);

  const isDragging = useCallback(() => zoneDrag.current !== null, []);

  const startDrag = useCallback((zoneId: string, e: MouseEvent) => {
    const off = dragOffsets.get(zoneId) ?? { dx: 0, dy: 0 };
    zoneDrag.current = {
      zoneId,
      startX: e.clientX,
      startY: e.clientY,
      origDx: off.dx,
      origDy: off.dy,
      moved: false,
    };
  }, [dragOffsets]);

  const moveDrag = useCallback((e: MouseEvent) => {
    if (!zoneDrag.current || !svgRef.current) return;

    const rect = svgRef.current.getBoundingClientRect();
    const scaleX = viewBox.w / rect.width;
    const scaleY = viewBox.h / rect.height;
    const dx = (e.clientX - zoneDrag.current.startX) * scaleX;
    const dy = (e.clientY - zoneDrag.current.startY) * scaleY;

    if (!zoneDrag.current.moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
      zoneDrag.current.moved = true;
    }

    if (zoneDrag.current.moved) {
      const zid = zoneDrag.current.zoneId;
      const newDx = zoneDrag.current.origDx + dx;
      const newDy = zoneDrag.current.origDy + dy;
      setDragOffsets((prev) => {
        const next = new Map(prev);
        next.set(zid, { dx: newDx, dy: newDy });
        return next;
      });
    }
  }, [svgRef, viewBox.w, viewBox.h]);

  const endDrag = useCallback((): string | null => {
    if (!zoneDrag.current) return null;
    const clickedZoneId = zoneDrag.current.moved ? null : zoneDrag.current.zoneId;
    zoneDrag.current = null;
    return clickedZoneId;
  }, []);

  return { dragOffsets, isDragging, startDrag, moveDrag, endDrag };
}
