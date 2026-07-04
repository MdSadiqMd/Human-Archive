export interface BoundingBox {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
	rotation: number;
	hand: "left" | "right";
}

export type ResizeHandle = "nw" | "n" | "ne" | "w" | "e" | "sw" | "s" | "se";

export interface Point {
	x: number;
	y: number;
}

export interface CanvasTransform {
	zoom: number;
	offsetX: number;
	offsetY: number;
}

export interface ZoomControl {
	zoomIn: () => void;
	zoomOut: () => void;
	zoomReset: () => void;
}
