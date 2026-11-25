import { Lock, Store } from "lucide-react-native";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { friendlyApiError } from "@/core/api/client";
import { useSession } from "@/core/auth/SessionProvider";
import { useT } from "@/core/i18n/I18nProvider";
import { useShop } from "@/core/state/ShopProvider";
import { fontFamilies } from "@/core/theme/fonts";
import { colors, ICON_STROKE, radii, spacing } from "@/core/theme/tokens";
import { Pill, PrimaryButton, useToast } from "@/core/ui";

export default function CreateShopScreen() {
  const { createShop } = useShop();
  const { signOut } = useSession();
  const { t } = useT();
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [owner, setOwner] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await createShop({
        name: name.trim(),
        owner_name: owner.trim() || undefined,
        phone: phone.trim() || undefined,
        city: city.trim() || undefined,
      });
    } catch (err) {
      toast(friendlyApiError(err), "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.logoMark}>
            <Store size={26} color={colors.surface} strokeWidth={ICON_STROKE} />
          </View>
          <Text style={styles.title}>{t("createShopTitle")}</Text>
          <Text style={styles.subtitle}>No CNIC. No tax number. Only what the khata needs.</Text>

          <View style={styles.fields}>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Dukaan ka naam (e.g. Madina Store)"
              placeholderTextColor={colors.ink3}
              style={styles.input}
            />
            <TextInput
              value={owner}
              onChangeText={setOwner}
              placeholder="Owner name"
              placeholderTextColor={colors.ink3}
              style={styles.input}
            />
            <TextInput
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              placeholder="Phone (optional)"
              placeholderTextColor={colors.ink3}
              style={styles.input}
            />
            <TextInput
              value={city}
              onChangeText={setCity}
              placeholder="Area / city (e.g. G-9 Markaz)"
              placeholderTextColor={colors.ink3}
              style={styles.input}
            />
          </View>

          <View style={styles.trustRow}>
            <Pill tone="cash">
              <Lock size={12} color={colors.cashInk} strokeWidth={ICON_STROKE} />
              <Text style={styles.trustText}>{t("zeroFbrBanner")}</Text>
            </Pill>
          </View>

          <View style={styles.footer}>
            <PrimaryButton busy={busy} disabled={name.trim().length < 2} onPress={() => void submit()}>
              Dukaan kholo
            </PrimaryButton>
            <Pressable onPress={() => void signOut()} style={styles.signOutBtn}>
              <Text style={styles.signOutText}>{t("signOut")}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1 },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.xxl,
    paddingTop: 44,
    paddingBottom: spacing.xxl,
  },
  logoMark: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    marginTop: spacing.lg,
    fontFamily: fontFamilies.sansBold,
    fontSize: 28,
    color: colors.ink,
  },
  subtitle: {
    marginTop: 4,
    fontFamily: fontFamilies.sans,
    fontSize: 15,
    color: colors.ink2,
  },
  fields: {
    marginTop: spacing.xl,
    gap: spacing.sm + 2,
  },
  input: {
    minHeight: 48,
    borderRadius: radii.chip,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderCard,
    paddingHorizontal: spacing.md + 2,
    fontFamily: fontFamilies.sans,
    fontSize: 16,
    color: colors.ink,
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
  footer: {
    marginTop: "auto",
    paddingTop: spacing.xxl,
    gap: spacing.sm,
  },
  signOutBtn: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  signOutText: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 14.5,
    color: colors.ink2,
  },
});
