function e(e, t, n) {
	return Number.isFinite(e) ? Math.max(t, Math.min(n, e)) : t;
}
function t(e, t, n) {
	let r = !1, i = [];
	for (let a of e.items) if (a.id === t) {
		let e = n(a);
		r = !0, e && i.push(e);
	} else i.push(a);
	return r ? {
		...e,
		items: i,
		updatedAt: Date.now()
	} : e;
}
function n(e, t) {
	return !Number.isFinite(e) || t <= 0 ? e : Math.round(e / t) * t;
}
function r(t, r = 12, i = 8, a = !0) {
	if (!a) return t;
	let o = 1 / r, s = 1 / i;
	return {
		x: e(n(t.x, o), 0, 1),
		y: e(n(t.y, s), 0, 1),
		w: e(n(t.w, o), .05, 1),
		h: e(n(t.h, s), .05, 1)
	};
}
//#endregion
//#region src/ui/layouts/free-layout-controller.ts
var i = /* @__PURE__ */ new Map(), a = /* @__PURE__ */ new Map(), o = null, s = null;
function c(e, t, n) {
	return Math.max(t, Math.min(n, e));
}
function l(e) {
	return e.type === "chart";
}
function u(e) {
	return l(e) ? {
		w: .2,
		h: .2
	} : {
		w: .15,
		h: .12
	};
}
function d(e, t) {
	if (e.querySelector(".pane-handle")) return;
	let n = document.createElement("div");
	n.className = "pane-handle", n.setAttribute("data-pane-handle", t.id), n.setAttribute("aria-label", `Drag ${t.title ?? t.type}`);
	let r = document.createElement("span");
	if (r.className = "pane-handle__title", r.textContent = t.title ?? t.type, n.appendChild(r), [
		"n",
		"s",
		"e",
		"w",
		"ne",
		"nw",
		"se",
		"sw"
	].forEach((e) => {
		let t = document.createElement("div");
		t.className = `pane-resize pane-resize--${e}`, t.setAttribute("data-resize", e), n.appendChild(t);
	}), !l(t)) {
		let e = document.createElement("div");
		e.className = "pane-ctrls";
		let r = document.createElement("button");
		r.type = "button", r.className = "pane-ctrl", r.setAttribute("data-ctrl", "min"), r.title = "Minimize", r.textContent = "–";
		let i = document.createElement("button");
		i.type = "button", i.className = "pane-ctrl", i.setAttribute("data-ctrl", "max"), i.title = "Maximize", i.textContent = "◻";
		let a = document.createElement("button");
		a.type = "button", a.className = "pane-ctrl pane-ctrl--close", a.setAttribute("data-ctrl", "close"), a.title = "Close", a.textContent = "✕";
		let o = (e) => (n) => {
			n.stopPropagation(), b(t, e);
		};
		r.addEventListener("click", o("min")), i.addEventListener("click", o("max")), a.addEventListener("click", o("close")), e.appendChild(r), e.appendChild(i), e.appendChild(a), n.appendChild(e);
	}
	e.appendChild(n);
}
function f(e, t) {
	let { position: n } = t;
	if (t.state === "maximized") {
		e.style.left = "0%", e.style.top = "0%", e.style.width = "100%", e.style.height = "100%", e.dataset.maximized = "1";
		return;
	}
	if (t.state === "minimized") {
		e.style.left = (n.x * 100).toFixed(3) + "%", e.style.top = (n.y * 100).toFixed(3) + "%", e.style.width = "36px", e.style.height = "24px", e.dataset.minimized = "1";
		return;
	}
	e.style.left = (n.x * 100).toFixed(3) + "%", e.style.top = (n.y * 100).toFixed(3) + "%", e.style.width = (n.w * 100).toFixed(3) + "%", e.style.height = (n.h * 100).toFixed(3) + "%", delete e.dataset.maximized, delete e.dataset.minimized;
}
function p(e, t) {
	if (!e) return;
	let n = /* @__PURE__ */ new Set();
	for (let r of t.items) {
		n.add(r.id);
		let s = i.get(r.id);
		if (!s) {
			s = document.createElement("div"), s.className = "pane " + (l(r) ? "pane--chart" : "pane--widget"), s.dataset.itemId = r.id, s.dataset.itemType = r.type;
			let t = document.createElement("div");
			if (t.className = "pane__content", t.dataset.paneContent = r.id, s.appendChild(t), e.appendChild(s), i.set(r.id, s), l(r) && o?.createChart) {
				let e = o.createChart(t, r);
				typeof e == "function" && a.set(r.id, e);
			} else if (!l(r) && o?.createWidget) {
				let e = o.createWidget(t, r);
				typeof e == "function" && a.set(r.id, e);
			}
		}
		d(s, r), f(s, r), t.activePaneId === r.id ? s.classList.add("pane--active") : s.classList.remove("pane--active");
	}
	for (let [e, t] of i) if (!n.has(e)) {
		let n = a.get(e);
		if (n) {
			try {
				n();
			} catch {}
			a.delete(e);
		}
		t.remove(), i.delete(e);
	}
}
function m(e) {
	if (!o) return null;
	let t = e?.closest("[data-item-id]");
	if (!t) return null;
	let n = t.dataset.itemId;
	return n ? o.getState().items.find((e) => e.id === n) ?? null : null;
}
function h(e) {
	if (!o) return;
	let t = e.target;
	if (t.closest("[data-resize]")) {
		g(e, "resize", t.getAttribute("data-resize"));
		return;
	}
	if (t.closest("[data-ctrl]")) {
		let e = t.getAttribute("data-ctrl"), n = m(t);
		n && e && b(n, e);
		return;
	}
	t.closest(".pane-handle") && g(e, "move");
}
function g(e, n, r) {
	if (!o) return;
	let a = m(e.target);
	if (!a) return;
	let c = i.get(a.id);
	if (!c) return;
	let l = o.getState();
	if (a.state !== "maximized" || n !== "move") {
		if (a.state === "minimized" && n === "move") {
			let e = t(l, a.id, (e) => ({
				...e,
				state: "normal"
			}));
			o.setState(e), p(o.host, e), o.onAfterApply?.();
			return;
		}
		s = {
			itemId: a.id,
			mode: n,
			resizeDir: r,
			startX: e.clientX,
			startY: e.clientY,
			startPos: {
				x: a.position.x,
				y: a.position.y,
				w: a.position.w,
				h: a.position.h
			},
			rect: o.host.getBoundingClientRect(),
			moved: !1
		};
		try {
			e.target.setPointerCapture?.(e.pointerId);
		} catch {}
		e.preventDefault(), e.stopPropagation(), c.classList.add("pane--dragging");
	}
}
function _(e) {
	if (!s || !o) return;
	let n = s, a = n.rect, l = (e.clientX - n.startX) / a.width, d = (e.clientY - n.startY) / a.height;
	if (!n.moved) {
		if (Math.abs(e.clientX - n.startX) < 3 && Math.abs(e.clientY - n.startY) < 3) return;
		n.moved = !0;
	}
	let p = o.getState(), m = p.items.find((e) => e.id === n.itemId);
	if (!m) return;
	let h = u(m), g = {
		x: n.startPos.x,
		y: n.startPos.y,
		w: n.startPos.w,
		h: n.startPos.h
	};
	if (n.mode === "move") g = {
		x: c(n.startPos.x + l, 0, 1 - n.startPos.w),
		y: c(n.startPos.y + d, 0, 1 - n.startPos.h),
		w: n.startPos.w,
		h: n.startPos.h
	};
	else {
		let e = n.resizeDir ?? "se";
		if (e.includes("e") && (g.w = c(n.startPos.w + l, h.w, 1 - n.startPos.x)), e.includes("s") && (g.h = c(n.startPos.h + d, h.h, 1 - n.startPos.y)), e.includes("w")) {
			let e = c(n.startPos.x + l, 0, n.startPos.x + n.startPos.w - h.w);
			g.w = n.startPos.w + (n.startPos.x - e), g.x = e;
		}
		if (e.includes("n")) {
			let e = c(n.startPos.y + d, 0, n.startPos.y + n.startPos.h - h.h);
			g.h = n.startPos.h + (n.startPos.y - e), g.y = e;
		}
	}
	p.snapToGrid && (g = r(g, 12, 8, !0));
	let _ = t(p, m.id, (e) => ({
		...e,
		position: {
			...e.position,
			...g
		}
	}));
	o.setState(_);
	let v = i.get(m.id);
	v && f(v, {
		...m,
		position: {
			...m.position,
			...g
		}
	});
}
function v(e) {
	if (!s || !o) return;
	let t = s;
	s = null;
	let n = i.get(t.itemId);
	n && n.classList.remove("pane--dragging");
	try {
		e.target.releasePointerCapture?.(e.pointerId);
	} catch {}
	t.moved && o.save();
}
function y(e) {
	if (!o) return;
	let t = e.target;
	if (t.closest(".pane-handle") || t.closest("[data-resize]") || t.closest("[data-ctrl]")) return;
	let n = m(t);
	if (n) {
		o.setActivePane(n.id);
		for (let [, e] of i) e.classList.remove("pane--active");
		i.get(n.id)?.classList.add("pane--active");
	}
}
function b(e, n) {
	if (!o) return;
	let r = o.getState();
	if (n === "close") {
		if (e.type === "chart" && r.items.filter((e) => e.type === "chart").length <= 1) return;
		let n = t(r, e.id, () => null);
		if (n.items.length === 0) {
			let e = {
				id: "p1",
				type: "chart",
				chartPaneId: "p1",
				position: {
					x: 0,
					y: 0,
					w: 1,
					h: 1
				},
				config: {
					symbol: "BTCUSDT",
					interval: "1h",
					active: !0
				}
			}, t = {
				...n,
				items: [e],
				activePaneId: "p1"
			};
			o.setState(t), p(o.host, t), o.save();
			return;
		}
		let i = {
			...n,
			activePaneId: n.items.find((e) => e.type === "chart")?.id ?? null
		};
		o.setState(i), p(o.host, i), o.save();
		return;
	}
	if (n === "min") {
		let n = t(r, e.id, (e) => ({
			...e,
			state: "minimized"
		}));
		o.setState(n), p(o.host, n), o.save();
		return;
	}
	if (n === "max") {
		let n = e.state === "maximized" ? "normal" : "maximized", i = t(r, e.id, (e) => ({
			...e,
			state: n
		}));
		o.setState(i), p(o.host, i), o.save();
	}
}
function x(e) {
	if (!o) return;
	let t = e.target;
	if (t.closest(".pane-handle")) return;
	let n = m(t);
	n && b(n, "max");
}
function S(e) {
	o && w(), o = e, e.host.addEventListener("pointerdown", h), e.host.addEventListener("pointermove", _), e.host.addEventListener("pointerup", v), e.host.addEventListener("pointercancel", v), e.host.addEventListener("click", y), e.host.addEventListener("dblclick", x), p(e.host, e.getState());
}
function C(e) {
	let t = a.get(e);
	if (t) {
		try {
			t();
		} catch {}
		a.delete(e);
	}
	let n = i.get(e);
	n && (n.remove(), i.delete(e));
}
function w() {
	if (o) {
		o.host.removeEventListener("pointerdown", h), o.host.removeEventListener("pointermove", _), o.host.removeEventListener("pointerup", v), o.host.removeEventListener("pointercancel", v), o.host.removeEventListener("click", y), o.host.removeEventListener("dblclick", x);
		for (let [, e] of a) try {
			e();
		} catch {}
		a.clear();
		for (let [, e] of i) e.remove();
		i.clear(), o = null, s = null;
	}
}
function T() {
	o && p(o.host, o.getState());
}
function E(e) {
	switch (e) {
		case "chart": return "Chart";
		case "footprint": return "Footprint";
		case "orderbook": return "Order Book";
		case "time_sales": return "Time & Sales";
		case "order_ticket": return "Order Ticket";
		case "positions": return "Positions";
		case "alerts": return "Alerts";
		case "cvd": return "CVD";
		case "volume_profile": return "Volume Profile";
		case "notes": return "Notes";
		case "sessions": return "Session Levels";
	}
}
//#endregion
//#region src/client/layouts-entry.ts
typeof window < "u" && (window.HgfxLayouts = {
	mount: S,
	unmount: w,
	refresh: T,
	disposeItem: C,
	getItemTypeLabel: E
});
var D = {};
//#endregion
export { D as default };
