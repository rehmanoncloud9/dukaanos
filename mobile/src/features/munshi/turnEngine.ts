import type { FeedTx, PaymentProposal, Pulse, SaleProposal, TurnResponse, TurnTrace } from "@/core/api/types";
import type { FlushOutcome } from "@/core/offline/queue";

export type TurnAction =
  | { type: "auto_commit_sale"; proposal: SaleProposal; key: string; trace: TurnTrace }
  | { type: "open_sale_review"; proposal: SaleProposal; key: string; trace: TurnTrace }
  | { type: "open_payment"; proposal: PaymentProposal; key: string; trace: TurnTrace }
  | { type: "open_reversal"; target: FeedTx | null; key: string; trace: TurnTrace }
  | { type: "open_pulse"; pulse: Pulse; trace: TurnTrace }
  | { type: "open_answer"; answer: string; proposal: SaleProposal | PaymentProposal | null; tools: { name: string; ms: number }[]; trace: TurnTrace }
  | { type: "open_parchi"; trace: TurnTrace }
  | { type: "unknown"; transcript: string; trace: TurnTrace };

export function classifyTurnResponse(res: TurnResponse, key: string): TurnAction {
  switch (res.kind) {
    case "sale":
      if (res.proposal.tier === 1) {
        return { type: "auto_commit_sale", proposal: res.proposal, key, trace: res.trace };
      }
      return { type: "open_sale_review", proposal: res.proposal, key, trace: res.trace };
    case "payment":
      return { type: "open_payment", proposal: res.proposal, key, trace: res.trace };
    case "reversal":
      return { type: "open_reversal", target: res.target, key, trace: res.trace };
    case "pulse":
      return { type: "open_pulse", pulse: res.pulse, trace: res.trace };
    case "answer":
      return {
        type: "open_answer",
        answer: res.answer,
        proposal: res.proposal,
        tools: res.tools,
        trace: res.trace,
      };
    case "purchase":
      return { type: "open_parchi", trace: res.trace };
    default:
      return { type: "unknown", transcript: res.trace.transcript ?? "", trace: res.trace };
  }
}

export function deferredFlushOutcome(res: TurnResponse): FlushOutcome {
  switch (res.kind) {
    case "sale":
      if (res.proposal.tier === 1) return "done";
      return { status: "review", patch: { review_kind: "sale", proposal: res.proposal, trace: res.trace } };
    case "payment":
      return { status: "review", patch: { review_kind: "payment", proposal: res.proposal, trace: res.trace } };
    case "reversal":
      return { status: "review", patch: { review_kind: "reversal", target: res.target, trace: res.trace } };
    default:
      return "done";
  }
}
