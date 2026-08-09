import { useEffect, useMemo, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

const icons = {
  shield: "◈",
  dashboard: "▦",
  disputes: "◌",
  orders: "□",
  settings: "⚙",
  arrow: "→",
  check: "✓",
  warning: "!",
  copy: "⎘",
  bolt: "↯",
  close: "×",
  lock: "⌁",
  refresh: "↻",
};

async function api(path, { token, ...options } = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Something went wrong");
  return body;
}

function App() {
  const [session, setSession] = useState(() =>
    JSON.parse(localStorage.getItem("disputeShieldSession") || "null"),
  );
  const [page, setPage] = useState("overview");
  const [disputes, setDisputes] = useState([]);
  const [selected, setSelected] = useState(null);
  const [noticeState, setNoticeState] = useState(null);
  function setNotice(message, type = "error") {
    setNoticeState(message ? { message, type } : null);
  }
  const notice = noticeState;
  const [loading, setLoading] = useState(false);

  const token = session?.accessToken;
  const stats = useMemo(
    () => ({
      atRisk: disputes
        .filter((item) =>
          ["needs_response", "draft_ready"].includes(item.status),
        )
        .reduce((sum, item) => sum + item.amountCents, 0),
      needsAction: disputes.filter((item) =>
        ["needs_response", "draft_ready"].includes(item.status),
      ).length,
      review: disputes.filter((item) => item.status === "under_review").length,
    }),
    [disputes],
  );

  useEffect(() => {
    if (token) loadDisputes();
  }, [token]);

  async function loadDisputes() {
    setLoading(true);
    try {
      const data = await api("/disputes", { token });
      setDisputes(data);
      if (selected)
        setSelected(data.find((item) => item._id === selected._id) || null);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setLoading(false);
    }
  }

  function completeAuth(data) {
    const nextSession = {
      accessToken: data.accessToken,
      merchant: data.merchant,
    };
    localStorage.setItem("disputeShieldSession", JSON.stringify(nextSession));
    setSession(nextSession);
  }

  function signOut() {
    localStorage.removeItem("disputeShieldSession");
    setSession(null);
    setDisputes([]);
    setSelected(null);
    setPage("overview");
  }

  if (!session) return <AuthScreen onComplete={completeAuth} />;

  return (
    <div className="min-h-screen bg-ink font-body text-paper">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-paper/10 bg-surface lg:block">
        <Brand />
        <nav className="px-3 pt-7">
          <NavItem
            active={page === "overview"}
            icon={icons.dashboard}
            label="Overview"
            onClick={() => setPage("overview")}
          />
          <NavItem
            active={page === "disputes"}
            icon={icons.disputes}
            label="Disputes"
            count={stats.needsAction || undefined}
            onClick={() => setPage("disputes")}
          />
          <NavItem
            active={page === "orders"}
            icon={icons.orders}
            label="Orders"
            onClick={() => setPage("orders")}
          />
          <div className="my-6 border-t border-paper/10" />
          <NavItem
            active={page === "settings"}
            icon={icons.settings}
            label="Settings"
            onClick={() => setPage("settings")}
          />
        </nav>
        <div className="absolute inset-x-3 bottom-4 rounded-lg border border-forest/30 bg-surface-2 p-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-paper/70">
            <span className="text-forest">●</span> Your data is protected
          </div>
          <p className="text-xs leading-5 text-paper/40">
            Evidence stays in your control until you submit it.
          </p>
        </div>
      </aside>

      <main className="min-h-screen pb-20 lg:pb-0 lg:pl-64">
        <header className="flex h-20 items-center justify-between border-b border-paper/10 bg-surface px-5 sm:px-8">
          <div className="lg:hidden">
            <Brand compact />
          </div>
          <div className="hidden font-mono text-xs uppercase tracking-widest text-paper/40 lg:block">
            {page === "overview"
              ? "Good to see you again"
              : page[0].toUpperCase() + page.slice(1)}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={loadDisputes}
              className="rounded-lg border border-paper/15 p-2 text-paper/60 transition hover:bg-surface-2"
              aria-label="Refresh"
            >
              {icons.refresh}
            </button>
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold text-paper">
                {session.merchant.businessName || "Your business"}
              </p>
              <p className="text-xs text-paper/40">{session.merchant.email}</p>
            </div>
            <button
              onClick={signOut}
              className="grid h-9 w-9 place-items-center rounded-full border-2 border-brass/50 bg-surface-2 font-display text-sm font-bold text-brass"
            >
              {session.merchant.email[0].toUpperCase()}
            </button>
          </div>
        </header>

        <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
          {notice && (
            <Notice
              message={notice.message}
              type={notice.type}
              onClose={() => setNotice(null)}
            />
          )}
          {page === "overview" && (
            <Overview
              stats={stats}
              disputes={disputes}
              onView={(item) => {
                setSelected(item);
                setPage("disputes");
              }}
            />
          )}
          {page === "disputes" && (
            <Disputes
              token={token}
              disputes={disputes}
              selected={selected}
              setSelected={setSelected}
              refresh={loadDisputes}
              setNotice={setNotice}
            />
          )}
          {page === "orders" && <Orders token={token} setNotice={setNotice} />}
          {page === "settings" && (
            <Settings
              token={token}
              merchant={session.merchant}
              setNotice={setNotice}
            />
          )}
          {loading && (
            <div className="fixed bottom-5 right-5 rounded-lg border border-paper/15 bg-surface px-4 py-3 font-mono text-xs uppercase tracking-wider text-paper/70 shadow-xl">
              Refreshing your workspace…
            </div>
          )}
        </div>
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-20 flex justify-around border-t border-paper/10 bg-surface/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur lg:hidden">
        <MobileNav
          icon={icons.dashboard}
          label="Home"
          active={page === "overview"}
          onClick={() => setPage("overview")}
        />
        <MobileNav
          icon={icons.disputes}
          label="Disputes"
          active={page === "disputes"}
          onClick={() => setPage("disputes")}
        />
        <MobileNav
          icon={icons.orders}
          label="Orders"
          active={page === "orders"}
          onClick={() => setPage("orders")}
        />
        <MobileNav
          icon={icons.settings}
          label="Settings"
          active={page === "settings"}
          onClick={() => setPage("settings")}
        />
      </nav>
    </div>
  );
}

function Brand({ compact = false }) {
  return (
    <div className={compact ? "" : "px-6"}>
      <div className="flex flex-col items-center gap-3">
        <img
          src="/images/dispute-shield-logo.svg"
          className="h-60 w-60 drop-shadow-lg"
          alt="DisputeShield"
        />
        {/* {!compact && (
          <span className="font-display text-sm font-semibold tracking-tight text-paper">
            DisputeShield
          </span>
        )} */}
      </div>
    </div>
  );
}
function NavItem({ icon, label, active, count, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`mb-1 flex w-full items-center gap-3 rounded-lg border-l-2 px-3 py-2.5 text-sm font-medium transition ${active ? "border-brass bg-surface-2 text-paper" : "border-transparent text-paper/50 hover:bg-surface-2 hover:text-paper/80"}`}
    >
      <span className="w-5 text-center text-base">{icon}</span>
      {label}
      {count && (
        <span className="ml-auto rounded border border-seal/50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-seal">
          {count}
        </span>
      )}
    </button>
  );
}
function MobileNav({ icon, label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`flex min-w-14 flex-col items-center gap-1 rounded-lg px-3 py-1 text-xs font-medium ${active ? "text-brass" : "text-paper/50"}`}
    >
      <span className="text-base">{icon}</span>
      {label}
    </button>
  );
}
function Notice({ message, type = "error", onClose }) {
  const styles =
    type === "success"
      ? "border-forest/40 bg-forest/10 text-forest"
      : "border-seal/40 bg-seal/10 text-seal";
  return (
    <div
      className={`mb-6 flex items-center justify-between rounded-lg border px-4 py-3 text-sm ${styles}`}
    >
      <span className="flex items-center gap-2">
        <b className="font-mono">{type === "success" ? icons.check : icons.warning}</b>
        {message}
      </span>
      <button onClick={onClose} className="opacity-70 hover:opacity-100">
        {icons.close}
      </button>
    </div>
  );
}

