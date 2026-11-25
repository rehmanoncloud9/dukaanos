import { useRouter } from "expo-router";
import { Lock, Mail, Store, UserRound } from "lucide-react-native";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { friendlyApiError } from "@/core/api/client";
import { useSession } from "@/core/auth/SessionProvider";
import { TurnstileModal } from "@/core/auth/TurnstileModal";
import { useT } from "@/core/i18n/I18nProvider";
import { fontFamilies } from "@/core/theme/fonts";
import { colors, ICON_STROKE, radii, spacing } from "@/core/theme/tokens";
import { Pill, PrimaryButton, SecondaryButton, useToast } from "@/core/ui";
import { useAppConfig } from "@/core/version/VersionProvider";

export default function LoginScreen() {
  const router = useRouter();
  const { signInSandbox, signInPassword, signInMagicLink } = useSession();
  const { config } = useAppConfig();
  const { t } = useT();
  const { toast } = useToast();

  const [mode, setMode] = useState<"none" | "stage" | "magic">("none");
  const [email, setEmail] = useState("stage@dukaanos.pk");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [turnstileOpen, setTurnstileOpen] = useState(false);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      toast(friendlyApiError(err), "err");
    } finally {
      setBusy(null);
    }
  };

  const startSandbox = () => {
    if (config.turnstile_site_key) {
      setTurnstileOpen(true);
      return;
    }
    void run("sandbox", () => signInSandbox());
  };

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.logoMark}>
            <Store size={30} color={colors.surface} strokeWidth={ICON_STROKE} />
          </View>
          <Text style={styles.title}>DukaanOS</Text>
          <Text style={styles.subtitle}>
            Bolo, parchi dikhao — munshi hisaab likh dega. Voice &amp; parchi → hash-chained khata.
          </Text>
          <Text style={styles.urduLine}>آپ بولیں، منشی حساب لکھے گا</Text>

          <View style={styles.trustRow}>
            <Pill tone="cash">
              <Lock size={12} color={colors.cashInk} strokeWidth={ICON_STROKE} />
              <Text style={styles.trustText}>{t("zeroFbrBanner")}</Text>
            </Pill>
          </View>

          <View style={styles.bottom}>
            <PrimaryButton tone="cash" busy={busy === "sandbox"} onPress={startSandbox} style={styles.heroBtn}>
              <Store size={18} color={colors.surface} strokeWidth={ICON_STROKE} />
              <Text style={styles.heroBtnText}>{t("tryDemoShop")}</Text>
            </PrimaryButton>
            <Text style={styles.hint}>Your own isolated sandbox · 3 Alis, 2 Tariqs, Bilal · 14-day history</Text>

            {mode === "stage" ? (
              <View style={styles.formCard}>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  placeholder="stage@dukaanos.pk"
                  placeholderTextColor={colors.ink3}
                  style={styles.input}
                />
                <TextInput
                  value={pin}
                  onChangeText={setPin}
                  secureTextEntry
                  keyboardType="number-pad"
                  placeholder="PIN / password"
                  placeholderTextColor={colors.ink3}
                  style={styles.input}
                />
                <PrimaryButton
                  busy={busy === "stage"}
                  disabled={!pin.trim()}
                  onPress={() => void run("stage", () => signInPassword(email, pin))}
                >
                  Open stage shop
                </PrimaryButton>
                <Pressable onPress={() => setMode("none")} style={styles.backLink}>
                  <Text style={styles.backLinkText}>{t("cancel")}</Text>
                </Pressable>
              </View>
            ) : mode === "magic" ? (
              <View style={styles.formCard}>
                {sent ? (
                  <Text style={styles.sentText}>Link bhej diya — {email} check karein (dukaanos://).</Text>
                ) : (
                  <>
                    <TextInput
                      value={email}
                      onChangeText={setEmail}
                      autoCapitalize="none"
                      keyboardType="email-address"
                      placeholder="aap@email.com"
                      placeholderTextColor={colors.ink3}
                      style={styles.input}
                    />
                    <PrimaryButton
                      busy={busy === "magic"}
                      disabled={!email.includes("@")}
                      onPress={() =>
                        void run("magic", async () => {
                          await signInMagicLink(email);
                          setSent(true);
                        })
                      }
                    >
                      Send magic link
                    </PrimaryButton>
                  </>
                )}
                <Pressable
                  onPress={() => {
                    setMode("none");
                    setSent(false);
                  }}
                  style={styles.backLink}
                >
                  <Text style={styles.backLinkText}>{t("cancel")}</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.dualRow}>
                <SecondaryButton onPress={() => setMode("stage")} style={styles.half}>
                  <UserRound size={16} color={colors.ink} strokeWidth={ICON_STROKE} />
                  <Text style={styles.secText}>{t("stageLogin")}</Text>
                </SecondaryButton>
                <SecondaryButton
                  onPress={() => {
                    setEmail("");
                    setMode("magic");
                  }}
                  style={styles.half}
                >
                  <Mail size={16} color={colors.ink} strokeWidth={ICON_STROKE} />
                  <Text style={styles.secText}>{t("newShop")}</Text>
                </SecondaryButton>
              </View>
            )}

            <Pressable onPress={() => router.push("/passport")} style={styles.verifyLink}>
              <Text style={styles.verifyText}>Verify an SMEConnect Passport →</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {config.turnstile_site_key ? (
        <TurnstileModal
          visible={turnstileOpen}
          siteKey={config.turnstile_site_key}
          onCancel={() => setTurnstileOpen(false)}
          onToken={(token) => {
            setTurnstileOpen(false);
            void run("sandbox", () => signInSandbox(token));
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1 },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.xxl,
    paddingTop: 52,
    paddingBottom: spacing.xxl,
  },
  logoMark: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    marginTop: spacing.xl,
    fontFamily: fontFamilies.sansBold,
    fontSize: 34,
    lineHeight: 38,
    letterSpacing: -0.9,
    color: colors.ink,
  },
  subtitle: {
    marginTop: spacing.sm,
    fontFamily: fontFamilies.sans,
    fontSize: 16.5,
    lineHeight: 23,
    color: colors.ink2,
  },
  urduLine: {
    marginTop: spacing.xs,
    fontFamily: fontFamilies.urduUi,
    fontSize: 17,
    lineHeight: 30,
    color: colors.ink,
    textAlign: "right",
  },
  trustRow: {
    marginTop: spacing.md,
    alignItems: "flex-start",
  },
  trustText: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 12.5,
    color: colors.cashInk,
  },
  bottom: {
    marginTop: "auto",
    paddingTop: spacing.xxl,
    gap: spacing.md,
  },
  heroBtn: {
    height: 54,
  },
  heroBtnText: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 17,
    color: colors.surface,
  },
  hint: {
    fontFamily: fontFamilies.sans,
    fontSize: 12.5,
    color: colors.ink2,
    textAlign: "center",
  },
  dualRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  half: {
    flex: 1,
  },
  secText: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 15,
    color: colors.ink,
  },
  formCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.borderCard,
    padding: spacing.md,
    gap: spacing.sm,
  },
  input: {
    minHeight: 48,
    borderRadius: radii.chip,
    backgroundColor: colors.canvas,
    paddingHorizontal: spacing.md,
    fontFamily: fontFamilies.sans,
    fontSize: 15,
    color: colors.ink,
  },
  sentText: {
    padding: spacing.sm,
    fontFamily: fontFamilies.sansMedium,
    fontSize: 14,
    color: colors.cashInk,
  },
  backLink: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  backLinkText: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 14,
    color: colors.ink2,
  },
  verifyLink: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  verifyText: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 13.5,
    color: colors.ink2,
    textDecorationLine: "underline",
  },
});
