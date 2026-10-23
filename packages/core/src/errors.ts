export type DomainErrorCode =
  | 'InvalidInput'
  | 'NotPermitted'
  | 'PlayerNotFound'
  | 'TargetNotFound'
  | 'NoChange'
  | 'InvalidRuleset'
  | 'DuplicateWorkDate'
  | 'AlreadyClosed'
  | 'CorrectionToZero'
  | 'RetractWindowClosed'
  | 'ReasonRequired'
  | 'NoEligibleVoters'
  | 'ProposalAlreadyOpen'
  | 'ProposalClosed'
  | 'NotAVoter'
  | 'AlreadyVoted'
  | 'NothingToRedeem'
  | 'RedeemExceedsDebt';

export interface DomainError {
  code: DomainErrorCode;
  message: string;
  /** Extra data for the UI, e.g. the existing record for DuplicateWorkDate. */
  detail?: Record<string, unknown>;
}

export const domainError = (code: DomainErrorCode, message: string, detail?: Record<string, unknown>): DomainError =>
  detail ? { code, message, detail } : { code, message };