function Overview({ stats, disputes, onView }) {
  return (
    <>
      <section className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 font-mono text-xs font-semibold uppercase tracking-[0.2em] text-brass">
            DISPUTE CONTROL CENTER
          </p>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-paper">
            Keep every response on track.
          </h1>
          <p className="mt-2 text-paper/50">
            Your chargeback queue, evidence, and deadlines in one place.
          </p>
        </div>
        <div className="rounded-lg border border-forest/30 bg-forest/10 px-4 py-3 text-sm font-medium text-forest">
          <span className="mr-2">●</span> All systems operational
        </div>
      </section>
      <div className="grid gap-4 md:grid-cols-3">
        <Metric
          label="Amount at risk"
          value={money(stats.atRisk)}
          detail="Across open disputes"
          tone="brass"
        />
        <Metric
          label="Needs your attention"
          value={stats.needsAction}
          detail="Drafts and new disputes"
          tone="seal"
        />
        <Metric
          label="Under bank review"
          value={stats.review}
          detail="Awaiting a decision"
          tone="steel"
        />
      </div>
      <section className="mt-8 overflow-hidden rounded-lg border border-paper/10 bg-surface">
        <div className="flex items-center justify-between border-b border-paper/10 px-6 py-5">
          <div>
            <h2 className="font-display font-semibold text-paper">
              Priority response queue
            </h2>
            <p className="mt-1 text-sm text-paper/50">
              Respond before the deadline to protect your revenue.
            </p>
          </div>
          <span className="font-mono text-sm font-medium text-brass">
            {disputes.length} total
          </span>
        </div>
        {disputes.length ? (
          <div>
            {disputes.slice(0, 5).map((item) => (
              <DisputeRow key={item._id} item={item} onClick={() => onView(item)} />
            ))}
          </div>
        ) : (
          <Empty
            title="No disputes yet"
            text="When Stripe sends a dispute, it will appear here with its response deadline."
          />
        )}
      </section>
    </>
  );
}
function Metric({ label, value, detail, tone }) {
  const colors = {
    brass: "bg-brass/10 text-brass",
    seal: "bg-seal/10 text-seal",
    steel: "bg-paper/10 text-paper/60",
  };
  const icon = { brass: icons.shield, seal: icons.warning, steel: icons.check }[tone];
  return (
    <div className="rounded-lg border border-paper/10 bg-surface p-5">
      <div className="mb-5 flex items-center justify-between">
        <p className="text-sm font-medium text-paper/50">{label}</p>
        <span className={`grid h-9 w-9 place-items-center rounded-lg ${colors[tone]}`}>
          {icon}
        </span>
      </div>
      <p className="font-mono text-3xl font-semibold tracking-tight text-paper">{value}</p>
      <p className="mt-2 text-sm text-paper/50">{detail}</p>
    </div>
  );
}

