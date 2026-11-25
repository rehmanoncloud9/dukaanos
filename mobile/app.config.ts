import type { ConfigContext, ExpoConfig } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL?.trim();
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const ed25519Key = process.env.EXPO_PUBLIC_ED25519_PUBLIC_KEY?.trim();

  if (process.env.EAS_BUILD === "true") {
    const missing = [
      !apiUrl?.startsWith("https://") && "EXPO_PUBLIC_API_URL (https://)",
      !supabaseUrl?.startsWith("https://") && "EXPO_PUBLIC_SUPABASE_URL",
      !supabaseAnonKey && "EXPO_PUBLIC_SUPABASE_ANON_KEY",
      (!ed25519Key || !/^[0-9a-fA-F]{64}$/.test(ed25519Key)) && "EXPO_PUBLIC_ED25519_PUBLIC_KEY (64-char hex)",
    ].filter(Boolean);
    if (missing.length > 0) {
      throw new Error(`EAS build aborted — missing or invalid public env vars: ${missing.join(", ")}`);
    }
  }

  let apiHost: string | undefined;
  try {
    if (apiUrl) {
      const parsed = new URL(apiUrl);
      if (parsed.protocol === "https:") apiHost = parsed.hostname;
    }
  } catch {
    apiHost = undefined;
  }

  return {
    ...config,
    name: "DukaanOS",
    slug: "dukaanos",
    version: "1.0.0",
    orientation: "portrait",
    scheme: "dukaanos",
    userInterfaceStyle: "light",
    icon: "./assets/images/icon.png",
    runtimeVersion: {
      policy: "appVersion",
    },
    updates: {
      enabled: true,
      checkAutomatically: "ON_LOAD",
      fallbackToCacheTimeout: 0,
    },
    ios: {
      bundleIdentifier: "pk.dukaanos.app",
      supportsTablet: false,
      icon: "./assets/expo.icon",
      infoPlist: {
        NSMicrophoneUsageDescription:
          "DukaanOS records short Urdu/Punjabi/English counter clips to draft sales and khata entries. / منشی آپ کی آواز سے حساب لکھنے کے لیے مائیک استعمال کرتا ہے۔",
        NSCameraUsageDescription:
          "DukaanOS captures wholesale parchi bills to extract restock items for your review. / پرچی اسکین کر کے مال شامل کرنے کے لیے کیمرہ استعمال ہوتا ہے۔",
        NSFaceIDUsageDescription:
          "Use Face ID or device passcode to lock your DukaanOS shop ledger. / دکان کا کھاتہ محفوظ رکھنے کے لیے لاک استعمال کریں۔",
      },
    },
    android: {
      package: "pk.dukaanos.app",
      allowBackup: false,
      predictiveBackGestureEnabled: false,
      adaptiveIcon: {
        backgroundColor: "#F2F2F7",
        foregroundImage: "./assets/images/android-icon-foreground.png",
        backgroundImage: "./assets/images/android-icon-background.png",
        monochromeImage: "./assets/images/android-icon-monochrome.png",
      },
      permissions: [
        "android.permission.RECORD_AUDIO",
        "android.permission.CAMERA",
      ],
      blockedPermissions: [
        "android.permission.READ_EXTERNAL_STORAGE",
        "android.permission.WRITE_EXTERNAL_STORAGE",
        "android.permission.ACCESS_FINE_LOCATION",
        "android.permission.ACCESS_COARSE_LOCATION",
        "android.permission.READ_MEDIA_IMAGES",
        "android.permission.READ_MEDIA_VIDEO",
        "android.permission.READ_MEDIA_AUDIO",
        "android.permission.SYSTEM_ALERT_WINDOW",
      ],
      ...(apiHost
        ? {
            intentFilters: [
              {
                action: "VIEW",
                autoVerify: true,
                category: ["BROWSABLE", "DEFAULT"],
                data: [
                  {
                    scheme: "https",
                    host: apiHost,
                    pathPrefix: "/verify",
                  },
                ],
              },
            ],
          }
        : {}),
    },
    plugins: [
      "expo-router",
      [
        "expo-splash-screen",
        {
          backgroundColor: "#F2F2F7",
          image: "./assets/images/splash-icon.png",
          imageWidth: 76,
        },
      ],
      [
        "expo-audio",
        {
          microphonePermission:
            "DukaanOS uses your microphone to log Urdu sales and khata entries. / آواز سے حساب لکھنے کے لیے مائیک کی اجازت دیں۔",
          enableBackgroundPlayback: false,
          enableBackgroundRecording: false,
        },
      ],
      [
        "expo-camera",
        {
          cameraPermission:
            "DukaanOS uses your camera to scan wholesale parchi bills. / پرچی اسکین کرنے کے لیے کیمرے کی اجازت دیں۔",
          recordAudioAndroid: false,
          barcodeScannerEnabled: false,
        },
      ],
      "expo-sqlite",
      [
        "expo-secure-store",
        {
          configureAndroidBackup: false,
        },
      ],
      [
        "expo-local-authentication",
        {
          faceIDPermission:
            "Use biometrics to lock your DukaanOS shop ledger.",
        },
      ],
      "expo-sharing",
      "expo-localization",
      "expo-font",
    ],
    experiments: {
      typedRoutes: true,
    },
  };
};
