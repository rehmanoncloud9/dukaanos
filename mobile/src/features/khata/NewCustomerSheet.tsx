import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { apiClient, friendlyApiError } from "@/core/api/client";
import { useT } from "@/core/i18n/I18nProvider";
import { useShop, useShopState } from "@/core/state/ShopProvider";
import { fontFamilies } from "@/core/theme/fonts";
import { colors, radii, spacing } from "@/core/theme/tokens";
import { PrimaryButton, SecondaryButton, Sheet, useToast } from "@/core/ui";

export interface NewCustomerSheetProps {
  open: boolean;
  onClose: () => void;
}

export function NewCustomerSheet({ open, onClose }: NewCustomerSheetProps) {
  const { t } = useT();
  const { toast } = useToast();
  const { shopId, invalidateShop } = useShop();
  const { refetch } = useShopState();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSave = async () => {
    const cleanName = name.trim();
    if (!cleanName || !shopId) return;
    setBusy(true);
    setErr(null);
    try {
      await apiClient.addCustomer(
        {
          name: cleanName,
          phone: phone.trim() || undefined,
          role_tag: role.trim() || undefined,
        },
        shopId,
      );
      await invalidateShop();
      await refetch();
      toast("Customer added", "ok");
      setName("");
      setPhone("");
      setRole("");
      onClose();
    } catch (e) {
      setErr(friendlyApiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={t("newCustomer")}>
      <View style={styles.body}>
        <Text style={styles.label}>CUSTOMER NAME</Text>
        <TextInput
          value={name}
          onChangeText={(v) => {
            setName(v);
            setErr(null);
          }}
          placeholder="Naam (e.g. Ali Tailor)"
          placeholderTextColor={colors.ink3}
          autoFocus
          style={styles.input}
        />
        <Text style={styles.label}>PHONE (WHATSAPP / 2G SMS)</Text>
        <TextInput
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          placeholder="03xx-xxxxxxx"
          placeholderTextColor={colors.ink3}
          style={styles.input}
        />
        <Text style={styles.label}>ROLE / GALI TAG (OPTIONAL)</Text>
        <TextInput
          value={role}
          onChangeText={setRole}
          placeholder="Electrician, Gali 4…"
          placeholderTextColor={colors.ink3}
          style={styles.input}
        />

        {err ? (
          <View style={styles.errBox}>
            <Text style={styles.errText}>{err}</Text>
          </View>
        ) : null}

        <View style={styles.actions}>
          <SecondaryButton onPress={onClose} style={styles.cancelBtn}>
            {t("cancel")}
          </SecondaryButton>
          <PrimaryButton
            busy={busy}
            disabled={!name.trim()}
            onPress={() => void handleSave()}
            style={styles.saveBtn}
          >
            Save customer
          </PrimaryButton>
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
    paddingBottom: spacing.lg,
  },
  label: {
    marginTop: spacing.xs,
    fontFamily: fontFamilies.sansSemi,
    fontSize: 11,
    letterSpacing: 0.65,
    color: colors.ink3,
  },
  input: {
    minHeight: 48,
    borderRadius: radii.chip,
    backgroundColor: colors.canvas,
    paddingHorizontal: spacing.md + 2,
    fontFamily: fontFamilies.sans,
    fontSize: 16,
    color: colors.ink,
  },
  errBox: {
    marginTop: spacing.xs,
    borderRadius: radii.chip,
    backgroundColor: colors.udhaarBg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  errText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 13.5,
    color: colors.udhaarInk,
  },
  actions: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.md,
  },
  cancelBtn: {
    width: 100,
  },
  saveBtn: {
    flex: 1,
  },
});
