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
  | 'RedeemExceedsDebt'
  /** Not available in the group's current mode. */
  | 'WrongMode'
  | 'RulesNotAdopted'
  | 'AlreadyAdopted'
  | 'AlreadyCheckedIn'
  | 'NotAWorkday'
  /** The rules set a workplace and this check-in came without a position. */
  | 'LocationRequired'
  | 'OutsideWorkplace'
  /** The position is too vague to tell (see `checkPlace`). */
  | 'LocationUncertain';

export interface DomainError {
  code: DomainErrorCode;
  message: string;
  /** Extra data for the UI, e.g. the existing record for DuplicateWorkDate. */
  detail?: Record<string, unknown>;
}

export const domainError = (code: DomainErrorCode, message: string, detail?: Record<string, unknown>): DomainError =>
  detail ? { code, message, detail } : { code, message };
