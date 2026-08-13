import type { UpsGroupConfig } from "./upsGroupAggregation";

/**
 * Per-facility UPS group topology (device -> group mapping + rated
 * capacity), ported verbatim from Desktop's config/<facility>/profile.json
 * ("dashboard.upsGroups") - the only source of this hardware topology
 * today; CleanWebApp/Supabase has no admin-editable equivalent yet (see
 * dashboardUpsMapping.ts's existing comment on the same gap). Keyed by the
 * facility code as stored in public.sites.code and in the real XLSM
 * workbooks' own "2. UPS Group History" Facility column ("rangsit" /
 * "srinakarin"), confirmed by direct inspection of both DC_Rangsit.xlsm and
 * DC_Srinakarin.xlsm.
 *
 * Same precedent as SRINAKARIN_OVERALL_GROUPS in engineeringDashboard.ts:
 * porting Desktop's fixed hardware config into shared code rather than
 * inventing a new config layer outside this sprint's scope.
 */
export const UPS_GROUP_TOPOLOGY: Record<string, UpsGroupConfig[]> = {
  rangsit: [
    { name: "UPS 11", ids: ["UPS 11A", "UPS 11B"], capacity: 400 },
    { name: "UPS 13", ids: ["UPS 13A", "UPS 13B"], capacity: 400 },
    { name: "UPS 14", ids: ["UPS 14C"], capacity: 120 },
    { name: "UPS 15 (PPC44A, PPC44B)", ids: ["UPS 15A (PPC44A)", "UPS 15B (PPC44B)"], capacity: 400 }
  ],
  srinakarin: [
    { name: "UPS 41", ids: ["UPS 41A", "UPS 41B"], capacity: 400 },
    { name: "PPC 41", ids: ["PPC 41A", "PPC 41B"], capacity: 400 },
    { name: "PPC 42", ids: ["PPC 42A", "PPC 42B"], capacity: 400 },
    { name: "PPC 43", ids: ["PPC 43A", "PPC 43B"], capacity: 400 },
    { name: "PPC 44", ids: ["PPC 44A", "PPC 44B"], capacity: 400 }
  ]
};

/** Never guesses: an unrecognized facility code returns null, not a
 *  fabricated or borrowed topology from another facility. */
export function getUpsGroupTopology(facilityCode: string): UpsGroupConfig[] | null {
  return UPS_GROUP_TOPOLOGY[facilityCode.trim().toLowerCase()] ?? null;
}
