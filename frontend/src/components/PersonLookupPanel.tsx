"use client";

import { API_BASE } from "@/lib/api";
import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  UserSearch,
  ChevronDown,
  ChevronUp,
  X,
  Search,
  Github,
  Globe,
  Shield,
  ShieldAlert,
  Mail,
  AtSign,
  Phone,
  ExternalLink,
  Check,
  HelpCircle,
  XCircle,
  Loader2,
  BookOpen,
  Users,
  Code,
  Fingerprint,
  History,
  Network,
  FileText,
  Scan,
} from "lucide-react";

interface SherlockCategory {
  [cat: string]: Array<{ name: string; url: string }>;
}

interface PersonResult {
  query: { name: string; email: string; username: string; phone: string; domain: string };
  github: Record<string, unknown>;
  gravatar: Record<string, unknown>;
  social_profiles: Array<{
    platform: string;
    url: string;
    status: "found" | "not_found" | "unverified" | "error";
    cat?: string;
    details: Record<string, unknown>;
  }>;
  sherlock: {
    total_sites_checked: number;
    total_found: number;
    by_category: SherlockCategory;
  };
  email_enum: Array<{
    service: string;
    registered: boolean | null;
    url?: string;
    username?: string;
  }>;
  breaches: { available?: boolean; count?: number; items?: Array<Record<string, unknown>>; reason?: string };
  whois: Record<string, unknown>;
  dns: { domain?: string; subdomains?: string[]; dns_records?: Record<string, string[]> };
  wikipedia: Record<string, unknown>;
  wayback: { available?: boolean; url?: string; timestamp?: string };
  pastes: Array<{ source: string; value: string; type: string }>;
  meta: { sources_checked: number; sources_found: number; sherlock_sites: number; cached: boolean; timestamp: string };
}

const CAT_LABELS: Record<string, string> = {
  dev: "DEVELOPMENT",
  social: "SOCIAL MEDIA",
  media: "MEDIA & CONTENT",
  blog: "BLOGS & SITES",
  gaming: "GAMING",
  security: "SECURITY",
  forum: "FORUMS & COMMUNITY",
  finance: "FINANCE & COMMERCE",
  crypto: "CRYPTO & PGP",
  other: "OTHER",
};