function Disputes({ token, disputes, selected, setSelected, refresh, setNotice }) {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <section>
        <div className="mb-6">
          <p className="mb-2 font-mono text-xs font-semibold uppercase tracking-[0.2em] text-brass">
            DISPUTE QUEUE
          </p>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-paper">
            Protect every transaction.
          </h1>
          <p className="mt-2 text-paper/50">
            Review the evidence before sending it to the bank.
          </p>
        </div>
        <div className="overflow-hidden rounded-lg border border-paper/10 bg-surface">
          {disputes.length ? (
            disputes.map((item) => (
              <DisputeRow
                key={item._id}
                item={item}
                selected={selected?._id === item._id}
                onClick={() => setSelected(item)}
              />
            ))
          ) : (
            <Empty
              title="Your queue is clear"
              text="Disputes from Stripe will appear here automatically."
            />
          )}
        </div>
      </section>
      <EvidencePanel token={token} dispute={selected} refresh={refresh} setNotice={setNotice} />
    </div>
  );
}
function DisputeRow({ item, onClick, selected }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-4 border-b border-paper/10 px-5 py-4 text-left transition last:border-0 ${selected ? "bg-surface-2" : "hover:bg-surface-2/60"}`}
    >
      <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${statusColor(item.status)}`}>
        {statusIcon(item.status)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-medium text-paper">{reasonLabel(item.reason)}</p>
          <span className="hidden font-mono text-xs text-paper/30 sm:inline">
            #{item.stripeDisputeId}
          </span>
        </div>
        <p className="mt-1 text-sm text-paper/40">
          {item.order?.orderNumber ? `Order ${item.order.orderNumber}` : "Order matching in progress"}{" "}
          · Due {date(item.respondBy)}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1.5">
        <p className="font-mono font-semibold text-paper">{money(item.amountCents, item.currency)}</p>
        <Stamp status={item.status} />
      </div>
    </button>
  );
}
function EvidencePanel({ token, dispute, refresh, setNotice }) {
  const [evidence, setEvidence] = useState(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setEvidence(null);
    setDraft("");
    if (dispute)
      api(`/disputes/${dispute._id}/evidence`, { token })
        .then((data) => {
          setEvidence(data);
          setDraft(data.editedNarrative || data.narrative);
        })
        .catch(() => {});
  }, [dispute?._id]);
  if (!dispute)
    return (
      <aside className="rounded-lg border border-dashed border-paper/20 bg-surface p-8 text-center text-sm text-paper/40">
        <div className="mb-3 text-2xl text-brass">{icons.shield}</div>
        Select a dispute to review its evidence.
      </aside>
    );
  async function generate() {
    setBusy(true);
    try {
      const data = await api(`/disputes/${dispute._id}/generate-evidence`, {
        token,
        method: "POST",
      });
      setEvidence(data);
      setDraft(data.narrative);
      await refresh();
    } catch (error) {
      setNotice(error.message, "error");
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    try {
      const data = await api(`/disputes/${dispute._id}/evidence`, {
        token,
        method: "PUT",
        body: JSON.stringify({ editedNarrative: draft }),
      });
      setEvidence(data);
      setNotice("Evidence saved and ready for submission.", "success");
    } catch (error) {
      setNotice(error.message, "error");
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    if (!confirm("Submit this evidence to Stripe for bank review?")) return;
    setBusy(true);
    try {
      await api(`/disputes/${dispute._id}/submit`, { token, method: "POST" });
      setNotice("Evidence submitted to Stripe.", "success");
      setEvidence(null);
      setDraft("");
      await refresh();
    } catch (error) {
      setNotice(error.message, "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <aside className="h-fit overflow-hidden rounded-lg border border-paper/10 bg-surface">
      <div className="border-b border-paper/10 p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-brass">
              EVIDENCE PACKET
            </p>
            <h2 className="mt-1 font-display font-semibold text-paper">{reasonLabel(dispute.reason)}</h2>
          </div>
          <Stamp status={dispute.status} />
        </div>
        <p className="mt-3 text-sm text-paper/50">
          Response due <b className="font-mono text-paper/80">{date(dispute.respondBy)}</b>
        </p>
      </div>
      <div className="p-5">
        {!evidence ? (
          <div className="rounded-lg border border-dashed border-paper/15 p-5 text-center">
            <p className="font-medium text-paper">Create your evidence packet</p>
            <p className="mt-2 text-sm leading-5 text-paper/50">
              We’ll draft a response using the matched order and fulfillment details.
            </p>
            <button
              disabled={busy}
              onClick={generate}
              className="mt-4 w-full rounded-lg bg-brass px-4 py-2.5 text-sm font-semibold text-ink hover:bg-brass/90 disabled:opacity-50"
            >
              {busy ? "Creating draft…" : "Generate evidence draft"} {icons.bolt}
            </button>
          </div>
        ) : (
          <>
            <label className="mb-2 block font-mono text-xs font-semibold uppercase tracking-[0.2em] text-paper/40">
              MERCHANT-APPROVED RESPONSE
            </label>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="h-56 w-full resize-none rounded-lg border border-paper/15 bg-paper p-3 font-body text-sm leading-6 text-ink outline-none ring-brass focus:ring-2"
            />
            <p className="mt-2 text-xs text-paper/30">
              Review for accuracy. This text is sent to Stripe when submitted.
            </p>
            <button
              disabled={busy || !draft.trim()}
              onClick={save}
              className="mt-4 w-full rounded-lg border border-paper/15 px-4 py-2.5 text-sm font-semibold text-paper/80 hover:bg-surface-2 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save approved response"}
            </button>
            <button
              disabled={busy || !evidence.editedNarrative}
              onClick={submit}
              className="mt-2 w-full rounded-lg bg-seal px-4 py-2.5 text-sm font-semibold text-paper hover:bg-seal/90 disabled:opacity-50"
            >
              Submit to Stripe {icons.arrow}
            </button>
          </>
        )}
      </div>
    </aside>
  );
}

function Orders({ token, setNotice }) {
  const [busy, setBusy] = useState(false);
  const [days, setDays] = useState(60);
  async function sync() {
    setBusy(true);
    try {
      const data = await api("/orders/sync", {
        token,
        method: "POST",
        body: JSON.stringify({ days: Number(days) }),
      });
      setNotice(
        `${data.imported} order${data.imported === 1 ? "" : "s"} synchronized from Shopify.`,
        "success",
      );
    } catch (error) {
      setNotice(error.message, "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="max-w-2xl">
      <p className="mb-2 font-mono text-xs font-semibold uppercase tracking-[0.2em] text-brass">
        SHOPIFY DATA
      </p>
      <h1 className="font-display text-3xl font-semibold tracking-tight text-paper">
        Keep order evidence current.
      </h1>
      <div className="mt-8 rounded-lg border border-paper/10 bg-surface p-6">
        <h2 className="font-semibold text-paper">Synchronize Shopify orders</h2>
        <p className="mt-2 text-sm leading-6 text-paper/50">
          Import orders, tracking details, fulfillment history, and notes so new disputes can be
          matched automatically.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <input
            value={days}
            onChange={(event) => setDays(event.target.value)}
            type="number"
            min="1"
            max="365"
            className="rounded-lg border border-paper/15 bg-ink px-3 py-2.5 font-mono text-paper outline-none ring-brass focus:ring-2"
          />
          <button
            disabled={busy}
            onClick={sync}
            className="rounded-lg bg-brass px-5 py-2.5 text-sm font-semibold text-ink hover:bg-brass/90 disabled:opacity-50"
          >
            {busy ? "Synchronizing…" : "Sync orders now"} {icons.refresh}
          </button>
        </div>
        <p className="mt-3 text-xs text-paper/30">
          Choose 1–365 days. Shopify permissions may limit historical data.
        </p>
      </div>
    </div>
  );
}
function Settings({ token, merchant, setNotice }) {
  const [shop, setShop] = useState("");
  async function connect(path, alreadyConnected, label) {
    if (alreadyConnected) {
      setNotice(`${label} is already connected.`, "success");
      return;
    }
    try {
      const { authorizationUrl } = await api(path, { token });
      window.location.assign(authorizationUrl);
    } catch (error) {
      setNotice(error.message);
    }
  }
  return (
    <div className="max-w-2xl">
      <p className="mb-2 font-mono text-xs font-semibold uppercase tracking-[0.2em] text-brass">
        CONNECTIONS
      </p>
      <h1 className="font-display text-3xl font-semibold tracking-tight text-paper">
        Your connected services.
      </h1>
      <div className="mt-8 grid gap-4">
        <Connection
          name="Stripe"
          detail="Connect your Stripe account to receive disputes and submit evidence."
          action="Connect Stripe"
          onClick={() =>
            connect("/auth/stripe/connect?format=json", merchant.stripeConnected, "Stripe")
          }
          connected={merchant.stripeConnected}
        />
        <Connection
          name="Shopify"
          detail="Connect your store to match orders, fulfillment, and tracking details."
          action="Connect Shopify"
          input={{ value: shop, onChange: (event) => setShop(event.target.value) }}
          onClick={() => {
            if (!shop) return setNotice("Enter your myshopify.com store domain first.");
            connect(
              `/auth/shopify/connect?format=json&shop=${encodeURIComponent(shop)}`,
              merchant.shopifyConnected,
              "Shopify",
            );
          }}
          connected={merchant.shopifyConnected}
        />
      </div>
      <p className="mt-6 text-sm text-paper/40">
        Signed in as <b className="text-paper/70">{merchant.email}</b>
      </p>
    </div>
  );
}
function Connection({ name, detail, action, onClick, input, connected }) {
  return (
    <div className="rounded-lg border border-paper/10 bg-surface p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="mb-3 grid h-10 w-10 place-items-center rounded-lg border border-brass/40 font-display text-brass">
            {name[0]}
          </div>
          <h2 className="font-semibold text-paper">{name}</h2>
          <p className="mt-1 max-w-md text-sm leading-6 text-paper/50">{detail}</p>
        </div>
        <span
          className={`rounded border px-2.5 py-1 font-mono text-xs font-medium uppercase tracking-wider ${connected ? "border-forest/40 bg-forest/10 text-forest" : "border-paper/15 text-paper/40"}`}
        >
          {connected ? "Connected" : "Not connected"}
        </span>
      </div>
      {input && (
        <input
          placeholder="your-store.myshopify.com"
          value={input.value}
          onChange={input.onChange}
          className="mt-5 w-full rounded-lg border border-paper/15 bg-ink px-3 py-2.5 text-sm text-paper outline-none ring-brass focus:ring-2"
        />
      )}
      <button
        onClick={onClick}
        className="mt-5 rounded-lg border border-paper/20 px-4 py-2.5 text-sm font-semibold text-paper/80 hover:bg-surface-2"
      >
        {action} {icons.arrow}
      </button>
    </div>
  );
}

function AuthScreen({ onComplete }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ email: "", password: "", businessName: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await api(`/auth/${mode}`, { method: "POST", body: JSON.stringify(form) });
      onComplete(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid min-h-screen bg-ink font-body lg:grid-cols-2">
      <section className="relative hidden overflow-hidden lg:flex">
        <img
          src="/images/merchant-shipping.jpg"
          className="absolute inset-0 h-full w-full object-cover"
          alt="Small-business owner preparing shipments"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-ink/95 via-ink/85 to-ink/98" />
        <div className="relative z-10 flex w-full flex-col justify-between p-12 text-paper">
          <Brand compact />
          <div>
            <p className="font-mono text-sm font-semibold tracking-[0.25em] text-brass">
              DISPUTE RESPONSE, SIMPLIFIED
            </p>
            <h1 className="mt-5 max-w-lg font-display text-5xl font-semibold leading-tight tracking-tight">
              Defend your revenue with confidence.
            </h1>
            <p className="mt-6 max-w-md text-lg leading-8 text-paper/60">
              DisputeShield gathers the order proof, prepares the response, and keeps every
              deadline visible.
            </p>
            <div className="mt-10 flex items-center gap-3 text-sm text-paper/70">
              <span className="grid h-8 w-8 place-items-center rounded-full border border-forest/50 text-forest">
                {icons.check}
              </span>
              <span>Evidence stays under your review.</span>
            </div>
          </div>
          <p className="font-mono text-xs text-paper/30">© 2026 DisputeShield</p>
        </div>
      </section>
      <section className="flex items-center justify-center bg-paper p-6 sm:p-10">
        <form onSubmit={submit} className="w-full max-w-sm">
          <div className="mb-10 lg:hidden">
            <BrandDark compact />
          </div>
          <p className="font-mono text-sm font-semibold uppercase tracking-[0.2em] text-seal">
            WELCOME TO DISPUTESHIELD
          </p>
          <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink">
            {mode === "login" ? "Welcome back." : "Start protecting revenue."}
          </h2>
          <p className="mt-2 text-sm text-ink/60">
            {mode === "login"
              ? "Sign in to manage your dispute response queue."
              : "Create your secure merchant workspace."}
          </p>
          {error && (
            <div className="mt-5 rounded-lg border border-seal/30 bg-seal/10 p-3 text-sm text-seal">
              {error}
            </div>
          )}
          {mode === "register" && (
            <Field
              label="Business name"
              value={form.businessName}
              onChange={(value) => setForm({ ...form, businessName: value })}
              placeholder="Acme Co."
            />
          )}
          <Field
            label="Email address"
            type="email"
            value={form.email}
            onChange={(value) => setForm({ ...form, email: value })}
            placeholder="you@company.com"
          />
          <Field
            label="Password"
            type="password"
            value={form.password}
            onChange={(value) => setForm({ ...form, password: value })}
            placeholder={mode === "register" ? "At least 12 characters" : "Your password"}
          />
          <button
            disabled={busy}
            className="mt-6 w-full rounded-lg bg-ink px-4 py-3 text-sm font-semibold text-paper hover:bg-ink/90 disabled:opacity-50"
          >
            {busy ? "Please wait…" : mode === "login" ? "Sign in to dashboard" : "Create account"}{" "}
            {icons.arrow}
          </button>
          <p className="mt-6 text-center text-sm text-ink/50">
            {mode === "login" ? "New to DisputeShield?" : "Already have an account?"}{" "}
            <button
              type="button"
              onClick={() => {
                setMode(mode === "login" ? "register" : "login");
                setError("");
              }}
              className="font-semibold text-seal"
            >
              {mode === "login" ? "Create an account" : "Sign in"}
            </button>
          </p>
        </form>
      </section>
    </div>
  );
}
function BrandDark({ compact = false }) {
  return (
    <div className={compact ? "" : "px-6 pt-7"}>
      <div className="flex items-center gap-3">
        <img src="/images/disputeshield-mark.svg" className="h-9 w-9" alt="DisputeShield" />
        {!compact && (
          <span className="font-display text-lg font-semibold tracking-tight text-ink">
            DisputeShield
          </span>
        )}
      </div>
    </div>
  );
}
function Field({ label, type = "text", value, onChange, placeholder }) {
  return (
    <label className="mt-5 block text-sm font-medium text-ink/70">
      {label}
      <input
        required
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-2 w-full rounded-lg border border-ink/15 px-3 py-3 text-ink outline-none ring-seal placeholder:text-ink/30 focus:ring-2"
      />
    </label>
  );
}
function Empty({ title, text }) {
  return (
    <div className="p-10 text-center">
      <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-lg border border-brass/30 text-brass">
        {icons.shield}
      </div>
      <h3 className="font-semibold text-paper">{title}</h3>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-paper/40">{text}</p>
    </div>
  );
}
function Stamp({ status }) {
  const styles = {
    needs_response: "border-seal text-seal",
    draft_ready: "border-brass text-brass",
    under_review: "border-paper/40 text-paper/60",
    won: "border-forest text-forest",
    lost: "border-seal/60 text-seal/60",
  };
  return (
    <span
      className={`inline-block -rotate-2 rounded border-2 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-widest ${styles[status] || "border-paper/25 text-paper/40"}`}
    >
      {String(status || "unknown").replaceAll("_", " ")}
    </span>
  );
}
function statusColor(status) {
  return (
    {
      needs_response: "bg-seal/10 text-seal",
      draft_ready: "bg-brass/10 text-brass",
      under_review: "bg-paper/10 text-paper/60",
      won: "bg-forest/10 text-forest",
      lost: "bg-seal/10 text-seal/70",
    }[status] || "bg-paper/10 text-paper/40"
  );
}
function statusIcon(status) {
  return status === "won" ? icons.check : status === "needs_response" ? icons.warning : icons.shield;
}
function money(cents = 0, currency = "usd") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: String(currency).toUpperCase(),
  }).format(cents / 100);
}
function date(value) {
  return value
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(
        new Date(value),
      )
    : "—";
}
function reasonLabel(reason) {
  return String(reason || "General")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default App;
