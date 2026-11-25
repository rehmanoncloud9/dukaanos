import {
  AudioModule,
  AudioQuality,
  IOSOutputFormat,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingOptions,
} from "expo-audio";
import * as Haptics from "expo-haptics";
import { Mic, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, View } from "react-native";
import { deleteQueueFile } from "@/core/offline/db";
import { useT } from "@/core/i18n/I18nProvider";
import { fontFamilies } from "@/core/theme/fonts";
import { colors, ICON_STROKE, MIC_BUTTON_DP, radii, spacing } from "@/core/theme/tokens";

export const MIN_CLIP_MS = 600;
export const MAX_CLIP_MS = 20_000;
const CANCEL_DRAG_PX = -70;

const MUNSHI_RECORDING_OPTIONS: RecordingOptions = {
  extension: ".m4a",
  sampleRate: 16_000,
  numberOfChannels: 1,
  bitRate: 32_000,
  isMeteringEnabled: true,
  directory: "document",
  android: {
    extension: ".m4a",
    outputFormat: "mpeg4",
    audioEncoder: "aac",
    sampleRate: 16_000,
  },
  ios: {
    extension: ".m4a",
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.MEDIUM,
    sampleRate: 16_000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: "audio/webm",
    bitsPerSecond: 32_000,
  },
};

export function meterDbToBarHeights(meteringDb: number | undefined): number[] {
  const db = typeof meteringDb === "number" && Number.isFinite(meteringDb) ? meteringDb : -60;
  const level = Math.max(0, Math.min(1, (db + 55) / 50));
  const weights = [0.55, 0.85, 1.0, 0.82, 0.58];
  return weights.map((w) => Math.round(6 + level * w * 20));
}

export interface MicButtonProps {
  busy?: boolean;
  onClip: (uri: string, mime: string) => void;
  onDenied: (msg: string) => void;
}

