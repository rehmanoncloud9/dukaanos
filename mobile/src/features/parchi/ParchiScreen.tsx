import { Asset } from "expo-asset";
import { CameraView, useCameraPermissions } from "expo-camera";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import {
  ArrowLeft,
  Camera,
  Check,
  FileImage,
  Flashlight,
  Wand2,
} from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
} from "react-native";
import type { BaseUnit } from "@domain/desi-units";
import { formatAmount, formatJournal, formatRs } from "@domain/money";
import { apiClient, friendlyApiError, newIdempotencyKey } from "@/core/api/client";
import type { CommitResponse, ParchiParseResponse } from "@/core/api/types";
import { useT } from "@/core/i18n/I18nProvider";
import { useShop } from "@/core/state/ShopProvider";
import { fontFamilies } from "@/core/theme/fonts";
import { colors, ICON_STROKE, MIN_TARGET_DP, radii, spacing } from "@/core/theme/tokens";
import {
  Card,
  Header,
  IconButton,
  Money,
  Pill,
  PrimaryButton,
  Screen,
  SecondaryButton,
  useToast,
} from "@/core/ui";
import {
  buildPurchaseInput,
  chooseParchiLineAmount,
  computeTargetResize,
  confirmParchiLine,
  parseParchiRupeesToPaisa,
  patchEditableLine,
  recalculateEditableLine,
  summarizeParchiReview,
  toEditableParchiLines,
  type EditableParchiLine,
} from "./logic";
import stagedParchiAsset from "./staged-parchi.jpg";

type Stage = "capture" | "parsing" | "review" | "done";

const STOCK_UNITS: BaseUnit[] = ["g", "ml", "pcs"];

