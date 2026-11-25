import { Linking } from "react-native";
import type { StateCustomer } from "@contracts";
import { normalizePkPhone, reminderText, smsLink, waLink } from "@domain/messages";

export async function openWhatsAppReminder(opts: {
  customer: Pick<StateCustomer, "name" | "phone" | "balance_paisa" | "days_overdue">;
  shopName: string;
  onError?: (msg: string) => void;
}): Promise<boolean> {
  const msg = reminderText({
    name: opts.customer.name,
    shop: opts.shopName,
    balance_paisa: opts.customer.balance_paisa,
    days_overdue: opts.customer.days_overdue,
  });
  const pkPhone = normalizePkPhone(opts.customer.phone);
  const nativeUrl = pkPhone
    ? `whatsapp://send?phone=${pkPhone}&text=${encodeURIComponent(msg)}`
    : `whatsapp://send?text=${encodeURIComponent(msg)}`;
  const webFallback = waLink(opts.customer.phone, msg);

  try {
    const canNative = await Linking.canOpenURL(nativeUrl);
    await Linking.openURL(canNative ? nativeUrl : webFallback);
    return true;
  } catch {
    try {
      await Linking.openURL(webFallback);
      return true;
    } catch {
      opts.onError?.("WhatsApp open nahi ho saka — SMS (2G) try karein");
      return false;
    }
  }
}

export async function openSmsReminder(opts: {
  customer: Pick<StateCustomer, "name" | "phone" | "balance_paisa" | "days_overdue">;
  shopName: string;
  onError?: (msg: string) => void;
}): Promise<boolean> {
  const msg = reminderText({
    name: opts.customer.name,
    shop: opts.shopName,
    balance_paisa: opts.customer.balance_paisa,
    days_overdue: opts.customer.days_overdue,
  });
  const url = smsLink(opts.customer.phone, msg);
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    opts.onError?.("SMS app open nahi ho saki");
    return false;
  }
}
