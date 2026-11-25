import { Component, type ErrorInfo, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { fontFamilies } from "@/core/theme/fonts";
import { colors, radii, spacing } from "@/core/theme/tokens";
import { PrimaryButton } from "@/core/ui/Buttons";
import { secureLog } from "./secureLog";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    secureLog("ui_error_boundary", {
      name: error.name,
      componentStackLength: info.componentStack?.length ?? 0,
    });
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <View style={styles.root}>
        <View style={styles.card}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.body}>Your saved ledger and offline queue remain safe. Tap below to reload.</Text>
          <PrimaryButton onPress={() => this.setState({ hasError: false })} style={styles.btn}>
            Reload screen
          </PrimaryButton>
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.canvas,
    justifyContent: "center",
    padding: spacing.xl,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.borderCard,
    padding: spacing.xl,
  },
  title: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 20,
    color: colors.ink,
  },
  body: {
    marginTop: spacing.sm,
    fontFamily: fontFamilies.sans,
    fontSize: 14,
    lineHeight: 20,
    color: colors.ink2,
  },
  btn: {
    marginTop: spacing.lg,
  },
});
