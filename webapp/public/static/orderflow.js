//#region src/core/orderflow/aggregator.ts
var e = class {
	cfg;
	bars = [];
	cvd = 0;
	venueCvd = /* @__PURE__ */ new Map();
	venueLastTs = /* @__PURE__ */ new Map();
	dedup = /* @__PURE__ */ new Map();
	lastTradeTs = 0;
	ingested = 0;
	deduped = 0;
	dirty = !0;
	cachedSnapshot = null;
	constructor(e) {
		if (this.cfg = e, !(e.timeframeMs > 0)) throw Error("timeframeMs must be > 0");
		if (!(e.tickSize > 0)) throw Error("tickSize must be > 0");
		if (!(e.retention > 0)) throw Error("retention must be > 0");
	}
	get config() {
		return this.cfg;
	}
	ingest(e) {
		if (e.symbol !== this.cfg.symbol || !Number.isFinite(e.price) || !Number.isFinite(e.qty) || e.qty <= 0 || e.price <= 0) return !1;
		let t = this.dedup.get(e.venue);
		if (t || (t = new i(this.cfg.dedupWindow), this.dedup.set(e.venue, t)), !t.add(e.tradeId)) return this.deduped++, !1;
		let n = this.cfg.venueWeights?.[e.venue] ?? 1, r = (e.aggressor === "buy" ? e.qty : -e.qty) * n, a = this.barFor(e.ts);
		return this.cvd += r, this.venueCvd.set(e.venue, (this.venueCvd.get(e.venue) ?? 0) + r), this.venueLastTs.set(e.venue, Math.max(this.venueLastTs.get(e.venue) ?? 0, e.ts)), this.lastTradeTs = Math.max(this.lastTradeTs, e.ts), this.ingested++, a && this.applyToBar(a, e, r), this.dirty = !0, !0;
	}
	ingestMany(e) {
		let t = 0;
		for (let n of e) this.ingest(n) && t++;
		return t;
	}
	markGap(e) {
		let t = this.bars[this.bars.length - 1];
		t && (t.incomplete = !0), e && this.dedup.get(e)?.clear(), this.dirty = !0;
	}
	snapshot() {
		return !this.dirty && this.cachedSnapshot ? this.cachedSnapshot : (this.cachedSnapshot = {
			symbol: this.cfg.symbol,
			cvd: this.cvd,
			venueCvd: Object.fromEntries(this.venueCvd),
			bars: this.bars.map(n),
			lastTradeTs: this.lastTradeTs,
			tradesIngested: this.ingested,
			tradesDeduped: this.deduped,
			venueLastTs: Object.fromEntries(this.venueLastTs)
		}, this.dirty = !1, this.cachedSnapshot);
	}
	staleVenues(e, t) {
		let n = [];
		for (let [r, i] of this.venueLastTs) e - i > t && n.push(r);
		return n;
	}
	barFor(e) {
		let n = e - e % this.cfg.timeframeMs, i = this.bars[this.bars.length - 1];
		if (i && i.openTs === n) return i;
		if (!i || n > i.openTs) {
			if (i) {
				let e = i.openTs + this.cfg.timeframeMs, r = this.cfg.retention;
				for (; e < n && r-- > 0;) this.bars.push(t(e, this.cfg.timeframeMs, this.cvd, i.incomplete)), e += this.cfg.timeframeMs;
			}
			let e = t(n, this.cfg.timeframeMs, this.cvd, !1);
			return this.bars.push(e), this.trimRetention(), e;
		}
		let a = r(this.bars, n);
		return a >= 0 ? this.bars[a] : null;
	}
	applyToBar(e, t, n) {
		let r = Math.round(t.price / this.cfg.tickSize) * this.cfg.tickSize, i = e.levels.get(r);
		i || (i = {
			price: r,
			buyVol: 0,
			sellVol: 0,
			delta: 0,
			trades: 0
		}, e.levels.set(r, i)), t.aggressor === "buy" ? (i.buyVol += t.qty, e.totalBuy += t.qty) : (i.sellVol += t.qty, e.totalSell += t.qty), i.delta = i.buyVol - i.sellVol, i.trades++, e.delta = e.totalBuy - e.totalSell, e.deltaHigh = Math.max(e.deltaHigh, e.delta), e.deltaLow = Math.min(e.deltaLow, e.delta), e.high = Math.max(e.high, t.price), e.low = Math.min(e.low, t.price), e.trades++, e.venueDelta.set(t.venue, (e.venueDelta.get(t.venue) ?? 0) + n), e === this.bars[this.bars.length - 1] ? e.cvdClose = this.cvd : this.recomputeCvdCloseFrom(e);
	}
	recomputeCvdCloseFrom(e) {
		let t = this.bars.indexOf(e), n = t > 0 ? this.bars[t - 1].cvdClose : 0;
		for (let e = t; e < this.bars.length; e++) {
			let t = 0;
			for (let n of this.bars[e].venueDelta.values()) t += n;
			n += t, this.bars[e].cvdClose = n;
		}
	}
	trimRetention() {
		let e = this.bars.length - this.cfg.retention;
		e > 0 && this.bars.splice(0, e);
	}
};
function t(e, t, n, r) {
	return {
		openTs: e,
		timeframeMs: t,
		levels: /* @__PURE__ */ new Map(),
		totalBuy: 0,
		totalSell: 0,
		delta: 0,
		cvdClose: n,
		deltaHigh: 0,
		deltaLow: 0,
		high: -Infinity,
		low: Infinity,
		trades: 0,
		incomplete: r,
		venueDelta: /* @__PURE__ */ new Map()
	};
}
function n(e) {
	let t = /* @__PURE__ */ new Map();
	for (let [n, r] of e.levels) t.set(n, { ...r });
	return {
		...e,
		levels: t,
		venueDelta: new Map(e.venueDelta)
	};
}
function r(e, t) {
	let n = 0, r = e.length - 1;
	for (; n <= r;) {
		let i = n + r >> 1, a = e[i].openTs;
		if (a === t) return i;
		a < t ? n = i + 1 : r = i - 1;
	}
	return -1;
}
var i = class {
	capacity;
	set = /* @__PURE__ */ new Set();
	ring;
	head = 0;
	constructor(e) {
		if (this.capacity = e, !(e > 0)) throw Error("capacity must be > 0");
		this.ring = Array(e);
	}
	add(e) {
		if (this.set.has(e)) return !1;
		let t = this.ring[this.head];
		return t !== void 0 && this.set.delete(t), this.ring[this.head] = e, this.head = (this.head + 1) % this.capacity, this.set.add(e), !0;
	}
	has(e) {
		return this.set.has(e);
	}
	clear() {
		this.set.clear(), this.ring.fill(void 0), this.head = 0;
	}
	get size() {
		return this.set.size;
	}
};
//#endregion
//#region src/core/orderflow/adapters.ts
function a(e) {
	let t = typeof e == "number" ? e : typeof e == "string" ? Number(e) : NaN;
	return Number.isFinite(t) ? t : NaN;
}
function o(e) {
	try {
		return JSON.parse(e);
	} catch {
		return null;
	}
}
var s = {
	venue: "binance",
	wsUrl: (e) => `wss://fstream.binance.com/ws/${e.toLowerCase()}@aggTrade`,
	subscribeMessage: () => null,
	parse(e, t) {
		let n = o(e);
		if (!n || n.e !== "aggTrade" || typeof n.s != "string" || n.s.toUpperCase() !== t.toUpperCase()) return [];
		let r = a(n.p), i = a(n.q), s = a(n.T);
		return !Number.isFinite(r) || !Number.isFinite(i) || !Number.isFinite(s) ? [] : [{
			venue: "binance",
			tradeId: String(n.a),
			symbol: t.toUpperCase(),
			price: r,
			qty: i,
			aggressor: n.m === !0 ? "sell" : "buy",
			ts: s
		}];
	}
}, c = {
	venue: "bybit",
	wsUrl: () => "wss://stream.bybit.com/v5/public/linear",
	subscribeMessage: (e) => JSON.stringify({
		op: "subscribe",
		args: [`publicTrade.${e.toUpperCase()}`]
	}),
	parse(e, t) {
		let n = o(e);
		if (!n || typeof n.topic != "string" || !n.topic.startsWith("publicTrade.") || !Array.isArray(n.data)) return [];
		let r = [];
		for (let e of n.data) {
			if (typeof e.s != "string" || e.s.toUpperCase() !== t.toUpperCase()) continue;
			let n = a(e.p), i = a(e.v), o = a(e.T);
			!Number.isFinite(n) || !Number.isFinite(i) || !Number.isFinite(o) || (e.S === "Buy" || e.S === "Sell") && r.push({
				venue: "bybit",
				tradeId: String(e.i),
				symbol: t.toUpperCase(),
				price: n,
				qty: i,
				aggressor: e.S === "Buy" ? "buy" : "sell",
				ts: o
			});
		}
		return r;
	}
};
function l(e) {
	let t = e.toUpperCase(), n = [
		"USDT",
		"USDC",
		"USD"
	].find((e) => t.endsWith(e));
	return n ? `${t.slice(0, -n.length)}-${n}-SWAP` : t;
}
var u = {
	venue: "okx",
	wsUrl: () => "wss://ws.okx.com:8443/ws/v5/public",
	subscribeMessage: (e) => JSON.stringify({
		op: "subscribe",
		args: [{
			channel: "trades",
			instId: l(e)
		}]
	}),
	parse(e, t) {
		let n = o(e);
		if (!n || typeof n.arg != "object" || n.arg === null) return [];
		let r = n.arg;
		if (r.channel !== "trades" || r.instId !== l(t) || !Array.isArray(n.data)) return [];
		let i = [];
		for (let e of n.data) {
			let n = a(e.px), r = a(e.sz), o = a(e.ts);
			!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(o) || (e.side === "buy" || e.side === "sell") && i.push({
				venue: "okx",
				tradeId: String(e.tradeId),
				symbol: t.toUpperCase(),
				price: n,
				qty: r,
				aggressor: e.side,
				ts: o
			});
		}
		return i;
	}
}, d = {
	binance: s,
	bybit: c,
	okx: u
};
//#endregion
//#region src/core/orderflow/signals.ts
function f(e) {
	return [...e.levels.values()].sort((e, t) => e.price - t.price);
}
function p(e, t = {}) {
	let n = t.ratio ?? 3, r = t.minVol ?? 0, i = f(e), a = [], o = i.map((e, t) => {
		if (t === 0 || e.buyVol < r) return !1;
		let a = i[t - 1].sellVol;
		return a > 0 ? e.buyVol / a >= n : e.buyVol >= r && r > 0;
	}), s = i.map((e, t) => {
		if (t === i.length - 1 || e.sellVol < r) return !1;
		let a = i[t + 1].buyVol;
		return a > 0 ? e.sellVol / a >= n : e.sellVol >= r && r > 0;
	}), c = (e, t) => {
		let n = Array(i.length).fill(0);
		for (let t = 0; t < i.length;) {
			if (!e[t]) {
				t++;
				continue;
			}
			let r = t;
			for (; r < i.length && e[r];) r++;
			for (let e = t; e < r; e++) n[e] = r - t;
			t = r;
		}
		for (let r = 0; r < i.length; r++) {
			if (!e[r]) continue;
			let o = i[r], s = t === "buy" ? i[r - 1].sellVol : i[r + 1].buyVol, c = t === "buy" ? o.buyVol : o.sellVol;
			a.push({
				type: "imbalance",
				side: t,
				price: o.price,
				ratio: s > 0 ? c / s : Infinity,
				stacked: n[r]
			});
		}
	};
	return c(o, "buy"), c(s, "sell"), a;
}
function m(e, t = {}) {
	let n = t.volMult ?? 2.5, r = f(e);
	if (r.length < 3) return [];
	let i = (e.totalBuy + e.totalSell) / r.length;
	if (i <= 0) return [];
	let a = [], o = r[0], s = r[r.length - 1];
	return o.sellVol >= n * i && a.push({
		type: "absorption",
		side: "buy",
		price: o.price,
		volume: o.sellVol
	}), s.buyVol >= n * i && a.push({
		type: "absorption",
		side: "sell",
		price: s.price,
		volume: s.buyVol
	}), a;
}
function h(e, t = {}) {
	let n = t.frac ?? .2, r = f(e);
	if (r.length < 3) return [];
	let i = (e.totalBuy + e.totalSell) / r.length;
	if (i <= 0) return [];
	let a = [], o = r[0], s = r[r.length - 1];
	return e.delta > 0 && s.buyVol <= n * i && a.push({
		type: "exhaustion",
		side: "buy",
		price: s.price,
		volume: s.buyVol
	}), e.delta < 0 && o.sellVol <= n * i && a.push({
		type: "exhaustion",
		side: "sell",
		price: o.price,
		volume: o.sellVol
	}), a;
}
function g(e) {
	return [
		...p(e),
		...m(e),
		...h(e)
	];
}
function _(e, t = {}) {
	let n = t.lookback ?? 20, r = [];
	for (let t = 1; t < e.length; t++) {
		let i = e[t];
		if (i.trades === 0) continue;
		let a = Math.max(0, t - n), o = -Infinity, s = Infinity, c = -Infinity, l = Infinity;
		for (let n = a; n < t; n++) {
			let t = e[n];
			t.trades !== 0 && (t.high > o && (o = t.high, c = t.cvdClose), t.low < s && (s = t.low, l = t.cvdClose));
		}
		o !== -Infinity && i.high > o && i.cvdClose < c && r.push({
			type: "delta_divergence",
			side: "bearish",
			barIndex: t
		}), s !== Infinity && i.low < s && i.cvdClose > l && r.push({
			type: "delta_divergence",
			side: "bullish",
			barIndex: t
		});
	}
	return r;
}
//#endregion
//#region src/core/risk/engine.ts
var v = .8, y = {
	maxOrderNotionalUsd: 500,
	maxPositionSize: .05,
	maxTotalNotionalUsd: 2e3,
	dailyLossLimitUsd: 200,
	maxConsecutiveFailures: 3,
	maxOrdersPerWindow: 10,
	orderWindowMs: 6e4,
	allowedSymbols: []
};
function b(e) {
	return new Date(e).toISOString().slice(0, 10);
}
function x(e) {
	return {
		dayKey: b(e),
		realizedPnlUsdToday: 0,
		consecutiveFailures: 0,
		disabled: !1,
		disabledReason: null,
		disabledAt: null,
		recentOrderTs: [],
		positions: []
	};
}
function S(e, t) {
	return e.ALLOW_MAINNET === "true" ? e.RISK_LIMITS_CONFIRMED === "true" ? t.allowedSymbols.length === 0 ? "allowedSymbols is empty" : t.maxOrderNotionalUsd > 0 ? t.dailyLossLimitUsd > 0 ? null : "dailyLossLimitUsd must be > 0" : "maxOrderNotionalUsd must be > 0" : "RISK_LIMITS_CONFIRMED is not \"true\"" : "ALLOW_MAINNET is not \"true\"";
}
function C(e) {
	return typeof e == "number" && Number.isFinite(e) && e > 0;
}
function w(e, t) {
	return e.find((e) => e.symbol === t);
}
function T(e, t) {
	let n = 0;
	for (let r of e) {
		let e = t[r.symbol] ?? r.avgEntryPrice;
		n += Math.abs(r.qty) * e;
	}
	return n;
}
function E(e, t) {
	let n = b(t);
	return n === e.dayKey ? e : {
		...e,
		dayKey: n,
		realizedPnlUsdToday: 0
	};
}
function D(e) {
	let { intent: t, limits: n, env: r } = e, i = E(e.state, t.ts), a = {
		...e.markPrices ?? {},
		[t.symbol]: t.price
	}, o = [], s = (e) => ({
		ok: !1,
		rejection: e,
		warnings: o
	});
	if (i.disabled) return s({
		code: "DISABLED",
		message: `Trading disabled: ${i.disabledReason ?? "unknown reason"}`
	});
	if (t.mode === "mainnet") {
		let e = S(r, n);
		if (e) return s({
			code: "MAINNET_NOT_ALLOWED",
			message: `Mainnet blocked: ${e}`
		});
	}
	if (!n.allowedSymbols.includes(t.symbol)) return s({
		code: "SYMBOL_NOT_ALLOWED",
		message: `Symbol ${t.symbol} is not in allowlist`
	});
	if (!C(t.qty)) return s({
		code: "INVALID_QTY",
		message: "qty must be a finite number > 0",
		actual: t.qty
	});
	if (!C(t.price)) return s({
		code: "INVALID_PRICE",
		message: "price must be a finite number > 0",
		actual: t.price
	});
	let c = t.qty * t.price;
	if (c > n.maxOrderNotionalUsd) return s({
		code: "ORDER_NOTIONAL",
		message: `Order notional $${c.toFixed(2)} exceeds max $${n.maxOrderNotionalUsd}`,
		limit: n.maxOrderNotionalUsd,
		actual: c
	});
	let l = w(i.positions, t.symbol), u = t.side === "buy" ? t.qty : -t.qty, d = (l?.qty ?? 0) + u, f = Math.abs(d), p = l !== void 0 && Math.abs(l.qty) > f;
	if (!p && f > n.maxPositionSize) return s({
		code: "POSITION_SIZE",
		message: `Projected position ${f} exceeds max ${n.maxPositionSize}`,
		limit: n.maxPositionSize,
		actual: f
	});
	O(o, "NEAR_POSITION_SIZE", f / n.maxPositionSize, "position size");
	let m = T(i.positions.filter((e) => e.symbol !== t.symbol).concat(d === 0 ? [] : [{
		symbol: t.symbol,
		qty: d,
		avgEntryPrice: t.price
	}]), a), h = T(i.positions, a);
	if (!p && m > n.maxTotalNotionalUsd && m > h) return s({
		code: "TOTAL_NOTIONAL",
		message: `Projected total notional $${m.toFixed(2)} exceeds max $${n.maxTotalNotionalUsd}`,
		limit: n.maxTotalNotionalUsd,
		actual: m
	});
	O(o, "NEAR_TOTAL_NOTIONAL", m / n.maxTotalNotionalUsd, "total notional");
	let g = -i.realizedPnlUsdToday;
	if (!p && g >= n.dailyLossLimitUsd) return s({
		code: "DAILY_LOSS",
		message: `Daily loss $${g.toFixed(2)} reached limit $${n.dailyLossLimitUsd}`,
		limit: n.dailyLossLimitUsd,
		actual: g
	});
	g > 0 && O(o, "NEAR_DAILY_LOSS", g / n.dailyLossLimitUsd, "daily loss");
	let _ = t.ts - n.orderWindowMs, v = i.recentOrderTs.filter((e) => e > _).length;
	return v >= n.maxOrdersPerWindow ? s({
		code: "RATE_LIMIT",
		message: `${v} orders in last ${n.orderWindowMs / 1e3}s (max ${n.maxOrdersPerWindow})`,
		limit: n.maxOrdersPerWindow,
		actual: v
	}) : {
		ok: !0,
		warnings: o
	};
}
function O(e, t, n, r) {
	Number.isFinite(n) && n >= v && n <= 1 && e.push({
		code: t,
		utilization: n,
		message: `${Math.round(n * 100)}% of ${r} limit used`
	});
}
//#endregion
//#region src/client/orderflow-entry.ts
typeof window < "u" && (window.OrderflowCore = {
	OrderflowAggregator: e,
	DedupRing: i,
	detectImbalances: p,
	detectAbsorption: m,
	detectExhaustion: h,
	detectAll: g,
	binanceFutures: s
});
//#endregion
export { d as ADAPTERS, y as DEFAULT_LIMITS, i as DedupRing, e as OrderflowAggregator, s as binanceFutures, c as bybitLinear, m as detectAbsorption, g as detectAll, _ as detectDeltaDivergence, h as detectExhaustion, p as detectImbalances, D as evaluate, x as initialRiskState, u as okxSwap };
