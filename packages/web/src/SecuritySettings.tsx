// Ayarlar → Güvenlik: otomatik kilit süresi, şifreli Arche'ler ve anlık görüntü geçmişi.

import { useEffect, useState, type ReactNode } from "react";
import type { NodeMeta } from "./api.ts";
import { decryptArche, encryptArche } from "./archeCrypt.ts";
import { DEFAULT_LOCK_TIMEOUT, DEFAULT_WEB_LOCK_TIMEOUT, LOCK_TIMEOUTS, lockNow, WEB_LOCK_TIMEOUTS } from "./autoLock.ts";
import { webSession } from "./desktop.ts";
import { t } from "./i18n/index.ts";
import { forgetArche, isArcheUnlocked, onLockChange, openLockedCount, unlockArche } from "./lock.ts";
import { usePref } from "./prefs.ts";
import { SnapshotSettings } from "./SnapshotSettings.tsx";
import { Icon } from "./ui/Icon.tsx";

function Card({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="settings-card">
      <h4>{title}</h4>
      {hint && <p className="muted small">{hint}</p>}
      {children}
    </section>
  );
}

/** Kilit durumu değişince bileşeni yeniden çizer. */
function useLockTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => onLockChange(() => setTick((n) => n + 1)), []);
  return tick;
}

export function SecuritySettings({ nodes, onToast, onChanged }: { nodes: NodeMeta[]; onToast: (msg: string) => void; onChanged: () => void }) {
  return (
    <>
      {webSession && <WebLockCard />}
      <AutoLockCard />
      <ArcheLockCard nodes={nodes} onToast={onToast} onChanged={onChanged} />
      <SnapshotSettings onToast={onToast} onChanged={onChanged} />
    </>
  );
}

/** Web sürümü: oturumun hareketsizlikte kilitlenme süresi (her zaman açık) ve hemen kilitleme. */
function WebLockCard() {
  const [minutes, setMinutes] = usePref<number>("webLockTimeout", DEFAULT_WEB_LOCK_TIMEOUT);
  return (
    <Card title={t("web.idleTitle")} hint={t("web.idleHint")}>
      <label className="row">
        <span>{t("autoLock.after")}</span>
        <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} data-testid="web-lock-timeout">
          {WEB_LOCK_TIMEOUTS.map((m) => (
            <option key={m} value={m}>
              {t("autoLock.minutes", { n: m })}
            </option>
          ))}
        </select>
      </label>
      <div className="row">
        <span className="muted small grow">{webSession!.account}</span>
        <button className="secondary" onClick={() => void webSession!.lock()}>
          <Icon name="lock" size={14} /> {t("web.lock")}
        </button>
      </div>
    </Card>
  );
}

function AutoLockCard() {
  const [minutes, setMinutes] = usePref<number>("lockTimeout", DEFAULT_LOCK_TIMEOUT);
  useLockTick();
  const open = openLockedCount();
  return (
    <Card title={t("autoLock.title")} hint={t("autoLock.hint")}>
      <label className="row">
        <span>{t("autoLock.after")}</span>
        <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} data-testid="lock-timeout">
          {LOCK_TIMEOUTS.map((m) => (
            <option key={m} value={m}>
              {m === 0 ? t("autoLock.never") : m === 1 ? t("autoLock.minute") : t("autoLock.minutes", { n: m })}
            </option>
          ))}
        </select>
      </label>
      <div className="row">
        <span className="muted small grow">{open ? t("autoLock.open", { n: open }) : t("autoLock.none")}</span>
        <button className="secondary" disabled={!open} onClick={lockNow}>
          <Icon name="lock" size={14} /> {t("autoLock.now")}
        </button>
      </div>
    </Card>
  );
}

const isArche = (n: NodeMeta) => n.parentNodeId === null && n.archeId === n.id;

