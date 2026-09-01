export type RackCapacitySavePayloadInput<TChanges> = {
  changes: TChanges;
  expectedRowVersion: number | null;
  initialize: boolean;
  carryForwardSourceMonth?: string | null;
  carryForwardSourceRowVersion?: number;
};

export type RackCapacitySavePayload<TChanges> = {
  changes: TChanges;
  expected_row_version: number | null;
  initialize: boolean;
  carry_forward_source_month?: string;
  carry_forward_source_row_version?: number;
  force_snapshot: true;
};

export function buildRackCapacitySavePayload<TChanges>({
  changes,
  expectedRowVersion,
  initialize,
  carryForwardSourceMonth,
  carryForwardSourceRowVersion
}: RackCapacitySavePayloadInput<TChanges>): RackCapacitySavePayload<TChanges> {
  const payload: RackCapacitySavePayload<TChanges> = {
    changes,
    expected_row_version: expectedRowVersion,
    initialize,
    force_snapshot: true
  };
  if (initialize && carryForwardSourceMonth != null) payload.carry_forward_source_month = carryForwardSourceMonth;
  if (initialize && carryForwardSourceRowVersion !== undefined) payload.carry_forward_source_row_version = carryForwardSourceRowVersion;
  return payload;
}
