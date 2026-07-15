/**
 * SettingsDialog — account settings (profile, repositories, encryption, delete).
 * Ported from frontend/settings.js. The encryption passphrase-change section and
 * the reauth-gated delete (deferred from slice 7) are wired here in slice 10:
 * both privileged actions bounce through OAuth step-up via requestSettingsReauth
 * and resume on return (?settings=passphrase / ?settings=delete).
 *
 * Repositories: list linked installations with per-install "Configure" deep-links,
 * plus install_options cards (personal / org / picker) to add another account —
 * mirrors InstallGate so Settings is not a single link that lands on the only
 * existing GitHub install.
 */

import { clearDisplayName, getDisplayName, setDisplayName } from "@/auth/displayName";
import { installOptionCopy } from "@/auth/installOptionCopy";
import { useLogout } from "@/auth/useAuthMutations";
import { ME_QUERY_KEY } from "@/auth/useMe";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/i18n";
import { type ApiError, apiFetch } from "@/lib/api";
import { PassphraseChangeSection } from "@/zk/PassphraseChangeSection";
import { hasEnrolledThisSession } from "@/zk/enroll";
import { clearZkReauthProof, getZkReauthProof } from "@/zk/github";
import { clearLocalZkState } from "@/zk/reset";
import { requestSettingsReauth } from "@/zk/settingsReauth";
import type { MePayload } from "@roxabi-live/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

export function SettingsDialog({
  me,
  open,
  onOpenChange,
  onNameChange,
  initialPassphraseForm = false,
  autoDelete = false,
  onResumeHandled,
}: {
  me: MePayload;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNameChange?: (name: string) => void;
  /** Resume: jump straight to the passphrase form (returned from reauth). */
  initialPassphraseForm?: boolean;
  /** Resume: re-run the delete after reauth (returned from reauth). */
  autoDelete?: boolean;
  onResumeHandled?: () => void;
}) {
  const login = me.user.github_login;
  const logout = useLogout();
  const t = useT();
  const qc = useQueryClient();
  const [name, setName] = useState(() => getDisplayName(login));
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const installations = me.installations ?? [];
  const installOptions = me.install_options ?? [];

  // Refresh /api/me when Settings opens or the user returns from a GitHub tab
  // (configure / add-install open target=_blank).
  useEffect(() => {
    if (!open) return;
    qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
    const onReturn = () => {
      if (document.visibilityState === "visible") {
        qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
      }
    };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [open, qc]);

  const deleteAccount = useMutation<{ redirected: boolean }, ApiError, void>({
    mutationFn: async () => {
      const payload: { reauth_proof?: string } = {};
      // Live enrollment state: cached /api/me can lag a same-session enroll.
      if (me.user.zk_enrolled || hasEnrolledThisSession()) {
        const proof = getZkReauthProof();
        if (!proof) {
          requestSettingsReauth("delete", window.location.pathname);
          return { redirected: true };
        }
        payload.reauth_proof = proof;
      }
      await apiFetch<{ ok: true }>("/api/account/delete", { method: "POST", body: payload });
      return { redirected: false };
    },
    onSuccess: async (res) => {
      if (res.redirected) return;
      clearZkReauthProof();
      await clearLocalZkState(login);
      clearDisplayName(login);
      logout.mutate(undefined);
    },
    onError: (err) => {
      if (err.status === 403) {
        requestSettingsReauth("delete", window.location.pathname);
        return;
      }
      setDeleteError(t("settings.deleteAccount.error"));
    },
  });

  function commitName(value: string) {
    const resolved = setDisplayName(login, value);
    setName(resolved);
    onNameChange?.(resolved);
  }

  function onDelete() {
    setDeleteError(null);
    if (
      !window.confirm(t("settings.deleteAccount.confirmPrompt"))
    ) {
      return;
    }
    deleteAccount.mutate();
  }

  // Resume: returned from reauth with ?settings=delete → re-run the delete once.
  const autoDeleteRan = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: one-shot resume; onDelete must not re-trigger it.
  useEffect(() => {
    if (autoDelete && open && !autoDeleteRan.current) {
      autoDeleteRan.current = true;
      onResumeHandled?.();
      onDelete();
    }
  }, [autoDelete, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="settings-dialog">
        <DialogTitle className="text-xl font-semibold text-foreground">{t("settings.title")}</DialogTitle>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">{t("settings.profile.heading")}</h3>
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">{t("settings.profile.displayName.label")}</span>
            <input
              type="text"
              value={name}
              maxLength={64}
              autoComplete="name"
              onChange={(e) => setName(e.target.value)}
              onBlur={(e) => commitName(e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <p className="text-xs text-muted-foreground">
            {t("settings.profile.displayName.hint", { login })}
          </p>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">{t("settings.repos.heading")}</h3>
          <p className="text-xs text-muted-foreground">{t("settings.repos.hint")}</p>

          {installations.length ? (
            <ul className="space-y-2">
              {installations.map((i) => (
                <li
                  key={i.tenant_id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                >
                  <span className="text-foreground">
                    <strong>{i.account_login}</strong>{" "}
                    <span className="text-muted-foreground">({i.account_type})</span>
                  </span>
                  <a
                    href={i.configure_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={t("settings.repos.configureAria", { login: i.account_login })}
                    data-testid={`settings-configure-${i.account_login}`}
                    className="text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t("settings.repos.configure")}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t("settings.repos.empty")}</p>
          )}

          {installOptions.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("settings.repos.addHeading")}
              </h4>
              <p className="text-xs text-muted-foreground">{t("settings.repos.addHint")}</p>
              <div className="space-y-2">
                {installOptions.map((opt) => {
                  const c = installOptionCopy(opt, t, {
                    personal: t("settings.repos.addPersonalHint"),
                    org: t("settings.repos.addOrgHint"),
                  });
                  return (
                    <a
                      key={`${opt.kind}:${opt.login ?? "picker"}`}
                      href={opt.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block rounded-md border border-border p-3 transition-colors hover:border-primary hover:bg-card/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      data-testid={`settings-install-${opt.kind}-${opt.login ?? "picker"}`}
                    >
                      <span className="block text-xs uppercase tracking-wide text-muted-foreground">
                        {c.title}
                      </span>
                      {c.name ? (
                        <span className="block font-medium text-foreground">{c.name}</span>
                      ) : null}
                      <span className="block text-xs text-muted-foreground">{c.hint}</span>
                    </a>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {me.user.zk_account_key_enabled && (
          <PassphraseChangeSection
            login={login}
            initialOpen={initialPassphraseForm}
            onChanged={() => {
              onResumeHandled?.();
              onOpenChange(false);
            }}
          />
        )}

        <section className="space-y-2 rounded-md border border-blocked/30 bg-blocked/5 p-3">
          <h3 className="text-sm font-semibold text-blocked">{t("settings.deleteAccount.heading")}</h3>
          <p className="text-xs text-muted-foreground">
            {t("settings.deleteAccount.hint")}
          </p>
          <Button
            variant="destructive"
            size="sm"
            onClick={onDelete}
            loading={deleteAccount.isPending}
            data-testid="settings-delete"
          >
            {t("settings.deleteAccount.button")}
          </Button>
          {deleteError && (
            <p className="text-xs text-blocked" role="alert">
              {deleteError}
            </p>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}