export function ParchiScreen() {
  const router = useRouter();
  const { t } = useT();
  const { toast } = useToast();
  const { shopId, recordCommit, invalidateShop } = useShop();

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [focusCycle, setFocusCycle] = useState(false);
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number } | null>(null);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [stage, setStage] = useState<Stage>("capture");
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParchiParseResponse | null>(null);
  const [lines, setLines] = useState<EditableParchiLine[]>([]);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [statedTotalText, setStatedTotalText] = useState("");
  const [statedTotalPaisa, setStatedTotalPaisa] = useState<number | null>(null);
  const [grandTotalAck, setGrandTotalAck] = useState(false);
  const [cashText, setCashText] = useState("");
  const [busy, setBusy] = useState(false);
  const [doneCommit, setDoneCommit] = useState<CommitResponse | null>(null);
  const [idemKey, setIdemKey] = useState(() => newIdempotencyKey("parchi"));

  useEffect(() => {
    return () => {
      if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    };
  }, []);

  const summary = useMemo(
    () => summarizeParchiReview(lines, statedTotalPaisa, grandTotalAck, cashText),
    [lines, statedTotalPaisa, grandTotalAck, cashText],
  );

  const prepareAndParse = async (
    rawUri: string,
    width?: number | null,
    height?: number | null,
  ) => {
    if (!shopId) {
      toast("Pehle shop select karein", "err");
      return;
    }
    try {
      setPreviewUri(rawUri);
      const { lowRes, resize } = computeTargetResize(width, height);
      if (lowRes) {
        toast("Photo bohat chhoti hai (<800px) — retake for best OCR", "warn");
      }
      setStage("parsing");
      const actions = resize ? [{ resize }] : [];
      const prepared = await manipulateAsync(rawUri, actions, {
        compress: 0.75,
        format: SaveFormat.JPEG,
      });

      const result = await apiClient.parchiParse(prepared.uri, "image/jpeg", shopId);
      setIdemKey(newIdempotencyKey("parchi"));
      setParsed(result);
      setLines(toEditableParchiLines(result.lines));
      const extracted = result.math_check.extracted_total_paisa;
      setStatedTotalPaisa(extracted);
      setStatedTotalText(extracted === null ? "" : String(extracted / 100));
      setCashText("");
      setGrandTotalAck(false);
      setEditingKey(null);
      setStage("review");
    } catch (e) {
      toast(friendlyApiError(e), "err");
      setStage("capture");
    }
  };

  const handleSnap = async () => {
    if (!cameraRef.current) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.9,
        skipProcessing: false,
      });
      if (photo?.uri) {
        await prepareAndParse(photo.uri, photo.width, photo.height);
      }
    } catch {
      toast("Camera capture fail hua — dobara try karein", "err");
    }
  };

  const handleGallery = async () => {
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.9,
        allowsEditing: false,
      });
      const asset = picked.assets?.[0];
      if (!picked.canceled && asset?.uri) {
        await prepareAndParse(asset.uri, asset.width, asset.height);
      }
    } catch {
      toast("Gallery open nahi ho saki", "err");
    }
  };

  const handleStagedSample = async () => {
    try {
      const asset = Asset.fromModule(stagedParchiAsset as number);
      await asset.downloadAsync();
      const uri = asset.localUri ?? asset.uri;
      await prepareAndParse(uri, asset.width ?? 960, asset.height ?? 1280);
    } catch (e) {
      toast(friendlyApiError(e), "err");
      setStage("capture");
    }
  };

  const handleTapFocus = (e: GestureResponderEvent) => {
    const { locationX, locationY } = e.nativeEvent;
    setFocusPoint({ x: locationX, y: locationY });
    setFocusCycle(true);
    if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    focusTimerRef.current = setTimeout(() => {
      setFocusCycle(false);
      setFocusPoint(null);
    }, 650);
  };

  const updateLine = (key: string, patch: Partial<EditableParchiLine>) => {
    setGrandTotalAck(false);
    setLines((prev) => patchEditableLine(prev, key, patch));
  };

  const handleRecalcLine = (line: EditableParchiLine) => {
    const res = recalculateEditableLine(line);
    if (!res.ok) {
      toast(res.error, "warn");
      return;
    }
    setGrandTotalAck(false);
    setLines((prev) => prev.map((entry) => (entry.key === line.key ? res.line : entry)));
  };

  const handleCommitPurchase = async () => {
    if (!parsed || !summary.canCommit || summary.cashPaidPaisa === null || !shopId) return;
    setBusy(true);
    try {
      const payload = buildPurchaseInput({
        idempotencyKey: idemKey,
        parsed,
        lines,
        cashPaidPaisa: summary.cashPaidPaisa,
        statedTotalPaisa,
      });
      const res = await apiClient.purchase(payload, shopId);
      recordCommit({
        response: res,
        endpoint: "/api/transactions/purchase",
        payload: payload as unknown as Record<string, unknown>,
        trace: null,
        proposal: null,
        label: `Restock · ${parsed.supplier_name}`,
        replay: null,
        committedAt: Date.now(),
      });
      await invalidateShop();
      setDoneCommit(res);
      setStage("done");
    } catch (e) {
      toast(friendlyApiError(e), "err");
    } finally {
      setBusy(false);
    }
  };

  const headerTitle =
    stage === "review"
      ? "Parchi OCR Review"
      : stage === "done"
        ? "Restocked ✓"
        : t("scanParchi");

  return (
    <Screen
      scroll
      header={
        <Header
          title={headerTitle}
          leftExtra={
            <IconButton
              accessibilityLabel="Back"
              onPress={() => router.back()}
              icon={<ArrowLeft size={18} color={colors.ink} strokeWidth={ICON_STROKE} />}
            />
          }
          right={
            stage === "review" ? (
              <Pill tone="neutral" mono>
                {lines.length} items · 0 write tools
              </Pill>
            ) : undefined
          }
        />
      }
    >
      {stage === "capture" ? (
        <View style={styles.container}>
          {permission?.granted ? (
            <View style={styles.cameraCard}>
              <View style={styles.cameraFrame}>
                <CameraView
                  ref={cameraRef}
                  style={styles.camera}
                  facing="back"
                  enableTorch={torchOn}
                  autofocus={focusCycle ? "off" : "on"}
                  ratio="4:3"
                />
                <Pressable
                  onPress={handleTapFocus}
                  accessibilityLabel="Tap to focus parchi camera"
                  style={styles.cameraOverlay}
                >
                  <View style={styles.guideBox}>
                    <View style={[styles.corner, styles.tl]} />
                    <View style={[styles.corner, styles.tr]} />
                    <View style={[styles.corner, styles.bl]} />
                    <View style={[styles.corner, styles.br]} />
                  </View>
                  {focusPoint ? (
                    <View
                      style={[
                        styles.focusReticle,
                        { left: focusPoint.x - 22, top: focusPoint.y - 22 },
                      ]}
                    />
                  ) : null}
                  <View style={styles.camTopBar}>
                    <View style={styles.camHintChip}>
                      <Text style={styles.camHintText}>
                        Parchi ko frame mein rakhein · Tap to focus
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => setTorchOn((v) => !v)}
                      accessibilityRole="button"
                      accessibilityLabel="Toggle torch"
                      style={[styles.torchBtn, torchOn && styles.torchBtnOn]}
                    >
                      <Flashlight
                        size={18}
                        color={torchOn ? colors.ink : colors.surface}
                        strokeWidth={ICON_STROKE}
                      />
                    </Pressable>
                  </View>
                </Pressable>
              </View>
              <View style={styles.cameraFooter}>
                <PrimaryButton tone="maal" onPress={() => void handleSnap()}>
                  <View style={styles.btnInner}>
                    <Camera size={18} color={colors.surface} strokeWidth={ICON_STROKE} />
                    <Text style={styles.whiteBtnText}>Snap Parchi</Text>
                  </View>
                </PrimaryButton>
              </View>
            </View>
          ) : (
            <Card>
              <Text style={styles.cardTitle}>Camera access for Parchi scan</Text>
              <Text style={styles.cardSub}>
                DukaanOS wholesale parchi photo sirf review ke liye bhejta hai (server par save nahi
                hoti). Upload 1280px JPEG par optimize hoti hai.
              </Text>
              <PrimaryButton
                tone="maal"
                onPress={() => {
                  if (permission?.canAskAgain === false) {
                    void Linking.openSettings();
                  } else {
                    void requestPermission();
                  }
                }}
                style={styles.permBtn}
              >
                {permission?.canAskAgain === false ? "Open Settings" : "Allow Camera"}
              </PrimaryButton>
            </Card>
          )}

          <SecondaryButton onPress={() => void handleGallery()}>
            <View style={styles.btnInner}>
              <FileImage size={16} color={colors.ink} strokeWidth={ICON_STROKE} />
              <Text style={styles.darkBtnText}>Choose from gallery</Text>
            </View>
          </SecondaryButton>

          <Pressable
            onPress={() => void handleStagedSample()}
            accessibilityRole="button"
            style={({ pressed }) => [styles.stagedBtn, pressed && styles.pressed]}
          >
            <Wand2 size={16} color={colors.maal} strokeWidth={ICON_STROKE} />
            <Text style={styles.stagedBtnText}>1-tap staged field sample</Text>
          </Pressable>
        </View>
      ) : null}

      {stage === "parsing" ? (
        <Card style={styles.parsingCard}>
          {previewUri ? (
            <Image source={{ uri: previewUri }} style={styles.parsingImg} resizeMode="contain" />
          ) : null}
          <View style={styles.parsingRow}>
            <ActivityIndicator size="small" color={colors.maal} />
            <Text style={styles.parsingText}>Reading parchi · vision OCR · 0 write tools</Text>
          </View>
        </Card>
      ) : null}

      {stage === "review" && parsed ? (
        <View style={styles.container}>
          <Card style={styles.previewStrip}>
            <View style={styles.previewRow}>
              {previewUri ? (
                <Image
                  source={{ uri: previewUri }}
                  style={styles.thumbImg}
                  resizeMode="cover"
                />
              ) : null}
              <View style={styles.flex1}>
                <Text numberOfLines={1} style={styles.supplierTitle}>
                  {parsed.supplier_name} · {parsed.bill_date ?? "Date unclear"}
                </Text>
                <Text style={styles.supplierSub}>
                  {parsed.legibility === "poor"
                    ? "Low legibility — review every highlighted row"
                    : "Review transcription against the original"}{" "}
                  · {parsed.latency_ms}ms
                </Text>
              </View>
            </View>
          </Card>

          <Card padded={false}>
            {lines.map((line, idx) => {
              const expanded = editingKey === line.key;
              const highlight = line.math_mismatch || !line.reviewed || line.low_confidence;
              return (
                <View
                  key={line.key}
                  style={[
                    styles.lineRow,
                    idx < lines.length - 1 && styles.hairlineBottom,
                    highlight && styles.lineWarnBg,
                  ]}
                >
                  <Pressable
                    onPress={() => setEditingKey(expanded ? null : line.key)}
                    accessibilityRole="button"
                    style={styles.lineTop}
                  >
                    <View style={styles.flex1}>
                      <View style={styles.badgesLine}>
                        <Text style={styles.lineName}>{line.name}</Text>
                        {line.match_status === "new_sku" ? (
                          <Pill tone="maal">New Item</Pill>
                        ) : null}
                        {line.low_confidence ? <Pill tone="amber">Low confidence</Pill> : null}
                      </View>
                      <Text style={styles.lineSub}>
                        {line.qty_number === null
                          ? "Quantity unclear"
                          : `${line.qty_number} ${line.unit ?? "unit unclear"}`}
                        {line.rate_paisa !== null
                          ? ` @ Rs. ${formatAmount(line.rate_paisa)}`
                          : " · Rate unclear"}
                        {line.math_mismatch
                          ? ` · Computed Rs. ${formatAmount(line.computed_total_paisa ?? 0)}; slip Rs. ${formatAmount(line.written_total_paisa ?? 0)}`
                          : ""}
                      </Text>
                      <Text numberOfLines={2} style={styles.asWritten}>
                        As written: {line.raw.name} · {line.raw.quantity ?? "?"}{" "}
                        {line.raw.unit ?? ""} · {line.raw.rate ?? "?"} ·{" "}
                        {line.raw.line_total ?? "?"}
                      </Text>
                    </View>
                    {line.line_total_paisa === null ? (
                      <Pill tone="amber" mono>
                        REVIEW
                      </Pill>
                    ) : (
                      <Money paisa={line.line_total_paisa} size={17} />
                    )}
                  </Pressable>

                  {line.computed_total_paisa !== null &&
                  line.written_total_paisa !== null &&
                  line.computed_total_paisa !== line.written_total_paisa ? (
                    <View style={styles.mismatchBtns}>
                      <Pressable
                        onPress={() => {
                          setGrandTotalAck(false);
                          setLines((prev) =>
                            chooseParchiLineAmount(prev, line.key, "computed"),
                          );
                        }}
                        style={[
                          styles.choiceChip,
                          line.choice === "computed" && styles.choiceChipActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.choiceChipText,
                            line.choice === "computed" && styles.choiceChipTextActive,
                          ]}
                        >
                          Use computed {formatRs(line.computed_total_paisa)}
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => {
                          setGrandTotalAck(false);
                          setLines((prev) =>
                            chooseParchiLineAmount(prev, line.key, "written"),
                          );
                        }}
                        style={[
                          styles.choiceChip,
                          line.choice === "written" && styles.choiceChipActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.choiceChipText,
                            line.choice === "written" && styles.choiceChipTextActive,
                          ]}
                        >
                          Keep slip {formatRs(line.written_total_paisa)}
                        </Text>
                      </Pressable>
                    </View>
                  ) : null}

                  {expanded ? (
                    <View style={styles.editorBox}>
                      <View style={styles.editorGrid}>
                        <View style={styles.editorField}>
                          <Text style={styles.fieldLabel}>Name</Text>
                          <TextInput
                            value={line.name}
                            onChangeText={(v) => updateLine(line.key, { name: v })}
                            style={[
                              styles.fieldInput,
                              line.low_confidence && styles.lowConfInput,
                            ]}
                          />
                        </View>
                        <View style={styles.editorField}>
                          <Text style={styles.fieldLabel}>Written unit</Text>
                          <TextInput
                            value={line.unitText}
                            onChangeText={(v) =>
                              updateLine(line.key, { unitText: v, unit: v })
                            }
                            placeholder="kg, g, pcs…"
                            placeholderTextColor={colors.ink3}
                            style={styles.fieldInput}
                          />
                        </View>
                      </View>

                      {line.match_status === "new_sku" ? (
                        <View>
                          <Text style={styles.fieldLabel}>Stock unit (New SKU)</Text>
                          <View style={styles.unitChips}>
                            {STOCK_UNITS.map((u) => (
                              <Pressable
                                key={u}
                                onPress={() => updateLine(line.key, { base_unit: u })}
                                style={[
                                  styles.unitChip,
                                  line.base_unit === u && styles.unitChipActive,
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.unitChipText,
                                    line.base_unit === u && styles.unitChipTextActive,
                                  ]}
                                >
                                  {u}
                                </Text>
                              </Pressable>
                            ))}
                          </View>
                        </View>
                      ) : null}

                      {line.conversion_unresolved && line.match_status === "new_sku" ? (
                        <View>
                          <Text style={styles.fieldLabel}>Base units per package</Text>
                          <TextInput
                            value={line.packText}
                            onChangeText={(v) =>
                              updateLine(line.key, { packText: v.replace(/[^\d]/g, "") })
                            }
                            keyboardType="number-pad"
                            placeholder="e.g. 1000 for 1kg pack"
                            placeholderTextColor={colors.ink3}
                            style={styles.fieldInput}
                          />
                        </View>
                      ) : null}

                      <View style={styles.editorGrid}>
                        <View style={styles.editorField}>
                          <Text style={styles.fieldLabel}>Quantity</Text>
                          <TextInput
                            value={line.qtyText}
                            onChangeText={(v) => {
                              const clean = v.replace(/[^\d.]/g, "");
                              updateLine(line.key, {
                                qtyText: clean,
                                qty_number:
                                  clean && Number.isFinite(Number(clean)) ? Number(clean) : null,
                              });
                            }}
                            keyboardType="decimal-pad"
                            style={[
                              styles.fieldInput,
                              line.low_confidence && styles.lowConfInput,
                            ]}
                          />
                        </View>
                        <View style={styles.editorField}>
                          <Text style={styles.fieldLabel}>Rate (Rs.)</Text>
                          <TextInput
                            value={line.rateText}
                            onChangeText={(v) =>
                              updateLine(line.key, { rateText: v.replace(/[^\d.]/g, "") })
                            }
                            keyboardType="decimal-pad"
                            style={[
                              styles.fieldInput,
                              line.low_confidence && styles.lowConfInput,
                            ]}
                          />
                        </View>
                      </View>

                      <View>
                        <Text style={styles.fieldLabel}>Written line total (Rs.)</Text>
                        <TextInput
                          value={line.totalText}
                          onChangeText={(v) =>
                            updateLine(line.key, { totalText: v.replace(/[^\d.]/g, "") })
                          }
                          keyboardType="decimal-pad"
                          style={[
                            styles.fieldInput,
                            line.low_confidence && styles.lowConfInput,
                          ]}
                        />
                      </View>

                      <View style={styles.editorActions}>
                        <SecondaryButton
                          onPress={() => handleRecalcLine(line)}
                          style={styles.smallActionBtn}
                        >
                          Recalculate
                        </SecondaryButton>
                        <PrimaryButton
                          tone="maal"
                          disabled={
                            line.line_total_paisa === null || line.qty_base_units === null
                          }
                          onPress={() => {
                            setLines((prev) => confirmParchiLine(prev, line.key));
                            setEditingKey(null);
                          }}
                          style={styles.smallActionBtn}
                        >
                          <View style={styles.btnInner}>
                            <Check size={14} color={colors.surface} strokeWidth={ICON_STROKE} />
                            <Text style={styles.whiteBtnText}>
                              {line.reviewed ? "Confirmed" : "Confirm line"}
                            </Text>
                          </View>
                        </PrimaryButton>
                      </View>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </Card>

          <Card style={styles.totalsCard}>
            <View style={styles.grandTotalRow}>
              <Text style={styles.metaLabel}>Written grand total (Rs.)</Text>
              <TextInput
                value={statedTotalText}
                onChangeText={(v) => {
                  const clean = v.replace(/[^\d.,]/g, "");
                  setStatedTotalText(clean);
                  setStatedTotalPaisa(parseParchiRupeesToPaisa(clean));
                  setGrandTotalAck(false);
                }}
                keyboardType="decimal-pad"
                placeholder="unclear"
                placeholderTextColor={colors.ink3}
                style={styles.inlineInput}
              />
              {statedTotalPaisa !== null &&
              statedTotalPaisa === summary.sumPaisa &&
              summary.totalSafe ? (
                <Pill tone="cash" mono>
                  Matches
                </Pill>
              ) : (
                <Pill tone="amber" mono>
                  Check total
                </Pill>
              )}
            </View>

            {summary.grandTotalMismatch ? (
              <View style={styles.mismatchTotalBox}>
                <Text style={styles.mismatchTotalText}>
                  {statedTotalPaisa === null
                    ? "Grand total is missing or unclear."
                    : `Written ${formatRs(statedTotalPaisa)} differs from selected SUM ${formatRs(summary.sumPaisa)}.`}
                </Text>
                <Pressable
                  onPress={() => setGrandTotalAck(true)}
                  style={[
                    styles.ackBtn,
                    grandTotalAck && styles.ackBtnActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.ackBtnText,
                      grandTotalAck && styles.ackBtnTextActive,
                    ]}
                  >
                    {grandTotalAck ? "Confirmed SUM ✓" : "Confirm selected line sum"}
                  </Text>
                </Pressable>
              </View>
            ) : null}

            <View style={styles.cashRow}>
              <Text style={styles.metaLabel}>Cash paid now (Rs.)</Text>
              <TextInput
                value={cashText}
                onChangeText={(v) => setCashText(v.replace(/[^\d.,]/g, ""))}
                keyboardType="decimal-pad"
                placeholder="required"
                placeholderTextColor={colors.ink3}
                style={styles.inlineInput}
              />
              <Text style={styles.apText}>A/P {formatRs(summary.apBalancePaisa)}</Text>
            </View>
          </Card>

          <View style={styles.commitSummary}>
            <Text style={styles.metaLabel}>
              Restock Total ({lines.length} SKUs
              {summary.newSkuCount ? ` · ${summary.newSkuCount} new` : ""})
            </Text>
            <Money paisa={summary.sumPaisa} size={22} />
          </View>

          <View style={styles.commitActions}>
            <SecondaryButton onPress={() => setStage("capture")} style={styles.cancelBtn}>
              {t("cancel")}
            </SecondaryButton>
            <PrimaryButton
              tone="maal"
              busy={busy}
              disabled={!summary.canCommit}
              onPress={() => void handleCommitPurchase()}
              style={styles.flex1}
            >
              Restock Commit
            </PrimaryButton>
          </View>
        </View>
      ) : null}

      {stage === "done" && doneCommit ? (
        <View style={styles.container}>
          <Card style={styles.stackGap}>
            <Text style={styles.supplierTitle}>{parsed?.supplier_name ?? "Wholesale"}</Text>
            <Money paisa={doneCommit.totals.total_paisa ?? 0} size={26} />
            <View style={styles.badgesLine}>
              <Pill tone="cash" mono>
                Δ = 0 ✓
              </Pill>
              <Pill mono>
                #{doneCommit.seq} {doneCommit.entry_hash.slice(0, 10)}…
              </Pill>
              {doneCommit.math_check ? (
                <Pill tone={doneCommit.math_check.passed ? "cash" : "amber"} mono>
                  {doneCommit.math_check.passed ? "MATH OK" : "MATH_MISMATCH reviewed"}
                </Pill>
              ) : null}
            </View>
            <View style={styles.journalBox}>
              {doneCommit.journal.map((entry, idx) => (
                <View key={idx} style={styles.journalRow}>
                  <Text style={styles.journalMono}>
                    {entry.side} {entry.account_code} {entry.account_name}
                  </Text>
                  <Text style={styles.journalMono}>{formatJournal(entry.amount_paisa)}</Text>
                </View>
              ))}
            </View>
          </Card>

          <View style={styles.commitActions}>
            <SecondaryButton
              onPress={() =>
                router.push(`/xray?txId=${encodeURIComponent(doneCommit.transaction_id)}`)
              }
              style={styles.flex1}
            >
              {"</>"} X-Ray
            </SecondaryButton>
            <PrimaryButton onPress={() => router.back()} style={styles.flex1}>
              {t("done")}
            </PrimaryButton>
          </View>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
    paddingBottom: spacing.xxl * 2,
  },
  flex1: {
    flex: 1,
    minWidth: 0,
  },
  stackGap: {
    gap: spacing.sm,
  },
  cameraCard: {
    borderRadius: radii.card,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderCard,
    overflow: "hidden",
  },
  cameraFrame: {
    height: 360,
    backgroundColor: "#000000",
    position: "relative",
  },
  camera: {
    ...StyleSheet.absoluteFill,
  },
  cameraOverlay: {
    ...StyleSheet.absoluteFill,
    padding: spacing.md,
    justifyContent: "space-between",
  },
  camTopBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  camHintChip: {
    backgroundColor: "rgba(10, 10, 10, 0.65)",
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  camHintText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 12,
    color: colors.surface,
  },
  torchBtn: {
    width: MIN_TARGET_DP,
    height: MIN_TARGET_DP,
    borderRadius: MIN_TARGET_DP / 2,
    backgroundColor: "rgba(10, 10, 10, 0.65)",
    alignItems: "center",
    justifyContent: "center",
  },
  torchBtnOn: {
    backgroundColor: colors.amberBg,
  },
  guideBox: {
    ...StyleSheet.absoluteFill,
    margin: 24,
  },
  corner: {
    position: "absolute",
    width: 24,
    height: 24,
    borderColor: "#34D399",
  },
  tl: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3 },
  tr: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3 },
  br: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3 },
  focusReticle: {
    position: "absolute",
    width: 44,
    height: 44,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "#34D399",
  },
  cameraFooter: {
    padding: spacing.md,
  },
  cardTitle: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 17,
    color: colors.ink,
  },
  cardSub: {
    marginTop: spacing.xs,
    fontFamily: fontFamilies.sans,
    fontSize: 13.5,
    lineHeight: 20,
    color: colors.ink2,
  },
  permBtn: {
    marginTop: spacing.md,
  },
  btnInner: {
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
  stagedBtn: {
    minHeight: MIN_TARGET_DP,
    borderRadius: radii.cta,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.maal,
    backgroundColor: colors.maalBg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  stagedBtnText: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 15,
    color: colors.maal,
  },
  parsingCard: {
    alignItems: "center",
    gap: spacing.md,
  },
  parsingImg: {
    width: "100%",
    height: 260,
    borderRadius: radii.chip,
    backgroundColor: colors.canvas,
  },
  parsingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  parsingText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 14,
    color: colors.ink2,
  },
  previewStrip: {
    backgroundColor: colors.surface,
  },
  previewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  thumbImg: {
    width: 56,
    height: 56,
    borderRadius: 10,
    backgroundColor: colors.canvas,
  },
  supplierTitle: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 16,
    color: colors.ink,
  },
  supplierSub: {
    marginTop: 2,
    fontFamily: fontFamilies.sans,
    fontSize: 12.5,
    color: colors.ink2,
  },
  lineRow: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  hairlineBottom: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderHairline,
  },
  lineWarnBg: {
    backgroundColor: "rgba(254, 243, 199, 0.5)",
  },
  lineTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  badgesLine: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
  },
  lineName: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 15.5,
    color: colors.ink,
  },
  lineSub: {
    marginTop: 2,
    fontFamily: fontFamilies.sans,
    fontSize: 13,
    fontVariant: ["tabular-nums"],
    color: colors.ink2,
  },
  asWritten: {
    marginTop: 3,
    fontFamily: fontFamilies.sans,
    fontSize: 11.5,
    color: colors.ink3,
  },
  mismatchBtns: {
    marginTop: spacing.sm,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  choiceChip: {
    minHeight: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    justifyContent: "center",
  },
  choiceChipActive: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },
  choiceChipText: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 13,
    color: colors.ink,
  },
  choiceChipTextActive: {
    color: colors.surface,
  },
  editorBox: {
    marginTop: spacing.sm,
    borderRadius: radii.chip,
    backgroundColor: colors.canvas,
    padding: spacing.md,
    gap: spacing.sm,
  },
  editorGrid: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  editorField: {
    flex: 1,
  },
  fieldLabel: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 11.5,
    color: colors.ink2,
    marginBottom: 3,
  },
  fieldInput: {
    minHeight: 42,
    borderRadius: 8,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm + 2,
    fontFamily: fontFamilies.sans,
    fontSize: 14,
    color: colors.ink,
  },
  lowConfInput: {
    borderWidth: 1,
    borderColor: colors.udhaar,
    backgroundColor: "#FFFBEB",
  },
  unitChips: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  unitChip: {
    minHeight: 38,
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  unitChipActive: {
    backgroundColor: colors.maal,
    borderColor: colors.maal,
  },
  unitChipText: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 13,
    color: colors.ink,
  },
  unitChipTextActive: {
    color: colors.surface,
  },
  editorActions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  smallActionBtn: {
    flex: 1,
    minHeight: 44,
  },
  totalsCard: {
    gap: spacing.md,
  },
  grandTotalRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flexWrap: "wrap",
  },
  cashRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  metaLabel: {
    fontFamily: fontFamilies.sans,
    fontSize: 13.5,
    color: colors.ink2,
  },
  inlineInput: {
    minHeight: 42,
    minWidth: 100,
    borderRadius: 8,
    backgroundColor: colors.canvas,
    paddingHorizontal: spacing.sm + 2,
    fontFamily: fontFamilies.sansBold,
    fontSize: 15,
    fontVariant: ["tabular-nums"],
    color: colors.ink,
  },
  apText: {
    marginLeft: "auto",
    fontFamily: fontFamilies.sansSemi,
    fontSize: 13,
    fontVariant: ["tabular-nums"],
    color: colors.ink2,
  },
  mismatchTotalBox: {
    gap: spacing.sm,
    borderRadius: 10,
    backgroundColor: colors.amberBg,
    padding: spacing.md,
  },
  mismatchTotalText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 13,
    color: colors.amberInk,
  },
  ackBtn: {
    minHeight: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(146, 64, 14, 0.35)",
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  ackBtnActive: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },
  ackBtnText: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 13,
    color: colors.amberInk,
  },
  ackBtnTextActive: {
    color: colors.surface,
  },
  commitSummary: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    paddingTop: spacing.xs,
  },
  commitActions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  cancelBtn: {
    width: 100,
  },
  journalBox: {
    marginTop: spacing.xs,
    borderRadius: radii.chip,
    backgroundColor: colors.canvas,
    padding: spacing.md,
    gap: 4,
  },
  journalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  journalMono: {
    fontFamily: fontFamilies.mono,
    fontSize: 11.5,
    color: colors.ink,
  },
  pressed: {
    opacity: 0.78,
  },
});