function ArcheLockCard({ nodes, onToast, onChanged }: { nodes: NodeMeta[]; onToast: (msg: string) => void; onChanged: () => void }) {
  useLockTick();
  const arches = nodes.filter(isArche).sort((a, b) => a.title.localeCompare(b.title, "tr"));
  const encrypted = arches.filter((a) => a.archeLock);
  const plain = arches.filter((a) => !a.archeLock && !a.template);
  const [pick, setPick] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [hint, setHint] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  /** Kilidi açılacak Arche ve girilen parola (satır içinde). */
  const [unlocking, setUnlocking] = useState<{ id: string; pw: string; wrong?: boolean; then?: "decrypt" } | null>(null);

  async function encrypt() {
    const arche = arches.find((a) => a.id === pick);
    if (!arche) return;
    if (pw.length < 4) return setError(t("lock.short"));
    if (pw !== pw2) return setError(t("lock.mismatch"));
    setError(null);
    try {
      const r = await encryptArche(arche, nodes, pw, hint, t("lock.notice"), (done, total) => setProgress(t("archeLock.working", { done, total })));
      onToast(t("archeLock.encrypted", { arche: arche.title, n: r.done }) + (r.skipped ? ` ${t("archeLock.skipped", { n: r.skipped })}` : ""));
      setPick("");
      setPw("");
      setPw2("");
      setHint("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProgress(null);
      onChanged();
    }
  }

  async function decrypt(arche: NodeMeta) {
    if (!confirm(t("archeLock.decryptConfirm", { arche: arche.title }))) return;
    try {
      const r = await decryptArche(arche, nodes, (done, total) => setProgress(t("archeLock.workingOff", { done, total })));
      onToast(t("archeLock.decrypted", { arche: arche.title, n: r.done }));
    } catch (e) {
      onToast((e as Error).message);
    } finally {
      setProgress(null);
      onChanged();
    }
  }

  async function unlock(arche: NodeMeta) {
    if (!unlocking || !arche.archeLock) return;
    const ok = await unlockArche(arche.id, arche.archeLock, unlocking.pw);
    if (!ok) return setUnlocking({ ...unlocking, pw: "", wrong: true });
    const then = unlocking.then;
    setUnlocking(null);
    if (then === "decrypt") await decrypt(arche);
  }

  return (
    <Card title={t("archeLock.title")} hint={t("archeLock.hint")}>
      {encrypted.length === 0 && <p className="muted small">{t("archeLock.none")}</p>}
      {encrypted.map((a) => {
        const open = isArcheUnlocked(a.id);
        return (
          <div key={a.id} className="arche-lock-row" data-testid="arche-lock-row">
            <div className="row">
              <Icon name={open ? "lock-open" : "lock"} size={16} />
              <span className="grow">
                {a.icon ? `${a.icon} ` : ""}
                {a.title}
                <span className="muted small"> · {open ? t("archeLock.stateOpen") : t("archeLock.stateClosed")}</span>
              </span>
              {open ? (
                <button className="secondary" onClick={() => forgetArche(a.id)}>
                  {t("archeLock.close")}
                </button>
              ) : (
                <button className="secondary" onClick={() => setUnlocking({ id: a.id, pw: "" })}>
                  {t("archeLock.unlock")}
                </button>
              )}
              <button className="secondary" disabled={!!progress} onClick={() => (open ? void decrypt(a) : setUnlocking({ id: a.id, pw: "", then: "decrypt" }))}>
                {t("archeLock.decrypt")}
              </button>
            </div>
            {unlocking?.id === a.id && (
              <form className="row" onSubmit={(e) => (e.preventDefault(), void unlock(a))}>
                <input autoFocus type="password" placeholder={t("lock.password")} value={unlocking.pw} onChange={(e) => setUnlocking({ ...unlocking, pw: e.target.value, wrong: false })} />
                <button className="primary" type="submit" disabled={!unlocking.pw}>
                  {t("lock.open")}
                </button>
                {unlocking.wrong && <span className="error-text small">{t("lock.wrong")}</span>}
                {a.archeLock?.hint && <span className="muted small">{t("lock.showHint", { hint: a.archeLock.hint })}</span>}
              </form>
            )}
          </div>
        );
      })}
      {plain.length > 0 && (
        <div className="arche-lock-new">
          <select value={pick} onChange={(e) => setPick(e.target.value)} data-testid="arche-lock-pick">
            <option value="">{t("archeLock.pick")}</option>
            {plain.map((a) => (
              <option key={a.id} value={a.id}>
                {a.icon ? `${a.icon} ` : ""}
                {a.title}
              </option>
            ))}
          </select>
          {pick && (
            <form className="arche-lock-form" onSubmit={(e) => (e.preventDefault(), void encrypt())}>
              <input type="password" placeholder={t("lock.password")} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
              <input type="password" placeholder={t("lock.confirm")} value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
              <input placeholder={t("lock.hint")} value={hint} onChange={(e) => setHint(e.target.value)} />
              {error && <p className="error-text small">{error}</p>}
              <button className="primary" type="submit" disabled={!pw || !!progress}>
                <Icon name="shield-lock" size={14} /> {t("archeLock.encrypt")}
              </button>
            </form>
          )}
        </div>
      )}
      {progress && <p className="muted small">{progress}</p>}
    </Card>
  );
}
