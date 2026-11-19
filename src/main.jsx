import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { UserManager, WebStorageStateStore } from "oidc-client-ts";
import {
  ArrowUpRight,
  ArrowRight,
  Plus,
  Search,
  LayoutDashboard,
  BriefcaseBusiness,
  FileText,
  ShieldCheck,
  LogOut,
  ChevronRight,
  X,
  Download,
  Trash2,
  Sparkles,
  Check,
  Clock3,
  Building2,
  ExternalLink,
  LoaderCircle,
  Leaf,
} from "lucide-react";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/dm-sans/latin-700.css";
import "@fontsource/manrope/latin-600.css";
import "@fontsource/manrope/latin-700.css";
import "@fontsource/manrope/latin-800.css";
import "./styles.css";
let config = {},
  manager;
const stages = [
  "Saved",
  "Applied",
  "Interview",
  "Offer",
  "Rejected",
  "Withdrawn",
];
const initial = {
  company: "",
  role: "",
  location: "",
  url: "",
  description: "",
  notes: "",
  status: "Saved",
};
async function request(path, options = {}) {
  const user = manager ? await manager.getUser() : null;
  if (manager && (!user || user.expired))
    throw new Error("Your session has expired. Sign in again to continue.");
  const res = await fetch((config.apiUrl || "") + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(user ? { Authorization: `Bearer ${user.access_token}` } : {}),
    },
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({ error: "Request failed." }));
    throw new Error(e.error || "Request failed.");
  }
  return res.status === 204 ? null : res.json();
}
function download(name, text, type = "text/plain") {
  downloadBlob(name, new Blob([text], { type }));
}
function downloadBlob(name, blob) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
function safeFileName(value) {
  return (
    value
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
      .trim()
      .slice(0, 80) || "application"
  );
}
function useDialogFocusTrap(enabled, setModal, setSelected) {
  useEffect(() => {
    if (!enabled) return;
    const previous = document.activeElement;
    const dialogs = document.querySelectorAll("dialog[open]");
    const active = dialogs[dialogs.length - 1];
    if (!active) return;
    const nodes = () =>
      Array.from(
        active.querySelectorAll(
          'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
        ),
      ).filter((el) => el.offsetParent !== null);
    nodes()[0]?.focus();
    const keys = (e) => {
      if (e.key === "Escape") {
        setModal(false);
        setSelected(null);
      }
      if (e.key === "Tab") {
        const list = nodes(),
          first = list[0],
          last = list.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", keys);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", keys);
      previous?.focus();
    };
  }, [enabled, setModal, setSelected]);
}
function getWorkspaceLabel(local, demo) {
  if (!local) return "Private workspace";
  if (demo) return "Local demo · template preview";
  return "Local workspace · Bedrock";
}
function getPageHeading(tab) {
  const headings = {
    Overview: "Your next chapter, organised.",
    Documents: "Your story, thoughtfully told.",
  };
  return headings[tab] || "Good things are in progress.";
}
function getPageDescription(tab) {
  if (tab === "Documents")
    return "Every tailored CV and cover letter, saved with its opportunity.";
  return "A little structure for the big things ahead. You’ve got this.";
}
function getTailorButtonLabel(busy, demo) {
  if (busy) return "Preparing your documents…";
  if (demo) return "Create demo preview";
  return "Tailor to this role";
}
const samples = [
  {
    company: "Linear",
    role: "Senior Product Designer",
    location: "Remote · Europe",
    status: "Interview",
    description:
      "We are looking for a senior product designer with experience in user research, interaction design, prototyping and design systems. You will partner with engineers and product managers to build thoughtful software.",
  },
  {
    company: "Notion",
    role: "Product Designer",
    location: "London, UK · Hybrid",
    status: "Applied",
    description:
      "Design intuitive collaboration experiences. Work across research, visual design and prototypes, partnering with product teams to understand customer needs and create accessible interfaces.",
  },
  {
    company: "Spotify",
    role: "UX Designer",
    location: "London, UK",
    status: "Saved",
    description:
      "Join our design team to develop user-centred experiences for listeners. Bring interaction design, research, collaboration and prototyping skills to a multidisciplinary team.",
  },
  {
    company: "Monzo",
    role: "Senior UX Designer",
    location: "Remote · UK",
    status: "Applied",
    description:
      "Help make money work for everyone through clear and accessible product design. Collaborate with researchers and engineers to create inclusive digital banking experiences.",
  },
];
function App() {
  const [ready, setReady] = useState(false),
    [signed, setSigned] = useState(false),
    [jobs, setJobs] = useState([]),
    [tab, setTab] = useState("Overview"),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("All applications"),
    [modal, setModal] = useState(false),
    [form, setForm] = useState(initial),
    [selected, setSelected] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [toast, setToast] = useState(""),
    [loading, setLoading] = useState(true);
  const notify = (t) => {
    setToast(t);
    setTimeout(() => setToast(""), 4000);
  };
  useDialogFocusTrap(modal || Boolean(selected), setModal, setSelected);
  const refresh = async () => {
    const data = await request("/api/jobs");
    setJobs(data.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  };
  useEffect(() => {
    void (async () => {
      try {
        config = await fetch("/config.json", { cache: "no-store" }).then(
          (r) => {
            if (!r.ok)
              throw new Error("Workspace configuration is unavailable.");
            return r.json();
          },
        );
        if (!config.local) {
          manager = new UserManager({
            authority: config.authority,
            client_id: config.clientId,
            redirect_uri: location.origin + "/",
            post_logout_redirect_uri: location.origin + "/",
            response_type: "code",
            scope: config.scope || "openid email profile",
            userStore: new WebStorageStateStore({
              store: window.sessionStorage,
            }),
            automaticSilentRenew: false,
          });
          manager.events.addAccessTokenExpired(() => {
            setSigned(false);
            setJobs([]);
            setSelected(null);
            setModal(false);
            setError("Your session has expired. Sign in again to continue.");
          });
          const params = new URLSearchParams(location.search);
          if (params.has("code") || params.has("error")) {
            try {
              await manager.signinRedirectCallback();
            } finally {
              history.replaceState({}, "", location.pathname);
            }
          }
          const user = await manager.getUser();
          setSigned(!!user && !user.expired);
          if (user && !user.expired) await refresh();
        } else {
          setSigned(true);
          await refresh();
        }
        setReady(true);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);
  const perform = async (fn) => {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const save = (e) => {
    e.preventDefault();
    void perform(async () => {
      const job = await request("/api/jobs", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setJobs((v) => [job, ...v]);
      setModal(false);
      setForm(initial);
      notify("Application added to your workspace");
    });
  };
  const update = (job) => {
    setJobs((v) => v.map((j) => (j.id === job.id ? job : j)));
    setSelected(job);
  };
  const loadSamples = () =>
    perform(async () => {
      await Promise.all(
        samples.map((sample) =>
          request("/api/jobs", {
            method: "POST",
            body: JSON.stringify({
              ...initial,
              ...sample,
              notes:
                "Example application for exploring Folio. Replace with your own details.",
            }),
          }),
        ),
      );
      await refresh();
      notify("Example applications added");
    });
  const visible = jobs.filter(
    (j) =>
      (filter === "All applications" || j.status === filter) &&
      `${j.company} ${j.role} ${j.location}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const stats = [
    {
      label: "Total applications",
      value: jobs.length,
      detail: "Every opportunity, organised",
      icon: BriefcaseBusiness,
    },
    {
      label: "In progress",
      value: jobs.filter((j) => ["Applied", "Interview"].includes(j.status))
        .length,
      detail: "Your next chapter is taking shape",
      icon: Clock3,
    },
    {
      label: "Interviews",
      value: jobs.filter((j) => j.status === "Interview").length,
      detail: "A chance to tell your story",
      icon: Building2,
    },
    {
      label: "Offers received",
      value: jobs.filter((j) => j.status === "Offer").length,
      detail: "Something worth celebrating",
      icon: Sparkles,
    },
  ];
  if (!ready || !signed)
    return (
      <main className="login">
        <div className="brand">
          <span className="brandmark">
            <Leaf size={24} />
          </span>{" "}
          folio<span className="brand-dot">.</span>
        </div>
        <p className="eyebrow">YOUR NEXT CHAPTER STARTS HERE</p>
        <h1>
          A little clarity.
          <br />A lot of possibility.
        </h1>
        <p>
          One private place for your applications, your story,
          <br />
          and the opportunities ahead.
        </p>
        {error && (
          <div role="alert" className="error">
            {error}
          </div>
        )}
        {loading ? (
          <LoaderCircle className="spin" />
        ) : (
          <button
            className="primary"
            disabled={!manager || busy}
            onClick={() => void perform(() => manager.signinRedirect())}
          >
            Sign in securely <ArrowRight size={17} />
          </button>
        )}
        <span className="secure">
          <ShieldCheck size={16} /> Private by design. Yours to control.
        </span>
      </main>
    );
  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href="/">
          <span className="brandmark">
            <Leaf size={24} />
          </span>{" "}
          folio<span className="brand-dot">.</span>
        </a>
        <div className="workspace-label">YOUR WORKSPACE</div>
        <nav>
          {[
            ["Overview", LayoutDashboard],
            ["Applications", BriefcaseBusiness],
            ["Documents", FileText],
          ].map(([name, Icon]) => (
            <button
              key={name}
              className={tab === name ? "nav active" : "nav"}
              onClick={() => setTab(name)}
            >
              <Icon size={19} />
              {name}
              {name === "Applications" && (
                <span className="nav-count">{jobs.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="note-icon">✧</span>
          <h3>A thoughtful next step.</h3>
          <p>
            You bring the experience.
            <br />
            We help you tell the story.
          </p>
          <button
            onClick={() => {
              setTab("Applications");
              setModal(true);
            }}
          >
            Find your next chapter <ArrowUpRight size={15} />
          </button>
        </div>
        <div className="sidebar-bottom">
          <span>
            <ShieldCheck size={17} /> Your data, your control
          </span>
          <button
            onClick={() =>
              void perform(async () =>
                download(
                  "folio-export.json",
                  JSON.stringify(await request("/api/export"), null, 2),
                  "application/json",
                ),
              )
            }
          >
            <Download size={16} />
            Export my data
          </button>
          <div className="profile">
            <div className="avatar">{config.local ? "D" : "Y"}</div>
            <div>
              <b>{config.local ? "Demo workspace" : "Your workspace"}</b>
              <small>
                {config.local ? "Local development" : "Private account"}
              </small>
            </div>
            {manager && (
              <button
                aria-label="Sign out"
                onClick={() =>
                  void perform(async () => {
                    if (config.provider === "azure") {
                      await manager.signoutRedirect();
                      return;
                    }
                    await manager.removeUser();
                    location.assign(
                      `${config.logoutUrl}?client_id=${encodeURIComponent(config.clientId)}&logout_uri=${encodeURIComponent(location.origin + "/")}`,
                    );
                  })
                }
              >
                <LogOut size={17} />
              </button>
            )}
          </div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div>
            Workspace <ChevronRight size={14} />
            <b>{tab}</b>
          </div>
          <span className="private">
            <span />
            {getWorkspaceLabel(config.local, config.demo)}
          </span>
        </header>
        <main className="content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">MAKE YOUR NEXT MOVE</div>
              <h1>{getPageHeading(tab)}</h1>
              <p>{getPageDescription(tab)}</p>
            </div>
            <button className="primary" onClick={() => setModal(true)}>
              <Plus size={18} /> Add application
            </button>
          </div>
          {error && (
            <div role="alert" className="error">
              {error}
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={15} />
              </button>
            </div>
          )}
          {tab === "Overview" && (
            <>
              <div className="stats">
                {stats.map(({ label, value, detail, icon: Icon }) => (
                  <section className="stat" key={label}>
                    <div className="stat-title">
                      {label}
                      <Icon size={18} />
                    </div>
                    <strong>{value.toString().padStart(2, "0")}</strong>
                    <small>{detail}</small>
                  </section>
                ))}
              </div>
              <section className="feature">
                <div className="feature-copy">
                  <span className="pill">
                    <Sparkles size={13} /> A LITTLE HELP, A STRONGER STORY
                  </span>
                  <h2>Same you. A more compelling introduction.</h2>
                  <p>
                    Turn your experience into a CV and cover letter that speak
                    <br className="desktop" /> to the role. Thoughtfully
                    tailored. Always true to you.
                  </p>
                  <button
                    onClick={() => {
                      if (jobs.length) setSelected(jobs[0]);
                      else setModal(true);
                    }}
                  >
                    Tailor your documents <ArrowRight size={16} />
                  </button>
                </div>
                <div className="feature-art" aria-hidden="true">
                  <div className="orbit" />
                  <div className="paper back">
                    <span />
                    <i />
                    <i />
                    <i />
                  </div>
                  <div className="paper front">
                    <div className="paper-person" />
                    <b>YOUR NEXT CHAPTER</b>
                    <i />
                    <i />
                    <i className="short" />
                    <hr />
                    <i />
                    <i />
                    <i className="short" />
                    <span className="paper-spark">✧</span>
                  </div>
                  <div className="art-label">
                    <Check size={14} /> A story only you can tell
                  </div>
                </div>
              </section>
            </>
          )}
          {tab === "Documents" ? (
            <section className="documents">
              {jobs.flatMap((j) =>
                j.versions.map((v, i) => (
                  <button
                    className="document-card"
                    key={v.id}
                    onClick={() => setSelected(j)}
                  >
                    <FileText />
                    <div>
                      <h3>
                        {j.company} · {j.role}
                      </h3>
                      <p>
                        Version {i + 1} ·{" "}
                        {new Date(v.createdAt).toLocaleDateString()} · CV &
                        cover letter
                      </p>
                    </div>
                    <ChevronRight />
                  </button>
                )),
              )}
              {!jobs.some((j) => j.versions.length) && (
                <div className="empty">
                  <FileText size={30} />
                  <h3>Your story starts here</h3>
                  <p>
                    Open an application and tailor your documents.
                    <br />
                    Each version will be saved here for you.
                  </p>
                  <button
                    className="secondary"
                    onClick={() => setTab("Applications")}
                  >
                    View applications <ArrowRight size={16} />
                  </button>
                </div>
              )}
            </section>
          ) : (
            <section className="applications">
              <div className="section-heading">
                <h2>
                  Your applications <span>{jobs.length}</span>
                </h2>
                <span className="muted">One step closer.</span>
              </div>
              <div className="table-tools">
                <div className="filters">
                  {[
                    "All applications",
                    "Saved",
                    "Applied",
                    "Interview",
                    "Offer",
                  ].map((f) => (
                    <button
                      className={filter === f ? "selected" : ""}
                      onClick={() => setFilter(f)}
                      key={f}
                    >
                      {f}
                    </button>
                  ))}
                  <select
                    aria-label="Filter all statuses"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    <option>All applications</option>
                    {stages.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <label className="search">
                  <Search size={16} />
                  <input
                    aria-label="Search applications"
                    placeholder="Search applications..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>COMPANY & ROLE</th>
                      <th>LOCATION</th>
                      <th>STATUS</th>
                      <th>LAST UPDATED</th>
                      <th aria-label="Open application" />
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((j) => (
                      <tr key={j.id} onClick={() => setSelected(j)}>
                        <td>
                          <div className="company">
                            <span
                              className={
                                "company-logo logo-" +
                                (j.company.codePointAt(0) % 4)
                              }
                            >
                              {j.company.slice(0, 1).toUpperCase()}
                            </span>
                            <div>
                              <button
                                className="row-title"
                                onClick={() => setSelected(j)}
                              >
                                {j.role}
                              </button>
                              <small>{j.company}</small>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className="location">
                            {j.location || "Not specified"}
                          </span>
                        </td>
                        <td>
                          <span
                            className={
                              "status status-" + j.status.toLowerCase()
                            }
                          >
                            <span />
                            {j.status}
                          </span>
                        </td>
                        <td className="date">
                          {new Date(j.updatedAt).toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                          })}
                        </td>
                        <td>
                          <ChevronRight size={16} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!visible.length && (
                <div className="empty">
                  <BriefcaseBusiness size={28} />
                  <h3>
                    {jobs.length
                      ? "No matches just yet"
                      : "Make room for your next opportunity"}
                  </h3>
                  <p>
                    {jobs.length
                      ? "Try a different search or status."
                      : "Add your first application to start keeping everything in one place."}
                  </p>
                  {!jobs.length && (
                    <div className="empty-actions">
                      <button
                        className="secondary"
                        onClick={() => setModal(true)}
                      >
                        <Plus size={16} /> Add your first application
                      </button>
                      {config.local && (
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => void loadSamples()}
                        >
                          Explore with example applications
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
              <div className="table-footer">
                <span>
                  {visible.length}{" "}
                  {visible.length === 1 ? "opportunity" : "opportunities"} in
                  view
                </span>
                <span>
                  Small steps. Real progress. <Leaf size={13} />
                </span>
              </div>
            </section>
          )}
          <footer className="page-footer">
            <ShieldCheck size={14} />
            {config.local
              ? "Local demo data stays on this machine. Use fictional information."
              : "Encrypted storage. Private records. You’re in control."}
            <span>Built for what’s next.</span>
          </footer>
        </main>
      </div>
      {toast && (
        <output className="toast">
          <Check size={17} />
          {toast}
        </output>
      )}
      {modal && (
        <div className="overlay">
          <dialog className="modal" aria-labelledby="new-title" open>
            <button
              className="close"
              aria-label="Close"
              onClick={() => setModal(false)}
            >
              <X />
            </button>
            <span className="eyebrow">A NEW POSSIBILITY</span>
            <h2 id="new-title">Add an application</h2>
            <p>Keep the details. Make your next move.</p>
            <form onSubmit={save}>
              <div className="form-row">
                <label>
                  <span>Company</span>
                  <input
                    autoFocus
                    required
                    maxLength={120}
                    value={form.company}
                    onChange={(e) =>
                      setForm({ ...form, company: e.target.value })
                    }
                  />
                </label>
                <label>
                  <span>Job title</span>
                  <input
                    required
                    maxLength={160}
                    value={form.role}
                    onChange={(e) => setForm({ ...form, role: e.target.value })}
                  />
                </label>
              </div>
              <div className="form-row">
                <label>
                  <span>Location</span>
                  <input
                    maxLength={160}
                    value={form.location}
                    onChange={(e) =>
                      setForm({ ...form, location: e.target.value })
                    }
                  />
                </label>
                <label>
                  <span>Status</span>
                  <select
                    value={form.status}
                    onChange={(e) =>
                      setForm({ ...form, status: e.target.value })
                    }
                  >
                    {stages.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                <span>Job link</span>
                <input
                  type="url"
                  placeholder="https://…"
                  value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                />
              </label>
              <label>
                <span>Job description</span>
                <textarea
                  rows={5}
                  maxLength={18000}
                  placeholder="Paste the job description to tailor your documents later…"
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                />
              </label>
              <label>
                <span>Private notes</span>
                <textarea
                  rows={2}
                  maxLength={6000}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </label>
              {error && (
                <p role="alert" className="error">
                  {error}
                </p>
              )}
              <button type="submit" className="primary full" disabled={busy}>
                {busy ? (
                  <LoaderCircle className="spin" size={17} />
                ) : (
                  <Plus size={17} />
                )}{" "}
                Save application
              </button>
            </form>
          </dialog>
        </div>
      )}
      {selected && (
        <Detail
          job={selected}
          onClose={() => setSelected(null)}
          onUpdate={update}
          onDelete={(id) => {
            setJobs((v) => v.filter((j) => j.id !== id));
            setSelected(null);
            notify("Application and documents deleted");
          }}
        />
      )}
    </div>
  );
}
function Detail({ job, onClose, onUpdate, onDelete }) {
  const [tab, setTab] = useState("Details"),
    [cv, setCv] = useState(""),
    [cover, setCover] = useState(""),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [version, setVersion] = useState(-1),
    [editing, setEditing] = useState({ ...job }),
    [confirm, setConfirm] = useState(false);
  const v = job.versions[version < 0 ? job.versions.length - 1 : version];
  const run = async (fn) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  function upload(file, target, maxLength) {
    if (!file) return;
    return run(async () => {
      if (file.size > 10 * 1024 * 1024)
        throw new Error("Choose a document smaller than 10 MB.");

      const extension = file.name.split(".").pop()?.toLowerCase();
      let text;
      if (extension === "txt" || extension === "md") {
        text = await file.text();
      } else if (extension === "docx") {
        const { extractDocxText } = await import("./docx-input.js");
        text = await extractDocxText(await file.arrayBuffer());
      } else if (extension === "pdf") {
        const { extractPdfText } = await import("./pdf-input.js");
        text = await extractPdfText(await file.arrayBuffer());
      } else {
        throw new Error("Choose a .txt, .md, .pdf, or .docx file.");
      }

      const extracted = text.trim();
      if (!extracted) {
        throw new Error(
          extension === "pdf"
            ? "No selectable text was found. Scanned PDFs require OCR, which is not supported."
            : "No text was found in this document.",
        );
      }
      if (extracted.length > maxLength)
        throw new Error(
          `This document contains more than ${maxLength.toLocaleString()} characters. Shorten it before uploading.`,
        );
      target(extracted);
    });
  }
  return (
    <div className="overlay drawer-overlay">
      <dialog className="drawer" open aria-labelledby="detail-title">
        <button
          className="close"
          aria-label="Close application"
          onClick={onClose}
        >
          <X />
        </button>
        <div className="eyebrow">YOUR OPPORTUNITY</div>
        <h2 id="detail-title">{job.role}</h2>
        <p className="job-company">
          {job.company}{" "}
          <span>· {job.location || "Location not specified"}</span>
        </p>
        <div className="detail-tabs">
          {["Details", "Tailor documents", "Versions"].map((t) => (
            <button
              className={tab === t ? "selected" : ""}
              key={t}
              onClick={() => setTab(t)}
            >
              {t}
              {t === "Versions" && ` (${job.versions.length})`}
            </button>
          ))}
        </div>
        {error && (
          <div role="alert" className="error">
            {error}
          </div>
        )}
        {tab === "Details" && (
          <>
            <label>
              <span>Application stage</span>
              <select
                aria-label="Application stage"
                disabled={busy}
                value={job.status}
                onChange={(e) =>
                  void run(async () =>
                    onUpdate(
                      await request(`/api/jobs/${job.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ status: e.target.value }),
                      }),
                    ),
                  )
                }
              >
                {stages.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  onUpdate(
                    await request(`/api/jobs/${job.id}`, {
                      method: "PATCH",
                      body: JSON.stringify({
                        description: editing.description,
                        notes: editing.notes,
                      }),
                    }),
                  );
                });
              }}
            >
              <label>
                <span>Job description</span>
                <textarea
                  rows={9}
                  maxLength={18000}
                  value={editing.description}
                  onChange={(e) =>
                    setEditing({ ...editing, description: e.target.value })
                  }
                />
              </label>
              <label>
                <span>Private notes</span>
                <textarea
                  rows={4}
                  maxLength={6000}
                  value={editing.notes}
                  onChange={(e) =>
                    setEditing({ ...editing, notes: e.target.value })
                  }
                />
              </label>
              <button type="submit" disabled={busy} className="secondary">
                Save details <Check size={16} />
              </button>
            </form>
            {job.url && (
              <a
                className="external"
                href={job.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                View original job <ExternalLink size={14} />
              </a>
            )}
            <h3 className="history-title">Application timeline</h3>
            <ol className="timeline">
              {job.history.map((h) => (
                <li key={`${h.at}-${h.status}`}>
                  <b>{h.status}</b>
                  <span>{new Date(h.at).toLocaleString()}</span>
                </li>
              ))}
            </ol>
            <div className="danger-zone">
              {confirm ? (
                <>
                  <p>
                    Delete this application and every saved document? This
                    cannot be undone.
                  </p>
                  <button
                    className="danger"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await request(`/api/jobs/${job.id}`, {
                          method: "DELETE",
                        });
                        onDelete(job.id);
                      })
                    }
                  >
                    Delete permanently
                  </button>
                  <button
                    className="text-button"
                    onClick={() => setConfirm(false)}
                  >
                    Keep application
                  </button>
                </>
              ) : (
                <button
                  className="text-button danger"
                  onClick={() => setConfirm(true)}
                >
                  <Trash2 size={15} /> Delete application & documents
                </button>
              )}
            </div>
          </>
        )}
        {tab === "Tailor documents" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const result = await request(`/api/jobs/${job.id}/tailor`, {
                  method: "POST",
                  body: JSON.stringify({ cv, coverLetter: cover, consent }),
                });
                onUpdate(result);
                setVersion(-1);
                setTab("Versions");
              });
            }}
          >
            <div className="info">
              <Sparkles size={19} />
              <p>
                {config.demo
                  ? "Demo preview uses a deterministic template, not an AI model."
                  : "Your documents are sent to AWS Bedrock to tailor them to this role."}{" "}
                Facts should stay yours. Review every detail before sending.
              </p>
            </div>
            <label>
              Your CV{" "}
              <small>Paste text or upload .txt, .md, .pdf, or .docx</small>
              <textarea
                required
                minLength={30}
                maxLength={24000}
                rows={10}
                placeholder="Your experience, skills, education and achievements…"
                value={cv}
                onChange={(e) => setCv(e.target.value)}
              />
              <input
                aria-label="Upload CV"
                type="file"
                accept=".txt,.md,.pdf,.docx,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={(e) => {
                  const file = e.currentTarget.files?.[0];
                  e.currentTarget.value = "";
                  if (file) void upload(file, setCv, 24000);
                }}
              />
            </label>
            <label>
              Your cover letter{" "}
              <small>
                Optional · paste text or upload .txt, .md, .pdf, or .docx
              </small>
              <textarea
                maxLength={12000}
                rows={6}
                placeholder="Add an existing letter to keep your voice…"
                value={cover}
                onChange={(e) => setCover(e.target.value)}
              />
              <input
                aria-label="Upload cover letter"
                type="file"
                accept=".txt,.md,.pdf,.docx,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={(e) => {
                  const file = e.currentTarget.files?.[0];
                  e.currentTarget.value = "";
                  if (file) void upload(file, setCover, 12000);
                }}
              />
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                required
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              <span>
                I agree to process these documents{" "}
                {config.demo
                  ? "locally for a demo preview"
                  : "with AWS Bedrock"}{" "}
                and save the originals and tailored versions in my private
                workspace.
              </span>
            </label>
            <button
              type="submit"
              disabled={busy || !consent}
              className="primary full"
            >
              {busy ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <Sparkles size={17} />
              )}{" "}
              {getTailorButtonLabel(busy, config.demo)}
            </button>
            <p className="fineprint">
              Up to 8 versions per application, subject to storage limits. PDF
              and DOCX uploads are text-extracted; original formatting is not
              retained.
            </p>
          </form>
        )}
        {tab === "Versions" &&
          (!v ? (
            <div className="empty">
              <FileText />
              <h3>A stronger introduction awaits.</h3>
              <p>Tailor a CV and cover letter to save your first version.</p>
              <button
                className="secondary"
                onClick={() => setTab("Tailor documents")}
              >
                Prepare documents <ArrowRight size={16} />
              </button>
            </div>
          ) : (
            <>
              <label>
                <span>Saved version</span>
                <select
                  value={version < 0 ? job.versions.length - 1 : version}
                  onChange={(e) => setVersion(Number(e.target.value))}
                >
                  {job.versions.map((v, i) => (
                    <option key={v.id} value={i}>
                      Version {i + 1} · {new Date(v.createdAt).toLocaleString()}
                    </option>
                  ))}
                </select>
              </label>
              <div className="info">
                <ShieldCheck size={20} />
                <p>
                  {config.demo ? "Demo output. " : "AI-assisted draft. "}Review
                  accuracy, voice and formatting before applying. No document is
                  sent to employers automatically.
                </p>
              </div>
              <h3>What changed</h3>
              <ul className="changes">
                {v.changes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
              {v.missingKeywords.length > 0 && (
                <div className="gap">
                  <b>Experience to check — not added as facts</b>
                  <p>{v.missingKeywords.join(", ")}</p>
                </div>
              )}
              {[
                ["Tailored CV", v.cv, "cv"],
                ["Tailored cover letter", v.coverLetter, "cover-letter"],
              ].map(([title, body, name]) => (
                <div className="document-preview" key={name}>
                  <div>
                    <h3>{title}</h3>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const { createDocxBlob } =
                            await import("./docx-output.js");
                          const file = await createDocxBlob(title, body);
                          downloadBlob(
                            `${safeFileName(job.company)}-${name}.docx`,
                            file,
                          );
                        })
                      }
                    >
                      <Download size={15} />
                      Download DOCX
                    </button>
                  </div>
                  <pre>{body}</pre>
                </div>
              ))}
              <details>
                <summary>Original documents</summary>
                <h4>Original CV</h4>
                <pre>{v.source.cv}</pre>
                <h4>Original cover letter</h4>
                <pre>
                  {v.source.coverLetter || "No original cover letter provided."}
                </pre>
              </details>
            </>
          ))}
      </dialog>
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
