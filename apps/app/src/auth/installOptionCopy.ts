/**
 * Shared title/name/hint mapping for GitHub App install option cards.
 * Used by InstallGate (onboarding) and SettingsDialog (add installation).
 */

import type { TFunc } from "@/i18n";
import type { InstallOption } from "@roxabi-live/shared";

export function installOptionCopy(
  opt: InstallOption,
  t: TFunc,
  hints: { personal: string; org: string },
): { title: string; name: string; hint: string } {
  if (opt.kind === "picker") {
    return {
      title: t("auth.install.option.orgTitle"),
      name: t("auth.install.option.pickerName"),
      hint: t("auth.install.option.pickerHint"),
    };
  }
  if (opt.kind === "personal") {
    return {
      title: t("auth.install.option.personalTitle"),
      name: opt.login ?? "",
      hint: hints.personal,
    };
  }
  return {
    title: t("auth.install.option.orgTitle"),
    name: opt.login ?? "",
    hint: hints.org,
  };
}
