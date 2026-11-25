import * as Application from "expo-application";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { File, Paths } from "expo-file-system";
import { useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import * as WebBrowser from "expo-web-browser";
import {
  Activity,
  ArrowLeft,
  Download,
  ExternalLink,
  FileAudio,
  Lock,
  LogOut,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Square,
  Trash2,
  UserX,
  WifiOff,
} from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, Share, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import type { ChainVerifyResponse } from "@/core/api/types";
import { ApiError, apiClient, friendlyApiError } from "@/core/api/client";
import { useSession } from "@/core/auth/SessionProvider";
import { configStatus } from "@/core/config";
import { useT } from "@/core/i18n/I18nProvider";
import type { Lang } from "@/core/i18n/dict";
import { listReplayClips, type ReplayClipRow } from "@/core/offline/db";
import { useOffline } from "@/core/offline/OfflineProvider";
import { useAppLock } from "@/core/security/AppLockGate";
import { useShop, useShopState } from "@/core/state/ShopProvider";
import { fontFamilies } from "@/core/theme/fonts";
import { colors, ICON_STROKE, MIN_TARGET_DP, radii, spacing } from "@/core/theme/tokens";
import {
  Card,
  Header,
  IconButton,
  Pill,
  PrimaryButton,
  relTime,
  Screen,
  SecondaryButton,
  Segmented,
  Sheet,
  useToast,
} from "@/core/ui";
import { useAppConfig } from "@/core/version/VersionProvider";
import { useMunshi } from "@/features/munshi/MunshiProvider";
import {
  describeShopSubtitle,
  isDeleteConfirmationValid,
  isHealthPayload,
  resolveWebAppUrl,
  type HealthPayload,
} from "./logic";

export function SettingsScreen() {
  const router = useRouter();
  const { t, lang, setLang } = useT();
  const { toast } = useToast();
  const { user, signOut } = useSession();
  const { shops, shop, setShopId, invalidateShop } = useShop();
  const { refetch: refetchShopState } = useShopState();
  const {
    online,
    simulatedOffline,
    setSimulatedOffline,
    pending,
    queue,
    dequeueTurn,
    retryTurn,
  } = useOffline();
  const { flushNow, openQueuedReview, submitTurn } = useMunshi();
  const { enabled: lockEnabled, setEnabled: setLockEnabled } = useAppLock();
  const { appVersion, config: appConfig } = useAppConfig();

  const [busy, setBusy] = useState<string | null>(null);
  const [secret, setSecret] = useState("");
  const [chain, setChain] = useState<ChainVerifyResponse | null>(null);
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [replaysOpen, setReplaysOpen] = useState(false);
  const [replays, setReplays] = useState<ReplayClipRow[]>(() => listReplayClips());
  const [playingId, setPlayingId] = useState<string | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteNeedsPassword, setDeleteNeedsPassword] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  const apiUrl = configStatus.config?.apiUrl ?? null;
  const buildVersion = Application.nativeBuildVersion ?? "1";

  const stopAudio = () => {
    try {
      playerRef.current?.pause();
      playerRef.current?.remove();
    } catch {
      // Ignore cleanup errors.
    }
    playerRef.current = null;
    setPlayingId(null);
  };

  useEffect(() => () => stopAudio(), []);

  const runAction = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    try {
      await fn();
    } catch (e) {
      toast(friendlyApiError(e), "err");
    } finally {
      setBusy(null);
    }
  };

  const handleToggleLock = async (next: boolean) => {
    const ok = await setLockEnabled(next);
    if (!ok && next) {
      toast("Device PIN ya biometric enrolled nahi hai", "warn");
    }
  };

  const handleDemo = (action: "reset" | "tamper") =>
    void runAction(action, async () => {
      if (!shop) return;
      const cleanSecret = secret.trim() || undefined;
      if (action === "tamper") {
        const res = await apiClient.demoTamper(shop.id, cleanSecret);
        await invalidateShop();
        await refetchShopState();
        setChain(null);
        toast(
          `Ledger row #${res.result.tampered_seq ?? "?"} silently edited — run Verify chain`,
          "warn",
        );
      } else {
        await apiClient.demoReset(shop.id, cleanSecret);
        await invalidateShop();
        await refetchShopState();
        setChain(null);
        toast("Demo shop reset & re-seeded (14-day history)", "ok");
      }
    });

  const handleExportData = () =>
    void runAction("export", async () => {
      const data = await apiClient.accountExport();
      const jsonText = JSON.stringify(data, null, 2);
      const filename = `dukaanos-export-${new Date().toISOString().slice(0, 10)}.json`;
      const outFile = new File(Paths.cache, filename);
      outFile.write(jsonText);
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(outFile.uri, {
          mimeType: "application/json",
          dialogTitle: "Export DukaanOS Data (JSON)",
          UTI: "public.json",
        });
      } else {
        await Share.share({ message: jsonText, title: filename });
      }
      toast("Shop data exported (JSON)", "ok");
    });

  const openLegalPage = async (path: "/privacy" | "/terms" | "/delete-account") => {
    const url = resolveWebAppUrl(apiUrl, path);
    if (!url) {
      toast("Web URL configured nahi hai", "warn");
      return;
    }
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch {
      toast("Link open nahi ho saka", "err");
    }
  };

  const handleDeleteAccount = async () => {
    if (!isDeleteConfirmationValid(deleteConfirm)) return;
    setBusy("delete");
    setDeleteErr(null);
    try {
      await apiClient.accountDelete(deletePassword.trim() || undefined);
      setDeleteOpen(false);
      toast("Account & shop data permanently deleted", "ok");
      await signOut();
    } catch (e) {
      if (e instanceof ApiError && e.code === "RECENT_AUTH_REQUIRED") {
        setDeleteNeedsPassword(true);
        setDeleteErr(
          "Purane session ki wajah se PIN / password dobara darj karein ya web delete page use karein.",
        );
      } else {
        setDeleteErr(friendlyApiError(e));
      }
    } finally {
      setBusy(null);
    }
  };

  const togglePlayClip = async (clip: ReplayClipRow) => {
    if (playingId === clip.id) {
      stopAudio();
      return;
    }
    stopAudio();
    try {
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        shouldRouteThroughEarpiece: false,
      });
      const player = createAudioPlayer(clip.file_uri);
      playerRef.current = player;
      setPlayingId(clip.id);
      player.play();
    } catch {
      toast("Audio file device par maujood nahi", "warn");
      setPlayingId(null);
    }
  };

  return (
    <Screen
      scroll
      header={
        <Header
          title={t("settings")}
          leftExtra={
            <IconButton
              accessibilityLabel="Back"
              onPress={() => router.back()}
              icon={<ArrowLeft size={18} color={colors.ink} strokeWidth={ICON_STROKE} />}
            />
          }
        />
      }
    >
      <View style={styles.container}>
        <View>
          <Text style={styles.eyebrow}>{t("language").toUpperCase()}</Text>
          <View style={styles.sectionGap}>
            <Segmented<Lang>
              value={lang}
              onChange={setLang}
              options={[
                { value: "en", label: "English" },
                { value: "ur", label: "اردو" },
              ]}
            />
          </View>
        </View>

        <View>
          <Text style={styles.eyebrow}>SHOP</Text>
          <Card padded={false} style={styles.sectionGap}>
            {shops && shops.length > 0 ? (
              shops.map((s, idx) => (
                <Pressable
                  key={s.id}
                  onPress={() => setShopId(s.id)}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.shopRow,
                    idx < shops.length - 1 && styles.hairlineBottom,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.flex1}>
                    <Text style={styles.rowTitle}>{s.name}</Text>
                    <Text style={styles.rowSub}>{describeShopSubtitle(s)}</Text>
                  </View>
                  {shop?.id === s.id ? <Pill tone="cash">Active</Pill> : null}
                </Pressable>
              ))
            ) : (
              <View style={styles.shopRow}>
                <Text style={styles.rowSub}>{shop?.name ?? "No shop loaded"}</Text>
              </View>
            )}
          </Card>
          {user?.email ? <Text style={styles.accountEmail}>{user.email}</Text> : null}
        </View>

        <View>
          <Text style={styles.eyebrow}>SECURITY</Text>
          <Card style={styles.sectionGap}>
            <View style={styles.switchRow}>
              <View style={styles.flex1}>
                <View style={styles.titleWithIcon}>
                  <Lock size={15} color={colors.ink} strokeWidth={ICON_STROKE} />
                  <Text style={styles.rowTitle}>App Lock (Biometrics / PIN)</Text>
                </View>
                <Text style={styles.rowSub}>Locks ledger 2 min after leaving app</Text>
              </View>
              <Switch
                value={lockEnabled}
                onValueChange={(next) => void handleToggleLock(next)}
                accessibilityLabel="Toggle App Lock"
              />
            </View>
          </Card>
        </View>

        <View>
          <Text style={styles.eyebrow}>OFFLINE SYNC &amp; QUEUE</Text>
          <Card style={styles.stackCard}>
            <View style={styles.betweenRow}>
              <Pill tone={pending ? "amber" : "cash"}>
                {pending} {t("pendingSync")}
              </Pill>
              <SecondaryButton
                busy={busy === "flush"}
                disabled={!online}
                onPress={() => void runAction("flush", flushNow)}
                style={styles.smallBtn}
              >
                <View style={styles.btnInner}>
                  <RefreshCw size={13} color={colors.ink} strokeWidth={ICON_STROKE} />
                  <Text style={styles.secSmallText}>Flush now</Text>
                </View>
              </SecondaryButton>
            </View>

            <Pressable
              onPress={() => setSimulatedOffline(!simulatedOffline)}
              accessibilityRole="button"
              style={[styles.offlineToggle, simulatedOffline && styles.offlineToggleOn]}
            >
              <WifiOff
                size={15}
                color={simulatedOffline ? colors.amberInk : colors.ink}
                strokeWidth={ICON_STROKE}
              />
              <Text
                style={[
                  styles.offlineToggleText,
                  simulatedOffline && styles.offlineToggleTextOn,
                ]}
              >
                Simulate Offline: {simulatedOffline ? "ON" : "OFF"}
              </Text>
            </Pressable>

            {queue.map((q) => (
              <View key={q.key} style={styles.queueRow}>
                <FileAudio size={14} color={colors.ink2} strokeWidth={ICON_STROKE} />
                <Text numberOfLines={1} style={styles.queueTitle}>
                  {q.kind === "text"
                    ? q.text ?? "Typed entry"
                    : `Voice clip · ${new Date(q.created_at).toLocaleTimeString()}`}
                </Text>
                <Pill
                  tone={q.status === "review" ? "maal" : q.status === "failed" ? "udhaar" : "amber"}
                >
                  {q.status}
                </Pill>
                {q.status === "review" ? (
                  <Pressable
                    onPress={() => {
                      router.replace("/(tabs)");
                      void openQueuedReview(q.key);
                    }}
                    style={styles.queueActBtn}
                  >
                    <Text style={styles.queueActText}>Open</Text>
                  </Pressable>
                ) : q.status === "failed" ? (
                  <Pressable onPress={() => void retryTurn(q.key)} style={styles.queueActBtn}>
                    <Text style={styles.queueActText}>Retry</Text>
                  </Pressable>
                ) : null}
                <IconButton
                  accessibilityLabel="Discard queued turn"
                  onPress={() => void dequeueTurn(q.key)}
                  icon={<Trash2 size={15} color={colors.ink3} strokeWidth={ICON_STROKE} />}
                />
              </View>
            ))}
          </Card>
        </View>

        <View>
          <Text style={styles.eyebrow}>JUDGE PROOF &amp; REPLAYS</Text>
          <Card style={styles.stackCard}>
            <SecondaryButton
              busy={busy === "chain"}
              onPress={() =>
                void runAction("chain", async () => {
                  if (!shop) return;
                  setChain(await apiClient.chain(shop.id));
                })
              }
            >
              <View style={styles.btnInner}>
                <ShieldCheck size={15} color={colors.ink} strokeWidth={ICON_STROKE} />
                <Text style={styles.secBtnText}>Verify SHA-256 chain</Text>
              </View>
            </SecondaryButton>

            {chain ? (
              <View style={[styles.monoResult, chain.ok ? styles.monoOk : styles.monoErr]}>
                <Text style={[styles.monoResultText, chain.ok ? styles.okInk : styles.errInk]}>
                  {chain.ok
                    ? `CHAIN_OK · ${chain.checked} links · ${chain.ms}ms`
                    : `CHAIN_BROKEN at #${chain.first_broken_seq ?? "?"} (${chain.code})`}
                </Text>
              </View>
            ) : null}

            {shop?.is_demo_shop ? (
              <>
                {shop.is_stage_shop ? (
                  <TextInput
                    value={secret}
                    onChangeText={setSecret}
                    secureTextEntry
                    placeholder="DEMO_RESET_SECRET (stage shop)"
                    placeholderTextColor={colors.ink3}
                    style={styles.input}
                  />
                ) : null}
                <View style={styles.twoCol}>
                  <SecondaryButton
                    busy={busy === "tamper"}
                    onPress={() => handleDemo("tamper")}
                    style={styles.flex1}
                  >
                    <View style={styles.btnInner}>
                      <ShieldAlert size={14} color={colors.ink} strokeWidth={ICON_STROKE} />
                      <Text style={styles.secBtnText}>Tamper test</Text>
                    </View>
                  </SecondaryButton>
                  <PrimaryButton
                    busy={busy === "reset"}
                    onPress={() => handleDemo("reset")}
                    style={styles.flex1}
                  >
                    Demo Reset
                  </PrimaryButton>
                </View>
                <Text style={styles.helperText}>
                  Tamper test silently modifies one historical ledger row while keeping balance
                  sum zero — Verify SHA-256 chain catches it immediately. Demo Reset restores the
                  14-day seed.
                </Text>
              </>
            ) : null}

            <SecondaryButton
              onPress={() => {
                setReplays(listReplayClips());
                setReplaysOpen((v) => !v);
              }}
            >
              <View style={styles.btnInner}>
                <Play size={14} color={colors.ink} strokeWidth={ICON_STROKE} />
                <Text style={styles.secBtnText}>
                  Real-audio replay library ({replays.length})
                </Text>
              </View>
            </SecondaryButton>

            {replaysOpen ? (
              <View style={styles.replaysList}>
                {replays.length === 0 ? (
                  <Text style={styles.helperText}>
                    No recordings yet — hold the Munshi mic once to archive real clips locally.
                  </Text>
                ) : (
                  replays.map((clip) => (
                    <View key={clip.id} style={styles.replayItem}>
                      <View style={styles.flex1}>
                        <Text numberOfLines={2} style={styles.replayTranscript}>
                          “{clip.transcript}”
                        </Text>
                        <Text style={styles.rowSub}>
                          {relTime(new Date(clip.created_at).toISOString())}
                        </Text>
                      </View>
                      <IconButton
                        accessibilityLabel="Play saved clip"
                        onPress={() => void togglePlayClip(clip)}
                        icon={
                          playingId === clip.id ? (
                            <Square size={14} color={colors.ink} strokeWidth={ICON_STROKE} />
                          ) : (
                            <Play size={14} color={colors.ink} strokeWidth={ICON_STROKE} />
                          )
                        }
                      />
                      <PrimaryButton
                        onPress={() => {
                          stopAudio();
                          router.replace("/(tabs)");
                          void submitTurn({
                            audioUri: clip.file_uri,
                            mimeType: clip.mime,
                            text: clip.transcript,
                          });
                        }}
                        style={styles.replaySendBtn}
                      >
                        <View style={styles.btnInner}>
                          <RotateCcw size={13} color={colors.surface} strokeWidth={ICON_STROKE} />
                          <Text style={styles.whiteSmallText}>Replay</Text>
                        </View>
                      </PrimaryButton>
                    </View>
                  ))
                )}
              </View>
            ) : null}
          </Card>
        </View>

        <View>
          <Text style={styles.eyebrow}>SYSTEM HEALTH</Text>
          <Card style={styles.stackCard}>
            <SecondaryButton
              busy={busy === "health"}
              onPress={() =>
                void runAction("health", async () => {
                  const res = await apiClient.health();
                  if (isHealthPayload(res)) setHealth(res);
                })
              }
            >
              <View style={styles.btnInner}>
                <Activity size={15} color={colors.ink} strokeWidth={ICON_STROKE} />
                <Text style={styles.secBtnText}>Run health check</Text>
              </View>
            </SecondaryButton>

            {health ? (
              <View style={styles.healthBox}>
                <Pill tone={health.ok ? "cash" : "udhaar"} mono>
                  {health.ok ? "SYSTEM OK" : "CHECK WARNINGS"}
                </Pill>
                {health.pinned_models
                  ? Object.entries(health.pinned_models).map(([k, v]) => (
                      <Text key={k} style={styles.healthLine}>
                        {k}: {v ?? "—"}{" "}
                        {health.models_available
                          ? health.models_available[k]
                            ? "✓"
                            : "✗"
                          : ""}
                      </Text>
                    ))
                  : null}
                {health.cutover_audit ? (
                  <Text
                    style={[
                      styles.healthLine,
                      health.cutover_audit.ok ? styles.okInk : styles.errInk,
                    ]}
                  >
                    gemini-2.5 refs: {health.cutover_audit.gemini_2_5_references}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </Card>
        </View>

        <View>
          <Text style={styles.eyebrow}>DATA RIGHTS &amp; LEGAL</Text>
          <View style={[styles.sectionGap, styles.stackGap]}>
            <SecondaryButton busy={busy === "export"} onPress={handleExportData}>
              <View style={styles.btnInner}>
                <Download size={15} color={colors.ink} strokeWidth={ICON_STROKE} />
                <Text style={styles.secBtnText}>{t("exportData")}</Text>
              </View>
            </SecondaryButton>

            <View style={styles.twoCol}>
              <SecondaryButton
                onPress={() => void openLegalPage("/privacy")}
                style={styles.flex1}
              >
                <View style={styles.btnInner}>
                  <Text style={styles.secBtnText}>{t("privacy")}</Text>
                  <ExternalLink size={13} color={colors.ink2} strokeWidth={ICON_STROKE} />
                </View>
              </SecondaryButton>
              <SecondaryButton
                onPress={() => void openLegalPage("/terms")}
                style={styles.flex1}
              >
                <View style={styles.btnInner}>
                  <Text style={styles.secBtnText}>{t("terms")}</Text>
                  <ExternalLink size={13} color={colors.ink2} strokeWidth={ICON_STROKE} />
                </View>
              </SecondaryButton>
            </View>

            <Pressable
              onPress={() => {
                setDeleteConfirm("");
                setDeletePassword("");
                setDeleteNeedsPassword(false);
                setDeleteErr(null);
                setDeleteOpen(true);
              }}
              accessibilityRole="button"
              style={({ pressed }) => [styles.deleteAccountBtn, pressed && styles.pressed]}
            >
              <UserX size={15} color={colors.udhaarInk} strokeWidth={ICON_STROKE} />
              <Text style={styles.deleteAccountText}>{t("deleteAccount")}</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.footerBlock}>
          <Text style={styles.versionText}>
            DukaanOS v{appVersion} (build {buildVersion}) · Latest v{appConfig.latest_app_version}
          </Text>
          <Pressable
            onPress={() =>
              Alert.alert(t("signOut"), "Kya aap DukaanOS se sign out karna chahte hain?", [
                { text: t("cancel"), style: "cancel" },
                { text: t("signOut"), style: "destructive", onPress: () => void signOut() },
              ])
            }
            accessibilityRole="button"
            style={({ pressed }) => [styles.signOutBtn, pressed && styles.pressed]}
          >
            <LogOut size={16} color={colors.udhaarInk} strokeWidth={ICON_STROKE} />
            <Text style={styles.signOutText}>{t("signOut")}</Text>
          </Pressable>
        </View>
      </View>

      <Sheet
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={t("deleteAccount")}
      >
        <View style={styles.sheetBody}>
          <View style={styles.deleteWarningBox}>
            <Text style={styles.deleteWarningTitle}>
              {lang === "ur" ? "مستقل حذف · ناقابل واپسی" : "Permanent Action"}
            </Text>
            <Text style={styles.deleteWarningText}>
              Deleting your account permanently removes your profile, shop memberships, and
              sole-owner shop ledger, customers, and items.{"\n\n"}
              آپ کا اکاؤنٹ، دکان کی رکنیت اور صرف آپ کی ملکیت والے کھاتے کا تمام ڈیٹا ہمیشہ کے لیے
              حذف ہو جائے گا۔
            </Text>
          </View>

          {deleteNeedsPassword ? (
            <>
              <Text style={styles.eyebrow}>RE-AUTHENTICATE PASSWORD / PIN</Text>
              <TextInput
                value={deletePassword}
                onChangeText={setDeletePassword}
                secureTextEntry
                placeholder="Password / PIN"
                placeholderTextColor={colors.ink3}
                style={styles.input}
              />
            </>
          ) : null}

          <Text style={styles.eyebrow}>
            {lang === "ur" ? 'تصدیق کے لیے DELETE یا حذف لکھیں' : "TYPE DELETE (OR حذف) TO CONFIRM"}
          </Text>
          <TextInput
            value={deleteConfirm}
            onChangeText={setDeleteConfirm}
            placeholder="DELETE"
            placeholderTextColor={colors.ink3}
            autoCapitalize="characters"
            style={styles.input}
          />

          {deleteErr ? (
            <View style={[styles.monoResult, styles.monoErr]}>
              <Text style={styles.errInk}>{deleteErr}</Text>
            </View>
          ) : null}

          <PrimaryButton
            tone="udhaar"
            busy={busy === "delete"}
            disabled={!isDeleteConfirmationValid(deleteConfirm)}
            onPress={() => void handleDeleteAccount()}
          >
            {lang === "ur" ? "میرا اکاؤنٹ مستقل حذف کریں" : "Permanently Delete My Account"}
          </PrimaryButton>

          <SecondaryButton onPress={() => void openLegalPage("/delete-account")}>
            <View style={styles.btnInner}>
              <Text style={styles.secBtnText}>Open Web /delete-account</Text>
              <ExternalLink size={13} color={colors.ink2} strokeWidth={ICON_STROKE} />
            </View>
          </SecondaryButton>
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xl,
    paddingBottom: spacing.xxl * 2,
  },
  eyebrow: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 11,
    letterSpacing: 0.65,
    color: colors.ink2,
  },
  sectionGap: {
    marginTop: spacing.sm,
  },
  stackGap: {
    gap: spacing.sm + 2,
  },
  stackCard: {
    marginTop: spacing.sm,
    gap: spacing.sm + 2,
  },
  flex1: {
    flex: 1,
    minWidth: 0,
  },
  shopRow: {
    minHeight: MIN_TARGET_DP + 6,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  hairlineBottom: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderHairline,
  },
  rowTitle: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 15,
    color: colors.ink,
  },
  rowSub: {
    marginTop: 2,
    fontFamily: fontFamilies.sans,
    fontSize: 12.5,
    color: colors.ink2,
  },
  accountEmail: {
    marginTop: spacing.xs + 2,
    fontFamily: fontFamilies.mono,
    fontSize: 12,
    color: colors.ink2,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  titleWithIcon: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  betweenRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  smallBtn: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
  },
  btnInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  secBtnText: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 14,
    color: colors.ink,
  },
  secSmallText: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 13,
    color: colors.ink,
  },
  whiteSmallText: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 13,
    color: colors.surface,
  },
  offlineToggle: {
    minHeight: MIN_TARGET_DP,
    borderRadius: radii.chip,
    backgroundColor: colors.surfaceSunken,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  offlineToggleOn: {
    backgroundColor: colors.amberBg,
  },
  offlineToggleText: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 14,
    color: colors.ink,
  },
  offlineToggleTextOn: {
    color: colors.amberInk,
  },
  queueRow: {
    minHeight: MIN_TARGET_DP,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderHairline,
    paddingTop: spacing.xs,
  },
  queueTitle: {
    flex: 1,
    minWidth: 0,
    fontFamily: fontFamilies.sans,
    fontSize: 13,
    color: colors.ink,
  },
  queueActBtn: {
    minHeight: 36,
    paddingHorizontal: spacing.sm,
    justifyContent: "center",
  },
  queueActText: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 12.5,
    color: colors.cash,
  },
  input: {
    minHeight: MIN_TARGET_DP,
    borderRadius: radii.chip,
    backgroundColor: colors.canvas,
    paddingHorizontal: spacing.md + 2,
    fontFamily: fontFamilies.sans,
    fontSize: 15,
    color: colors.ink,
  },
  twoCol: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  monoResult: {
    borderRadius: radii.chip,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  monoOk: {
    backgroundColor: colors.cashBg,
  },
  monoErr: {
    backgroundColor: colors.udhaarBg,
  },
  monoResultText: {
    fontFamily: fontFamilies.mono,
    fontSize: 12,
  },
  okInk: {
    color: colors.cashInk,
  },
  errInk: {
    color: colors.udhaarInk,
  },
  helperText: {
    fontFamily: fontFamilies.sans,
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.ink2,
  },
  replaysList: {
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  replayItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderHairline,
    paddingTop: spacing.sm,
  },
  replayTranscript: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 13.5,
    color: colors.ink,
  },
  replaySendBtn: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
  },
  healthBox: {
    gap: 4,
    paddingTop: spacing.xs,
  },
  healthLine: {
    fontFamily: fontFamilies.mono,
    fontSize: 12,
    color: colors.ink,
  },
  deleteAccountBtn: {
    minHeight: MIN_TARGET_DP,
    borderRadius: radii.chip,
    backgroundColor: colors.udhaarBg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  deleteAccountText: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 14,
    color: colors.udhaarInk,
  },
  footerBlock: {
    alignItems: "center",
    gap: spacing.md,
  },
  versionText: {
    fontFamily: fontFamilies.mono,
    fontSize: 11.5,
    color: colors.ink3,
  },
  signOutBtn: {
    width: "100%",
    minHeight: MIN_TARGET_DP,
    borderRadius: radii.chip,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderCard,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  signOutText: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 14.5,
    color: colors.udhaarInk,
  },
  sheetBody: {
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  deleteWarningBox: {
    borderRadius: radii.chip,
    backgroundColor: colors.amberBg,
    padding: spacing.md + 2,
    gap: 4,
  },
  deleteWarningTitle: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 14,
    color: colors.amberInk,
  },
  deleteWarningText: {
    fontFamily: fontFamilies.sans,
    fontSize: 13,
    lineHeight: 19,
    color: colors.amberInk,
  },
  pressed: {
    opacity: 0.78,
  },
});