export function MicButton({ busy = false, onClip, onDenied }: MicButtonProps) {
  const { t } = useT();
  const recorder = useAudioRecorder(MUNSHI_RECORDING_OPTIONS);
  const recState = useAudioRecorderState(recorder, 80);

  const [recording, setRecording] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [secs, setSecs] = useState(0);

  const activeRef = useRef(false);
  const cancellingRef = useRef(false);
  const startXRef = useRef(0);
  const startedAtRef = useRef(0);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const finishingRef = useRef(false);

  const clearTimers = useCallback(() => {
    if (autoStopRef.current) {
      clearTimeout(autoStopRef.current);
      autoStopRef.current = null;
    }
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const finishRecording = useCallback(
    async (cancel: boolean) => {
      if (!activeRef.current || finishingRef.current) return;
      finishingRef.current = true;
      activeRef.current = false;
      clearTimers();
      setRecording(false);
      setCancelling(false);
      cancellingRef.current = false;

      const elapsedMs = Date.now() - startedAtRef.current;
      try {
        await recorder.stop();
      } catch {
        // Recorder may already have stopped at max duration.
      }
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        interruptionMode: "mixWithOthers",
      }).catch(() => undefined);

      const uri = recorder.uri;
      finishingRef.current = false;

      if (cancel) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        deleteQueueFile(uri);
        return;
      }

      if (elapsedMs < MIN_CLIP_MS || !uri) {
        deleteQueueFile(uri);
        onDenied("Mic dabaa kar rakhein aur bolein (hold to talk)");
        return;
      }

      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onClip(uri, "audio/mp4");
    },
    [clearTimers, onClip, onDenied, recorder],
  );

  const requestPermissionWithRationale = useCallback(async (): Promise<boolean> => {
    const existing = await AudioModule.getRecordingPermissionsAsync();
    if (existing.granted) return true;
    if (!existing.canAskAgain) return false;

    const proceed = await new Promise<boolean>((resolve) => {
      Alert.alert(
        t("micPermissionTitle"),
        "DukaanOS needs microphone access to transcribe Urdu/Punjabi/English sales. Audio is never saved on the server.\n\nمائیک سے آواز سن کر حساب لکھنے کے لیے اجازت دیں۔",
        [
          { text: t("cancel"), style: "cancel", onPress: () => resolve(false) },
          { text: "Allow / اجازت دیں", onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      );
    });
    if (!proceed) return false;
    const requested = await AudioModule.requestRecordingPermissionsAsync();
    return requested.granted;
  }, [t]);

  const startRecording = useCallback(async () => {
    if (busy || activeRef.current || finishingRef.current) return;
    try {
      const granted = await requestPermissionWithRationale();
      if (!granted) {
        onDenied(t("micPermissionDenied"));
        return;
      }

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        interruptionMode: "doNotMix",
        shouldPlayInBackground: false,
        shouldRouteThroughEarpiece: false,
      });
      await recorder.prepareToRecordAsync();
      activeRef.current = true;
      cancellingRef.current = false;
      startedAtRef.current = Date.now();
      setRecording(true);
      setCancelling(false);
      setSecs(0);
      recorder.record({ forDuration: MAX_CLIP_MS / 1000 });
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      tickRef.current = setInterval(() => {
        setSecs((s) => s + 1);
      }, 1000);
      autoStopRef.current = setTimeout(() => {
        void finishRecording(false);
      }, MAX_CLIP_MS);
    } catch {
      activeRef.current = false;
      setRecording(false);
      clearTimers();
      onDenied(t("micPermissionDenied"));
    }
  }, [busy, clearTimers, finishRecording, onDenied, recorder, requestPermissionWithRationale, t]);

  const barHeights = useMemo(
    () => (recording ? meterDbToBarHeights(recState.metering) : [6, 6, 6, 6, 6]),
    [recording, recState.metering],
  );

  return (
    <View style={styles.wrap}>
      {recording ? (
        <View style={styles.pill} accessibilityLiveRegion="polite">
          <Text style={styles.pillText}>
            {cancelling
              ? t("releaseToCancel")
              : `0:${String(secs).padStart(2, "0")} · ${t("slideToCancel")}`}
          </Text>
        </View>
      ) : null}

      <View
        accessible
        accessibilityRole="button"
        accessibilityLabel={recording ? "Recording voice — release to send" : t("holdToTalk")}
        accessibilityState={{ busy }}
        onStartShouldSetResponder={() => !busy}
        onMoveShouldSetResponder={() => !busy}
        onResponderGrant={(e) => {
          startXRef.current = e.nativeEvent.pageX;
          void startRecording();
        }}
        onResponderMove={(e) => {
          if (!activeRef.current) return;
          const shouldCancel = e.nativeEvent.pageX - startXRef.current < CANCEL_DRAG_PX;
          if (shouldCancel !== cancellingRef.current) {
            cancellingRef.current = shouldCancel;
            setCancelling(shouldCancel);
            if (shouldCancel) void Haptics.selectionAsync();
          }
        }}
        onResponderRelease={() => {
          if (activeRef.current) {
            void finishRecording(cancellingRef.current);
          }
        }}
        onResponderTerminate={() => {
          if (activeRef.current) {
            void finishRecording(true);
          }
        }}
        style={[
          styles.circle,
          recording ? (cancelling ? styles.cancellingCircle : styles.recordingCircle) : styles.idleCircle,
        ]}
      >
        {busy ? (
          <ActivityIndicator size="small" color={colors.surface} />
        ) : recording ? (
          cancelling ? (
            <X size={26} color={colors.surface} strokeWidth={ICON_STROKE} />
          ) : (
            <View style={styles.barsRow}>
              {barHeights.map((h, i) => (
                <View key={i} style={[styles.bar, { height: h }]} />
              ))}
            </View>
          )
        ) : (
          <Mic size={24} color={colors.surface} strokeWidth={ICON_STROKE} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
  },
  pill: {
    position: "absolute",
    bottom: MIC_BUTTON_DP + 10,
    backgroundColor: colors.ink,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    minWidth: 180,
    alignItems: "center",
  },
  pillText: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 12,
    color: colors.surface,
    fontVariant: ["tabular-nums"],
  },
  circle: {
    width: MIC_BUTTON_DP,
    height: MIC_BUTTON_DP,
    borderRadius: MIC_BUTTON_DP / 2,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000000",
    shadowOpacity: 0.24,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 14,
    elevation: 6,
  },
  idleCircle: {
    backgroundColor: colors.ink,
  },
  recordingCircle: {
    backgroundColor: colors.cash,
  },
  cancellingCircle: {
    backgroundColor: colors.udhaar,
  },
  barsRow: {
    height: 26,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  bar: {
    width: 3,
    borderRadius: 99,
    backgroundColor: colors.surface,
  },
});
