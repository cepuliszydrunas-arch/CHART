//#region src/chart/settings/model.ts
var e = {
	showTitle: !0,
	showSymbolHeader: !0,
	timezone: "local",
	pricePrecision: "auto",
	thousandsSeparator: !0,
	crosshairMode: "normal",
	showLastPriceLine: !0,
	lastPriceLineColor: "#e8e9ea",
	lastPriceLineStyle: "solid",
	showLastPriceLabel: !0,
	syncSymbolAcrossPanes: !1,
	syncTimeframeAcrossPanes: !1,
	syncSettingsAcrossPanes: !1,
	chartBackground: "#0b0d0e",
	plotBackground: "#0b0d0e",
	grid: "both",
	gridColor: "#1c2024",
	gridOpacity: 1,
	gridWidth: 1,
	gridLineStyle: "solid",
	showBorder: !0,
	borderColor: "#1c2024",
	borderWidth: 1,
	showWatermark: !1,
	watermarkText: "HUGOFXLAB",
	watermarkOpacity: .6,
	watermarkPosition: "center",
	watermarkFontSize: 48,
	labelFontSize: "medium",
	cursorStyle: "crosshair",
	chartStyle: "candle",
	bullColor: "#2ebd85",
	bearColor: "#e0483e",
	wickColor: "#2ebd85",
	bullBorderColor: "#2ebd85",
	bearBorderColor: "#e0483e",
	showWicks: !0,
	showCandleBorders: !0,
	candleWidth: 62,
	hollowStyle: !0,
	priceSource: "close",
	showVolume: !0,
	volumePosition: "bottom",
	bullVolumeColor: "#2ebd85",
	bearVolumeColor: "#e0483e",
	volumeOpacity: .3,
	priceScalePos: "right",
	timeScalePos: "bottom",
	autoScale: !0,
	logScale: !1,
	invertPriceScale: !1,
	showPriceLabels: !0,
	showTimeLabels: !0,
	axisColor: "#1c2024",
	axisLabelColor: "#8b909a",
	decimalPrecision: "auto",
	showOHLC: !0,
	wheelMode: "zoom",
	zoomMode: "xy",
	zoomToCursor: !0,
	doubleClickAction: "fit",
	dragAction: "pan",
	spaceDragPan: !0,
	keyboardShortcuts: !0,
	arrowPanStep: 15,
	zoomSensitivity: 1,
	panSensitivity: 1,
	pinchZoom: !0,
	twoFingerPan: !0,
	doubleTapReset: !0,
	indVolume: !0,
	indEMA20: !1,
	indEMA50: !1,
	indSMA200: !1,
	indVWAP: !1,
	indBB: !1,
	indCVD: !1,
	showDrawings: !0,
	lockDrawings: !1,
	drawingLineColor: "#e0c46c",
	drawingLineWidth: 1.4,
	drawingLineStyle: "solid",
	drawingOpacity: 1,
	magnetMode: !1,
	footprintEnabled: !1,
	obEnabled: !1,
	tapeEnabled: !1,
	snapToGrid: !0
}, t = [
	{
		id: "general",
		label: "General",
		icon: "⚙"
	},
	{
		id: "appearance",
		label: "Appearance",
		icon: "🎨"
	},
	{
		id: "candles",
		label: "Candles / Bars",
		icon: "🕯"
	},
	{
		id: "axes",
		label: "Scales & Axes",
		icon: "📐"
	},
	{
		id: "interaction",
		label: "Interaction",
		icon: "🖱"
	},
	{
		id: "indicators",
		label: "Indicators",
		icon: "📈"
	},
	{
		id: "drawings",
		label: "Drawings",
		icon: "✏"
	},
	{
		id: "orderflow",
		label: "Order Flow",
		icon: "🧱"
	},
	{
		id: "layout",
		label: "Layout",
		icon: "🔲"
	}
];
function n(t) {
	return t in e;
}
//#endregion
//#region src/chart/settings/validate.ts
var r = /^#[0-9a-fA-F]{6}$/;
function i(e) {
	return typeof e == "string" && r.test(e);
}
function a(e, t, n) {
	return t.includes(e) ? e : n;
}
function o(e, t, n, r) {
	return typeof e != "number" || !Number.isFinite(e) ? r : Math.max(t, Math.min(n, e));
}
function s(e, t) {
	return typeof e == "boolean" ? e : t;
}
function c(t) {
	let n = { ...e };
	for (let r of Object.keys(e)) {
		let i = t[r];
		if (i == null) continue;
		let a = e[r];
		switch (typeof a) {
			case "boolean":
				n[r] = s(i, a);
				break;
			case "number":
				n[r] = o(i, l(r), u(r), a);
				break;
			case "string": n[r] = d(r, i, a);
		}
	}
	return n;
}
function l(e) {
	switch (e) {
		case "gridOpacity":
		case "volumeOpacity":
		case "drawingOpacity":
		case "watermarkOpacity": return .05;
		case "candleWidth": return 1;
		case "arrowPanStep": return 1;
		case "zoomSensitivity":
		case "panSensitivity": return .1;
		case "watermarkFontSize": return 10;
		case "drawingLineWidth": return .5;
		case "gridWidth": return .5;
		case "borderWidth": return 0;
		default: return -Infinity;
	}
}
function u(e) {
	switch (e) {
		case "gridOpacity":
		case "volumeOpacity":
		case "drawingOpacity":
		case "watermarkOpacity": return 1;
		case "candleWidth": return 100;
		case "arrowPanStep": return 100;
		case "zoomSensitivity":
		case "panSensitivity": return 10;
		case "watermarkFontSize": return 160;
		case "drawingLineWidth": return 10;
		case "gridWidth":
		case "borderWidth": return 8;
		default: return Infinity;
	}
}
function d(e, t, n) {
	if (typeof t != "string") return n;
	switch (e) {
		case "timezone": return a(t, [
			"local",
			"utc",
			"exchange"
		], "local");
		case "crosshairMode": return a(t, [
			"off",
			"normal",
			"magnet"
		], "normal");
		case "lastPriceLineStyle": return a(t, [
			"solid",
			"dashed",
			"dotted"
		], "solid");
		case "grid": return a(t, [
			"both",
			"horizontal",
			"vertical",
			"none"
		], "both");
		case "gridLineStyle": return a(t, [
			"solid",
			"dashed",
			"dotted"
		], "solid");
		case "watermarkPosition": return a(t, [
			"tl",
			"tr",
			"bl",
			"br",
			"center"
		], "center");
		case "labelFontSize": return a(t, [
			"small",
			"medium",
			"large"
		], "medium");
		case "cursorStyle": return a(t, [
			"crosshair",
			"default",
			"hidden"
		], "crosshair");
		case "chartStyle": return a(t, [
			"candle",
			"bar",
			"hollow",
			"heikin",
			"line",
			"area"
		], "candle");
		case "priceSource": return a(t, [
			"close",
			"open",
			"high",
			"low",
			"hl2",
			"hlc3",
			"ohlc4"
		], "close");
		case "volumePosition": return a(t, ["bottom", "hidden"], "bottom");
		case "priceScalePos": return a(t, [
			"right",
			"left",
			"both",
			"hidden"
		], "right");
		case "timeScalePos": return a(t, [
			"bottom",
			"hidden",
			"top"
		], "bottom");
		case "wheelMode": return a(t, [
			"zoom",
			"scroll",
			"disabled"
		], "zoom");
		case "zoomMode": return a(t, [
			"xy",
			"h",
			"v"
		], "xy");
		case "doubleClickAction": return a(t, [
			"fit",
			"reset",
			"disabled"
		], "fit");
		case "dragAction": return a(t, ["pan", "disabled"], "pan");
		case "drawingLineStyle": return a(t, [
			"solid",
			"dashed",
			"dotted"
		], "solid");
		case "bullColor":
		case "bearColor":
		case "wickColor":
		case "bullBorderColor":
		case "bearBorderColor":
		case "bullVolumeColor":
		case "bearVolumeColor":
		case "chartBackground":
		case "plotBackground":
		case "gridColor":
		case "borderColor":
		case "axisColor":
		case "axisLabelColor":
		case "lastPriceLineColor":
		case "drawingLineColor": return i(t) ? t : n;
		case "watermarkText": return t.slice(0, 64);
		default: return t;
	}
}
function f(e) {
	return e === "auto" ? "auto" : typeof e == "number" && Number.isFinite(e) && e >= 0 && e <= 8 ? Math.floor(e) : "auto";
}
function p(e) {
	if (!e || typeof e != "object") return {};
	let t = {};
	for (let [r, i] of Object.entries(e)) n(r) && i !== void 0 && (t[r] = i);
	return c(t);
}
var m = () => ({
	version: 1,
	app: {},
	workspace: {},
	panes: {}
});
function h(e) {
	return typeof e == "object" && !!e && !Array.isArray(e);
}
function g(e) {
	if (!h(e)) return m();
	let t = typeof e.version == "number" ? e.version : 0, n = m();
	if (t === 0) {
		let t = { ...e };
		return delete t.version, n.workspace = p(t), n;
	}
	if (e.app && h(e.app) && (n.app = p(e.app)), e.workspace && h(e.workspace) && (n.workspace = p(e.workspace)), e.panes && h(e.panes)) for (let [t, r] of Object.entries(e.panes)) h(r) && (n.panes[t] = p(r));
	return n;
}
function _(e) {
	return JSON.stringify({
		version: 1,
		app: e.app,
		workspace: e.workspace,
		panes: e.panes
	});
}
function v(e, t, n, r, i) {
	let a = S(e);
	if (i) {
		a.workspace[n] = C(n, r);
		for (let e of Object.keys(a.panes)) delete a.panes[e][n];
		return a;
	}
	let o = a.panes[t] ?? {};
	return o[n] = C(n, r), a.panes[t] = o, a;
}
function y(e, t) {
	let n = S(e);
	return delete n.panes[t], n;
}
function b(e) {
	return m();
}
function x(t, n) {
	let r = {
		...e,
		...t.workspace,
		...t.app
	}, i = t.panes?.[n], a = i ? {
		...r,
		...i
	} : r, o = p(a);
	return o.decimalPrecision = f(a.decimalPrecision), o.pricePrecision = f(a.pricePrecision), o;
}
function S(e) {
	return {
		version: e.version,
		app: { ...e.app },
		workspace: { ...e.workspace },
		panes: Object.fromEntries(Object.entries(e.panes).map(([e, t]) => [e, { ...t }]))
	};
}
function C(t, n) {
	return t === "decimalPrecision" || t === "pricePrecision" ? f(n) : typeof n == "boolean" || typeof n == "number" || typeof n == "string" ? n : e[t];
}
function w(e) {
	return Object.keys(e.app).length > 0 || Object.keys(e.workspace).length > 0 || Object.keys(e.panes).length > 0;
}
//#endregion
//#region src/client/settings-entry.ts
if (typeof window < "u") {
	let n = "hgfx.settings.v1";
	function r() {
		try {
			let e = localStorage.getItem(n);
			return g(e ? JSON.parse(e) : null);
		} catch {
			return m();
		}
	}
	function i(e) {
		try {
			localStorage.setItem(n, _(e));
		} catch {}
	}
	window.HgfxSettings = {
		defaults: e,
		categories: t,
		hydrate: g,
		serialize: _,
		setValue: v,
		resetPane: y,
		resetAll: b,
		mergeSettings: x,
		storeHasChanges: w,
		sanitizePaneOverrides: p,
		load: r,
		persist: i
	};
}
var T = {};
//#endregion
export { T as default };
