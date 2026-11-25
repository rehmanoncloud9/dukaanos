import { useQuery } from "@tanstack/react-query";
import * as Print from "expo-print";
import { useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import * as WebBrowser from "expo-web-browser";
import { ArrowLeft, ExternalLink, Printer, Share2, ShieldAlert, ShieldCheck } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Share, StyleSheet, Text, TextInput, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { formatRsCompact } from "@domain/money";
import type { PassportPayload, VerifyResult } from "@passport";
import { apiClient, friendlyApiError } from "@/core/api/client";
import { useSession } from "@/core/auth/SessionProvider";
import { configStatus } from "@/core/config";
import { useShop, useShopState } from "@/core/state/ShopProvider";
import { fontFamilies } from "@/core/theme/fonts";
import { colors, ICON_STROKE, MIN_TARGET_DP, radii, spacing } from "@/core/theme/tokens";
import { Card, Header, IconButton, Pill, PrimaryButton, Screen, SecondaryButton, useToast } from "@/core/ui";
import { useAppConfig } from "@/core/version/VersionProvider";
import {
  buildPassportPdfHtml,
  tamperPassportTokenForDemo,
  verifyPassportOnDevice,
} from "./verify";

type QrSvgHandle = {
  toDataURL?: (cb: (data: string) => void) => void;
};

export function PassportScreen({ tokenParam }: { tokenParam?: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useSession();
  const { shopId } = useShop();
  const { data: shopState } = useShopState();
  const { config: appConfig } = useAppConfig();
  const qrRef = useRef<QrSvgHandle | null>(null);

  const pinnedPublicKey =
    configStatus.config?.ed25519PublicKey || appConfig.verify_public_key || "";

  const [manualToken, setManualToken] = useState<string>(tokenParam ?? "");
  const [exportingPdf, setExportingPdf] = useState(false);

  const isVerifierMode = Boolean(tokenParam) || !user;

  const summaryQuery = useQuery({
    queryKey: ["tradeSummary", shopId ?? "none"],
    queryFn: () => apiClient.tradeSummary(30, shopId!),
    enabled: Boolean(user && shopId && !tokenParam),
    retry: false,
  });

  const passport = summaryQuery.data ?? null;
  const activeToken = tokenParam ? manualToken : (manualToken || passport?.token || "");

  const [verifyState, setVerifyState] = useState<{
    token: string;
    result: VerifyResult;
  } | null>(null);

  useEffect(() => {
    if (!activeToken) return;
    let alive = true;
    void verifyPassportOnDevice(activeToken, pinnedPublicKey).then((result) => {
      if (alive) setVerifyState({ token: activeToken, result });
    });
    return () => {
      alive = false;
    };
  }, [activeToken, pinnedPublicKey]);

  const sigResult = verifyState?.token === activeToken ? verifyState.result : null;
  const sigValid = sigResult?.valid === true;
  const verifiedPayload = (sigResult?.payload ?? passport?.payload ?? null) as PassportPayload | null;
  const verifyUrl =
    passport?.verify_url ??
    (activeToken && configStatus.config?.apiUrl
      ? `${configStatus.config.apiUrl}/verify#${activeToken}`
      : "");

  const captureQrDataUrl = (): Promise<string | null> =>
    new Promise((resolve) => {
      const handle = qrRef.current;
      if (!handle?.toDataURL) {
        resolve(null);
        return;
      }
      const timer = setTimeout(() => resolve(null), 1000);
      try {
        handle.toDataURL((base64) => {
          clearTimeout(timer);
          resolve(base64 ? `data:image/png;base64,${base64}` : null);
        });
      } catch {
        clearTimeout(timer);
        resolve(null);
      }
    });

  const handleExportPdf = async () => {
    if (!passport) return;
    setExportingPdf(true);
    try {
      const qrDataUrl = await captureQrDataUrl();
      const html = buildPassportPdfHtml({
        passport,
        shopState,
        qrDataUrl,
      });
      const { uri } = await Print.printToFileAsync({ html });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, {
          mimeType: "application/pdf",
          dialogTitle: "Export SMEConnect Report (PDF)",
          UTI: "com.adobe.pdf",
        });
      } else {
        await Print.printAsync({ uri });
      }
      toast("SMEConnect PDF ready", "ok");
    } catch (e) {
      toast(friendlyApiError(e), "err");
    } finally {
      setExportingPdf(false);
    }
  };

  const handleOpenVerify = async () => {
    if (!verifyUrl) return;
    try {
      await WebBrowser.openBrowserAsync(verifyUrl);
    } catch {
      toast("Browser open nahi ho saka", "err");
    }
  };

  const handleShareLink = async () => {
    if (!verifyUrl) return;
    try {
      await Share.share({
        message: verifyUrl,
        url: verifyUrl,
        title: "DukaanOS SMEConnect Trade Passport",
      });
    } catch {
      // User cancelled share dialog.
    }
  };

  const handleTamperDemo = () => {
    if (!activeToken) return;
    const forged = tamperPassportTokenForDemo(activeToken);
    if (forged) setManualToken(forged);
  };

  const summary = passport?.summary;
  const shopTitle = summary?.shop_name ?? verifiedPayload?.n ?? "DukaanOS Shop";
  const cityLabel = summary?.city ?? verifiedPayload?.c ?? "Pakistan";
  const activeDays = summary?.active_days ?? verifiedPayload?.ad ?? 0;

  return (
    <Screen
      scroll
      header={
        <Header
          title="SMEConnect Passport"
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
        <View style={[styles.walletCard, sigResult && !sigValid && styles.walletCardInvalid]}>
          <View style={[styles.topTrim, !sigValid && sigResult && styles.topTrimInvalid]} />

          {!isVerifierMode && summaryQuery.isLoading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="small" color={colors.passEmerald} />
              <Text style={styles.loadingText}>Signing with Ed25519…</Text>
            </View>
          ) : !isVerifierMode && summaryQuery.isError ? (
            <View style={styles.loadingWrap}>
              <ShieldAlert size={22} color={colors.udhaar} strokeWidth={ICON_STROKE} />
              <Text style={styles.errCardText}>{friendlyApiError(summaryQuery.error)}</Text>
            </View>
          ) : !verifiedPayload ? (
            <View style={styles.loadingWrap}>
              <Text style={styles.loadingText}>
                Scan a SMEConnect QR or paste a passport token below to verify Ed25519 signature.
              </Text>
            </View>
          ) : (
            <>
              <View style={styles.cardBody}>
                <View style={styles.brandRow}>
                  <Text style={styles.brandTitle}>
                    <Text style={styles.brandBold}>DukaanOS </Text>
                    <Text style={styles.brandMuted}>SMEConnect</Text>
                  </Text>
                  <View
                    style={[
                      styles.statusBadge,
                      sigResult && !sigValid ? styles.statusBadgeBad : styles.statusBadgeOk,
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusBadgeText,
                        sigResult && !sigValid
                          ? styles.statusBadgeTextBad
                          : styles.statusBadgeTextOk,
                      ]}
                    >
                      {sigResult === null
                        ? "VERIFYING…"
                        : sigValid
                          ? "Ed25519 VERIFIED"
                          : "SIG INVALID"}
                    </Text>
                  </View>
                </View>

                <Text style={styles.shopTitle}>{shopTitle}</Text>
                <Text style={styles.shopSub}>
                  {cityLabel} · Active {activeDays} days
                </Text>

                <View style={styles.metricsRow}>
                  <View style={styles.metricCol}>
                    <Text style={styles.metricLabel}>{verifiedPayload.pd}D GMV</Text>
                    <Text style={styles.metricVal}>{formatRsCompact(verifiedPayload.gmv)}</Text>
                  </View>
                  <View style={styles.metricCol}>
                    <Text style={styles.metricLabel}>CASH / CREDIT</Text>
                    <Text style={styles.metricVal}>
                      {Math.round(verifiedPayload.cash_bp / 100)}% /{" "}
                      {100 - Math.round(verifiedPayload.cash_bp / 100)}%
                    </Text>
                  </View>
                  <View style={styles.metricCol}>
                    <Text style={styles.metricLabel}>RECOVERY</Text>
                    <Text style={[styles.metricVal, styles.recoveryVal]}>
                      {(verifiedPayload.rec_bp / 100).toFixed(1)}%
                    </Text>
                  </View>
                </View>

                <View style={styles.chainBar}>
                  <Text style={styles.hashText}>
                    SHA-256 {verifiedPayload.h.slice(0, 4)}…{verifiedPayload.h.slice(-4)} ·{" "}
                    {verifiedPayload.txn} links
                  </Text>
                  <View style={styles.sigRow}>
                    {sigValid ? (
                      <ShieldCheck size={14} color={colors.passEmerald} strokeWidth={ICON_STROKE} />
                    ) : (
                      <ShieldAlert size={14} color={colors.udhaar} strokeWidth={ICON_STROKE} />
                    )}
                    <Text style={[styles.sigText, !sigValid && styles.sigTextBad]}>
                      {sigResult === null
                        ? "VERIFYING…"
                        : sigValid
                          ? "SIG VALID ✓"
                          : `SIG INVALID (${sigResult.reason ?? "FAIL"}) ✗`}
                    </Text>
                  </View>
                </View>
              </View>

              {verifyUrl ? (
                <View style={styles.qrWell}>
                  <View style={styles.qrCard}>
                    <QRCode
                      value={verifyUrl}
                      size={168}
                      ecl="M"
                      color={colors.passBg}
                      backgroundColor={colors.surface}
                      getRef={(c) => {
                        qrRef.current = c as QrSvgHandle | null;
                      }}
                    />
                  </View>
                  <Pressable
                    onPress={() => void handleOpenVerify()}
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.verifyLinkBtn, pressed && styles.pressed]}
                  >
                    <Text style={styles.verifyLinkText}>Open /verify</Text>
                    <ExternalLink size={13} color={colors.passEmerald} strokeWidth={ICON_STROKE} />
                  </Pressable>
                </View>
              ) : null}

              <Text style={styles.disclaimer}>
                {passport?.disclaimer ??
                  "Owner-consented 30-day trade summary aligned with SBP SMEConnect (Nov 1, 2026). Informational only — not a credit score, underwriting decision, tax filing or Shariah certification."}
              </Text>
            </>
          )}
        </View>

        {passport ? (
          <View style={styles.ctaGrid}>
            <PrimaryButton
              busy={exportingPdf}
              onPress={() => void handleExportPdf()}
              style={styles.halfBtn}
            >
              <View style={styles.btnContent}>
                <Printer size={16} color={colors.surface} strokeWidth={ICON_STROKE} />
                <Text style={styles.whiteBtnText}>Export PDF</Text>
              </View>
            </PrimaryButton>
            <SecondaryButton onPress={() => void handleShareLink()} style={styles.halfBtn}>
              <View style={styles.btnContent}>
                <Share2 size={16} color={colors.ink} strokeWidth={ICON_STROKE} />
                <Text style={styles.darkBtnText}>Share link</Text>
              </View>
            </SecondaryButton>
          </View>
        ) : null}

        {isVerifierMode || passport ? (
          <Card>
            <View style={styles.verifierHeader}>
              <Text style={styles.eyebrow}>ON-DEVICE ED25519 VERIFIER</Text>
              {sigResult ? (
                <Pill tone={sigValid ? "cash" : "udhaar"} mono>
                  {sigResult.verify_ms}ms
                </Pill>
              ) : null}
            </View>
            <TextInput
              value={manualToken}
              onChangeText={(v) => setManualToken(v.trim())}
              multiline
              numberOfLines={3}
              placeholder="Paste Ed25519 passport token (<payload>.<sig>) to inspect or verify offline"
              placeholderTextColor={colors.ink3}
              style={styles.tokenInput}
            />
            <View style={styles.verifierBtns}>
              {manualToken ? (
                <SecondaryButton onPress={() => setManualToken("")} style={styles.halfBtn}>
                  Reset token
                </SecondaryButton>
              ) : null}
              <SecondaryButton
                disabled={!activeToken}
                onPress={handleTamperDemo}
                style={styles.halfBtn}
              >
                Tamper test (2x GMV)
              </SecondaryButton>
            </View>
          </Card>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  walletCard: {
    borderRadius: radii.pass,
    backgroundColor: colors.passBg,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.3)",
    overflow: "hidden",
  },
  walletCardInvalid: {
    borderColor: "rgba(194, 65, 12, 0.55)",
  },
  topTrim: {
    height: 3,
    backgroundColor: colors.passEmerald,
  },
  topTrimInvalid: {
    backgroundColor: colors.udhaar,
  },
  loadingWrap: {
    minHeight: 280,
    padding: spacing.xl,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  loadingText: {
    fontFamily: fontFamilies.sans,
    fontSize: 14,
    color: colors.passMuted,
    textAlign: "center",
  },
  errCardText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 14,
    color: colors.udhaarBg,
    textAlign: "center",
  },
  cardBody: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  brandTitle: {
    fontSize: 15,
  },
  brandBold: {
    fontFamily: fontFamilies.sansBold,
    color: colors.passInk,
  },
  brandMuted: {
    fontFamily: fontFamilies.sans,
    color: colors.passMuted,
  },
  statusBadge: {
    borderRadius: radii.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 3,
  },
  statusBadgeOk: {
    borderColor: "rgba(16, 185, 129, 0.5)",
  },
  statusBadgeBad: {
    borderColor: "rgba(194, 65, 12, 0.7)",
  },
  statusBadgeText: {
    fontFamily: fontFamilies.monoSemi,
    fontSize: 10.5,
  },
  statusBadgeTextOk: {
    color: colors.passEmerald,
  },
  statusBadgeTextBad: {
    color: "#FB923C",
  },
  shopTitle: {
    marginTop: spacing.md,
    fontFamily: fontFamilies.sansBold,
    fontSize: 24,
    letterSpacing: -0.4,
    color: colors.passInk,
  },
  shopSub: {
    fontFamily: fontFamilies.sans,
    fontSize: 13.5,
    color: colors.passMuted,
  },
  metricsRow: {
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.1)",
    flexDirection: "row",
    gap: spacing.sm,
  },
  metricCol: {
    flex: 1,
  },
  metricLabel: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 10.5,
    letterSpacing: 0.6,
    color: colors.passMuted,
  },
  metricVal: {
    marginTop: 2,
    fontFamily: fontFamilies.sansBold,
    fontSize: 17,
    fontVariant: ["tabular-nums"],
    color: colors.passInk,
  },
  recoveryVal: {
    color: colors.passEmerald,
  },
  chainBar: {
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.1)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  hashText: {
    fontFamily: fontFamilies.mono,
    fontSize: 11.5,
    color: colors.passMuted,
  },
  sigRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  sigText: {
    fontFamily: fontFamilies.monoSemi,
    fontSize: 11.5,
    color: colors.passEmerald,
  },
  sigTextBad: {
    color: "#FB923C",
  },
  qrWell: {
    backgroundColor: colors.passElevated,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.xl,
    alignItems: "center",
  },
  qrCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.md,
  },
  verifyLinkBtn: {
    marginTop: spacing.lg,
    minHeight: MIN_TARGET_DP,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.chip,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.5)",
    backgroundColor: "rgba(16, 185, 129, 0.1)",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  verifyLinkText: {
    fontFamily: fontFamilies.monoSemi,
    fontSize: 12.5,
    color: colors.passEmerald,
  },
  disclaimer: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    fontFamily: fontFamilies.sans,
    fontSize: 11.5,
    lineHeight: 16,
    color: colors.passMuted,
    textAlign: "center",
  },
  ctaGrid: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  halfBtn: {
    flex: 1,
  },
  btnContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  whiteBtnText: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 15,
    color: colors.surface,
  },
  darkBtnText: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 15,
    color: colors.ink,
  },
  verifierHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  eyebrow: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 11,
    letterSpacing: 0.65,
    color: colors.ink2,
  },
  tokenInput: {
    minHeight: 76,
    borderRadius: radii.chip,
    backgroundColor: colors.canvas,
    padding: spacing.md,
    fontFamily: fontFamilies.mono,
    fontSize: 11.5,
    color: colors.ink,
    textAlignVertical: "top",
  },
  verifierBtns: {
    marginTop: spacing.sm,
    flexDirection: "row",
    gap: spacing.sm,
  },
  pressed: {
    opacity: 0.8,
  },
});