/* ── Collapsible Section ── */
function Section({
  title,
  icon,
  children,
  badge,
  defaultOpen = true,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  badge?: string | number;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-[var(--border-primary)]/50">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-[9px] font-mono tracking-[0.15em] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
      >
        {icon}
        <span className="flex-1 text-left">{title}</span>
        {badge !== undefined && (
          <span className="text-[8px] bg-cyan-950/40 border border-cyan-800/30 rounded px-1.5 py-0.5 text-cyan-400">
            {badge}
          </span>
        )}
        {open ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Status Icon ── */
function StatusIcon({ status }: { status: string }) {
  if (status === "found") return <Check size={10} className="text-green-400" />;
  if (status === "not_found") return <XCircle size={10} className="text-red-400/60" />;
  if (status === "unverified") return <HelpCircle size={10} className="text-yellow-400/60" />;
  return <XCircle size={10} className="text-[var(--text-muted)]" />;
}

/* ── Field Row ── */
function Field({ label, value }: { label: string; value: string | number | undefined }) {
  if (!value && value !== 0) return null;
  return (
    <div className="flex justify-between gap-2 py-0.5">
      <span className="text-[8px] text-[var(--text-muted)] font-mono tracking-wider shrink-0">{label}</span>
      <span className="text-[10px] text-[var(--text-secondary)] font-mono text-right truncate">{String(value)}</span>
    </div>
  );
}

const PersonLookupPanel = React.memo(function PersonLookupPanel({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [isMinimized, setIsMinimized] = useState(false);

  // Form fields
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [phone, setPhone] = useState("");
  const [domain, setDomain] = useState("");

  // State
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PersonResult | null>(null);
  const [error, setError] = useState("");

  const hasInput = !!(name.trim() || email.trim() || username.trim() || domain.trim());

  const handleLookup = async () => {
    if (!hasInput || loading) return;
    setLoading(true);
    setError("");
    setResult(null);

    try {
      const res = await fetch(`${API_BASE}/api/person-lookup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, username, phone, domain }),
      });
      if (res.ok) {
        setResult(await res.json());
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.error || `Lookup failed (${res.status})`);
      }
    } catch {
      setError("Network error — backend may be offline");
    }
    setLoading(false);
  };

  const handleClear = () => {
    setName("");
    setEmail("");
    setUsername("");
    setPhone("");
    setDomain("");
    setResult(null);
    setError("");
  };

  if (!isOpen) return null;

  const avatar = (result?.gravatar as Record<string, string>)?.avatar_url ||
    (result?.github as Record<string, string>)?.avatar_url;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: 20 }}
      transition={{ type: "spring", damping: 25, stiffness: 300 }}
      className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[460px] max-h-[88vh] bg-[var(--bg-primary)]/90 backdrop-blur-xl border border-[var(--border-primary)] rounded-xl z-[9999] flex flex-col font-mono shadow-[0_8px_60px_rgba(0,0,0,0.5)] pointer-events-auto"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-primary)]">
        <Fingerprint size={14} className="text-cyan-400" />
        <span className="text-[10px] tracking-[0.2em] text-[var(--text-primary)] font-bold flex-1">
          OSINT PERSON LOOKUP
        </span>
        {result && (
          <span className="text-[8px] text-[var(--text-muted)]">
            {result.meta.sources_found}/{result.meta.sources_checked} SRC
            {result.sherlock?.total_found > 0 && ` · ${result.sherlock.total_found}/${result.meta.sherlock_sites} SITES`}
          </span>
        )}
        <button onClick={() => setIsMinimized(!isMinimized)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
          {isMinimized ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
        </button>
        <button onClick={onClose} className="text-[var(--text-muted)] hover:text-red-400 transition-colors">
          <X size={12} />
        </button>
      </div>

      <AnimatePresence>
        {!isMinimized && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-y-auto styled-scrollbar flex-1"
          >
            {/* Input Form */}
            <div className="p-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <InputField icon={<Users size={10} />} placeholder="Name" value={name} onChange={setName} onEnter={handleLookup} />
                <InputField icon={<Mail size={10} />} placeholder="Email" value={email} onChange={setEmail} onEnter={handleLookup} />
                <InputField icon={<AtSign size={10} />} placeholder="Username" value={username} onChange={setUsername} onEnter={handleLookup} />
                <InputField icon={<Phone size={10} />} placeholder="Phone" value={phone} onChange={setPhone} onEnter={handleLookup} />
              </div>
              <InputField icon={<Globe size={10} />} placeholder="Domain (e.g. example.com)" value={domain} onChange={setDomain} onEnter={handleLookup} />

              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleLookup}
                  disabled={!hasInput || loading}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 rounded text-[9px] tracking-[0.15em] font-bold transition-all ${
                    hasInput && !loading
                      ? "bg-cyan-500/20 border border-cyan-500/50 text-cyan-300 hover:bg-cyan-500/30 hover:border-cyan-400"
                      : "bg-[var(--bg-secondary)]/50 border border-[var(--border-primary)] text-[var(--text-muted)] cursor-not-allowed"
                  }`}
                >
                  {loading ? (
                    <Loader2 size={10} className="animate-spin" />
                  ) : (
                    <Scan size={10} />
                  )}
                  {loading ? "SCANNING..." : "DEEP SCAN"}
                </button>
                {(result || name || email || username || phone || domain) && (
                  <button
                    onClick={handleClear}
                    className="px-3 py-2 rounded text-[9px] tracking-[0.1em] border border-[var(--border-primary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--text-muted)] transition-colors"
                  >
                    CLEAR
                  </button>
                )}
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="mx-3 mb-2 px-3 py-2 rounded bg-red-950/30 border border-red-500/30 text-[9px] text-red-400 font-mono">
                {error}
              </div>
            )}

            {/* Loading Animation */}
            {loading && (
              <div className="px-3 pb-3">
                <div className="flex flex-col items-center gap-2 py-6">
                  <div className="relative w-14 h-14">
                    <div className="absolute inset-0 rounded-full border-2 border-cyan-500/20" />
                    <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-cyan-400 animate-spin" />
                    <div className="absolute inset-2 rounded-full border border-cyan-500/10" />
                    <div className="absolute inset-2 rounded-full border border-transparent border-b-cyan-300 animate-spin" style={{ animationDirection: "reverse", animationDuration: "1.5s" }} />
                    <div className="absolute inset-4 rounded-full border border-transparent border-t-emerald-400/50 animate-spin" style={{ animationDuration: "2s" }} />
                  </div>
                  <span className="text-[9px] text-cyan-400/70 tracking-[0.2em] animate-pulse">
                    SCANNING 150+ SITES
                  </span>
                  <span className="text-[7px] text-[var(--text-muted)] tracking-wider">
                    Sherlock · HIBP · PGP · Wayback · DNS · Pastes
                  </span>
                </div>
              </div>
            )}

            {/* Results */}
            {result && !loading && (
              <div>
                {/* Identity Header */}
                {(avatar || (result.wikipedia as Record<string, string>)?.summary || (result.gravatar as Record<string, string>)?.display_name) && (
                  <Section title="IDENTITY" icon={<Users size={10} />} defaultOpen={true}>
                    <div className="flex gap-3">
                      {avatar && (
                        <img
                          src={avatar}
                          alt="avatar"
                          className="w-12 h-12 rounded-lg border border-[var(--border-primary)] object-cover flex-shrink-0"
                        />
                      )}
                      <div className="flex-1 min-w-0 space-y-1">
                        {(result.gravatar as Record<string, string>)?.display_name && (
                          <div className="text-[11px] text-[var(--text-primary)] font-bold">
                            {(result.gravatar as Record<string, string>).display_name}
                          </div>
                        )}
                        {(result.gravatar as Record<string, string>)?.current_location && (
                          <div className="text-[9px] text-[var(--text-muted)]">
                            {(result.gravatar as Record<string, string>).current_location}
                          </div>
                        )}
                        {(result.wikipedia as Record<string, string>)?.description && (
                          <div className="text-[9px] text-cyan-400/80 italic">
                            {(result.wikipedia as Record<string, string>).description}
                          </div>
                        )}
                      </div>
                    </div>
                    {(result.wikipedia as Record<string, string>)?.summary && (
                      <p className="mt-2 text-[9px] text-[var(--text-secondary)] leading-relaxed line-clamp-4">
                        {(result.wikipedia as Record<string, string>).summary}
                      </p>
                    )}
                    {(result.wikipedia as Record<string, string>)?.url && (
                      <a
                        href={(result.wikipedia as Record<string, string>).url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 mt-1 text-[8px] text-cyan-400 hover:text-cyan-300 transition-colors"
                      >
                        <BookOpen size={8} /> Wikipedia <ExternalLink size={7} />
                      </a>
                    )}
                  </Section>
                )}

                {/* Sherlock — Username Enumeration */}
                {result.sherlock?.total_found > 0 && (
                  <Section
                    title="SHERLOCK SCAN"
                    icon={<Fingerprint size={10} />}
                    badge={`${result.sherlock.total_found} / ${result.sherlock.total_sites_checked}`}
                    defaultOpen={true}
                  >
                    <div className="space-y-2">
                      {Object.entries(result.sherlock.by_category).map(([cat, sites]) => (
                        <div key={cat}>
                          <div className="text-[7px] tracking-[0.2em] text-[var(--text-muted)] mb-1">
                            {CAT_LABELS[cat] || cat.toUpperCase()} ({sites.length})
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {sites.map((s) => (
                              <a
                                key={s.name}
                                href={s.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] bg-green-950/30 border border-green-800/30 text-green-300 hover:bg-green-900/40 hover:border-green-600/40 transition-colors"
                              >
                                <Check size={7} />
                                {s.name}
                              </a>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </Section>
                )}

                {/* Email Enumeration */}
                {result.email_enum?.length > 0 && (
                  <Section
                    title="EMAIL ENUMERATION"
                    icon={<Mail size={10} />}
                    badge={result.email_enum.filter(e => e.registered).length}
                    defaultOpen={false}
                  >
                    <div className="space-y-1">
                      {result.email_enum.map((e) => (
                        <div
                          key={e.service}
                          className={`flex items-center gap-2 py-1 px-2 rounded text-[9px] ${
                            e.registered
                              ? "bg-green-950/20 border border-green-800/20"
                              : "border border-transparent"
                          }`}
                        >
                          {e.registered === true && <Check size={10} className="text-green-400" />}
                          {e.registered === false && <XCircle size={10} className="text-red-400/40" />}
                          {e.registered === null && <HelpCircle size={10} className="text-yellow-400/40" />}
                          <span className={`flex-1 font-mono ${e.registered ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]"}`}>
                            {e.service}
                          </span>
                          {e.username && <span className="text-[8px] text-cyan-400">@{e.username}</span>}
                          {e.url && e.registered && (
                            <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300">
                              <ExternalLink size={8} />
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  </Section>
                )}

                {/* GitHub */}
                {result.github && Object.keys(result.github).length > 0 && (
                  <Section title="CODE" icon={<Code size={10} />} badge={(result.github as Record<string, number>).public_repos} defaultOpen={false}>
                    <div className="space-y-0.5">
                      <Field label="USER" value={(result.github as Record<string, string>).username} />
                      <Field label="BIO" value={(result.github as Record<string, string>).bio} />
                      <Field label="LOCATION" value={(result.github as Record<string, string>).location} />
                      <Field label="COMPANY" value={(result.github as Record<string, string>).company} />
                      <Field label="REPOS" value={(result.github as Record<string, number>).public_repos} />
                      <Field label="FOLLOWERS" value={(result.github as Record<string, number>).followers} />
                      <Field label="JOINED" value={(result.github as Record<string, string>).created_at?.split("T")[0]} />
                    </div>
                    {(result.github as Record<string, string>).url && (
                      <a
                        href={(result.github as Record<string, string>).url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 mt-2 text-[8px] text-cyan-400 hover:text-cyan-300 transition-colors"
                      >
                        <Github size={8} /> View Profile <ExternalLink size={7} />
                      </a>
                    )}
                  </Section>
                )}

                {/* Breaches */}
                <Section
                  title="BREACHES"
                  icon={result.breaches?.count ? <ShieldAlert size={10} className="text-red-400" /> : <Shield size={10} />}
                  badge={result.breaches?.available ? result.breaches.count : undefined}
                  defaultOpen={!!(result.breaches?.count && result.breaches.count > 0)}
                >
                  {!result.breaches?.available ? (
                    <div className="text-[9px] text-[var(--text-muted)] py-1">
                      {result.breaches?.reason === "no_api_key"
                        ? "HIBP API key not configured — add HIBP_API_KEY to .env"
                        : result.breaches?.reason === "no_email"
                        ? "No email provided for breach check"
                        : "Breach check unavailable"}
                    </div>
                  ) : result.breaches.count === 0 ? (
                    <div className="flex items-center gap-2 text-[9px] text-green-400 py-1">
                      <Check size={10} /> No breaches found
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {result.breaches.items?.map((b, i) => (
                        <div key={i} className="bg-red-950/15 border border-red-800/20 rounded px-2 py-1.5">
                          <div className="flex justify-between">
                            <span className="text-[9px] text-red-300 font-bold">{b.name as string}</span>
                            <span className="text-[8px] text-[var(--text-muted)]">{b.date as string}</span>
                          </div>
                          {(b.data_classes as string[])?.length > 0 && (
                            <div className="text-[8px] text-[var(--text-muted)] mt-0.5 truncate">
                              {(b.data_classes as string[]).slice(0, 5).join(", ")}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </Section>

                {/* DNS Recon */}
                {result.dns && (result.dns.subdomains?.length || Object.keys(result.dns.dns_records || {}).length > 0) && (
                  <Section
                    title="DNS RECON"
                    icon={<Network size={10} />}
                    badge={result.dns.subdomains?.length || 0}
                    defaultOpen={false}
                  >
                    <div className="space-y-2">
                      {result.dns.subdomains && result.dns.subdomains.length > 0 && (
                        <div>
                          <div className="text-[7px] tracking-[0.2em] text-[var(--text-muted)] mb-1">SUBDOMAINS (crt.sh)</div>
                          <div className="max-h-24 overflow-y-auto styled-scrollbar">
                            {result.dns.subdomains.map((sub) => (
                              <div key={sub} className="text-[8px] text-emerald-400/80 font-mono py-0.5">
                                {sub}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {result.dns.dns_records?.mx && result.dns.dns_records.mx.length > 0 && (
                        <div>
                          <div className="text-[7px] tracking-[0.2em] text-[var(--text-muted)] mb-1">MX RECORDS</div>
                          {result.dns.dns_records.mx.map((mx, i) => (
                            <div key={i} className="text-[8px] text-[var(--text-secondary)] font-mono py-0.5">{mx}</div>
                          ))}
                        </div>
                      )}
                      {result.dns.dns_records?.txt && result.dns.dns_records.txt.length > 0 && (
                        <div>
                          <div className="text-[7px] tracking-[0.2em] text-[var(--text-muted)] mb-1">TXT RECORDS</div>
                          {result.dns.dns_records.txt.map((txt, i) => (
                            <div key={i} className="text-[8px] text-[var(--text-secondary)] font-mono py-0.5 break-all">{txt}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  </Section>
                )}

                {/* WHOIS */}
                {result.whois && Object.keys(result.whois).length > 0 && (
                  <Section title="WHOIS / RDAP" icon={<Globe size={10} />} defaultOpen={false}>
                    <div className="space-y-0.5">
                      <Field label="DOMAIN" value={(result.whois as Record<string, string>).domain} />
                      <Field label="REGISTRANT" value={(result.whois as Record<string, string>).registrant} />
                      <Field label="REGISTRAR" value={(result.whois as Record<string, string>).registrar} />
                      <Field label="CREATED" value={(result.whois as Record<string, string>).created?.split("T")[0]} />
                      <Field label="EXPIRES" value={(result.whois as Record<string, string>).expires?.split("T")[0]} />
                    </div>
                  </Section>
                )}

                {/* Wayback Machine */}
                {result.wayback?.available && (
                  <Section title="WAYBACK MACHINE" icon={<History size={10} />} defaultOpen={false}>
                    <div className="space-y-1">
                      <Field label="TIMESTAMP" value={result.wayback.timestamp} />
                      {result.wayback.url && (
                        <a
                          href={result.wayback.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[8px] text-cyan-400 hover:text-cyan-300 transition-colors"
                        >
                          <History size={8} /> View archived snapshot <ExternalLink size={7} />
                        </a>
                      )}
                    </div>
                  </Section>
                )}

                {/* Pastes */}
                {result.pastes?.length > 0 && (
                  <Section
                    title="PASTE EXPOSURE"
                    icon={<FileText size={10} className="text-yellow-400" />}
                    badge={result.pastes.length}
                    defaultOpen={false}
                  >
                    <div className="space-y-1">
                      {result.pastes.map((p, i) => (
                        <div key={i} className="bg-yellow-950/15 border border-yellow-800/20 rounded px-2 py-1.5">
                          <div className="flex justify-between">
                            <span className="text-[9px] text-yellow-300 font-bold">{p.source}</span>
                            <span className="text-[8px] text-[var(--text-muted)]">{p.type}</span>
                          </div>
                          <div className="text-[8px] text-[var(--text-secondary)] mt-0.5 truncate">{p.value}</div>
                        </div>
                      ))}
                    </div>
                  </Section>
                )}

                {/* Meta */}
                <div className="px-3 py-2 border-t border-[var(--border-primary)]/50">
                  <div className="flex justify-between text-[8px] text-[var(--text-muted)] font-mono">
                    <span>{result.meta.sources_found}/{result.meta.sources_checked} SOURCES</span>
                    <span>{result.sherlock?.total_found || 0} PROFILES</span>
                    <span>{result.meta.cached ? "CACHED" : "LIVE"}</span>
                    <span>{result.meta.timestamp?.split("T")[1]?.replace("Z", "") || ""} UTC</span>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
});

/* ── Input Field ── */
function InputField({
  icon,
  placeholder,
  value,
  onChange,
  onEnter,
}: {
  icon: React.ReactNode;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  onEnter?: () => void;
}) {
  return (
    <div className="flex items-center gap-2 bg-[var(--bg-secondary)]/30 border border-[var(--border-primary)] rounded px-2 py-1.5 focus-within:border-cyan-700 transition-colors">
      <span className="text-[var(--text-muted)]">{icon}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && onEnter) onEnter(); }}
        placeholder={placeholder}
        className="flex-1 bg-transparent text-[10px] text-[var(--text-primary)] font-mono tracking-wider outline-none placeholder:text-[var(--text-muted)]/50"
      />
    </div>
  );
}

export default PersonLookupPanel;
