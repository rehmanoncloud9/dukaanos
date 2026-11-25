import { useRouter } from "expo-router";
import { ArrowLeft, Check, Plus, Trash2 } from "lucide-react-native";
import { useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { recalcCatalogLine, recalcNewSkuLine, resettle, setLineQty } from "@domain/bill";
import { describeQty, formatBaseQty, formatUnitPrice, parseQuantityPhrase, type BaseUnit } from "@domain/desi-units";
import { formatRs, rupeesToPaisa } from "@domain/money";
import type { CustomerRow, ProposalLine, SaleProposal } from "@domain/types";
import { ApiError, apiClient, friendlyApiError } from "@/core/api/client";
import type { TurnTrace } from "@/core/api/types";
import { useT } from "@/core/i18n/I18nProvider";
import { useShop, useShopState } from "@/core/state/ShopProvider";
import { fontFamilies } from "@/core/theme/fonts";
import { colors, ICON_STROKE, radii, spacing } from "@/core/theme/tokens";
import { Card, IconButton, Money, Pill, PrimaryButton, SecondaryButton, useToast } from "@/core/ui";
import { ReceiptSheet } from "@/features/receipt/ReceiptSheet";
import { useMunshi } from "./MunshiProvider";

const REASON_LABEL: Record<string, string> = {
  UDHAAR: "Udhaar",
  DISCOUNT: "Discount",
  LOW_CONFIDENCE: "Low confidence",
  AMBIGUOUS_CUSTOMER: "3-Ali check",
  NEW_SKU: "New item",
  NO_ITEMS: "No items",
  UDHAAR_REQUIRES_CUSTOMER: "Customer needed",
  OVERPAYMENT_TO_KHATA: "Extra cash → khata",
  NEGATIVE_STOCK: "Stock",
  UNRESOLVED_NUMBER: "Number needs correction",
  UNVERIFIED_EXTRACTION: "Review extraction",
  EXPLICIT_CASH_REQUIRED: "Confirm cash received",
};

function NewSkuEditor({ line, onSave }: { line: ProposalLine; onSave: (next: ProposalLine) => void }) {
  const [open, setOpen] = useState(Boolean(line.number_unresolved) || (!line.value_first && line.unit_price_paisa <= 0));
  const [quantity, setQuantity] = useState(line.quantity_phrase ?? "");
  const [price, setPrice] = useState(line.price_known && line.unit_price_paisa ? String(line.unit_price_paisa / 100) : "");
  const [unit, setUnit] = useState<BaseUnit>(line.base_unit);

  if (!open) {
    return (
      <Pressable onPress={() => setOpen(true)} style={styles.quickAddChip}>
        <Text style={styles.quickAddChipText}>+ QuickAdd “{line.name}” to Maal</Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.quickAddBox}>
      <TextInput
        value={quantity}
        onChangeText={setQuantity}
        placeholder="quantity e.g. 2 packet"
        placeholderTextColor={colors.ink3}
        style={styles.quickInput}
      />
      <View style={styles.quickPriceRow}>
        <Text style={styles.quickRs}>Rs.</Text>
        <TextInput
          value={price}
          onChangeText={(v) => setPrice(v.replace(/[^\d.]/g, ""))}
          keyboardType="decimal-pad"
          placeholder="price"
          placeholderTextColor={colors.ink3}
          style={[styles.quickInput, styles.quickPriceInput]}
        />
        <View style={styles.unitPills}>
          {(["pcs", "g", "ml"] as BaseUnit[]).map((u) => (
            <Pressable
              key={u}
              onPress={() => setUnit(u)}
              style={[styles.unitChip, unit === u && styles.unitChipOn]}
            >
              <Text style={[styles.unitChipText, unit === u && styles.unitChipTextOn]}>
                {u === "g" ? "per kg" : u === "ml" ? "per L" : "per pc"}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      <PrimaryButton
        tone="maal"
        disabled={!price}
        onPress={() => {
          const pack = unit === "pcs" ? 1 : 1000;
          onSave(
            recalcNewSkuLine({
              ...line,
              quantity_phrase: quantity.trim() || null,
              base_unit: unit,
              pack_size_base_units: pack,
              unit_price_paisa: rupeesToPaisa(Number(price)),
              price_known: true,
              confidence: 1,
            }),
          );
          setOpen(false);
        }}
      >
        Save SKU
      </PrimaryButton>
    </View>
  );
}

function ReviewLineRow({
  line,
  stockBefore,
  onChange,
  onRemove,
}: {
  line: ProposalLine;
  stockBefore: number | null;
  onChange: (l: ProposalLine) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [phrase, setPhrase] = useState(line.quantity_phrase ?? "");

  const sub =
    line.kind === "new_sku"
      ? line.value_first && !line.price_known
        ? "Value-first · Loose"
        : line.price_known
          ? `${formatBaseQty(line.qty_base_units, line.base_unit)} @ ${formatUnitPrice(line)} · new SKU`
          : "New item — set a price"
      : line.value_first
        ? `Value-first${line.is_loose ? " · Loose" : ""} · ${formatBaseQty(line.qty_base_units, line.base_unit)} @ ${formatUnitPrice(line)}`
        : `${describeQty(line.qty_base_units, line.base_unit, parseQuantityPhrase(line.quantity_phrase))} @ ${formatUnitPrice(line)}`;

  return (
    <View style={styles.lineItem}>
      <Pressable onPress={() => setEditing((e) => !e)} style={styles.lineHeader}>
        <View style={styles.lineLeft}>
          <Text style={styles.lineName}>{line.name}</Text>
          <Text style={styles.lineSub}>{sub}</Text>
          {line.number_unresolved ? (
            <Text style={styles.unresolvedWarn}>Number unclear — correct quantity before saving</Text>
          ) : null}
          {line.stock_after !== null && line.stock_after < 0 ? (
            <Text style={styles.stockWarn}>Stock → {formatBaseQty(line.stock_after, line.base_unit)} (soft warning)</Text>
          ) : null}
        </View>
        <Money paisa={line.line_total_paisa} size={17} />
      </Pressable>

      {line.kind === "new_sku" ? <NewSkuEditor line={line} onSave={onChange} /> : null}

      {editing && line.kind === "catalog" ? (
        <View style={styles.editRow}>
          <TextInput
            value={phrase}
            onChangeText={setPhrase}
            placeholder="dedh pao / 2 kilo / 3"
            placeholderTextColor={colors.ink3}
            style={styles.phraseInput}
          />
          <Pressable
            onPress={() =>
              onChange(
                recalcCatalogLine({ ...line, quantity_phrase: phrase, value_first: false, value_paisa: null }, stockBefore),
              )
            }
            style={styles.setBtn}
          >
            <Text style={styles.setBtnText}>Set</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Increase quantity"
            onPress={() =>
              onChange(
                setLineQty(
                  line,
                  line.qty_base_units + (line.base_unit === "pcs" ? 1 : line.pack_size_base_units / 4),
                  stockBefore,
                ),
              )
            }
            style={styles.stepBtn}
          >
            <Text style={styles.stepBtnText}>+</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Decrease quantity"
            onPress={() =>
              onChange(
                setLineQty(
                  line,
                  Math.max(1, line.qty_base_units - (line.base_unit === "pcs" ? 1 : line.pack_size_base_units / 4)),
                  stockBefore,
                ),
              )
            }
            style={styles.stepBtn}
          >
            <Text style={styles.stepBtnText}>−</Text>
          </Pressable>
          <IconButton
            accessibilityLabel="Remove line"
            onPress={onRemove}
            icon={<Trash2 size={16} color={colors.udhaarInk} strokeWidth={ICON_STROKE} />}
            style={styles.delBtn}
          />
        </View>
      ) : null}
    </View>
  );
}

export function SaleReviewView({
  initial,
  idemKey,
  trace,
}: {
  initial: SaleProposal;
  idemKey: string;
  trace: TurnTrace | null;
}) {
  const router = useRouter();
  const { t } = useT();
  const { toast } = useToast();
  const { data: state, refetch } = useShopState();
  const { confirmSale, clearReview } = useMunshi();
  const { shopId } = useShop();

  const customers: CustomerRow[] = state?.customers ?? [];
  const [p, setP] = useState<SaleProposal>(initial);
  const [cashText, setCashText] = useState(String(initial.cash_paid_paisa / 100));
  const [discText, setDiscText] = useState(String(initial.discount_paisa / 100));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [addingCustomer, setAddingCustomer] = useState(false);
  const [newCustName, setNewCustName] = useState(initial.customer.mention ?? "");
  const [newCustPhone, setNewCustPhone] = useState("");
  const [addingBusy, setAddingBusy] = useState(false);

  const [receiptData, setReceiptData] = useState<{
    commit: Awaited<ReturnType<typeof confirmSale>>;
    phone: string | null;
  } | null>(null);

  const stockOf = (id: string | null) =>
    id ? state?.products.find((x) => x.id === id)?.stock_base_units ?? null : null;

  const matchPct = useMemo(() => {
    const scores = p.lines
      .map((l) => l.match?.score ?? 0)
      .concat(p.customer.candidates.length ? [p.customer.candidates[0].score] : []);
    return Math.round((scores.reduce((a, b) => a + b, 0) / Math.max(1, scores.length)) * 100);
  }, [p]);

  const updateProposal = (patch: Parameters<typeof resettle>[2]) => {
    const next = resettle(p, customers, patch);
    setP(next);
    setCashText(String(next.cash_paid_paisa / 100));
    setErr(null);
  };

  const customerChips = p.customer.candidates.length
    ? p.customer.candidates.map((c) => customers.find((x) => x.id === c.id) ?? { ...c, aliases: [] })
    : customers.slice(0, 8);

  const needsCustomer = p.credit_paisa !== 0 && !p.customer.selected_id;
  const priceMissing = p.lines.some((l) => (l.kind === "new_sku" && l.line_total_paisa <= 0) || l.number_unresolved);

  const addNewCustomer = async () => {
    if (!newCustName.trim()) return;
    setAddingBusy(true);
    try {
      const created = await apiClient.addCustomer(
        { name: newCustName.trim(), phone: newCustPhone.trim() || undefined },
        shopId ?? undefined,
      );
      await refetch();
      const synthetic: CustomerRow = {
        id: created.id,
        name: newCustName.trim(),
        phone: newCustPhone.trim() || null,
        balance_paisa: 0,
        aliases: [],
      };
      const next = resettle(p, [...customers, synthetic], { selected_customer_id: created.id });
      setP(next);
      setCashText(String(next.cash_paid_paisa / 100));
      setAddingCustomer(false);
    } catch (e) {
      toast(friendlyApiError(e), "err");
    } finally {
      setAddingBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await confirmSale(p, idemKey, trace);
      const phone = customers.find((c) => c.id === p.customer.selected_id)?.phone ?? null;
      setReceiptData({ commit: res, phone });
    } catch (e) {
      setErr(
        e instanceof ApiError && e.code === "UDHAAR_REQUIRES_CUSTOMER"
          ? "Udhaar ke liye customer chunein (UDHAAR_REQUIRES_CUSTOMER)"
          : friendlyApiError(e),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.topBar}>
        <IconButton
          accessibilityLabel="Close review"
          onPress={() => {
            clearReview();
            router.back();
          }}
          icon={<ArrowLeft size={18} color={colors.ink} strokeWidth={ICON_STROKE} />}
        />
        <Text style={styles.topTitle}>{t("reviewEntry")}</Text>
        <Pill tone={trace?.source === "rules" ? "amber" : "cash"}>
          {trace?.source === "rules" ? "Rule parse" : `${matchPct}% Match`}
        </Pill>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          {trace?.transcript ? (
            <View style={styles.transcriptBox}>
              <Text style={styles.transcriptText}>“{trace.transcript}”</Text>
            </View>
          ) : null}

          <View style={styles.reasonRow}>
            <Pill tone="dark" mono>
              Tier 2
            </Pill>
            {p.tier_reasons.map((r) => (
              <Pill
                key={r}
                tone={r.startsWith("UDHAAR") || r === "AMBIGUOUS_CUSTOMER" ? "udhaar" : r === "NEW_SKU" ? "maal" : "neutral"}
              >
                {REASON_LABEL[r] ?? r}
              </Pill>
            ))}
          </View>

          {p.customer.mention || p.credit_paisa !== 0 ? (
            <View style={styles.section}>
              <Text style={[styles.eyebrow, needsCustomer && styles.eyebrowErr]}>
                MATCH CUSTOMER {p.customer.candidates.length > 1 ? "(3-ALI DISAMBIGUATION)" : ""}
                {needsCustomer ? " · REQUIRED FOR UDHAAR" : ""}
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsScroll}>
                {customerChips.map((c) => {
                  const selected = p.customer.selected_id === c.id;
                  return (
                    <Pressable
                      key={c.id}
                      onPress={() => updateProposal({ selected_customer_id: c.id })}
                      style={[
                        styles.custChip,
                        selected ? styles.custChipOn : styles.custChipOff,
                        needsCustomer && !selected && styles.custChipWarn,
                      ]}
                    >
                      <View style={styles.custNameRow}>
                        {selected ? <Check size={14} color={colors.surface} strokeWidth={ICON_STROKE} /> : null}
                        <Text style={[styles.custName, selected && styles.custNameOn]}>{c.name}</Text>
                      </View>
                      <Text style={[styles.custSub, selected && styles.custSubOn]}>
                        {c.role_tag ? `${c.role_tag} · ` : ""}Khata {formatRs(c.balance_paisa)}
                      </Text>
                    </Pressable>
                  );
                })}
                <Pressable onPress={() => setAddingCustomer((v) => !v)} style={styles.newCustBtn}>
                  <Plus size={14} color={colors.ink2} strokeWidth={ICON_STROKE} />
                  <Text style={styles.newCustText}>New</Text>
                </Pressable>
              </ScrollView>

              {addingCustomer ? (
                <View style={styles.newCustForm}>
                  <TextInput
                    value={newCustName}
                    onChangeText={setNewCustName}
                    placeholder="Naam"
                    placeholderTextColor={colors.ink3}
                    style={styles.newCustInput}
                  />
                  <TextInput
                    value={newCustPhone}
                    onChangeText={setNewCustPhone}
                    keyboardType="phone-pad"
                    placeholder="03xx…"
                    placeholderTextColor={colors.ink3}
                    style={[styles.newCustInput, styles.phoneInput]}
                  />
                  <PrimaryButton busy={addingBusy} disabled={!newCustName.trim()} onPress={() => void addNewCustomer()}>
                    Add
                  </PrimaryButton>
                </View>
              ) : null}
            </View>
          ) : null}

          <View style={styles.section}>
            <Text style={styles.eyebrow}>ITEMS (DETERMINISTIC MATH)</Text>
            <Card padded={false}>
              {p.lines.map((l, idx) => (
                <ReviewLineRow
                  key={l.key}
                  line={l}
                  stockBefore={stockOf(l.product_id)}
                  onChange={(nl) => updateProposal({ lines: p.lines.map((x, j) => (j === idx ? nl : x)) })}
                  onRemove={() => updateProposal({ lines: p.lines.filter((_, j) => j !== idx) })}
                />
              ))}

              {p.discount_paisa > 0 || discText !== "0" ? (
                <View style={styles.discountRow}>
                  <Text style={styles.discountLabel}>Discount (Chhor do)</Text>
                  <Text style={styles.discountMinus}>-Rs.</Text>
                  <TextInput
                    value={discText}
                    onChangeText={(v) => {
                      const clean = v.replace(/[^\d]/g, "");
                      setDiscText(clean);
                      updateProposal({ discount_paisa: rupeesToPaisa(Number(clean || 0)) });
                    }}
                    keyboardType="number-pad"
                    style={styles.discountInput}
                  />
                </View>
              ) : null}

              <View style={styles.netRow}>
                <Text style={styles.netLabel}>Net Bill</Text>
                <Money paisa={p.total_paisa} size={19} />
              </View>
            </Card>
          </View>

          <View style={styles.settleGrid}>
            <View style={styles.settleCol}>
              <Text style={styles.eyebrow}>CASH RECEIVED</Text>
              <View style={styles.cashInputRow}>
                <Text style={styles.cashRs}>Rs.</Text>
                <TextInput
                  value={cashText}
                  onChangeText={(v) => {
                    const clean = v.replace(/[^\d]/g, "");
                    setCashText(clean);
                    const next = resettle(p, customers, { cash_paid_paisa: rupeesToPaisa(Number(clean || 0)) });
                    setP(next);
                    setErr(null);
                  }}
                  keyboardType="number-pad"
                  style={styles.cashInput}
                />
              </View>
            </View>
            <View style={styles.settleCol}>
              <Text style={styles.eyebrow}>{p.credit_paisa > 0 ? "KHATA UDHAAR" : "KHATA CREDIT"}</Text>
              <Money
                paisa={p.credit_paisa}
                sign={p.credit_paisa > 0}
                size={22}
                color={p.credit_paisa > 0 ? colors.udhaar : colors.cash}
              />
              {p.new_balance_paisa !== null ? (
                <Text style={styles.balHint}>New bal: {formatRs(p.new_balance_paisa)}</Text>
              ) : null}
              {p.change_due_paisa > 0 ? (
                <Text style={styles.balHint}>Change: {formatRs(p.change_due_paisa)}</Text>
              ) : null}
            </View>
          </View>

          {err ? (
            <View style={styles.errBox}>
              <Text style={styles.errText}>{err}</Text>
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          <SecondaryButton
            onPress={() => {
              clearReview();
              router.back();
            }}
            style={styles.cancelBtn}
          >
            {t("cancel")}
          </SecondaryButton>
          <PrimaryButton
            busy={busy}
            disabled={needsCustomer || priceMissing || p.lines.length === 0}
            onPress={() => void save()}
            style={styles.saveBtn}
          >
            {t("confirmAndSave")}
          </PrimaryButton>
        </View>
      </KeyboardAvoidingView>

      {receiptData ? (
        <ReceiptSheet
          open
          commit={receiptData.commit}
          proposal={p}
          customerPhone={receiptData.phone}
          onOpenXRay={(txId) => {
            setReceiptData(null);
            clearReview();
            router.replace(`/xray?txId=${txId}`);
          }}
          onClose={() => {
            setReceiptData(null);
            clearReview();
            router.back();
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderHairline,
  },
  topTitle: {
    flex: 1,
    fontFamily: fontFamilies.sansBold,
    fontSize: 18,
    color: colors.ink,
  },
  scrollContent: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: 36,
  },
  transcriptBox: {
    backgroundColor: colors.canvas,
    borderRadius: radii.chip,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  transcriptText: {
    fontFamily: fontFamilies.sans,
    fontSize: 15,
    lineHeight: 21,
    color: colors.ink,
  },
  reasonRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  section: {
    gap: spacing.xs + 2,
  },
  eyebrow: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 11,
    letterSpacing: 0.6,
    color: colors.ink2,
  },
  eyebrowErr: {
    color: colors.udhaarInk,
  },
  chipsScroll: {
    gap: spacing.sm,
    paddingVertical: 2,
  },
  custChip: {
    minHeight: 50,
    borderRadius: radii.chip,
    borderWidth: 1,
    paddingHorizontal: spacing.md + 2,
    justifyContent: "center",
  },
  custChipOn: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },
  custChipOff: {
    backgroundColor: colors.surface,
    borderColor: colors.borderStrong,
  },
  custChipWarn: {
    borderColor: colors.udhaar,
  },
  custNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  custName: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 15,
    color: colors.ink,
  },
  custNameOn: { color: colors.surface },
  custSub: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    color: colors.ink2,
  },
  custSubOn: { color: "rgba(255,255,255,0.72)" },
  newCustBtn: {
    minHeight: 50,
    borderRadius: radii.chip,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.borderStrong,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  newCustText: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 14,
    color: colors.ink2,
  },
  newCustForm: {
    marginTop: spacing.xs,
    flexDirection: "row",
    gap: spacing.xs,
    alignItems: "center",
  },
  newCustInput: {
    flex: 1,
    minHeight: 48,
    borderRadius: radii.chip,
    backgroundColor: colors.canvas,
    paddingHorizontal: spacing.md,
    fontFamily: fontFamilies.sans,
    fontSize: 15,
    color: colors.ink,
  },
  phoneInput: { flex: 0.8 },
  lineItem: {
    borderBottomWidth: 1,
    borderBottomColor: colors.borderHairline,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  lineHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  lineLeft: { flex: 1 },
  lineName: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 15,
    color: colors.ink,
  },
  lineSub: {
    marginTop: 2,
    fontFamily: fontFamilies.sans,
    fontSize: 13,
    color: colors.ink2,
  },
  unresolvedWarn: {
    marginTop: 4,
    fontFamily: fontFamilies.sansSemi,
    fontSize: 12,
    color: colors.udhaar,
  },
  stockWarn: {
    marginTop: 4,
    fontFamily: fontFamilies.sansSemi,
    fontSize: 12,
    color: colors.udhaar,
  },
  editRow: {
    marginTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  phraseInput: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: colors.canvas,
    paddingHorizontal: spacing.sm + 2,
    fontFamily: fontFamilies.sans,
    fontSize: 14,
    color: colors.ink,
  },
  setBtn: {
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: colors.ink,
    paddingHorizontal: spacing.md,
    justifyContent: "center",
  },
  setBtnText: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 13,
    color: colors.surface,
  },
  stepBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: colors.surfaceSunken,
    alignItems: "center",
    justifyContent: "center",
  },
  stepBtnText: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 18,
    color: colors.ink,
  },
  delBtn: {
    width: 44,
    height: 44,
    backgroundColor: colors.udhaarBg,
    borderRadius: 10,
  },
  quickAddChip: {
    marginTop: spacing.sm,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.maal,
    backgroundColor: colors.maalBg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignSelf: "flex-start",
  },
  quickAddChipText: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 13,
    color: colors.maal,
  },
  quickAddBox: {
    marginTop: spacing.sm,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.maal,
    backgroundColor: colors.maalBg,
    padding: spacing.sm + 2,
    gap: spacing.xs + 2,
  },
  quickPriceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  quickRs: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 14,
    color: colors.maal,
  },
  quickInput: {
    minHeight: 42,
    borderRadius: 8,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm + 2,
    fontFamily: fontFamilies.sans,
    fontSize: 14,
    color: colors.ink,
  },
  quickPriceInput: {
    width: 84,
  },
  unitPills: {
    flex: 1,
    flexDirection: "row",
    gap: 4,
  },
  unitChip: {
    flex: 1,
    minHeight: 40,
    borderRadius: 8,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  unitChipOn: {
    backgroundColor: colors.ink,
  },
  unitChipText: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 12,
    color: colors.ink2,
  },
  unitChipTextOn: {
    color: colors.surface,
  },
  discountRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(254, 226, 226, 0.55)",
    borderBottomWidth: 1,
    borderBottomColor: colors.borderHairline,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    gap: 6,
  },
  discountLabel: {
    flex: 1,
    fontFamily: fontFamilies.sansMedium,
    fontSize: 15,
    color: colors.udhaarInk,
  },
  discountMinus: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 15,
    color: colors.udhaarInk,
  },
  discountInput: {
    minWidth: 72,
    minHeight: 40,
    textAlign: "right",
    fontFamily: fontFamilies.sansBold,
    fontSize: 17,
    color: colors.udhaarInk,
    fontVariant: ["tabular-nums"],
  },
  netRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  netLabel: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 16,
    color: colors.ink,
  },
  settleGrid: {
    flexDirection: "row",
    gap: spacing.md,
    backgroundColor: colors.canvas,
    borderRadius: radii.card,
    padding: spacing.md + 2,
  },
  settleCol: {
    flex: 1,
    gap: 4,
  },
  cashInputRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 4,
  },
  cashRs: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 14,
    color: colors.cash,
  },
  cashInput: {
    flex: 1,
    minHeight: 42,
    fontFamily: fontFamilies.sansBold,
    fontSize: 22,
    color: colors.cash,
    fontVariant: ["tabular-nums"],
  },
  balHint: {
    fontFamily: fontFamilies.sans,
    fontSize: 12.5,
    color: colors.ink2,
  },
  errBox: {
    borderRadius: radii.chip,
    backgroundColor: colors.udhaarBg,
    padding: spacing.md,
  },
  errText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 14,
    color: colors.udhaarInk,
  },
  footer: {
    flexDirection: "row",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderHairline,
    backgroundColor: colors.surface,
  },
  cancelBtn: {
    width: 100,
  },
  saveBtn: {
    flex: 1,
  },
});
