//#endregion
//#region src/client/feed-entry.ts
typeof window < "u" && (window.HgfxFeed = { FeedManager: class {
	streams = /* @__PURE__ */ new Map();
	opts;
	nextSubId = 0;
	constructor(e = {}) {
		this.opts = {
			restBase: e.restBase ?? "https://fapi.binance.com",
			wsBase: e.wsBase ?? "wss://fstream.binance.com/stream?streams=",
			reconnectMs: e.reconnectMs ?? 2e3,
			createSocket: e.createSocket ?? ((e) => new WebSocket(e)),
			fetcher: e.fetcher ?? ((...e) => fetch(...e))
		};
	}
	subscribe(e, t) {
		let n = String(e || "").toUpperCase();
		if (!n) throw Error("FeedManager.subscribe: empty symbol");
		let r = this.streams.get(n);
		r || (r = {
			symbol: n,
			ws: null,
			reconnectTimer: null,
			lastTradeId: null,
			lastTradeTs: 0,
			subscribers: /* @__PURE__ */ new Map(),
			closed: !1,
			firstMsg: !1
		}, this.streams.set(n, r), this.open(r));
		let i = "sub_" + ++this.nextSubId;
		return r.subscribers.set(i, t), () => this.unsubscribe(n, i);
	}
	unsubscribe(e, t) {
		let n = this.streams.get(e);
		n && (n.subscribers.delete(t), n.subscribers.size === 0 && (this.closeStream(n), this.streams.delete(e)));
	}
	shutdown() {
		for (let e of this.streams.values()) this.closeStream(e);
		this.streams.clear();
	}
	hasStream(e) {
		return this.streams.has(String(e || "").toUpperCase());
	}
	subscriberCount(e) {
		return this.streams.get(String(e || "").toUpperCase())?.subscribers.size ?? 0;
	}
	open(e) {
		if (e.closed) return;
		if (e.ws) try {
			e.ws.onclose = null, e.ws.close();
		} catch {}
		let t = this.opts.wsBase + e.symbol.toLowerCase() + "@aggTrade", n;
		try {
			n = this.opts.createSocket(t);
		} catch {
			this.scheduleReconnect(e);
			return;
		}
		e.ws = n, e.firstMsg = !1, n.onmessage = (t) => this.onMessage(e, t), n.onclose = () => {
			e.closed || (e.ws = null, this.scheduleReconnect(e));
		}, n.onerror = () => {
			try {
				n.close();
			} catch {}
		};
	}
	onMessage(e, t) {
		let n;
		try {
			let e = typeof t.data == "string" ? t.data : "";
			n = JSON.parse(e);
		} catch {
			return;
		}
		let r = n && typeof n == "object" && "data" in n ? n.data : n;
		if (!r || r.e !== "aggTrade") return;
		e.firstMsg ||= !0;
		let i = r;
		if (e.lastTradeId !== null && i.a === e.lastTradeId) return;
		let a = {
			tradeId: i.a,
			symbol: i.s,
			price: +i.p,
			qty: +i.q,
			aggressor: i.m ? "sell" : "buy",
			ts: i.T,
			venue: "binance-futures"
		};
		e.lastTradeId = i.a, e.lastTradeTs = i.T;
		for (let t of e.subscribers.values()) try {
			t(a);
		} catch {}
	}
	scheduleReconnect(e) {
		e.closed || (e.reconnectTimer ||= setTimeout(() => {
			e.reconnectTimer = null, this.open(e);
		}, this.opts.reconnectMs));
	}
	closeStream(e) {
		if (e.closed = !0, e.reconnectTimer &&= (clearTimeout(e.reconnectTimer), null), e.ws) {
			try {
				e.ws.onclose = null, e.ws.onmessage = null, e.ws.onerror = null, e.ws.close();
			} catch {}
			e.ws = null;
		}
	}
} });
var e = {};
//#endregion
export { e as default };
