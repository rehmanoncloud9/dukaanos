import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { useRouter } from "expo-router";
import { MessageSquare, Play, RotateCcw, Square, Volume2 } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { formatBaseQty } from "@domain/desi-units";
import { reminderText, smsLink, waLink, wholesaleListText } from "@domain/messages";
import { formatRs, rupeesToPaisa } from "@domain/money";
import type { CommitResponse, FeedTx, PaymentProposal, Pulse, SaleProposal, TurnTrace } from "@/core/api/types";
import { friendlyApiError, newIdempotencyKey } from "@/core/api/client";
import { useT } from "@/core/i18n/I18nProvider";
import { listReplayClips, type ReplayClipRow } from "@/core/offline/db";
import { useShop, useShopState } from "@/core/state/ShopProvider";
import { fontFamilies } from "@/core/theme/fonts";
import { colors, ICON_STROKE, MIN_TARGET_DP, radii, spacing } from "@/core/theme/tokens";
import { Card, EmptyState, Money, Pill, PrimaryButton, relTime, SecondaryButton, Sheet, useToast } from "@/core/ui";
import { ReceiptSheet } from "@/features/receipt/ReceiptSheet";
import { feedSummary } from "./MunshiHome";
import { useMunshi } from "./MunshiProvider";
import { speakUrdu, stopTtsPlayback } from "./tts";

async function openPreferredWhatsApp(phone: string | null | undefined, message: string, onFail: () => void) {
  const digits = (phone ?? "").replace(/[^\d]/g, "");
  const cleanPhone = digits.startsWith("03") && digits.length === 11 ? `92${digits.slice(1)}` : digits;
  const nativeUrl = cleanPhone
    ? `whatsapp://send?phone=${cleanPhone}&text=${encodeURIComponent(message)}`
    : `whatsapp://send?text=${encodeURIComponent(message)}`;
  const fallback = waLink(phone, message);
  try {
    const canNative = await Linking.canOpenURL(nativeUrl);
    await Linking.openURL(canNative ? nativeUrl : fallback);
  } catch {
    await Linking.openURL(fallback).catch(onFail);
  }
}

