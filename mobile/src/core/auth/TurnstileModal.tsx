import { useMemo } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { z } from "zod";
import { configStatus } from "@/core/config";
import { colors, radii, spacing } from "@/core/theme/tokens";

const WidgetMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("token"), token: z.string().min(1) }),
  z.object({ type: z.literal("expired") }),
  z.object({ type: z.literal("error") }),
]);

export interface TurnstileModalProps {
  visible: boolean;
  siteKey: string;
  onToken: (token: string) => void;
  onCancel: () => void;
}

export function TurnstileModal({ visible, siteKey, onToken, onCancel }: TurnstileModalProps) {
  const baseUrl = configStatus.config?.apiUrl ?? "https://dukaanos.vercel.app";
  const allowedOrigin = useMemo(() => {
    try {
      return new URL(baseUrl).origin;
    } catch {
      return "https://dukaanos.vercel.app";
    }
  }, [baseUrl]);

  const html = useMemo(() => {
    const safeKey = JSON.stringify(siteKey);
    return `<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1" />
    <script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer></script>
    <style>
      body { margin: 0; display: grid; place-items: center; min-height: 180px; background: #ffffff; font-family: system-ui, sans-serif; }
    </style>
  </head>
  <body>
    <div id="cf"></div>
    <script>
      function post(msg) {
        if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(msg));
      }
      function mount() {
        if (!window.turnstile) { setTimeout(mount, 120); return; }
        window.turnstile.render("#cf", {
          sitekey: ${safeKey},
          theme: "light",
          callback: function(token) { post({ type: "token", token: token }); },
          "expired-callback": function() { post({ type: "expired" }); },
          "error-callback": function() { post({ type: "error" }); }
        });
      }
      mount();
    </script>
  </body>
</html>`;
  }, [siteKey]);

  const handleMessage = (event: WebViewMessageEvent) => {
    try {
      const parsed = WidgetMessageSchema.safeParse(JSON.parse(event.nativeEvent.data));
      if (!parsed.success) return;
      if (parsed.data.type === "token") {
        onToken(parsed.data.token);
      } else if (parsed.data.type === "error") {
        onCancel();
      }
    } catch {
      // Ignore malformed messages from WebView.
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Human Verification</Text>
          <Text style={styles.subtitle}>Quick security check before creating your isolated demo shop.</Text>
          <View style={styles.webWrap}>
            <WebView
              source={{ html, baseUrl: allowedOrigin }}
              originWhitelist={[allowedOrigin, "https://challenges.cloudflare.com"]}
              javaScriptEnabled
              domStorageEnabled={false}
              allowFileAccess={false}
              allowUniversalAccessFromFileURLs={false}
              onMessage={handleMessage}
              onShouldStartLoadWithRequest={(req) => {
                return req.url.startsWith(allowedOrigin) || req.url.startsWith("https://challenges.cloudflare.com") || req.url === "about:blank";
              }}
              style={styles.webview}
            />
          </View>
          <Pressable onPress={onCancel} accessibilityRole="button" accessibilityLabel="Cancel verification" style={styles.cancelBtn}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(10, 10, 10, 0.45)",
    justifyContent: "center",
    padding: spacing.xl,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderCard,
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.ink,
  },
  subtitle: {
    marginTop: 4,
    fontSize: 13,
    color: colors.ink2,
  },
  webWrap: {
    height: 190,
    marginTop: spacing.md,
    borderRadius: radii.chip,
    overflow: "hidden",
    backgroundColor: colors.surface,
  },
  webview: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  cancelBtn: {
    marginTop: spacing.md,
    height: 48,
    borderRadius: radii.cta,
    backgroundColor: colors.surfaceSunken,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelText: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.ink,
  },
});