export function pulseSpeech(p: Pulse): string {
  return [
    `Aaj galla mein ${formatRs(p.galla.cash_in_galla_paisa)} hain.`,
    `${p.galla.sales_count} sales, udhaar ${formatRs(p.galla.udhaar_paisa)}.`,
    p.overdue.count
      ? `${p.overdue.count} customers ka ${formatRs(p.overdue.total_paisa)} pandrah din se zyada ruka hua hai.`
      : "Koi purana udhaar nahi.",
    p.stockout.count
      ? `${p.stockout.items.map((s) => s.name.replace(/\s*\(.*\)/, "")).join(" aur ")} do din mein khatam ho sakte hain.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function PaymentModal({
  proposal,
  idemKey,
  trace,
  onSaved,
  onClose,
}: {
  proposal: PaymentProposal;
  idemKey: string;
  trace: TurnTrace | null;
  onSaved: (res: CommitResponse, phone: string | null) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const { data: state } = useShopState();
  const { confirmPayment } = useMunshi();
  const customers = useMemo(() => state?.customers ?? [], [state?.customers]);

  const [selected, setSelected] = useState<string | null>(proposal.customer.selected_id ?? null);
  const cust = customers.find((c) => c.id === selected) ?? null;

  const [amount, setAmount] = useState<string>(() => {
    if (proposal.amount_paisa > 0) return String(Math.round(proposal.amount_paisa / 100));
    const initialCust = customers.find((c) => c.id === proposal.customer.selected_id);
    return initialCust && initialCust.balance_paisa > 0 ? String(Math.round(initialCust.balance_paisa / 100)) : "";
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const numericRs = parseInt(amount || "0", 10);
  const amt = Number.isFinite(numericRs) && numericRs > 0 && numericRs <= 10_000_000 ? rupeesToPaisa(numericRs) : 0;

  const chips = useMemo(() => {
    if (proposal.customer.candidates.length > 0) {
      const fromCandidates = proposal.customer.candidates
        .map((c) => customers.find((x) => x.id === c.id))
        .filter((x): x is NonNullable<typeof x> => Boolean(x));
      if (fromCandidates.length > 0) return fromCandidates;
    }
    return customers.filter((c) => c.balance_paisa > 0 || c.id === selected);
  }, [customers, proposal.customer.candidates, selected]);

  const quickAmounts = useMemo(() => {
    if (!cust || cust.balance_paisa <= 0) return [];
    return [cust.balance_paisa, 50_000, 100_000].filter((v, i, a) => a.indexOf(v) === i && v > 0);
  }, [cust]);

  const save = async () => {
    if (!selected || amt <= 0) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await confirmPayment(selected, amt, idemKey, trace);
      onSaved(res, cust?.phone ?? null);
    } catch (e) {
      setErr(friendlyApiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open onClose={onClose} title={`${t("wasooli")} · Payment`}>
      <View style={styles.sheetBody}>
        {trace?.transcript ? (
          <View style={styles.transcriptBox}>
            <Text style={styles.transcriptText}>“{trace.transcript}”</Text>
          </View>
        ) : null}

        <Text style={styles.sectionLabel}>CUSTOMER</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {chips.map((c) => {
            const active = selected === c.id;
            return (
              <Pressable
                key={c.id}
                onPress={() => {
                  setSelected(c.id);
                  setErr(null);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[styles.customerChip, active && styles.customerChipActive]}
              >
                <Text style={[styles.customerChipName, active && styles.customerChipNameActive]}>{c.name}</Text>
                <Text style={[styles.customerChipBal, active && styles.customerChipBalActive]}>
                  Khata {formatRs(c.balance_paisa)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.amountCard}>
          <Text style={styles.sectionLabel}>AMOUNT RECEIVED</Text>
          <View style={styles.amountInputRow}>
            <Text style={styles.rsPrefix}>Rs.</Text>
            <TextInput
              value={amount}
              onChangeText={(v) => {
                setAmount(v.replace(/[^\d]/g, ""));
                setErr(null);
              }}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor={colors.ink3}
              autoFocus
              style={styles.amountInput}
            />
          </View>
          {cust ? (
            <Text style={styles.balPreview}>
              {formatRs(cust.balance_paisa)} → New bal:{" "}
              <Text style={styles.balPreviewStrong}>{formatRs(cust.balance_paisa - amt)}</Text>
            </Text>
          ) : null}
          {quickAmounts.length > 0 ? (
            <View style={styles.quickAmtRow}>
              {quickAmounts.map((v) => (
                <Pressable
                  key={v}
                  onPress={() => setAmount(String(Math.round(v / 100)))}
                  accessibilityRole="button"
                  style={styles.quickAmtChip}
                >
                  <Text style={styles.quickAmtText}>
                    {v === cust?.balance_paisa ? "Full " : ""}
                    {formatRs(v)}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>

        {err ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{err}</Text>
          </View>
        ) : null}

        <View style={styles.footerActions}>
          <SecondaryButton onPress={onClose} style={styles.cancelBtn}>
            {t("cancel")}
          </SecondaryButton>
          <PrimaryButton
            tone="cash"
            busy={busy}
            disabled={!selected || amt <= 0}
            onPress={() => void save()}
            style={styles.confirmBtn}
          >
            {t("confirmWasooli")}
          </PrimaryButton>
        </View>
      </View>
    </Sheet>
  );
}

function ReversalModal({ target, onClose }: { target: FeedTx | null; onClose: () => void }) {
  const { t } = useT();
  const { toast } = useToast();
  const { reverse } = useMunshi();
  const [busy, setBusy] = useState(false);

  const handleReverse = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await reverse(target.id, "voice-wapas");
      toast("Entry reversed — Δ = 0, chain extended", "ok");
      onClose();
    } catch (err) {
      toast(friendlyApiError(err), "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open onClose={onClose} title="Pichli entry wapas?">
      <View style={styles.sheetBody}>
        {target ? (
          <Card>
            <Text style={styles.targetTitle}>
              {target.customer_name ?? target.supplier_name ?? "Walk-in Cash"}
            </Text>
            <Text style={styles.targetSub}>{feedSummary(target)}</Text>
            <View style={styles.targetAmountWrap}>
              <Money paisa={target.total_paisa} size={22} />
            </View>
            <Text style={styles.targetMeta}>
              #{target.seq} · {target.entry_hash.slice(0, 12)}…
            </Text>
          </Card>
        ) : (
          <Text style={styles.mutedBody}>Wapas karne ke liye koi entry nahi.</Text>
        )}

        <Text style={styles.reversalExplain}>
          reverse_transaction mirrors every ledger row and stock movement and appends a new SHA-256 link — history is
          never deleted.
        </Text>

        <View style={styles.footerActions}>
          <SecondaryButton onPress={onClose} style={styles.cancelBtn}>
            {t("cancel")}
          </SecondaryButton>
          <PrimaryButton
            busy={busy}
            disabled={!target}
            onPress={() => void handleReverse()}
            style={styles.confirmBtn}
          >
            Undo entry
          </PrimaryButton>
        </View>
      </View>
    </Sheet>
  );
}

function PulseModal({ pulse, onClose }: { pulse: Pulse; onClose: () => void }) {
  const { toast } = useToast();
  const { shopId } = useShop();
  const { data: state } = useShopState();
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => () => stopTtsPlayback(), []);

  const shop = state?.shop.name ?? "DukaanOS";
  const wholesaleMsg = wholesaleListText(
    shop,
    pulse.stockout.items.map((s) => ({
      name: s.name,
      suggested_base_units: s.suggested_base_units,
      base_unit: s.base_unit,
      pack_size_base_units: s.pack_size_base_units,
      pack_label: s.pack_size_base_units === 5000 ? "tin" : undefined,
    })),
  );

  const readAloud = async () => {
    setSpeaking(true);
    try {
      const mode = await speakUrdu(pulseSpeech(pulse), shopId ?? undefined);
      if (mode === "text-only") toast("Text-only summary shown (audio unavailable)", "info");
    } finally {
      setSpeaking(false);
    }
  };

  return (
    <Sheet
      open
      onClose={() => {
        stopTtsPlayback();
        onClose();
      }}
      title="Munshi Pulse"
      right={
        <Pill tone="cash" mono>
          SQL {pulse.sql_ms}ms · Rs. 0 LLM
        </Pill>
      }
    >
      <View style={styles.sheetBody}>
        <Card>
          <Text style={styles.sectionLabel}>CASH IN GALLA · TODAY</Text>
          <Money paisa={pulse.galla.cash_in_galla_paisa} size={30} style={styles.gallaHero} />
          <View style={styles.gallaGrid}>
            <View style={styles.gallaCell}>
              <Text style={styles.gallaCellLabel}>Sales</Text>
              <Text style={styles.gallaCellVal}>{formatRs(pulse.galla.cash_sales_paisa)}</Text>
            </View>
            <View style={styles.gallaCell}>
              <Text style={styles.gallaCellLabel}>Udhaar</Text>
              <Text style={[styles.gallaCellVal, { color: colors.udhaar }]}>{formatRs(pulse.galla.udhaar_paisa)}</Text>
            </View>
            <View style={styles.gallaCell}>
              <Text style={styles.gallaCellLabel}>Est. margin</Text>
              <Text style={[styles.gallaCellVal, { color: colors.cash }]}>{formatRs(pulse.galla.est_margin_paisa)}</Text>
            </View>
          </View>
        </Card>

        <Card padded={false}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardHeading}>Overdue udhaar (15+ days)</Text>
            <Pill tone="udhaar">{formatRs(pulse.overdue.total_paisa)}</Pill>
          </View>
          {pulse.overdue.items.length === 0 ? (
            <Text style={styles.allClearText}>Sab saaf hai ✓</Text>
          ) : (
            pulse.overdue.items.map((o) => {
              const msg = reminderText({
                name: o.name,
                shop,
                balance_paisa: o.balance_paisa,
                days_overdue: o.days_overdue,
              });
              return (
                <View key={o.id} style={styles.listRow}>
                  <View style={styles.listLeft}>
                    <Text style={styles.listTitle}>{o.name}</Text>
                    <Text style={styles.listSub}>
                      {o.days_overdue}d overdue · {formatRs(o.balance_paisa)}
                    </Text>
                  </View>
                  <View style={styles.actionPillRow}>
                    <Pressable
                      onPress={() => void openPreferredWhatsApp(o.phone, msg, () => toast("Could not open WhatsApp", "err"))}
                      accessibilityRole="button"
                      style={[styles.miniBtn, { backgroundColor: colors.cashBg }]}
                    >
                      <MessageSquare size={14} color={colors.cashInk} strokeWidth={ICON_STROKE} />
                      <Text style={[styles.miniBtnText, { color: colors.cashInk }]}>Remind</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => void Linking.openURL(smsLink(o.phone, msg)).catch(() => toast("Could not open SMS", "err"))}
                      accessibilityRole="button"
                      style={styles.miniBtn}
                    >
                      <Text style={styles.miniBtnText}>SMS</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })
          )}
        </Card>

        <Card padded={false}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardHeading}>2-day stockout velocity</Text>
            <Pill tone="maal">{pulse.stockout.count} items</Pill>
          </View>
          {pulse.stockout.items.map((s) => (
            <View key={s.id} style={styles.listRow}>
              <View style={styles.listLeft}>
                <Text style={styles.listTitle}>{s.name}</Text>
                <Text style={styles.listSub}>
                  {formatBaseQty(s.stock_base_units, s.base_unit)} left · ~
                  {formatBaseQty(Math.round(s.daily_avg), s.base_unit)}/day
                </Text>
              </View>
              <Text style={styles.daysLeftText}>{s.days_left}d</Text>
            </View>
          ))}
          {pulse.stockout.items.length > 0 ? (
            <View style={styles.cardFooterPad}>
              <PrimaryButton
                tone="maal"
                onPress={() => void openPreferredWhatsApp(null, wholesaleMsg, () => toast("Could not open WhatsApp", "err"))}
              >
                <View style={styles.btnContentRow}>
                  <MessageSquare size={16} color={colors.surface} strokeWidth={ICON_STROKE} />
                  <Text style={styles.whiteBtnText}>Wholesale WhatsApp List</Text>
                </View>
              </PrimaryButton>
            </View>
          ) : null}
        </Card>

        <SecondaryButton busy={speaking} onPress={() => void readAloud()}>
          <View style={styles.btnContentRow}>
            <Volume2 size={16} color={colors.ink} strokeWidth={ICON_STROKE} />
            <Text style={styles.secBtnText}>Suniye (Urdu readout)</Text>
          </View>
        </SecondaryButton>
      </View>
    </Sheet>
  );
}

function AnswerModal({
  answer,
  proposal,
  tools,
  trace,
  onClose,
}: {
  answer: string;
  proposal: SaleProposal | PaymentProposal | null;
  tools: { name: string; ms: number }[];
  trace: TurnTrace;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const { shopId } = useShop();
  const { openReviewForProposal, openPaymentForProposal } = useMunshi();
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => () => stopTtsPlayback(), []);

  const readAloud = async () => {
    setSpeaking(true);
    try {
      const mode = await speakUrdu(answer, shopId ?? undefined);
      if (mode === "text-only") toast("Text answer displayed (audio offline/unavailable)", "info");
    } finally {
      setSpeaking(false);
    }
  };

  return (
    <Sheet
      open
      onClose={() => {
        stopTtsPlayback();
        onClose();
      }}
      title="Munshi ka jawab"
    >
      <View style={styles.sheetBody}>
        <View style={styles.transcriptBox}>
          <Text style={styles.transcriptMuted}>“{trace.transcript}”</Text>
        </View>
        <Text style={styles.answerText} selectable>
          {answer || "—"}
        </Text>
        <View style={styles.pillsRow}>
          {trace.model ? <Pill mono>{trace.model}</Pill> : null}
          {tools.map((tl, idx) => (
            <Pill key={idx} tone="maal" mono>
              {tl.name} {tl.ms}ms
            </Pill>
          ))}
        </View>
        <View style={styles.footerActions}>
          <SecondaryButton busy={speaking} onPress={() => void readAloud()} style={proposal ? styles.speakHalfBtn : styles.confirmBtn}>
            <View style={styles.btnContentRow}>
              <Volume2 size={16} color={colors.ink} strokeWidth={ICON_STROKE} />
              <Text style={styles.secBtnText}>Suniye</Text>
            </View>
          </SecondaryButton>
          {proposal ? (
            <PrimaryButton
              style={styles.confirmBtn}
              onPress={() => {
                const agentKey = newIdempotencyKey("agent");
                if (proposal.kind === "sale") {
                  onClose();
                  openReviewForProposal(proposal, agentKey, trace);
                } else {
                  openPaymentForProposal(proposal, agentKey, trace);
                }
              }}
            >
              Review proposal
            </PrimaryButton>
          ) : null}
        </View>
      </View>
    </Sheet>
  );
}

function ReplaysModal({ onClose }: { onClose: () => void }) {
  const { submitTurn } = useMunshi();
  const { toast } = useToast();
  const [clips] = useState<ReplayClipRow[]>(() => listReplayClips());
  const [playingId, setPlayingId] = useState<string | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);

  const stopPlayer = () => {
    try {
      playerRef.current?.pause();
      playerRef.current?.remove();
    } catch {
      // Ignore audio teardown failures.
    }
    playerRef.current = null;
    setPlayingId(null);
  };

  useEffect(() => () => stopPlayer(), []);

  const togglePlay = async (clip: ReplayClipRow) => {
    if (playingId === clip.id) {
      stopPlayer();
      return;
    }
    stopPlayer();
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
      toast("Audio file unavailable on device", "warn");
      setPlayingId(null);
    }
  };

  return (
    <Sheet
      open
      onClose={() => {
        stopPlayer();
        onClose();
      }}
      title="Recent Voice Replays"
    >
      <View style={styles.sheetBody}>
        {clips.length === 0 ? (
          <EmptyState
            title="No saved voice clips yet"
            subtitle="Hold the mic button on Munshi to record an Urdu sale or payment."
          />
        ) : (
          clips.map((clip) => {
            const isPlaying = playingId === clip.id;
            return (
              <Card key={clip.id}>
                <Text style={styles.clipTranscript}>“{clip.transcript}”</Text>
                <Text style={styles.clipMeta}>{relTime(new Date(clip.created_at).toISOString())}</Text>
                <View style={styles.clipActions}>
                  <SecondaryButton onPress={() => void togglePlay(clip)} style={styles.halfAction}>
                    <View style={styles.btnContentRow}>
                      {isPlaying ? (
                        <Square size={14} color={colors.ink} strokeWidth={ICON_STROKE} />
                      ) : (
                        <Play size={14} color={colors.ink} strokeWidth={ICON_STROKE} />
                      )}
                      <Text style={styles.secBtnText}>{isPlaying ? "Stop" : "Listen"}</Text>
                    </View>
                  </SecondaryButton>
                  <PrimaryButton
                    onPress={() => {
                      stopPlayer();
                      onClose();
                      void submitTurn({ audioUri: clip.file_uri, mimeType: clip.mime, text: clip.transcript });
                    }}
                    style={styles.halfAction}
                  >
                    <View style={styles.btnContentRow}>
                      <RotateCcw size={14} color={colors.surface} strokeWidth={ICON_STROKE} />
                      <Text style={styles.whiteBtnText}>Replay</Text>
                    </View>
                  </PrimaryButton>
                </View>
              </Card>
            );
          })
        )}
      </View>
    </Sheet>
  );
}

export function MunshiSheets() {
  const router = useRouter();
  const { modal, closeModal } = useMunshi();
  const [paymentReceipt, setPaymentReceipt] = useState<{ commit: CommitResponse; customerPhone: string | null } | null>(null);

  const openXRay = (txId: string) => {
    setPaymentReceipt(null);
    closeModal();
    router.push(`/xray?txId=${encodeURIComponent(txId)}`);
  };

  return (
    <>
      {modal?.type === "payment" ? (
        <PaymentModal
          proposal={modal.proposal}
          idemKey={modal.key}
          trace={modal.trace}
          onClose={closeModal}
          onSaved={(commit, customerPhone) => {
            closeModal();
            setPaymentReceipt({ commit, customerPhone });
          }}
        />
      ) : null}

      {modal?.type === "reversal" ? <ReversalModal target={modal.target} onClose={closeModal} /> : null}

      {modal?.type === "pulse" ? <PulseModal pulse={modal.pulse} onClose={closeModal} /> : null}

      {modal?.type === "answer" ? (
        <AnswerModal
          answer={modal.answer}
          proposal={modal.proposal}
          tools={modal.tools}
          trace={modal.trace}
          onClose={closeModal}
        />
      ) : null}

      {modal?.type === "replays" ? <ReplaysModal onClose={closeModal} /> : null}

      {modal?.type === "receipt" ? (
        <ReceiptSheet
          open
          commit={modal.commit}
          proposal={modal.proposal}
          customerPhone={modal.customerPhone}
          onOpenXRay={openXRay}
          onClose={closeModal}
        />
      ) : paymentReceipt ? (
        <ReceiptSheet
          open
          commit={paymentReceipt.commit}
          proposal={null}
          customerPhone={paymentReceipt.customerPhone}
          onOpenXRay={openXRay}
          onClose={() => setPaymentReceipt(null)}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  sheetBody: {
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
    paddingBottom: spacing.lg,
  },
  sectionLabel: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 11,
    letterSpacing: 0.65,
    color: colors.ink3,
  },
  transcriptBox: {
    backgroundColor: colors.canvas,
    borderRadius: radii.chip,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.sm + 2,
  },
  transcriptText: {
    fontFamily: fontFamilies.sans,
    fontSize: 15,
    lineHeight: 22,
    color: colors.ink,
  },
  transcriptMuted: {
    fontFamily: fontFamilies.sans,
    fontSize: 14,
    lineHeight: 20,
    color: colors.ink2,
  },
  chipRow: {
    gap: spacing.sm,
    paddingVertical: 2,
  },
  customerChip: {
    minHeight: MIN_TARGET_DP,
    borderRadius: radii.chip,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.xs + 2,
    justifyContent: "center",
  },
  customerChipActive: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },
  customerChipName: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 15,
    color: colors.ink,
  },
  customerChipNameActive: {
    color: colors.surface,
  },
  customerChipBal: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    color: colors.ink2,
  },
  customerChipBalActive: {
    color: "rgba(255,255,255,0.72)",
  },
  amountCard: {
    backgroundColor: colors.canvas,
    borderRadius: radii.card,
    padding: spacing.lg,
  },
  amountInputRow: {
    marginTop: spacing.xs,
    flexDirection: "row",
    alignItems: "baseline",
  },
  rsPrefix: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 28,
    color: colors.cash,
    marginRight: spacing.xs,
  },
  amountInput: {
    flex: 1,
    fontFamily: fontFamilies.sansBold,
    fontSize: 34,
    lineHeight: 40,
    color: colors.cash,
    padding: 0,
  },
  balPreview: {
    marginTop: spacing.xs,
    fontFamily: fontFamilies.sans,
    fontSize: 13,
    color: colors.ink2,
    fontVariant: ["tabular-nums"],
  },
  balPreviewStrong: {
    fontFamily: fontFamilies.sansBold,
    color: colors.ink,
  },
  quickAmtRow: {
    marginTop: spacing.md,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  quickAmtChip: {
    minHeight: 40,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    justifyContent: "center",
  },
  quickAmtText: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 13,
    color: colors.ink,
  },
  errorBanner: {
    borderRadius: radii.chip,
    backgroundColor: colors.udhaarBg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  errorText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 14,
    color: colors.udhaarInk,
  },
  footerActions: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  cancelBtn: {
    width: 100,
  },
  confirmBtn: {
    flex: 1,
  },
  speakHalfBtn: {
    paddingHorizontal: spacing.lg,
  },
  targetTitle: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 15,
    color: colors.ink,
  },
  targetSub: {
    marginTop: 2,
    fontFamily: fontFamilies.sans,
    fontSize: 13,
    color: colors.ink2,
  },
  targetAmountWrap: {
    marginTop: spacing.sm,
  },
  targetMeta: {
    marginTop: spacing.xs,
    fontFamily: fontFamilies.mono,
    fontSize: 11,
    color: colors.ink2,
  },
  mutedBody: {
    fontFamily: fontFamilies.sans,
    fontSize: 15,
    color: colors.ink2,
  },
  reversalExplain: {
    fontFamily: fontFamilies.sans,
    fontSize: 13,
    lineHeight: 19,
    color: colors.ink2,
  },
  gallaHero: {
    marginTop: spacing.xs,
  },
  gallaGrid: {
    marginTop: spacing.md,
    flexDirection: "row",
    gap: spacing.sm,
  },
  gallaCell: {
    flex: 1,
  },
  gallaCellLabel: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    color: colors.ink2,
  },
  gallaCellVal: {
    marginTop: 2,
    fontFamily: fontFamilies.sansBold,
    fontSize: 14.5,
    color: colors.ink,
    fontVariant: ["tabular-nums"],
  },
  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md + 2,
    paddingBottom: spacing.sm,
  },
  cardHeading: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 15,
    color: colors.ink,
  },
  allClearText: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md + 2,
    fontFamily: fontFamilies.sans,
    fontSize: 13.5,
    color: colors.ink2,
  },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderTopWidth: 1,
    borderTopColor: colors.borderHairline,
  },
  listLeft: {
    flex: 1,
    minWidth: 0,
  },
  listTitle: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 15,
    color: colors.ink,
  },
  listSub: {
    marginTop: 2,
    fontFamily: fontFamilies.sans,
    fontSize: 12.5,
    color: colors.ink2,
  },
  actionPillRow: {
    flexDirection: "row",
    gap: spacing.xs + 2,
  },
  miniBtn: {
    minHeight: 40,
    minWidth: 52,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceSunken,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  miniBtnText: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 13,
    color: colors.ink,
  },
  daysLeftText: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 15,
    color: colors.udhaar,
    fontVariant: ["tabular-nums"],
  },
  cardFooterPad: {
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderHairline,
  },
  btnContentRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  whiteBtnText: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 15,
    color: colors.surface,
  },
  secBtnText: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 15,
    color: colors.ink,
  },
  answerText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 18,
    lineHeight: 28,
    color: colors.ink,
  },
  pillsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs + 2,
  },
  clipTranscript: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 15,
    lineHeight: 22,
    color: colors.ink,
  },
  clipMeta: {
    marginTop: 4,
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    color: colors.ink3,
  },
  clipActions: {
    marginTop: spacing.md,
    flexDirection: "row",
    gap: spacing.sm,
  },
  halfAction: {
    flex: 1,
  },
});
